import type { AiAnalysisResponse } from "@/lib/ai/schema";

export type Severity = "critical" | "warning" | "info" | "success";

export type TrendPoint = {
  label: string;
  value: number;
};

export type Metric = {
  label: string;
  value: string;
  detail: string;
  trend: number;
  tone: "cyan" | "violet" | "green" | "amber" | "rose";
  points: number[];
};

export type Finding = {
  id: string;
  title: string;
  description: string;
  severity: Severity;
  source: string;
  database: string;
  status: "open" | "acknowledged" | "resolved" | "dismissed";
  firstSeen: string;
  lastSeen: string;
  occurrences: number;
  href: string;
  evidence: string;
};

export type QueryStat = {
  id: string;
  query: string;
  database: string;
  user: string;
  calls: number;
  totalTime: number;
  meanTime: number;
  rows: number;
  cacheHit: number;
  tempIo: string;
  wal: string;
  delta: number;
  status: "regressed" | "improved" | "stable";
  tables: string[];
  points: number[];
};

export type IndexRecord = {
  indexOid?: number;
  tableOid?: number;
  name: string;
  table: string;
  schema: string;
  size: string;
  sizeBytes?: number;
  scans: number;
  tuplesRead?: number;
  tuplesFetched?: number;
  type: string;
  status: "healthy" | "unused" | "duplicate" | "overlap" | "invalid";
  writeCost: "low" | "medium" | "high";
  writeCostScore?: number;
  writeCostReasons?: string[];
  definition: string;
  keyColumns?: string[];
  includedColumns?: string[];
  unique?: boolean;
  valid?: boolean;
  ready?: boolean;
};

export type MaintenanceRecord = {
  relationOid?: number;
  table: string;
  schema: string;
  totalSize: string;
  totalSizeBytes?: number;
  relationSize?: string;
  estimatedRows?: number;
  liveRows: number;
  deadRows: number;
  deadRatio: number;
  lastVacuum: string;
  lastAnalyze: string;
  lastManualVacuum?: string;
  lastAutovacuum?: string;
  lastManualAnalyze?: string;
  lastAutoanalyze?: string;
  modificationsSinceAnalyze?: number;
  sequentialScans?: number;
  sequentialTuplesRead?: number;
  indexScans?: number | null;
  inserted?: number;
  updated?: number;
  deleted?: number;
  hotUpdated?: number;
  relationOptions?: string[];
  freezeAge: number;
  risk: "low" | "medium" | "high";
};

export type Session = {
  pid: number;
  database: string;
  user: string;
  application: string;
  client: string;
  state: "active" | "idle" | "idle in transaction";
  wait: string;
  duration: string;
  query: string;
  blockedBy?: number;
  blockingPids?: number[];
  ageSeconds?: number;
};

export type PlanNode = {
  id: string;
  name: string;
  relation?: string;
  time: number;
  cost: number;
  rows: number;
  estimate: number;
  loops: number;
  tone: Severity;
  detail: string;
  children?: PlanNode[];
};

export type Analysis = {
  id: string;
  title: string;
  queryId: string;
  model: string;
  createdAt: string;
  severity: Severity;
  confidence: number;
  summary: string;
  requestId: string;
  tokens: number;
  result?: AiAnalysisResponse;
};
