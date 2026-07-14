export type Severity = "info" | "low" | "medium" | "high" | "critical";

export interface QueryCounters {
  calls: number;
  totalExecTimeMs: number;
  totalPlanTimeMs?: number;
  rows?: number;
  sharedBlocksHit?: number;
  sharedBlocksRead?: number;
  tempBlocksRead?: number;
  tempBlocksWritten?: number;
  walBytes?: number;
}

export interface QuerySnapshot extends QueryCounters {
  capturedAt: Date | string;
  statsResetAt?: Date | string | null;
}

export interface CounterDelta {
  calls: number | null;
  totalExecTimeMs: number | null;
  totalPlanTimeMs: number | null;
  rows: number | null;
  sharedBlocksHit: number | null;
  sharedBlocksRead: number | null;
  tempBlocksRead: number | null;
  tempBlocksWritten: number | null;
  walBytes: number | null;
}

export interface SnapshotDelta {
  usable: boolean;
  resetDetected: boolean;
  resetReason?:
    "stats_reset_changed" | "counter_decreased" | "invalid_interval";
  intervalSeconds: number;
  counters: CounterDelta;
  meanExecTimeMs: number | null;
  callsPerSecond: number | null;
  rowsPerCall: number | null;
  cacheHitRatio: number | null;
}

export interface RegressionWindow {
  calls: number;
  meanExecTimeMs: number;
  totalExecTimeMs?: number;
  p95ExecTimeMs?: number;
  rowsPerCall?: number;
}

export interface RegressionResult {
  regressed: boolean;
  score: number;
  latencyChangeRatio: number | null;
  p95ChangeRatio: number | null;
  rowChangeRatio: number | null;
  reasons: string[];
}

export interface PlanNode {
  "Node Type": string;
  Plans?: PlanNode[];
  [key: string]: unknown;
}

export interface ExplainDocument {
  Plan: PlanNode;
  "Planning Time"?: number;
  "Execution Time"?: number;
  Settings?: Record<string, unknown> | Array<Record<string, unknown>>;
  JIT?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface VisitedPlanNode {
  node: PlanNode;
  path: string;
  parentPath: string | null;
  depth: number;
  ordinal: number;
}

export interface PlanWarning {
  code:
    | "dominant_node"
    | "sequential_scan"
    | "sort_spill"
    | "nested_loop_amplification"
    | "row_estimate_error"
    | "filter_rejection"
    | "buffer_pressure"
    | "wal_activity"
    | "parallel_shortfall";
  severity: Severity;
  path: string;
  message: string;
  evidence: Record<string, number | string | boolean | null>;
}

export interface PlanMetrics {
  nodeCount: number;
  maxDepth: number;
  planningTimeMs: number | null;
  executionTimeMs: number | null;
  totalCost: number | null;
  actualTotalTimeMs: number | null;
  sharedBlocksHit: number;
  sharedBlocksRead: number;
  tempBlocksRead: number;
  tempBlocksWritten: number;
  walRecords: number;
  dominantNodePath: string | null;
}

export interface PlanNodeMatch {
  beforePath: string;
  afterPath: string;
  confidence: number;
  reason: "identity" | "relation" | "structure";
}

export interface PlanNodeDiff {
  status: "added" | "removed" | "changed" | "unchanged";
  beforePath: string | null;
  afterPath: string | null;
  nodeTypeBefore: string | null;
  nodeTypeAfter: string | null;
  actualTimeChangeMs: number | null;
  actualTimeChangeRatio: number | null;
  costChangeRatio: number | null;
  rowEstimateChangeRatio: number | null;
  materialChanges: string[];
}

export interface PlanDiff {
  matches: PlanNodeMatch[];
  nodes: PlanNodeDiff[];
  executionTimeChangeMs: number | null;
  executionTimeChangeRatio: number | null;
  summary: string[];
}

export interface IndexRecord {
  id: string;
  schema: string;
  table: string;
  name: string;
  method: string;
  keyColumns: string[];
  includeColumns?: string[];
  predicate?: string | null;
  expressions?: string[];
  unique?: boolean;
  primary?: boolean;
  constraintBacked?: boolean;
  valid?: boolean;
  ready?: boolean;
  sizeBytes?: number;
  scans?: number;
}

export interface IndexOverlap {
  kind: "duplicate" | "prefix";
  redundantId: string;
  coveringId: string;
  confidence: number;
  reason: string;
}

export interface WriteCostInput {
  inserts: number;
  updates: number;
  deletes: number;
  hotUpdates?: number;
  indexCount: number;
  totalIndexBytes: number;
  tableBytes?: number;
}

export interface WriteCostSignal {
  score: number;
  level: "low" | "moderate" | "high" | "extreme";
  mutations: number;
  nonHotUpdates: number;
  amplification: number;
  reasons: string[];
}

export interface MissingIndexEvidence {
  schema: string | null;
  table: string;
  columns: string[];
  paths: string[];
  estimatedRows: number;
  actualRows: number;
  rowsRemovedByFilter: number;
  score: number;
  evidence: string[];
}

export interface MissingIndexCandidate extends MissingIndexEvidence {
  confidence: "medium" | "high";
  recommendation: string;
}

export interface MaintenanceInput {
  liveRows: number;
  deadRows: number;
  modificationsSinceAnalyze: number;
  lastVacuumAt?: Date | string | null;
  lastAnalyzeAt?: Date | string | null;
  transactionAge?: number;
  freezeMaxAge?: number;
  tableBytes?: number;
  autovacuumEnabled?: boolean;
}

export interface MaintenanceScore {
  overall: number;
  vacuumUrgency: number;
  analyzeStaleness: number;
  freezeRisk: number;
  bloatRisk: number;
  severity: Severity;
  reasons: string[];
}

export interface CapabilitySnapshot {
  serverVersionNum: number;
  extensions: string[];
  views: string[];
  privileges: string[];
  settings?: Record<string, string | boolean | number | null>;
  inRecovery?: boolean;
}

export type CapabilityFeature =
  | "query_stats"
  | "query_text_all_roles"
  | "exact_bloat"
  | "hypothetical_indexes"
  | "live_activity"
  | "vacuum_progress"
  | "explain_settings"
  | "wal_metrics"
  | "jit_metrics";

export interface CapabilityStatus {
  feature: CapabilityFeature;
  available: boolean;
  degraded: boolean;
  reason: string | null;
}

export interface FindingLike {
  sourceKey: string;
  database: string;
  rule: string;
  resourceType: string;
  resourceKey: string;
  evidence?: unknown;
  severity?: Severity;
  firstSeenAt?: Date | string;
  lastSeenAt?: Date | string;
  occurrenceCount?: number;
}
