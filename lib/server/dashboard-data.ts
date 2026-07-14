import { calculateMaintenanceScore } from "@/lib/analysis/maintenance";
import { scoreQueryRegression } from "@/lib/analysis/deltas";
import {
  findIndexRelationships,
  getDatabaseStat,
  getQueryStat,
  getQueryRegressionWindows,
  listDatabases,
  listActivity,
  listAiAnalyses,
  listFindings,
  listIndexes,
  listMaintenanceProgress,
  listQueryStats,
  listQueryHistory,
  listRegisteredDatabases,
  listSchemas,
  listTableMaintenance,
  detectCapabilities,
} from "@/lib/db";
import type {
  ActivitySession,
  IndexInfo,
  QueryStat as DatabaseQueryStat,
  TableMaintenance,
  ProgressOperation,
} from "@/lib/db";
import type {
  Analysis,
  Finding,
  IndexRecord,
  MaintenanceRecord,
  Metric,
  QueryStat,
  Session,
} from "@/lib/demo/types";
import { getControlDatabase, getTargetContext } from "@/lib/server/context";

export interface DataSourceState {
  mode: "live" | "unavailable";
  label: string;
  detail: string;
}

export interface FleetPageData {
  metrics: Metric[];
  findings: Finding[];
  capabilities: Array<{ label: string; status: string; detail: string }>;
  coverage: {
    databases: number;
    schemas: number;
    queries: number;
    tables: number;
  };
  source: DataSourceState;
}

function formatBytes(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const unit = Math.min(
    Math.floor(Math.log(value) / Math.log(1024)),
    units.length - 1,
  );
  return `${(value / 1024 ** unit).toFixed(unit === 0 ? 0 : 1)} ${units[unit]}`;
}

