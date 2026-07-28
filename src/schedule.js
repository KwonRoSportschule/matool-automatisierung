const WORKDAYS = new Set(["Mon", "Tue", "Wed", "Thu", "Fri"]);

/** Return whether an instant is one of the hourly 08:00–20:00 Berlin runs. */
export function isOperatingTime(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Berlin",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
  const hour = Number(values.hour);
  const minute = Number(values.minute);

  return WORKDAYS.has(values.weekday) && hour >= 8 && hour <= 20 && minute === 0;
}
