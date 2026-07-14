import {
  calculateMaintenanceScore,
  effectiveFreezeMaxAge,
} from "@/lib/analysis/maintenance";
import { calculateWriteCostSignal } from "@/lib/analysis/indexes";
import type {
  IndexInfo,
  IndexRelationship,
  QueryStat as DatabaseQueryStat,
  TableMaintenance,
} from "@/lib/db";
import type {
  IndexRecord,
  MaintenanceRecord,
  QueryStat,
} from "@/lib/demo/types";

export function formatInventoryBytes(value: number): string {
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

export function presentQuery(row: DatabaseQueryStat): QueryStat {
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
    tempIo: formatInventoryBytes(
      (row.tempBlocksRead + row.tempBlocksWritten) * 8192,
    ),
    wal: formatInventoryBytes(row.walBytes),
    delta: 0,
    status: "stable",
    tables: [],
    points: [],
  };
}

export function applyQueryFindingSignals(
  queries: QueryStat[],
  findings: readonly Record<string, unknown>[],
): QueryStat[] {
  const byId = new Map(queries.map((query) => [query.id, query]));
  for (const finding of findings) {
    if (finding["category"] !== "query") continue;
    const destination =
      finding["destination"] && typeof finding["destination"] === "object"
        ? (finding["destination"] as Record<string, unknown>)
        : {};
    const href = String(destination["href"] ?? "").split("?", 1)[0] ?? "";
    const query = byId.get(href.split("/").at(-1) ?? "");
    if (!query) continue;
    query.status = "regressed";
    const evidence =
      finding["evidence"] && typeof finding["evidence"] === "object"
        ? (finding["evidence"] as Record<string, unknown>)
        : {};
    const recent = Number(evidence["recentMeanExecTimeMs"]);
    const baseline = Number(evidence["baselineMeanExecTimeMs"]);
    if (Number.isFinite(recent) && Number.isFinite(baseline) && baseline > 0) {
      query.delta = Number((((recent - baseline) / baseline) * 100).toFixed(1));
    }
  }
  return queries;
}

export function presentIndexes(
  rows: readonly IndexInfo[],
  relationships: readonly IndexRelationship[],
): IndexRecord[] {
  const relationshipByIndex = new Map<number, "duplicate" | "prefix">();
  for (const relationship of relationships) {
    relationshipByIndex.set(relationship.leftIndexOid, relationship.kind);
  }
  return rows.map((row) => {
    const relationship = relationshipByIndex.get(row.indexOid);
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
      size: formatInventoryBytes(row.sizeBytes),
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
  });
}

export function presentMaintenance(
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
    totalSize: formatInventoryBytes(row.totalSizeBytes),
    totalSizeBytes: row.totalSizeBytes,
    relationSize: formatInventoryBytes(row.relationSizeBytes),
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

export function contextualHref(
  path: string,
  context: {
    source?: string;
    schema?: string;
    parameters?: Record<string, string | number | undefined>;
  },
): string {
  const [pathname, existingQuery = ""] = path.split("?", 2);
  const parameters = new URLSearchParams(existingQuery);
  if (context.source) parameters.set("source", context.source);
  if (context.schema) parameters.set("schema", context.schema);
  for (const [key, value] of Object.entries(context.parameters ?? {})) {
    if (value !== undefined) parameters.set(key, String(value));
  }
  const query = parameters.toString();
  return `${pathname}${query ? `?${query}` : ""}`;
}