function relativeTime(value: Date | string | null | undefined): string {
  if (!value) return "never";
  const milliseconds = Date.now() - new Date(value).getTime();
  if (!Number.isFinite(milliseconds)) return "unknown";
  const minutes = Math.max(0, Math.round(milliseconds / 60_000));
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

function duration(seconds: number): string {
  const safe = Math.max(0, Math.round(seconds));
  const minutes = Math.floor(safe / 60);
  return `${String(minutes).padStart(2, "0")}:${String(safe % 60).padStart(2, "0")}`;
}

function flatPoints(value: number): number[] {
  const bounded = Math.max(
    5,
    Math.min(95, Number.isFinite(value) ? value : 50),
  );
  return Array.from({ length: 12 }, () => bounded);
}

function mapQuery(row: DatabaseQueryStat): QueryStat {
  const blockAccess = row.sharedBlocksHit + row.sharedBlocksRead;
  return {
    id: row.queryId,
    query: row.query,
    database: row.databaseName,
    user: row.userName,
    calls: row.calls,
    totalTime: row.totalExecTime,
    meanTime: row.meanExecTime,
    rows: row.rows,
    cacheHit: Number(
      (blockAccess > 0
        ? (row.sharedBlocksHit / blockAccess) * 100
        : 100
      ).toFixed(2),
    ),
    tempIo: formatBytes((row.tempBlocksRead + row.tempBlocksWritten) * 8192),
    wal: formatBytes(row.walBytes),
    delta: 0,
    status: "stable",
    tables: [],
    points: flatPoints(row.meanExecTime),
  };
}

function mapIndex(
  row: IndexInfo,
  relationship: "duplicate" | "prefix" | undefined,
): IndexRecord {
  const mutations = row.tableInserts + row.tableUpdates + row.tableDeletes;
  return {
    name: row.name,
    table: row.table,
    schema: row.schema,
    size: formatBytes(row.sizeBytes),
    sizeBytes: row.sizeBytes,
    scans: row.scans,
    type: row.accessMethod,
    status:
      !row.valid || !row.ready
        ? "invalid"
        : relationship === "duplicate"
          ? "duplicate"
          : relationship === "prefix"
            ? "overlap"
            : row.scans === 0 &&
                !row.constraintBacked &&
                row.sizeBytes >= 1_048_576
              ? "unused"
              : "healthy",
    writeCost:
      mutations > 100_000 || row.sizeBytes > 1_073_741_824
        ? "high"
        : mutations > 1_000 || row.sizeBytes > 104_857_600
          ? "medium"
          : "low",
    definition: row.definition,
  };
}

function mapMaintenance(
  row: TableMaintenance,
  freezeMaxAge: number,
): MaintenanceRecord {
  const lastVacuum = row.lastAutovacuum ?? row.lastVacuum;
  const lastAnalyze = row.lastAutoanalyze ?? row.lastAnalyze;
  const score = calculateMaintenanceScore({
    liveRows: row.liveRows,
    deadRows: row.deadRows,
    modificationsSinceAnalyze: row.modificationsSinceAnalyze,
    lastVacuumAt: lastVacuum,
    lastAnalyzeAt: lastAnalyze,
    transactionAge: row.transactionIdAge,
    freezeMaxAge,
    tableBytes: row.totalSizeBytes,
    autovacuumEnabled: !row.relationOptions.includes(
      "autovacuum_enabled=false",
    ),
  });
  return {
    relationOid: row.relationOid,
    table: row.table,
    schema: row.schema,
    totalSize: formatBytes(row.totalSizeBytes),
    totalSizeBytes: row.totalSizeBytes,
    liveRows: row.liveRows,
    deadRows: row.deadRows,
    deadRatio: Number(
      ((row.deadRows / Math.max(1, row.liveRows + row.deadRows)) * 100).toFixed(
        1,
      ),
    ),
    lastVacuum: relativeTime(lastVacuum),
    lastAnalyze: relativeTime(lastAnalyze),
    freezeAge: row.transactionIdAge,
    risk: score.overall >= 65 ? "high" : score.overall >= 30 ? "medium" : "low",
  };
}

function mapSession(row: ActivitySession, database: string): Session {
  const state =
    row.state === "active" || row.state === "idle in transaction"
      ? row.state
      : "idle";
  return {
    pid: row.processId,
    database,
    user: row.userName ?? "system",
    application: row.applicationName || row.backendType,
    client: row.clientAddress ?? "local",
    state,
    wait: row.waitEvent
      ? `${row.waitEventType ?? "Wait"} · ${row.waitEvent}`
      : "—",
    duration: duration(
      Math.max(row.transactionAgeSeconds, row.queryAgeSeconds),
    ),
    query: row.queryPreview,
    blockedBy: row.blockingProcessIds[0],
  };
}

function mapFinding(row: Record<string, unknown>): Finding {
  const status = String(row["status"]) as Finding["status"];
  const severity = String(row["severity"]);
  const destination =
    row["destination"] && typeof row["destination"] === "object"
      ? (row["destination"] as Record<string, unknown>)
      : {};
  return {
    id: String(row["id"]),
    title: String(row["title"]),
    description: String(row["summary"]),
    severity:
      status === "resolved"
        ? "success"
        : severity === "critical" || severity === "high"
          ? "critical"
          : severity === "warning" || severity === "medium"
            ? "warning"
            : "info",
    source: String(row["rule_name"] ?? row["category"]),
    database: String(row["database_name"] ?? "configured target"),
    status,
    firstSeen: relativeTime(row["first_seen_at"] as string),
    lastSeen: relativeTime(row["last_seen_at"] as string),
    occurrences: Number(row["occurrence_count"] ?? 1),
    href:
      typeof destination["href"] === "string"
        ? destination["href"]
        : "/findings",
    evidence: JSON.stringify(row["evidence"] ?? {}),
  };
}

export async function loadQueriesPageData(): Promise<{
  queries: QueryStat[];
  source: DataSourceState;
}> {
  const { db, target } = await getTargetContext();
  const rows = await listQueryStats(db, { limit: 250 });
  const queries = rows.map(mapQuery);
  try {
    const findings = await listFindings(await getControlDatabase(), {
      limit: 250,
      status: "open",
    });
    for (const finding of findings) {
      if (finding["category"] !== "query") continue;
      const destination =
        finding["destination"] && typeof finding["destination"] === "object"
          ? (finding["destination"] as Record<string, unknown>)
          : {};
      const queryId = String(destination["href"] ?? "")
        .split("/")
        .at(-1);
      const query = queries.find((candidate) => candidate.id === queryId);
      if (!query) continue;
      query.status = "regressed";
      const evidence =
        finding["evidence"] && typeof finding["evidence"] === "object"
          ? (finding["evidence"] as Record<string, unknown>)
          : {};
      const recent = Number(evidence["recentMeanExecTimeMs"]);
      const baseline = Number(evidence["baselineMeanExecTimeMs"]);
      if (
        Number.isFinite(recent) &&
        Number.isFinite(baseline) &&
        baseline > 0
      ) {
        query.delta = Number(
          (((recent - baseline) / baseline) * 100).toFixed(1),
        );
      }
    }
  } catch {
    // Current query statistics are still available before collection history.
  }
  return {
    queries,
    source: {
      mode: "live",
      label: "Live PostgreSQL",
      detail: `${target.label} · ${rows.length} bounded rows`,
    },
  };
}

export async function loadQueryDetailData(
  queryId: string,
): Promise<{ query: QueryStat | null; source: DataSourceState }> {
  const { db, target } = await getTargetContext();
  const row = await getQueryStat(db, queryId);
  let query = row ? mapQuery(row) : null;
  if (query && row) {
    try {
      const control = await getControlDatabase();
      const registered = await listRegisteredDatabases(control);
      const sourceDatabase = registered.find(
        (candidate) =>
          candidate.sourceKey === target.key &&
          candidate.databaseName === row.databaseName,
      );
      if (sourceDatabase) {
        const [history, windows] = await Promise.all([
          listQueryHistory(control, sourceDatabase.sourceDatabaseId, queryId, {
            limit: 50,
          }),
          getQueryRegressionWindows(
            control,
            sourceDatabase.sourceDatabaseId,
            queryId,
          ),
        ]);
        const points = history
          .map((snapshot) => Number(snapshot["mean_exec_time"] ?? 0))
          .filter(Number.isFinite)
          .reverse();
        if (points.length > 0) query.points = points;
        if (
          windows.baseline?.meanExecTimeMs &&
          windows.recent?.meanExecTimeMs
        ) {
          const regression = scoreQueryRegression(
            {
              calls: windows.baseline.calls,
              meanExecTimeMs: windows.baseline.meanExecTimeMs,
              rowsPerCall: windows.baseline.rowsPerCall ?? undefined,
            },
            {
              calls: windows.recent.calls,
              meanExecTimeMs: windows.recent.meanExecTimeMs,
              rowsPerCall: windows.recent.rowsPerCall ?? undefined,
            },
          );
          query.delta = Number(
            ((regression.latencyChangeRatio ?? 0) * 100).toFixed(1),
          );
          query.status = regression.regressed
            ? "regressed"
            : query.delta <= -10
              ? "improved"
              : "stable";
        }
      }
    } catch {
      // Current pg_stat_statements data remains useful without history.
    }
  }
  return {
    query,
    source: { mode: "live", label: "Live PostgreSQL", detail: target.label },
  };
}

export async function loadIndexesPageData(): Promise<{
  indexes: IndexRecord[];
  hypopgAvailable: boolean;
  source: DataSourceState;
}> {
  const { db, target } = await getTargetContext();
  const [rows, capabilities] = await Promise.all([
    listIndexes(db, { limit: 250 }),
    detectCapabilities(db),
  ]);
  const relationships = findIndexRelationships(rows);
  const byIndex = new Map<number, "duplicate" | "prefix">();
  for (const relationship of relationships)
    byIndex.set(relationship.leftIndexOid, relationship.kind);
  return {
    indexes: rows.map((row) => mapIndex(row, byIndex.get(row.indexOid))),
    hypopgAvailable: Boolean(capabilities.extensions.hypopg),
    source: {
      mode: "live",
      label: "Live PostgreSQL",
      detail: `${target.label} · all discovered schemas`,
    },
  };
}

export async function loadMaintenancePageData(): Promise<{
  maintenance: MaintenanceRecord[];
  progress: ProgressOperation[];
  pgstattupleAvailable: boolean;
  source: DataSourceState;
}> {
  const { db, target } = await getTargetContext();
  const [rows, freeze, progress, capabilities] = await Promise.all([
    listTableMaintenance(db, { limit: 250 }),
    db.query<{ setting: string }>(
      "SELECT setting FROM pg_settings WHERE name = 'autovacuum_freeze_max_age'",
    ),
    listMaintenanceProgress(db),
    detectCapabilities(db),
  ]);
  const freezeMaxAge = Number(freeze.rows[0]?.setting ?? 200_000_000);
  return {
    maintenance: rows.map((row) => mapMaintenance(row, freezeMaxAge)),
    progress,
    pgstattupleAvailable: Boolean(capabilities.extensions.pgstattuple),
    source: {
      mode: "live",
      label: "Live PostgreSQL",
      detail: `${target.label} · estimated catalog statistics`,
    },
  };
}

export async function loadLivePageData(): Promise<{
  sessions: Session[];
  source: DataSourceState;
}> {
  const { db, target } = await getTargetContext();
  const [rows, database] = await Promise.all([
    listActivity(db, { limit: 250, includeIdle: true }),
    db.query<{ name: string }>("SELECT current_database() AS name"),
  ]);
  return {
    sessions: rows.map((row) =>
      mapSession(row, database.rows[0]?.name ?? "unknown"),
    ),
    source: {
      mode: "live",
      label: "Live PostgreSQL",
      detail: `${target.label} · auto-refreshes every 5s`,
    },
  };
}

export async function loadFindingsPageData(): Promise<{
  findings: Finding[];
  source: DataSourceState;
}> {
  const control = await getControlDatabase();
  const rows = await listFindings(control, { limit: 250 });
  return {
    findings: rows.map(mapFinding),
    source: {
      mode: "live",
      label: "Control-plane history",
      detail: `${rows.length} durable findings`,
    },
  };
}

export async function loadAdvisorPageData(): Promise<{
  analyses: Analysis[];
  source: DataSourceState;
}> {
  const control = await getControlDatabase();
  const registered = await control.query<{ id: string }>(
    "SELECT id::text FROM index_analyzer.source_databases ORDER BY last_seen_at DESC LIMIT 1",
  );
  const databaseId = Number(registered.rows[0]?.id);
  const rows = Number.isSafeInteger(databaseId)
    ? await listAiAnalyses(control, databaseId, { limit: 50 })
    : [];
  return {
    analyses: rows.map((row) => ({
      id: String(row["id"]),
      title: String(row["summary"] ?? "Analysis in progress"),
      queryId: "—",
      model: String(row["model"]),
      createdAt: relativeTime(row["created_at"] as string),
      severity:
        String(row["status"]) === "failed"
          ? "critical"
          : String(row["severity"]) === "critical" ||
              String(row["severity"]) === "high"
            ? "critical"
            : String(row["severity"]) === "medium"
              ? "warning"
              : "info",
      confidence: Math.round(Number(row["confidence"] ?? 0) * 100),
      summary: String(
        row["summary"] ?? row["error_message"] ?? "Analysis pending",
      ),
      requestId: String(row["provider_request_id"] ?? "local"),
      tokens:
        Number(row["input_tokens"] ?? 0) + Number(row["output_tokens"] ?? 0),
    })),
    source: {
      mode: "live",
      label: "Saved analyses",
      detail: "Control-plane persistence",
    },
  };
}

export async function loadFleetPageData(): Promise<FleetPageData> {
  const { db, target } = await getTargetContext();
  const [
    database,
    queries,
    tables,
    sessions,
    capabilities,
    schemas,
    databases,
  ] = await Promise.all([
    getDatabaseStat(db),
    listQueryStats(db, { limit: 250 }),
    listTableMaintenance(db, { limit: 250 }),
    listActivity(db, { limit: 250, includeIdle: true }),
    import("@/lib/db/capabilities").then(({ detectCapabilities }) =>
      detectCapabilities(db),
    ),
    listSchemas(db),
    listDatabases(db),
  ]);
  let durableFindings: Finding[] = [];
  try {
    const control = await getControlDatabase();
    durableFindings = (await listFindings(control, { limit: 25 })).map(
      mapFinding,
    );
  } catch {
    // A target can be inspected before the optional control-plane migrations run.
  }
  const deadRows = tables.reduce((total, table) => total + table.deadRows, 0);
  const liveRows = tables.reduce((total, table) => total + table.liveRows, 0);
  const totalExec = queries.reduce(
    (total, query) => total + query.totalExecTime,
    0,
  );
  const blocked = sessions.filter(
    (session) => session.blockingProcessIds.length > 0,
  ).length;
  const metrics: Metric[] = [
    {
      label: "Workload time",
      value: `${(totalExec / 1000).toFixed(1)} s`,
      detail: `${queries.length} bounded statements`,
      trend: 0,
      tone: "cyan",
      points: flatPoints(55),
    },
    {
      label: "Cache hit ratio",
      value: `${(database.cacheHitRatio * 100).toFixed(2)}%`,
      detail: `${formatBytes(database.blocksRead * 8192)} read`,
      trend: 0,
      tone: "violet",
      points: flatPoints(database.cacheHitRatio * 100),
    },
    {
      label: "Active sessions",
      value: String(database.activeConnections),
      detail: `${sessions.length} visible · ${blocked} blocked`,
      trend: 0,
      tone: blocked > 0 ? "amber" : "green",
      points: flatPoints(database.activeConnections),
    },
    {
      label: "Dead tuples",
      value: deadRows.toLocaleString(),
      detail: `${((deadRows / Math.max(1, liveRows + deadRows)) * 100).toFixed(1)}% of observed rows`,
      trend: 0,
      tone: deadRows > liveRows * 0.1 ? "rose" : "green",
      points: flatPoints((deadRows / Math.max(1, liveRows + deadRows)) * 100),
    },
  ];
  const extension = (name: string, detail: string) => ({
    label: name,
    status: capabilities.extensions[name] ? "Available" : "Unavailable",
    detail: capabilities.extensions[name]
      ? `v${capabilities.extensions[name]}`
      : detail,
  });
  return {
    metrics,
    findings: durableFindings,
    capabilities: [
      extension("pg_stat_statements", "Query workload disabled"),
      {
        label: "pg_read_all_stats",
        status: capabilities.privileges.readAllStats
          ? "Available"
          : "Unavailable",
        detail: capabilities.privileges.readAllStats
          ? "Role membership detected"
          : "Other-role query text may be hidden",
      },
      extension("pgstattuple", "Exact bloat checks disabled"),
      {
        label: "Track I/O timing",
        status:
          capabilities.settings["track_io_timing"] === "on"
            ? "Available"
            : "Unavailable",
        detail: `track_io_timing = ${capabilities.settings["track_io_timing"] ?? "unknown"}`,
      },
      extension("hypopg", "Hypothetical indexes capability-gated"),
    ],
    coverage: {
      databases: databases.length,
      schemas: schemas.length,
      queries: queries.length,
      tables: tables.length,
    },
    source: {
      mode: "live",
      label: "Live PostgreSQL",
      detail: `${target.label} · ${capabilities.databaseName} · captured ${relativeTime(database.capturedAt)}`,
    },
  };
}

export function unavailableSource(error: unknown): DataSourceState {
  return {
    mode: "unavailable",
    label: "Sample preview",
    detail:
      error instanceof Error ? error.message : "Database target unavailable",
  };
}
