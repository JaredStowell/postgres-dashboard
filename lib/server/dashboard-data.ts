import {
  calculateMaintenanceScore,
  effectiveFreezeMaxAge,
} from "@/lib/analysis/maintenance";
import { calculateWriteCostSignal } from "@/lib/analysis/indexes";
import { scoreQueryRegression } from "@/lib/analysis/deltas";
import { aiAnalysisResponseSchema } from "@/lib/ai/schema";
import {
  applyQueryFindingSignals,
  contextualHref,
} from "@/lib/presentation/inventory";
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
  listIndexRelationshipCandidates,
  listMaintenanceProgress,
  listQueryStats,
  listQueryHistory,
  listRegisteredDatabases,
  listLatestFleetSnapshots,
  listFleetTrend,
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
import {
  getAdvisorIndexContexts,
  getAdvisorTableContexts,
  listRecentAdvisorExplainRuns,
} from "@/lib/db/advisor-evidence";
import {
  canonicalAdvisorQuery,
  extractQualifiedRelationsFromSql,
} from "@/lib/server/advisor-evidence";

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
    discoveredDatabases: number;
    schemas: number;
    queries: number;
    tables: number;
  };
  source: DataSourceState;
  targets: Array<{
    key: string;
    database: string;
    capturedAt: string;
    activeConnections: number;
    cacheHitRatio: number;
    queries: number;
    tables: number;
  }>;
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
    points: [],
  };
}

function mapIndex(
  row: IndexInfo,
  relationship: "duplicate" | "prefix" | undefined,
): IndexRecord {
  const writeCost = calculateWriteCostSignal({
    inserts: row.tableInserts,
    updates: row.tableUpdates,
    deletes: row.tableDeletes,
    hotUpdates: row.tableHotUpdates,
    indexCount: row.tableIndexCount,
    totalIndexBytes: row.totalTableIndexBytes,
    tableBytes: row.tableBytes,
  });
  return {
    indexOid: row.indexOid,
    tableOid: row.tableOid,
    name: row.name,
    table: row.table,
    schema: row.schema,
    size: formatBytes(row.sizeBytes),
    sizeBytes: row.sizeBytes,
    scans: row.scans,
    tuplesRead: row.tuplesRead,
    tuplesFetched: row.tuplesFetched,
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
      writeCost.level === "extreme" || writeCost.level === "high"
        ? "high"
        : writeCost.level === "moderate"
          ? "medium"
          : "low",
    writeCostScore: writeCost.score,
    writeCostReasons: writeCost.reasons,
    definition: row.definition,
    keyColumns: row.keyColumns,
    includedColumns: row.includedColumns,
    unique: row.unique,
    valid: row.valid,
    ready: row.ready,
  };
}

function mapMaintenance(
  row: TableMaintenance,
  freezeMaxAge: number,
): MaintenanceRecord {
  const lastVacuum = row.lastAutovacuum ?? row.lastVacuum;
  const lastAnalyze = row.lastAutoanalyze ?? row.lastAnalyze;
  const relationFreezeMaxAge = effectiveFreezeMaxAge(
    row.relationOptions,
    freezeMaxAge,
  );
  const score = calculateMaintenanceScore({
    liveRows: row.liveRows,
    deadRows: row.deadRows,
    modificationsSinceAnalyze: row.modificationsSinceAnalyze,
    lastVacuumAt: lastVacuum,
    lastAnalyzeAt: lastAnalyze,
    transactionAge: row.transactionIdAge,
    freezeMaxAge: relationFreezeMaxAge,
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
    relationSize: formatBytes(row.relationSizeBytes),
    estimatedRows: row.estimatedRows,
    liveRows: row.liveRows,
    deadRows: row.deadRows,
    deadRatio: Number(
      ((row.deadRows / Math.max(1, row.liveRows + row.deadRows)) * 100).toFixed(
        1,
      ),
    ),
    lastVacuum: relativeTime(lastVacuum),
    lastAnalyze: relativeTime(lastAnalyze),
    lastManualVacuum: relativeTime(row.lastVacuum),
    lastAutovacuum: relativeTime(row.lastAutovacuum),
    lastManualAnalyze: relativeTime(row.lastAnalyze),
    lastAutoanalyze: relativeTime(row.lastAutoanalyze),
    modificationsSinceAnalyze: row.modificationsSinceAnalyze,
    sequentialScans: row.sequentialScans,
    sequentialTuplesRead: row.sequentialTuplesRead,
    indexScans: row.indexScans,
    inserted: row.inserted,
    updated: row.updated,
    deleted: row.deleted,
    hotUpdated: row.hotUpdated,
    relationOptions: row.relationOptions,
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
    blockingPids: row.blockingProcessIds,
    ageSeconds: Math.max(row.transactionAgeSeconds, row.queryAgeSeconds),
  };
}

function mapFinding(row: Record<string, unknown>): Finding {
  const status = String(row["status"]) as Finding["status"];
  const severity = String(row["severity"]);
  const destination =
    row["destination"] && typeof row["destination"] === "object"
      ? (row["destination"] as Record<string, unknown>)
      : {};
  const evidence =
    row["evidence"] && typeof row["evidence"] === "object"
      ? (row["evidence"] as Record<string, unknown>)
      : {};
  const destinationHref =
    typeof destination["href"] === "string" ? destination["href"] : "/findings";
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
    href: contextualHref(destinationHref, {
      source: String(row["source_key"] ?? "") || undefined,
      schema:
        typeof evidence["schema"] === "string" ? evidence["schema"] : undefined,
    }),
    evidence: JSON.stringify(row["evidence"] ?? {}),
  };
}

