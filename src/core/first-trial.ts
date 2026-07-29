import { AppError } from "./app-error";
import { canonicalJson, sha256Hex } from "./crypto";

export const FIRST_TRIAL_COLLECTOR = "interessenten_first_trial";
export const FIRST_TRIAL_EVENT_TYPE = "prospect.first_trial_contact_due";

export type ContactChannel = "email" | "sms" | "staff_task";

export interface FirstTrialPolicy {
  contactLeadMinutes: number;
  lookbackMinutes: number;
  contactChannel: ContactChannel;
}

export interface ProspectFirstTrial {
  prospectId: string;
  trialAppointmentId: string;
  firstTrialStartsAt: string;
  firstName: string | null;
  email: string | null;
  phone: string | null;
  locationCode: string | null;
}

export type EligibilityState =
  | "pending"
  | "due"
  | "stale"
  | "excluded";

export interface EligibilityResult {
  state: EligibilityState;
  reason:
    | "contact_window_not_reached"
    | "contact_due"
    | "contact_window_expired"
    | "trial_already_started"
    | "missing_email"
    | "missing_phone";
  dueAt: string;
}

export interface ProspectContactEvent {
  eventId: string;
  eventType: typeof FIRST_TRIAL_EVENT_TYPE;
  payloadVersion: 1;
  sourceKey: string;
  occurredAt: string;
  prospect: {
    firstName: string | null;
    email: string | null;
    phone: string | null;
  };
  firstTrial: {
    appointmentId: string;
    startsAt: string;
    locationCode: string | null;
  };
  contact: {
    channel: ContactChannel;
    dueAt: string;
  };
}

export function validatePolicy(policy: FirstTrialPolicy): void {
  if (
    !Number.isInteger(policy.contactLeadMinutes) ||
    policy.contactLeadMinutes <= 0
  ) {
    throw new AppError(
      "invalid_contact_lead",
      422,
      "Der Kontaktvorlauf muss eine positive Anzahl Minuten sein."
    );
  }

  if (
    !Number.isInteger(policy.lookbackMinutes) ||
    policy.lookbackMinutes < 0
  ) {
    throw new AppError(
      "invalid_contact_lookback",
      422,
      "Das Nachholfenster darf nicht negativ sein."
    );
  }
}

export function validateProspect(record: ProspectFirstTrial): void {
  if (record.prospectId.trim().length === 0) {
    throw new AppError(
      "missing_prospect_id",
      422,
      "Eine stabile Interessenten-ID fehlt."
    );
  }

  if (record.trialAppointmentId.trim().length === 0) {
    throw new AppError(
      "missing_trial_appointment_id",
      422,
      "Eine stabile Probetraining-Termin-ID fehlt."
    );
  }

  const trialTimestamp = Date.parse(record.firstTrialStartsAt);
  if (!Number.isFinite(trialTimestamp)) {
    throw new AppError(
      "invalid_first_trial_timestamp",
      422,
      "Der Zeitpunkt des ersten Probetrainings ist ungültig."
    );
  }
}

export function evaluateFirstTrialContact(
  record: ProspectFirstTrial,
  policy: FirstTrialPolicy,
  now: Date
): EligibilityResult {
  validateProspect(record);
  validatePolicy(policy);

  const trialTimestamp = Date.parse(record.firstTrialStartsAt);
  const dueTimestamp = trialTimestamp - policy.contactLeadMinutes * 60_000;
  const windowEndTimestamp = dueTimestamp + policy.lookbackMinutes * 60_000;
  const dueAt = new Date(dueTimestamp).toISOString();

  if (policy.contactChannel === "email" && !record.email) {
    return {
      state: "excluded",
      reason: "missing_email",
      dueAt
    };
  }

  if (policy.contactChannel === "sms" && !record.phone) {
    return {
      state: "excluded",
      reason: "missing_phone",
      dueAt
    };
  }

  const nowTimestamp = now.getTime();
  if (nowTimestamp >= trialTimestamp) {
    return {
      state: "stale",
      reason: "trial_already_started",
      dueAt
    };
  }

  if (nowTimestamp < dueTimestamp) {
    return {
      state: "pending",
      reason: "contact_window_not_reached",
      dueAt
    };
  }

  if (nowTimestamp > windowEndTimestamp) {
    return {
      state: "stale",
      reason: "contact_window_expired",
      dueAt
    };
  }

  return {
    state: "due",
    reason: "contact_due",
    dueAt
  };
}

