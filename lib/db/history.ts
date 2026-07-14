import type { Queryable } from "./client";
import { boundedPage, type PageInput, toNumber } from "./sql";

export interface RegisteredDatabase {
  sourceDatabaseId: number;
  sourceKey: string;
  displayName: string;
  bindingName: string;
  databaseOid: number;
  databaseName: string;
  serverVersion: number;
  lastSeenAt: Date;
  capabilities: Record<string, unknown> | null;
}

export async function listRegisteredDatabases(
  db: Queryable,
): Promise<RegisteredDatabase[]> {
  const result = await db.query<Record<string, unknown>>(`
    SELECT sd.id AS source_database_id, s.source_key, s.display_name, s.binding_name,
      sd.database_oid::int, sd.database_name, sd.server_version, sd.last_seen_at,
      CASE WHEN c.source_database_id IS NULL THEN NULL ELSE jsonb_build_object(
        'detectedAt', c.detected_at, 'serverVersion', c.server_version,
        'extensions', c.extensions, 'privileges', c.privileges, 'settings', c.settings,
        'supportedColumns', c.supported_columns, 'warnings', c.warnings
      ) END AS capabilities
    FROM index_analyzer.source_databases sd
    JOIN index_analyzer.sources s ON s.id = sd.source_id
    LEFT JOIN index_analyzer.capabilities c ON c.source_database_id = sd.id
    WHERE s.enabled
    ORDER BY s.display_name, sd.database_name
    LIMIT 250
  `);
  return result.rows.map((row) => ({
    sourceDatabaseId: toNumber(row["source_database_id"]),
    sourceKey: String(row["source_key"]),
    displayName: String(row["display_name"]),
    bindingName: String(row["binding_name"]),
    databaseOid: toNumber(row["database_oid"]),
    databaseName: String(row["database_name"]),
    serverVersion: toNumber(row["server_version"]),
    lastSeenAt: new Date(String(row["last_seen_at"])),
    capabilities:
      row["capabilities"] && typeof row["capabilities"] === "object"
        ? (row["capabilities"] as Record<string, unknown>)
        : null,
  }));
}

export interface FleetSnapshot {
  sourceDatabaseId: number;
  sourceKey: string;
  databaseName: string;
  collectionRunId: number;
  capturedAt: Date;
  status: string;
  resetDetected: boolean;
  databaseSizeBytes: number;
  activeConnections: number;
  blocksRead: number;
  blocksHit: number;
  tempBytes: number;
  deadlocks: number;
  queryCount: number;
  tableCount: number;
  indexCount: number;
}

export async function listLatestFleetSnapshots(
  db: Queryable,
): Promise<FleetSnapshot[]> {
  const result = await db.query<Record<string, unknown>>(`
    SELECT DISTINCT ON (sd.id) sd.id AS source_database_id, s.source_key, sd.database_name,
      cr.id AS collection_run_id, ds.captured_at, cr.status, cr.reset_detected,
      ds.database_size_bytes, ds.active_connections, ds.blks_read, ds.blks_hit,
      ds.temp_bytes, ds.deadlocks, cr.query_count, cr.table_count, cr.index_count
    FROM index_analyzer.source_databases sd
    JOIN index_analyzer.sources s ON s.id = sd.source_id
    JOIN index_analyzer.collection_runs cr ON cr.source_database_id = sd.id
    JOIN index_analyzer.database_snapshots ds ON ds.collection_run_id = cr.id
    WHERE s.enabled AND cr.status = 'succeeded'
    ORDER BY sd.id, cr.started_at DESC
    LIMIT 250
  `);
  return result.rows.map((row) => ({
    sourceDatabaseId: toNumber(row["source_database_id"]),
    sourceKey: String(row["source_key"]),
    databaseName: String(row["database_name"]),
    collectionRunId: toNumber(row["collection_run_id"]),
    capturedAt: new Date(String(row["captured_at"])),
    status: String(row["status"]),
    resetDetected: row["reset_detected"] === true,
    databaseSizeBytes: toNumber(row["database_size_bytes"]),
    activeConnections: toNumber(row["active_connections"]),
    blocksRead: toNumber(row["blks_read"]),
    blocksHit: toNumber(row["blks_hit"]),
    tempBytes: toNumber(row["temp_bytes"]),
    deadlocks: toNumber(row["deadlocks"]),
    queryCount: toNumber(row["query_count"]),
    tableCount: toNumber(row["table_count"]),
    indexCount: toNumber(row["index_count"]),
  }));
}

export async function listQueryHistory(
  db: Queryable,
  sourceDatabaseId: number,
  queryId: string,
  input: PageInput = {},
): Promise<Record<string, unknown>[]> {
  if (!Number.isSafeInteger(sourceDatabaseId) || sourceDatabaseId <= 0) {
    throw new Error("Invalid source database ID");
  }
  if (!/^-?\d+$/.test(queryId)) throw new Error("Invalid query ID");
  const page = boundedPage(input);
  const result = await db.query<Record<string, unknown>>(
    `
    SELECT qs.*, cr.started_at AS captured_at, cr.reset_detected
    FROM index_analyzer.query_snapshots qs
    JOIN index_analyzer.collection_runs cr ON cr.id = qs.collection_run_id
    WHERE cr.source_database_id = $1 AND qs.query_id = $2
    ORDER BY cr.started_at DESC
    LIMIT $3 OFFSET $4
  `,
    [sourceDatabaseId, queryId, page.limit, page.offset],
  );
  return result.rows;
}