export async function loadQueriesPageData(source?: string): Promise<{
  queries: QueryStat[];
  hasMore: boolean;
  source: DataSourceState;
}> {
  const { db, target } = await getTargetContext(source);
  const page = await listQueryStats(db, { limit: 26 });
  const hasMore = page.length > 25;
  const rows = page.slice(0, 25);
  const queries = rows.map(mapQuery);
  try {
    const control = await getControlDatabase();
    const registered = await listRegisteredDatabases(control);
    const sourceDatabaseId = registered.find(
      (database) =>
        database.sourceKey === target.key &&
        database.databaseName === rows[0]?.databaseName,
    )?.sourceDatabaseId;
    if (sourceDatabaseId) {
      const findings = await listFindings(control, {
        sourceDatabaseId,
        limit: 250,
        status: "open",
      });
      applyQueryFindingSignals(queries, findings);
    }
  } catch {
    // Current query statistics are still available before collection history.
  }
  return {
    queries,
    hasMore,
    source: {
      mode: "live",
      label: "Live PostgreSQL",
      detail: `${target.label} · ${rows.length} bounded rows`,
    },
  };
}

export interface QueryDetailContext {
  plans: Array<{ id: string; createdAt: string }>;
  findings: Finding[];
  relations: Array<{
    schema: string;
    name: string;
    estimatedRows?: number;
    totalBytes?: number;
  }>;
  indexes: Array<{
    schema: string;
    table: string;
    name: string;
    scans?: number;
  }>;
}

