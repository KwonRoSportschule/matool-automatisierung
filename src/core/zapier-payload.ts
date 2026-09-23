/**
 * Member-detail responses also contain bank and payment information. Zapier
 * receives only the data required for the approved member, contract and
 * onboarding workflows; the raw MATOOL response stays in D1.
 */
const ZAPIER_MEMBER_DETAIL_FIELDS = [
  "abschluss",
  "anrede",
  "email",
  "handy",
  "klassenliste",
  "kuendigungsfrist",
  "kundenart",
  "name",
  "pruefung_ohnegebuehr",
  "schueler_nr",
  "spartenliste",
  "telefon",
  "vertrag",
  "vertragid",
  "vertragsbeginn",
  "vertragsdatum",
  "vertragsende",
  "verlaengerung",
  "vname"
] as const;

/**
 * Projects a stored MATOOL snapshot to the least-privilege Zapier payload.
 * The projection is intentionally applied at both the hook-delivery and
 * sample-list API boundaries.
 */
export function projectSnapshotPayloadForZapier(
  area: string,
  payload: Readonly<Record<string, unknown>>
): Record<string, unknown> {
  if (area !== "schueler_details") {
    return { ...payload };
  }

  const projected: Record<string, unknown> = {};
  for (const field of ZAPIER_MEMBER_DETAIL_FIELDS) {
    if (Object.hasOwn(payload, field)) {
      projected[field] = payload[field];
    }
  }
  return projected;
}
