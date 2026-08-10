export type DashboardState =
  | "healthy"
  | "warning"
  | "critical"
  | "inactive"
  | "unknown";

export type RunStatus =
  | "failed"
  | "info"
  | "partial_failed"
  | "running"
  | "skipped"
  | "succeeded"
  | "warning";

export interface PrivacySummary {
  masked: boolean;
  mode: string;
  notice: string;
}

export interface DashboardErrorSummary {
  at: string | null;
  code: string | null;
  httpStatus?: number | null;
}

export interface ConnectionSummary {
  action: string | null;
  checkedAt: string | null;
  configured?: boolean;
  description: string;
  key: "database" | "matool" | "schedule" | "zapier" | string;
  label: string;
  lastActivityAt: string | null;
  lastError: DashboardErrorSummary | null;
  lastSuccessAt: string | null;
  state: DashboardState;
  statusLabel: string;
  activeSubscriptions?: number;
  delayMinutes?: number | null;
  nextScheduledAt?: string;
  outboundEnabled?: boolean;
  pendingOutbox?: number;
  previousScheduledAt?: string;
  unconfirmedClaims?: number;
}

export interface DashboardRunSummary {
  errorCode: string | null;
  failureCount: number;
  fetchedCount: number;
  finishedAt: string;
  id: string;
  startedAt: string;
  status: "failed" | "succeeded";
  successCount: number;
}

export interface AreaSummary {
  changedCount: number;
  currentCount: number;
  firstSeenAt: string | null;
  key: string;
  label: string;
  lastChangedAt: string | null;
  lastObservedAt: string | null;
  lastRun: DashboardRunSummary | null;
  lastSuccessfulRun: DashboardRunSummary | null;
  newCount: number;
  state: DashboardState;
  storedCount: number;
}

export interface ChartPoint {
  changed: number;
  failed: number;
  label: string;
  new: number;
  successful: number;
}

export interface FunctionSummary {
  areas: string[];
  dependencies: string[];
  description: string;
  execution: "automatic" | "automatic_and_manual" | "manual" | "on_demand" | string;
  key: string;
  lastRunAt: string | null;
  name: string;
  state: "disabled" | "enabled" | "unavailable" | string;
}

export interface WarningSummary {
  action: string | null;
  impact: string;
  key: string;
  occurredAt: string | null;
  state: "critical" | "warning";
  technicalCode: string | null;
  title: string;
}

export interface ScheduleSummary {
  affectedAreas: string[];
  description: string;
  lastActualAt: string | null;
  lastCompletedAt: string | null;
  lastStatus: RunStatus | null;
  nextScheduledAt: string;
  previousScheduledAt: string;
  technicalCron: string;
  timeZone?: string;
}

export interface DashboardOverview {
  areas: AreaSummary[];
  charts: { points: ChartPoint[] };
  connections: Record<string, ConnectionSummary>;
  environment: string;
  functions: FunctionSummary[];
  generatedAt: string;
  metrics: {
    areasWithData: number;
    changedRecords: number;
    failedRuns: number;
    monitoredAreas: number;
    newRecords: number;
    storedRecords: number;
    successfulRuns: number;
  };
  overall: {
    label: string;
    reasonCount: number;
    recommendedAction: string | null;
    state: DashboardState;
    summary: string;
  };
  privacy: PrivacySummary;
  range: { days: 1 | 7 | 30 | 90; from: string; to: string };
  schedule: ScheduleSummary;
  schemaVersion: number;
  warnings: WarningSummary[];
}

export interface ActivityItem {
  affectedCount?: number | null;
  area?: string | null;
  areaLabel?: string | null;
  count?: number | null;
  description?: string;
  id: string;
  kind: "automation" | "data" | "sync" | "zapier" | string;
  occurredAt: string;
  status: RunStatus;
  summary?: string;
  technicalCode?: string | null;
  technicalDetails?: Record<string, unknown> | string | null;
  title?: string;
}

export interface DashboardActivityResponse {
  activities: ActivityItem[];
  generatedAt: string;
  page: number;
  pageSize: number;
  privacy: PrivacySummary;
  schemaVersion: number;
  total: number;
  totalPages: number;
}

export interface DashboardColumn {
  key: string;
  label: string;
  masked: boolean;
}

export type RecordChange = "created" | "updated" | "unchanged" | string;

export interface DashboardRecord {
  change: RecordChange;
  firstSeenAt: string;
  isCurrent: boolean;
  lastChangedAt: string;
  lastSeenAt: string;
  publicId: string;
  recordRef: string;
  values: Record<string, string>;
}

export interface DashboardRecordsResponse {
  area: string;
  columns: DashboardColumn[];
  generatedAt: string;
  label: string;
  page: number;
  pageSize: number;
  privacy: PrivacySummary;
  records: DashboardRecord[];
  schemaVersion: number;
  total: number;
  totalPages: number;
}

export interface DashboardField extends DashboardColumn {
  value: string;
}

export interface ChangeHistoryItem {
  change?: RecordChange;
  changeKind?: RecordChange;
  observedAt: string;
}

export interface DashboardRecordDetail {
  area: string;
  change: RecordChange;
  changeHistory: ChangeHistoryItem[];
  fields: DashboardField[];
  firstSeenAt: string;
  generatedAt: string;
  isCurrent: boolean;
  label: string;
  lastChangedAt: string;
  lastSeenAt: string;
  privacy: PrivacySummary;
  publicId: string;
  recordRef: string;
  schemaVersion: number;
}

export interface DiscoveryResponse {
  discovery: {
    bereich: string;
    bodyBytes: number;
    fields: Array<{
      element: "input" | "select";
      name: string;
      optionCount?: number;
      type?: string;
    }>;
    idPatterns: Array<{
      attribute: "href" | "id" | "onclick";
      occurrences: number;
      pattern: string;
    }>;
    rowCount: number;
    status: number;
    tableCount: number;
    tables: Array<{ headers: string[]; index: number; rowCount: number }>;
  };
  schemaVersion: number;
}

export interface SyncResponse {
  sync: {
    areas: Array<{ area: string; errorCode?: string; status: string }>;
    failed: number;
    storedTotal: number;
    succeeded: number;
  };
}