export async function loadQueryDetailData(
  queryId: string,
  source?: string,
): Promise<{
  query: QueryStat | null;
  context: QueryDetailContext;
  source: DataSourceState;
}> {
  const { db, target } = await getTargetContext(source);
  const row = await getQueryStat(db, queryId);
  let query = row ? mapQuery(row) : null;
  let context: QueryDetailContext = {
    plans: [],
    findings: [],
    relations: [],
    indexes: [],
  };
  if (query && row) {
    try {
      const control = await getControlDatabase();
      const registered = await listRegisteredDatabases(control);
      const sourceDatabase = registered.find(
        (candidate) =>
          candidate.sourceKey === target.key &&
          candidate.databaseName === row.databaseName,
      );
      const relations = extractQualifiedRelationsFromSql(row.query);
      const tables = await getAdvisorTableContexts(db, relations);
      const indexes = await getAdvisorIndexContexts(
        db,
        tables.map((table) => table.relationOid),
      );
      query.tables = tables.map((table) => `${table.schema}.${table.name}`);
      context = {
        ...context,
        relations: tables.map((table) => ({
          schema: table.schema,
          name: table.name,
          estimatedRows: table.estimatedRows,
          totalBytes: table.totalBytes,
        })),
        indexes: indexes.map((index) => ({
          schema: index.schema,
          table: index.table,
          name: index.name,
          scans: index.scans,
        })),
      };
      if (sourceDatabase) {
        const [history, windows, plans, findings] = await Promise.all([
          listQueryHistory(control, sourceDatabase.sourceDatabaseId, queryId, {
            limit: 50,
          }),
          getQueryRegressionWindows(
            control,
            sourceDatabase.sourceDatabaseId,
            queryId,
          ),
          listRecentAdvisorExplainRuns(
            control,
            sourceDatabase.sourceDatabaseId,
            50,
          ),
          listFindings(control, {
            sourceDatabaseId: sourceDatabase.sourceDatabaseId,
            limit: 250,
          }),
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
        const queryShape = canonicalAdvisorQuery(row.query);
        const relationKeys = new Set(
          context.relations.map(
            (relation) => `${relation.schema}.${relation.name}`,
          ),
        );
        context.plans = plans
          .filter(
            (plan) =>
              canonicalAdvisorQuery(plan.normalizedQuery) === queryShape,
          )
          .slice(0, 10)
          .map((plan) => ({
            id: plan.id,
            createdAt: plan.createdAt.toISOString(),
          }));
        context.findings = findings
          .filter((finding) => {
            const destination =
              finding["destination"] &&
              typeof finding["destination"] === "object"
                ? (finding["destination"] as Record<string, unknown>)
                : {};
            const evidence =
              finding["evidence"] && typeof finding["evidence"] === "object"
                ? (finding["evidence"] as Record<string, unknown>)
                : {};
            const href = String(destination["href"] ?? "").split("?", 1)[0];
            const relation = `${String(evidence["schema"] ?? "")}.${String(evidence["table"] ?? "")}`;
            return href === `/queries/${queryId}` || relationKeys.has(relation);
          })
          .slice(0, 20)
          .map(mapFinding);
      }
    } catch {
      // Current pg_stat_statements data remains useful without history.
    }
  }
  return {
    query,
    context,
    source: { mode: "live", label: "Live PostgreSQL", detail: target.label },
  };
}

export async function loadIndexesPageData(
  source?: string,
  schema?: string,
): Promise<{
  indexes: IndexRecord[];
  hasMore: boolean;
  relationshipAnalysisTruncated: boolean;
  hypopgAvailable: boolean;
  missingCandidates: MissingIndexView[];
  source: DataSourceState;
}> {
  const { db, target } = await getTargetContext(source);
  const [rows, capabilities] = await Promise.all([
    listIndexes(db, { limit: 26, schema }),
    detectCapabilities(db),
  ]);
  const hasMore = rows.length > 25;
  const visibleRows = rows.slice(0, 25);
  const relationshipCandidates = await listIndexRelationshipCandidates(db, {
    relationOids: [...new Set(visibleRows.map((row) => row.tableOid))],
  });
  const visibleIndexOids = new Set(visibleRows.map((row) => row.indexOid));
  const relationships = findIndexRelationships(
    relationshipCandidates.indexes,
  ).filter((relationship) => visibleIndexOids.has(relationship.leftIndexOid));
  const byIndex = new Map<number, "duplicate" | "prefix">();
  for (const relationship of relationships)
    byIndex.set(relationship.leftIndexOid, relationship.kind);
  let missingCandidates: MissingIndexView[] = [];
  try {
    const control = await getControlDatabase();
    const registered = await listRegisteredDatabases(control);
    const currentDatabase = await db.query<{ name: string }>(
      "SELECT current_database() AS name",
    );
    const sourceDatabaseId = registered.find(
      (database) =>
        database.sourceKey === target.key &&
        database.databaseName === currentDatabase.rows[0]?.name,
    )?.sourceDatabaseId;
    if (sourceDatabaseId) {
      const result = await control.query<Record<string, unknown>>(
        `SELECT f.id, f.title, f.summary, f.evidence,
          er.normalized_query
         FROM index_analyzer.findings f
         LEFT JOIN index_analyzer.alert_rules r ON r.id = f.rule_id
         LEFT JOIN index_analyzer.explain_runs er
           ON er.id = NULLIF(f.evidence->>'explainRunId', '')::uuid
          AND er.source_database_id = f.source_database_id
         WHERE f.source_database_id = $1 AND f.status IN ('open', 'acknowledged')
           AND r.rule_key = 'missing-index'
         ORDER BY f.last_seen_at DESC LIMIT 50`,
        [sourceDatabaseId],
      );
      missingCandidates = result.rows.flatMap((candidate) => {
        const evidence =
          candidate["evidence"] && typeof candidate["evidence"] === "object"
            ? (candidate["evidence"] as Record<string, unknown>)
            : {};
        const columns = Array.isArray(evidence["columns"])
          ? evidence["columns"].map(String).slice(0, 32)
          : [];
        const schemaName = String(evidence["schema"] ?? "");
        const table = String(evidence["table"] ?? "");
        if (!schemaName || !table || columns.length === 0) return [];
        return [
          {
            id: String(candidate["id"]),
            title: String(candidate["title"]),
            summary: String(candidate["summary"]),
            schema: schemaName,
            table,
            columns,
            score: Number(evidence["score"] ?? 0),
            confidence: String(evidence["confidence"] ?? "medium"),
            planId: String(evidence["explainRunId"] ?? ""),
            query: String(candidate["normalized_query"] ?? ""),
          },
        ];
      });
    }
  } catch {
    // Catalog inventory stays useful before control-plane collection.
  }
  return {
    indexes: visibleRows.map((row) => mapIndex(row, byIndex.get(row.indexOid))),
    hasMore,
    relationshipAnalysisTruncated: relationshipCandidates.truncated,
    hypopgAvailable: Boolean(capabilities.extensions.hypopg),
    missingCandidates,
    source: {
      mode: "live",
      label: "Live PostgreSQL",
      detail: `${target.label} · all discovered schemas`,
    },
  };
}

export interface MissingIndexView {
  id: string;
  title: string;
  summary: string;
  schema: string;
  table: string;
  columns: string[];
  score: number;
  confidence: string;
  planId: string;
  query: string;
}

export async function loadMaintenancePageData(
  source?: string,
  schema?: string,
): Promise<{
  maintenance: MaintenanceRecord[];
  hasMore: boolean;
  progress: ProgressOperation[];
  pgstattupleAvailable: boolean;
  source: DataSourceState;
}> {
  const { db, target } = await getTargetContext(source);
  const capabilities = await detectCapabilities(db);
  const [rows, freeze, progress] = await Promise.all([
    listTableMaintenance(db, { limit: 26, schema }),
    db.query<{ setting: string }>(
      "SELECT setting FROM pg_settings WHERE name = 'autovacuum_freeze_max_age'",
    ),
    listMaintenanceProgress(db, capabilities.supportedColumns),
  ]);
  const freezeMaxAge = Number(freeze.rows[0]?.setting ?? 200_000_000);
  const hasMore = rows.length > 25;
  return {
    maintenance: rows
      .slice(0, 25)
      .map((row) => mapMaintenance(row, freezeMaxAge)),
    hasMore,
    progress,
    pgstattupleAvailable: Boolean(capabilities.extensions.pgstattuple),
    source: {
      mode: "live",
      label: "Live PostgreSQL",
      detail: `${target.label} · estimated catalog statistics`,
    },
  };
}

export async function loadLivePageData(source?: string): Promise<{
  sessions: Session[];
  source: DataSourceState;
}> {
  const { db, target } = await getTargetContext(source);
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

export async function loadFindingsPageData(source?: string): Promise<{
  findings: Finding[];
  enabledRules: number;
  source: DataSourceState;
}> {
  const control = await getControlDatabase();
  let sourceDatabaseId: number | undefined;
  if (source) {
    const registered = await listRegisteredDatabases(control);
    sourceDatabaseId = registered.find(
      (database) => database.sourceKey === source,
    )?.sourceDatabaseId;
    if (!sourceDatabaseId) {
      return {
        findings: [],
        enabledRules: 0,
        source: {
          mode: "live",
          label: "Control-plane history",
          detail: "No collection has completed for this target yet",
        },
      };
    }
  }
  const [rows, ruleCount] = await Promise.all([
    listFindings(control, { limit: 250, sourceDatabaseId }),
    control.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM index_analyzer.alert_rules WHERE enabled",
    ),
  ]);
  return {
    findings: rows.map(mapFinding),
    enabledRules: Number(ruleCount.rows[0]?.count ?? 0),
    source: {
      mode: "live",
      label: "Control-plane history",
      detail: `${rows.length} durable findings`,
    },
  };
}

export async function loadAdvisorPageData(source?: string): Promise<{
  analyses: Analysis[];
  source: DataSourceState;
}> {
  const control = await getControlDatabase();
  const registered = await control.query<{ id: string }>(
    `SELECT d.id::text
     FROM index_analyzer.source_databases d
     JOIN index_analyzer.sources s ON s.id = d.source_id
     WHERE ($1::text IS NULL OR s.source_key = $1)
     ORDER BY d.last_seen_at DESC LIMIT 1`,
    [source ?? null],
  );
  const databaseId = Number(registered.rows[0]?.id);
  const rows = Number.isSafeInteger(databaseId)
    ? await listAiAnalyses(control, databaseId, { limit: 50 })
    : [];
  return {
    analyses: rows.map((row) => {
      const result = aiAnalysisResponseSchema.safeParse({
        summary: row["summary"],
        severity: row["severity"],
        confidence: Number(row["confidence"]),
        evidence: row["evidence"],
        caveats: row["caveats"],
        recommendations: row["recommendations"],
      });
      return {
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
        result: result.success ? result.data : undefined,
      } satisfies Analysis;
    }),
    source: {
      mode: "live",
      label: "Saved analyses",
      detail: "Control-plane persistence",
    },
  };
}

export async function loadFleetPageData(
  source?: string,
  schema?: string,
): Promise<FleetPageData> {
  const { db, target } = await getTargetContext(source);
  const [
    database,
    queries,
    tables,
    sessions,
    indexes,
    capabilities,
    schemas,
    databases,
  ] = await Promise.all([
    getDatabaseStat(db),
    listQueryStats(db, { limit: 250 }),
    listTableMaintenance(db, { limit: 250, schema }),
    listActivity(db, { limit: 250, includeIdle: true }),
    listIndexes(db, { limit: 250, schema }),
    import("@/lib/db/capabilities").then(({ detectCapabilities }) =>
      detectCapabilities(db),
    ),
    listSchemas(db),
    listDatabases(db),
  ]);
  let durableFindings: Finding[] = [];
  let targetSnapshots: Awaited<ReturnType<typeof listLatestFleetSnapshots>> =
    [];
  let trend: Awaited<ReturnType<typeof listFleetTrend>> = [];
  try {
    const control = await getControlDatabase();
    const registered = await listRegisteredDatabases(control);
    const current = registered.find(
      (candidate) =>
        candidate.sourceKey === target.key &&
        candidate.databaseName === capabilities.databaseName,
    );
    [durableFindings, targetSnapshots, trend] = await Promise.all([
      listFindings(control, { limit: 25 }).then((rows) => rows.map(mapFinding)),
      listLatestFleetSnapshots(control),
      current
        ? listFleetTrend(control, current.sourceDatabaseId)
        : Promise.resolve([]),
    ]);
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
  const indexBytes = indexes.reduce(
    (total, index) => total + index.sizeBytes,
    0,
  );
  const freezeMaxAge = Number(
    capabilities.settings["autovacuum_freeze_max_age"] ?? 200_000_000,
  );
  const maintenanceScores = tables.map((table) =>
    calculateMaintenanceScore({
      liveRows: table.liveRows,
      deadRows: table.deadRows,
      modificationsSinceAnalyze: table.modificationsSinceAnalyze,
      lastVacuumAt: table.lastAutovacuum ?? table.lastVacuum,
      lastAnalyzeAt: table.lastAutoanalyze ?? table.lastAnalyze,
      transactionAge: table.transactionIdAge,
      freezeMaxAge: effectiveFreezeMaxAge(table.relationOptions, freezeMaxAge),
      tableBytes: table.totalSizeBytes,
      autovacuumEnabled: !table.relationOptions.includes(
        "autovacuum_enabled=false",
      ),
    }),
  );
  const vacuumUrgent = maintenanceScores.filter(
    (score) => score.vacuumUrgency >= 50,
  ).length;
  const freezeRisk = maintenanceScores.filter(
    (score) => score.freezeRisk >= 50,
  ).length;
  const latestTrend = trend.at(-1);
  const previousTrend = trend.at(-2);
  const olderTrend = trend.at(-3);
  const interval = (newer: typeof latestTrend, older: typeof latestTrend) => {
    if (
      !newer ||
      !older ||
      newer.totalCalls < older.totalCalls ||
      newer.totalExecTime < older.totalExecTime
    )
      return null;
    const calls = newer.totalCalls - older.totalCalls;
    return {
      calls,
      mean:
        calls > 0 ? (newer.totalExecTime - older.totalExecTime) / calls : null,
    };
  };
  const latestInterval = interval(latestTrend, previousTrend);
  const baselineInterval = interval(previousTrend, olderTrend);
  const latencyDelta =
    latestInterval?.mean != null &&
    baselineInterval?.mean != null &&
    baselineInterval.mean > 0
      ? ((latestInterval.mean - baselineInterval.mean) /
          baselineInterval.mean) *
        100
      : null;
  const latestCapture = targetSnapshots
    .filter(
      (snapshot) =>
        snapshot.sourceKey === target.key &&
        snapshot.databaseName === capabilities.databaseName,
    )
    .sort(
      (left, right) => right.capturedAt.getTime() - left.capturedAt.getTime(),
    )
    .at(0)?.capturedAt;
  const metrics: Metric[] = [
    {
      label: "Workload time",
      value: `${(totalExec / 1000).toFixed(1)} s`,
      detail: `${queries.length} bounded statements`,
      trend: 0,
      tone: "cyan",
      points: trend.map((point) => point.totalExecTime),
    },
    {
      label: "Cache hit ratio",
      value: `${(database.cacheHitRatio * 100).toFixed(2)}%`,
      detail: `${formatBytes(database.blocksRead * 8192)} read`,
      trend: 0,
      tone: "violet",
      points: trend.map((point) => point.cacheHitRatio * 100),
    },
    {
      label: "Active sessions",
      value: String(database.activeConnections),
      detail: `${sessions.length} visible · ${blocked} blocked`,
      trend: 0,
      tone: blocked > 0 ? "amber" : "green",
      points: trend.map((point) => point.activeConnections),
    },
    {
      label: "Dead tuples",
      value: deadRows.toLocaleString(),
      detail: `${((deadRows / Math.max(1, liveRows + deadRows)) * 100).toFixed(1)}% of observed rows`,
      trend: 0,
      tone: deadRows > liveRows * 0.1 ? "rose" : "green",
      points: trend.map((point) => point.deadRows),
    },
    {
      label: "Blocked sessions",
      value: String(blocked),
      detail: "Sessions with pg_blocking_pids() evidence",
      trend: 0,
      tone: blocked > 0 ? "rose" : "green",
      points: [],
    },
    {
      label: "Calls since snapshot",
      value:
        latestInterval == null ? "—" : latestInterval.calls.toLocaleString(),
      detail: "Reset-aware latest collection interval",
      trend: 0,
      tone: "violet",
      points: [],
    },
    {
      label: "Query latency delta",
      value:
        latencyDelta == null
          ? "—"
          : `${latencyDelta >= 0 ? "+" : ""}${latencyDelta.toFixed(1)}%`,
      detail: "Latest mean interval versus prior interval",
      trend: latencyDelta ?? 0,
      tone:
        latencyDelta == null
          ? "cyan"
          : latencyDelta > 15
            ? "rose"
            : latencyDelta < -10
              ? "green"
              : "amber",
      points: [],
    },
    {
      label: "Index footprint",
      value: formatBytes(indexBytes),
      detail: `${indexes.length} bounded catalog indexes`,
      trend: 0,
      tone: "cyan",
      points: [],
    },
    {
      label: "Vacuum urgency",
      value: String(vacuumUrgent),
      detail: "Relations scoring at least 50/100",
      trend: 0,
      tone: vacuumUrgent > 0 ? "amber" : "green",
      points: [],
    },
    {
      label: "Freeze risk",
      value: String(freezeRisk),
      detail: `Against max age ${freezeMaxAge.toLocaleString()}`,
      trend: 0,
      tone: freezeRisk > 0 ? "rose" : "green",
      points: [],
    },
    {
      label: "Collection freshness",
      value: latestCapture ? relativeTime(latestCapture) : "Not collected",
      detail: `${target.key} · ${capabilities.databaseName}`,
      trend: 0,
      tone: latestCapture ? "green" : "amber",
      points: [],
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
      databases: targetSnapshots.length,
      discoveredDatabases: databases.length,
      schemas: schemas.length,
      queries: queries.length,
      tables: tables.length,
    },
    source: {
      mode: "live",
      label: "Live PostgreSQL",
      detail: `${target.label} · ${capabilities.databaseName} · captured ${relativeTime(database.capturedAt)}`,
    },
    targets: targetSnapshots.map((snapshot) => ({
      key: snapshot.sourceKey,
      database: snapshot.databaseName,
      capturedAt: snapshot.capturedAt.toISOString(),
      activeConnections: snapshot.activeConnections,
      cacheHitRatio:
        snapshot.blocksHit /
        Math.max(1, snapshot.blocksHit + snapshot.blocksRead),
      queries: snapshot.queryCount,
      tables: snapshot.tableCount,
    })),
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
