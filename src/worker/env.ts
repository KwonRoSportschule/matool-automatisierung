export interface Env {
  ASSETS: Fetcher;
  DB: D1Database;
  INTERESSENTEN_SYNC_WORKFLOW: Workflow<InteressentenSyncWorkflowParams>;

  APP_ENV: "local" | "test" | "staging" | "production";
  ACCESS_AUD: string;
  ACCESS_SERVICE_AUD: string;
  ACCESS_TEAM_DOMAIN: string;
  MATOOL_BASE_URL: string;
  OUTBOUND_DELIVERY_ENABLED: string;
  /**
   * UTC-Zeitpunkt; aeltere Aenderungen stellt der Worker nie per Webhook zu.
   * Verhindert, dass beim Einschalten ein Rueckstau alte Zaps ausloest.
   */
  OUTBOUND_DELIVERY_START_AT?: string;
  PUBLIC_DASHBOARD_FULL_ACCESS?: string;
  PUBLIC_DASHBOARD_READ_ONLY?: string;
  /**
   * "true" zeigt Datensatzwerte auch ohne Access-Anmeldung im Klartext.
   * Ausdrücklich für die Testphase mit MATOOL-Testdaten gesetzt. Vor dem
   * ersten Echtdatenlauf auf "false" stellen.
   */
  PUBLIC_DASHBOARD_PLAINTEXT?: string;

  /**
   * Benutzername und Passwort fuer das Dashboard (HTTP Basic Auth).
   * Ausschliesslich als Cloudflare Secret setzen. Sind beide gesetzt, gilt
   * der Passwortschutz fuer Webseite und Admin-API; die oeffentlichen
   * PUBLIC_DASHBOARD_*-Modi greifen dann nicht mehr.
   */
  DASHBOARD_USERNAME?: string;
  DASHBOARD_PASSWORD?: string;
  /** "true" sperrt das Dashboard, solange die beiden Secrets fehlen. */
  DASHBOARD_PASSWORD_REQUIRED?: string;
  /**
   * "true" verlangt zusaetzlich zum Passwort eine Cloudflare-Access-Anmeldung
   * (zweiter Faktor, z. B. Einmalcode per E-Mail). Erst setzen, wenn Access
   * die Worker-Adresse tatsaechlich schuetzt.
   */
  DASHBOARD_REQUIRE_CLOUDFLARE_ACCESS?: string;

  /**
   * Zufallstext (mindestens 32 Zeichen) als Cloudflare Secret. Daraus
   * entsteht der AES-256-GCM-Schluessel fuer alle MATOOL-Nutzlasten in D1.
   */
  DATA_ENCRYPTION_KEY?: string;
  /** Vorheriger Schluessel, nur zum Lesen waehrend eines Schluesselwechsels. */
  DATA_ENCRYPTION_KEY_PREVIOUS?: string;
  /** "true" verweigert das Speichern neuer Nutzlasten ohne Schluessel. */
  DATA_ENCRYPTION_REQUIRED?: string;
  /**
   * Tage, nach denen Kopien alter Datensatzstaende in der Aenderungshistorie
   * geloescht werden. Standard: 30.
   */
  CHANGE_PAYLOAD_RETENTION_DAYS?: string;

  ADMIN_ORIGIN?: string;
  CSRF_SECRET?: string;
  DEV_AUTH_BYPASS?: string;

  /**
   * Beitragsuebersicht: "monat" (Standard), wenn der MATOOL-Wert `beitrag`
   * bereits der Monatsbetrag ist; "zahlungsperiode", wenn er je
   * Zahlungsperiode gilt und auf einen Monat umgerechnet werden muss.
   */
  BEITRAEGE_BETRAGSBEZUG?: string;
  /** Kommagetrennte Felder, in denen eine Stilllegung steht. */
  BEITRAEGE_STILLLEGUNG_FELDER?: string;
  /**
   * Kommagetrennte Muster fuer stillgelegte Mitglieder, ohne Gross- und
   * Kleinschreibung. "=wert" verlangt eine exakte Uebereinstimmung.
   */
  BEITRAEGE_STILLLEGUNG_MUSTER?: string;

  MATOOL_EMAIL?: string;
  MATOOL_PASSWORD?: string;
  MATOOL_REAL_RUNS_ENABLED?: string;

  ZAPIER_SERVICE_TOKEN?: string;
  ZAPIER_WEBHOOK_SIGNING_SECRET?: string;
}

export interface InteressentenSyncWorkflowParams {
  requestedAt: string;
  trigger: "manual" | "scheduled";
}
