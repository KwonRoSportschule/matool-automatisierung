const BERLIN_TIME_ZONE = "Europe/Berlin";
const FIRST_ALLOWED_HOUR = 9;
const LAST_ALLOWED_HOUR = 19;

const berlinDateTimeFormatter = new Intl.DateTimeFormat("en-CA", {
  day: "2-digit",
  hour: "2-digit",
  hourCycle: "h23",
  month: "2-digit",
  timeZone: BERLIN_TIME_ZONE,
  year: "numeric"
});

export type SchleswigHolsteinHoliday =
  | "ascension_day"
  | "christmas_day"
  | "easter_monday"
  | "german_unity_day"
  | "good_friday"
  | "labour_day"
  | "new_years_day"
  | "reformation_day"
  | "second_christmas_day"
  | "whit_monday";

export type ScheduleWindowDecision =
  | {
      allowed: true;
      localDate: string;
      localHour: number;
      reason: "within_window";
    }
  | {
      allowed: false;
      holiday?: SchleswigHolsteinHoliday;
      localDate: string;
      localHour: number;
      reason: "outside_hours" | "public_holiday" | "weekend";
    };

interface CalendarDate {
  day: number;
  month: number;
  year: number;
}

interface BerlinDateTime extends CalendarDate {
  hour: number;
}

export interface BerlinScheduleSummary {
  description: string;
  nextScheduledAt: string;
  previousScheduledAt: string;
  timeZone: typeof BERLIN_TIME_ZONE;
}

export function evaluateBerlinScheduleWindow(
  scheduledTime: number | Date
): ScheduleWindowDecision {
  const instant =
    scheduledTime instanceof Date
      ? new Date(scheduledTime.getTime())
      : new Date(scheduledTime);
  if (!Number.isFinite(instant.getTime())) {
    throw new RangeError("scheduledTime must be a valid instant");
  }

  const local = getBerlinDateTime(instant);
  const localDate = toDateKey(local);
  const holiday = getSchleswigHolsteinHoliday(local);
  if (holiday) {
    return {
      allowed: false,
      holiday,
      localDate,
      localHour: local.hour,
      reason: "public_holiday"
    };
  }

  const weekday = new Date(
    Date.UTC(local.year, local.month - 1, local.day)
  ).getUTCDay();
  if (weekday === 0 || weekday === 6) {
    return {
      allowed: false,
      localDate,
      localHour: local.hour,
      reason: "weekend"
    };
  }

  if (
    local.hour < FIRST_ALLOWED_HOUR ||
    local.hour > LAST_ALLOWED_HOUR
  ) {
    return {
      allowed: false,
      localDate,
      localHour: local.hour,
      reason: "outside_hours"
    };
  }

  return {
    allowed: true,
    localDate,
    localHour: local.hour,
    reason: "within_window"
  };
}

export function getBerlinScheduleSummary(
  now: number | Date = Date.now()
): BerlinScheduleSummary {
  const instant =
    now instanceof Date ? new Date(now.getTime()) : new Date(now);
  if (!Number.isFinite(instant.getTime())) {
    throw new RangeError("now must be a valid instant");
  }

  const hour = new Date(instant.getTime());
  hour.setUTCMinutes(0, 0, 0);
  const previousScheduledAt = findScheduledHour(hour, -1, instant.getTime());

  const nextStart = new Date(hour.getTime());
  if (nextStart.getTime() <= instant.getTime()) {
    nextStart.setUTCHours(nextStart.getUTCHours() + 1);
  }
  const nextScheduledAt = findScheduledHour(
    nextStart,
    1,
    instant.getTime()
  );

  return {
    description:
      "Montag bis Freitag, jede volle Stunde von 09:00 bis 19:00 Uhr, ausgenommen Feiertage in Schleswig-Holstein.",
    nextScheduledAt: nextScheduledAt.toISOString(),
    previousScheduledAt: previousScheduledAt.toISOString(),
    timeZone: BERLIN_TIME_ZONE
  };
}

function findScheduledHour(
  start: Date,
  direction: -1 | 1,
  now: number
): Date {
  const candidate = new Date(start.getTime());
  for (let offset = 0; offset < 24 * 21; offset += 1) {
    const decision = evaluateBerlinScheduleWindow(candidate);
    if (
      decision.allowed &&
      (direction === -1
        ? candidate.getTime() <= now
        : candidate.getTime() > now)
    ) {
      return candidate;
    }
    candidate.setUTCHours(candidate.getUTCHours() + direction);
  }
  throw new RangeError("scheduled hour could not be resolved");
}

function getBerlinDateTime(instant: Date): BerlinDateTime {
  const parts = berlinDateTimeFormatter.formatToParts(instant);
  return {
    day: getNumericPart(parts, "day"),
    hour: getNumericPart(parts, "hour"),
    month: getNumericPart(parts, "month"),
    year: getNumericPart(parts, "year")
  };
}

function getNumericPart(
  parts: Intl.DateTimeFormatPart[],
  type: Intl.DateTimeFormatPartTypes
): number {
  const value = parts.find((part) => part.type === type)?.value;
  if (!value) {
    throw new Error(`Intl.DateTimeFormat did not provide ${type}`);
  }
  return Number.parseInt(value, 10);
}

function getSchleswigHolsteinHoliday(
  date: CalendarDate
): SchleswigHolsteinHoliday | undefined {
  const holidays = new Map<string, SchleswigHolsteinHoliday>([
    [`${date.year}-01-01`, "new_years_day"],
    [`${date.year}-05-01`, "labour_day"],
    [`${date.year}-10-03`, "german_unity_day"],
    [`${date.year}-10-31`, "reformation_day"],
    [`${date.year}-12-25`, "christmas_day"],
    [`${date.year}-12-26`, "second_christmas_day"]
  ]);
  const easterSunday = getGregorianEasterSunday(date.year);
  holidays.set(toDateKey(addCalendarDays(easterSunday, -2)), "good_friday");
  holidays.set(toDateKey(addCalendarDays(easterSunday, 1)), "easter_monday");
  holidays.set(
    toDateKey(addCalendarDays(easterSunday, 39)),
    "ascension_day"
  );
  holidays.set(toDateKey(addCalendarDays(easterSunday, 50)), "whit_monday");

  return holidays.get(toDateKey(date));
}

function getGregorianEasterSunday(year: number): CalendarDate {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const easterOffset = h + l - 7 * m + 114;

  return {
    day: (easterOffset % 31) + 1,
    month: Math.floor(easterOffset / 31),
    year
  };
}

function addCalendarDays(
  date: CalendarDate,
  days: number
): CalendarDate {
  const result = new Date(
    Date.UTC(date.year, date.month - 1, date.day + days)
  );
  return {
    day: result.getUTCDate(),
    month: result.getUTCMonth() + 1,
    year: result.getUTCFullYear()
  };
}

function toDateKey(date: CalendarDate): string {
  return [
    date.year.toString().padStart(4, "0"),
    date.month.toString().padStart(2, "0"),
    date.day.toString().padStart(2, "0")
  ].join("-");
}