export function buildProspectSourceKey(record: ProspectFirstTrial): string {
  validateProspect(record);
  return `matool:prospect:${record.prospectId}`;
}

export async function buildFirstTrialEventId(
  record: ProspectFirstTrial
): Promise<string> {
  validateProspect(record);
  return sha256Hex(
    [
      "matool",
      "prospect-first-trial",
      record.prospectId,
      record.trialAppointmentId,
      FIRST_TRIAL_EVENT_TYPE
    ].join(":")
  );
}

export async function buildSourceRevision(
  record: ProspectFirstTrial
): Promise<string> {
  validateProspect(record);
  return sha256Hex(canonicalJson(record));
}

export async function buildProspectContactEvent(
  record: ProspectFirstTrial,
  policy: FirstTrialPolicy,
  now: Date
): Promise<ProspectContactEvent> {
  const eligibility = evaluateFirstTrialContact(record, policy, now);
  if (eligibility.state !== "due") {
    throw new AppError(
      "contact_not_due",
      409,
      "Für diesen Interessenten ist aktuell kein Kontakt fällig."
    );
  }

  return {
    eventId: await buildFirstTrialEventId(record),
    eventType: FIRST_TRIAL_EVENT_TYPE,
    payloadVersion: 1,
    sourceKey: buildProspectSourceKey(record),
    occurredAt: now.toISOString(),
    prospect: {
      firstName: record.firstName,
      email: record.email,
      phone: record.phone
    },
    firstTrial: {
      appointmentId: record.trialAppointmentId,
      startsAt: record.firstTrialStartsAt,
      locationCode: record.locationCode
    },
    contact: {
      channel: policy.contactChannel,
      dueAt: eligibility.dueAt
    }
  };
}

export function parseProspectContactEventJson(
  value: string
): ProspectContactEvent {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw invalidEventPayload();
  }

  if (!isRecord(parsed)) {
    throw invalidEventPayload();
  }

  const prospect = parsed.prospect;
  const firstTrial = parsed.firstTrial;
  const contact = parsed.contact;
  if (
    typeof parsed.eventId !== "string" ||
    !/^[a-f0-9]{64}$/u.test(parsed.eventId) ||
    parsed.eventType !== FIRST_TRIAL_EVENT_TYPE ||
    parsed.payloadVersion !== 1 ||
    typeof parsed.sourceKey !== "string" ||
    parsed.sourceKey.length === 0 ||
    !isIsoTimestamp(parsed.occurredAt) ||
    !isRecord(prospect) ||
    !isNullableString(prospect.firstName) ||
    !isNullableString(prospect.email) ||
    !isNullableString(prospect.phone) ||
    !isRecord(firstTrial) ||
    typeof firstTrial.appointmentId !== "string" ||
    firstTrial.appointmentId.length === 0 ||
    !isIsoTimestamp(firstTrial.startsAt) ||
    !isNullableString(firstTrial.locationCode) ||
    !isRecord(contact) ||
    (contact.channel !== "email" &&
      contact.channel !== "sms" &&
      contact.channel !== "staff_task") ||
    !isIsoTimestamp(contact.dueAt)
  ) {
    throw invalidEventPayload();
  }

  return parsed as unknown as ProspectContactEvent;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === "string";
}

function isIsoTimestamp(value: unknown): value is string {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

function invalidEventPayload(): AppError {
  return new AppError(
    "invalid_event_payload",
    500,
    "Ein gespeichertes Ereignis ist ungültig."
  );
}
