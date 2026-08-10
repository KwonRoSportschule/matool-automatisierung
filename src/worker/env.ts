export interface Env {
  ASSETS: Fetcher;
  DB: D1Database;

  APP_ENV: "local" | "test" | "staging" | "production";
  ACCESS_AUD: string;
  ACCESS_SERVICE_AUD: string;
  ACCESS_TEAM_DOMAIN: string;
  MATOOL_BASE_URL: string;
  OUTBOUND_DELIVERY_ENABLED: string;
  PUBLIC_DASHBOARD_READ_ONLY?: string;
  /**
   * "true" zeigt Datensatzwerte auch ohne Access-Anmeldung im Klartext.
   * Ausdrücklich für die Testphase mit MATOOL-Testdaten gesetzt. Vor dem
   * ersten Echtdatenlauf auf "false" stellen.
   */
  PUBLIC_DASHBOARD_PLAINTEXT?: string;

  ADMIN_ORIGIN?: string;
  CSRF_SECRET?: string;
  DEV_AUTH_BYPASS?: string;

  MATOOL_EMAIL?: string;
  MATOOL_PASSWORD?: string;
  MATOOL_REAL_RUNS_ENABLED?: string;

  ZAPIER_SERVICE_TOKEN?: string;
  ZAPIER_WEBHOOK_SIGNING_SECRET?: string;
}