export interface RegressionWindowMetrics {
  sampleCount: number;
  calls: number;
  totalExecTimeMs: number;
  meanExecTimeMs: number | null;
  rowsPerCall: number | null;
}

export interface QueryRegressionWindows {
  recent: RegressionWindowMetrics | null;
  baseline: RegressionWindowMetrics | null;
  resetSamplesDiscarded: number;
}

export async function getQueryRegressionWindows(
  db: Queryable,
  sourceDatabaseId: number,
  queryId: string,
  input: { recentSamples?: number; baselineSamples?: number } = {},
): Promise<QueryRegressionWindows> {
  if (!Number.isSafeInteger(sourceDatabaseId) || sourceDatabaseId <= 0) {
    throw new Error("Invalid source database ID");
  }
  if (!/^-?\d+$/.test(queryId)) throw new Error("Invalid query ID");
  const recentSamples = input.recentSamples ?? 3;
  const baselineSamples = input.baselineSamples ?? 6;
  if (
    !Number.isSafeInteger(recentSamples) ||
    !Number.isSafeInteger(baselineSamples) ||
    recentSamples < 1 ||
    recentSamples > 20 ||
    baselineSamples < 1 ||
    baselineSamples > 50
  ) {
    throw new Error("Regression windows are out of bounds");
  }
  const result = await db.query<Record<string, unknown>>(
    `
    WITH sampled AS (
      SELECT cr.id, cr.started_at, cr.reset_detected,
        sum(qs.calls)::bigint AS calls,
        sum(qs.total_exec_time)::float8 AS total_exec_time,
        sum(qs.rows)::bigint AS rows
      FROM index_analyzer.collection_runs cr
      JOIN index_analyzer.query_snapshots qs ON qs.collection_run_id = cr.id
      WHERE cr.source_database_id = $1 AND qs.query_id = $2 AND cr.status = 'succeeded'
      GROUP BY cr.id, cr.started_at, cr.reset_detected
      ORDER BY cr.started_at DESC
      LIMIT $3
    ), ordered AS (
      SELECT *, lag(calls) OVER (ORDER BY started_at) AS previous_calls,
        lag(total_exec_time) OVER (ORDER BY started_at) AS previous_exec_time,
        lag(rows) OVER (ORDER BY started_at) AS previous_rows
      FROM sampled
    ), deltas AS (
      SELECT *, calls - previous_calls AS calls_delta,
        total_exec_time - previous_exec_time AS exec_delta,
        rows - previous_rows AS rows_delta,
        reset_detected OR previous_calls IS NULL OR calls < previous_calls
          OR total_exec_time < previous_exec_time OR rows < previous_rows AS unusable,
        row_number() OVER (ORDER BY started_at DESC) AS recency
      FROM ordered
    )
    SELECT
      count(*) FILTER (WHERE unusable) AS reset_samples_discarded,
      count(*) FILTER (WHERE NOT unusable AND recency <= $4) AS recent_sample_count,
      COALESCE(sum(calls_delta) FILTER (WHERE NOT unusable AND recency <= $4), 0) AS recent_calls,
      COALESCE(sum(exec_delta) FILTER (WHERE NOT unusable AND recency <= $4), 0) AS recent_exec,
      COALESCE(sum(rows_delta) FILTER (WHERE NOT unusable AND recency <= $4), 0) AS recent_rows,
      count(*) FILTER (WHERE NOT unusable AND recency > $4) AS baseline_sample_count,
      COALESCE(sum(calls_delta) FILTER (WHERE NOT unusable AND recency > $4), 0) AS baseline_calls,
      COALESCE(sum(exec_delta) FILTER (WHERE NOT unusable AND recency > $4), 0) AS baseline_exec,
      COALESCE(sum(rows_delta) FILTER (WHERE NOT unusable AND recency > $4), 0) AS baseline_rows
    FROM deltas
  `,
    [
      sourceDatabaseId,
      queryId,
      recentSamples + baselineSamples + 1,
      recentSamples,
    ],
  );
  const row = result.rows[0] ?? {};
  const window = (
    prefix: "recent" | "baseline",
  ): RegressionWindowMetrics | null => {
    const sampleCount = toNumber(row[`${prefix}_sample_count`]);
    if (sampleCount === 0) return null;
    const calls = toNumber(row[`${prefix}_calls`]);
    const execution = toNumber(row[`${prefix}_exec`]);
    const rows = toNumber(row[`${prefix}_rows`]);
    return {
      sampleCount,
      calls,
      totalExecTimeMs: execution,
      meanExecTimeMs: calls > 0 ? execution / calls : null,
      rowsPerCall: calls > 0 ? rows / calls : null,
    };
  };
  return {
    recent: window("recent"),
    baseline: window("baseline"),
    resetSamplesDiscarded: toNumber(row["reset_samples_discarded"]),
  };
}
