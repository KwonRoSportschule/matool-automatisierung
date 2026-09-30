/**
 * Verständliche Erklärungen für technische Fehlercodes. Der Code selbst
 * bleibt in Klammern sichtbar, damit er sich im Verlauf und in den Logs
 * wiederfinden lässt.
 */
const ERROR_LABELS: Readonly<Record<string, string>> = {
  internal_error: "Unerwarteter interner Fehler",
  manual_sync_abandoned: "Manueller Abruf ohne Lebenszeichen abgebrochen",
  manual_sync_fill_failed: "Nachlesen der Stilllegungen fehlgeschlagen",
  manual_sync_lease_timeout: "Ein anderer Abruf lief länger als 30 Minuten",
  manual_sync_workflow_unavailable: "Manueller Abruf konnte nicht gestartet werden",
  matool_authentication_unverified: "MATOOL-Sitzung abgelaufen oder Anmeldung nicht bestätigt",
  matool_exact_source_implausible_shrink:
    "Liste unplausibel kleiner als beim letzten Abruf – zum Schutz des Bestands nicht übernommen",
  matool_exact_source_mismatch:
    "Zwei Kontrollabrufe waren nicht identisch (Daten änderten sich während des Abrufs)",
  matool_exact_sync_busy: "Ein anderer Abruf lief gerade",
  matool_exact_sync_lease_lost: "Abrufsperre an einen anderen Lauf verloren",
  matool_exact_sync_lease_store_failed: "Datenbank kurz nicht erreichbar",
  matool_login_failed: "Anmeldung bei MATOOL fehlgeschlagen – Zugangsdaten prüfen",
  matool_network_error: "MATOOL war nicht erreichbar (Verbindung abgebrochen)",
  matool_not_configured: "MATOOL-Zugangsdaten fehlen",
  matool_run_aborted: "Lauf wurde von Cloudflare abgebrochen",
  matool_runs_not_confirmed: "Echtdaten-Abrufe sind nicht freigegeben",
  matool_schueler_open_failed: "Mitglied konnte in MATOOL nicht geöffnet werden",
  matool_session_prime_failed: "MATOOL-Sitzung konnte nicht gestartet werden",
  matool_snapshot_persistence_failed: "Speichern in der Datenbank fehlgeschlagen",
  matool_subrequest_limit: "Anfragekontingent des Laufs aufgebraucht",
  matool_sync_store_unavailable: "Laufstatus konnte nicht gespeichert werden",
  matool_time_budget_exhausted: "Zeitbudget aufgebraucht – folgt im nächsten Lauf",
  matool_unexpected_content_type: "MATOOL hat eine unerwartete Seite geliefert",
  matool_unexpected_status: "MATOOL hat mit einem Serverfehler geantwortet",
  one_or_more_areas_failed: "Mindestens ein Bereich ist fehlgeschlagen",
  // Gründe für ausgelassene Stundenläufe.
  lease_busy: "Ein anderer Abruf lief noch",
  outside_schedule_window: "Außerhalb des Zeitfensters (Werktage 9–19 Uhr)",
  previous_run_active: "Der vorherige Lauf war noch nicht fertig",
  real_runs_not_confirmed: "Echtdaten-Abrufe sind nicht freigegeben",
  workflow_unavailable: "Abruf-Workflow war nicht erreichbar"
};

/** "Erklärung (code)" – oder nur der Code, wenn er unbekannt ist. */
export function errorLabel(code: string | null | undefined): string {
  if (!code) {
    return "";
  }
  const known = ERROR_LABELS[code];
  if (known) {
    return `${known} (${code})`;
  }
  if (code.endsWith("_schema_mismatch")) {
    return `MATOOL hat die Seite anders aufgebaut als erwartet (${code})`;
  }
  return code;
}
