import type { AiIndexContext, AiTableContext } from "@/lib/ai/payload";

import type { Queryable } from "./client";
import { toNumber } from "./sql";

export interface QualifiedRelation {
  schema: string;
  table: string;
}

export interface AdvisorFindingEvidence {
  id: number;
  sourceDatabaseId: number;
  category: string;
  severity: string;
  title: string;
  summary: string;
  evidence: Record<string, unknown>;
  destination: Record<string, unknown>;
}

export interface AdvisorExplainEvidence {
  id: string;
  sourceDatabaseId: number;
  createdAt: Date;
  normalizedQuery: string;
  plan: unknown;
}

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export async function getAdvisorFinding(
  db: Queryable,
  sourceDatabaseId: number,
  findingId: number,
): Promise<AdvisorFindingEvidence | null> {
  const result = await db.query<Record<string, unknown>>(
    `
    SELECT id, source_database_id, category, severity, title, summary, evidence, destination
    FROM index_analyzer.findings
    WHERE id = $1 AND source_database_id = $2
  `,
    [findingId, sourceDatabaseId],
  );
  const row = result.rows[0];
  if (!row) return null;
  return {
    id: toNumber(row["id"]),
    sourceDatabaseId: toNumber(row["source_database_id"]),
    category: String(row["category"]),
    severity: String(row["severity"]),
    title: String(row["title"]),
    summary: String(row["summary"]),
    evidence: objectValue(row["evidence"]),
    destination: objectValue(row["destination"]),
  };
}

function mapExplain(row: Record<string, unknown>): AdvisorExplainEvidence {
  return {
    id: String(row["id"]),
    sourceDatabaseId: toNumber(row["source_database_id"]),
    createdAt: new Date(String(row["created_at"])),
    normalizedQuery: String(row["normalized_query"]),
    plan: row["plan_json"],
  };
}

export async function getAdvisorExplainRun(
  db: Queryable,
  sourceDatabaseId: number,
  planId: string,
): Promise<AdvisorExplainEvidence | null> {
  const result = await db.query<Record<string, unknown>>(
    `
    SELECT id, source_database_id, created_at, normalized_query, plan_json
    FROM index_analyzer.explain_runs
    WHERE id = $1 AND source_database_id = $2
  `,
    [planId, sourceDatabaseId],
  );
  return result.rows[0] ? mapExplain(result.rows[0]) : null;
}

export async function listRecentAdvisorExplainRuns(
  db: Queryable,
  sourceDatabaseId: number,
  limit = 50,
): Promise<AdvisorExplainEvidence[]> {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100)
    throw new Error("Advisor plan limit must be between 1 and 100");
  const result = await db.query<Record<string, unknown>>(
    `
    SELECT id, source_database_id, created_at, normalized_query
    FROM index_analyzer.explain_runs
    WHERE source_database_id = $1
    ORDER BY created_at DESC
    LIMIT $2
  `,
    [sourceDatabaseId, limit],
  );
  return result.rows.map(mapExplain);
}

export async function getAdvisorTableContexts(
  db: Queryable,
  relations: readonly QualifiedRelation[],
): Promise<Array<AiTableContext & { relationOid: number }>> {
  const bounded = relations.slice(0, 30);
  if (bounded.length === 0) return [];
  const requested = JSON.stringify(
    bounded.map((relation) => ({
      schema_name: relation.schema,
      table_name: relation.table,
    })),
  );
  const tables = await db.query<Record<string, unknown>>(
    `
    WITH requested AS (
      SELECT * FROM jsonb_to_recordset($1::jsonb)
        AS value(schema_name text, table_name text)
    )
    SELECT c.oid::int AS relation_oid, n.nspname AS schema_name,
      c.relname AS table_name, c.reltuples::bigint AS estimated_rows,
      pg_total_relation_size(c.oid) AS total_bytes
    FROM requested r
    JOIN pg_namespace n ON n.nspname = r.schema_name
    JOIN pg_class c ON c.relnamespace = n.oid AND c.relname = r.table_name
    WHERE c.relkind IN ('r', 'p', 'm')
    ORDER BY n.nspname, c.relname
    LIMIT 30
  `,
    [requested],
  );
  const relationOids = tables.rows.map((row) => toNumber(row["relation_oid"]));
  if (relationOids.length === 0) return [];
  const columns = await db.query<Record<string, unknown>>(
    `
    SELECT a.attrelid::int AS relation_oid, a.attnum::int AS ordinal,
      a.attname AS column_name, format_type(a.atttypid, a.atttypmod) AS data_type,
      NOT a.attnotnull AS nullable, s.null_frac, s.avg_width, s.n_distinct,
      s.correlation,
      COALESCE(array_length(s.most_common_vals, 1), 0)::int AS common_value_count,
      COALESCE(array_length(s.histogram_bounds, 1), 0)::int AS histogram_boundary_count
    FROM pg_attribute a
    JOIN pg_class c ON c.oid = a.attrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    LEFT JOIN pg_stats s ON s.schemaname = n.nspname
      AND s.tablename = c.relname AND s.attname = a.attname
    WHERE a.attrelid = ANY($1::oid[]) AND a.attnum > 0 AND NOT a.attisdropped
    ORDER BY a.attrelid, a.attnum
    LIMIT 2400
  `,
    [relationOids],
  );
  const columnsByRelation = new Map<number, AiTableContext["columns"]>();
  for (const row of columns.rows) {
    const relationOid = toNumber(row["relation_oid"]);
    const statistics: Record<string, number> = {};
    if (row["null_frac"] != null)
      statistics["nullFraction"] = toNumber(row["null_frac"]);
    if (row["avg_width"] != null)
      statistics["averageWidthBytes"] = toNumber(row["avg_width"]);
    if (row["n_distinct"] != null)
      statistics["distinctEstimate"] = toNumber(row["n_distinct"]);
    if (row["correlation"] != null)
      statistics["correlation"] = toNumber(row["correlation"]);
    statistics["commonValueCount"] = toNumber(row["common_value_count"]);
    statistics["histogramBoundaryCount"] = toNumber(
      row["histogram_boundary_count"],
    );
    const relationColumns = columnsByRelation.get(relationOid) ?? [];
    relationColumns.push({
      name: String(row["column_name"]),
      dataType: String(row["data_type"]),
      nullable: row["nullable"] === true,
      statistics,
    });
    columnsByRelation.set(relationOid, relationColumns);
  }
  return tables.rows.map((row) => {
    const relationOid = toNumber(row["relation_oid"]);
    return {
      relationOid,
      schema: String(row["schema_name"]),
      name: String(row["table_name"]),
      estimatedRows: toNumber(row["estimated_rows"]),
      totalBytes: toNumber(row["total_bytes"]),
      columns: columnsByRelation.get(relationOid) ?? [],
    };
  });
}

export async function getAdvisorIndexContexts(
  db: Queryable,
  relationOids: readonly number[],
): Promise<AiIndexContext[]> {
  const bounded = [...new Set(relationOids)].slice(0, 30);
  if (bounded.length === 0) return [];
  const result = await db.query<Record<string, unknown>>(
    `
    SELECT n.nspname AS schema_name, t.relname AS table_name,
      i.relname AS index_name, pg_get_indexdef(i.oid) AS index_definition,
      COALESCE(si.idx_scan, 0) AS scans, pg_relation_size(i.oid) AS size_bytes
    FROM pg_index ix
    JOIN pg_class i ON i.oid = ix.indexrelid
    JOIN pg_class t ON t.oid = ix.indrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    LEFT JOIN pg_stat_all_indexes si ON si.indexrelid = i.oid
    WHERE t.oid = ANY($1::oid[])
    ORDER BY pg_relation_size(i.oid) DESC, n.nspname, t.relname, i.relname
    LIMIT 100
  `,
    [bounded],
  );
  return result.rows.map((row) => ({
    schema: String(row["schema_name"]),
    table: String(row["table_name"]),
    name: String(row["index_name"]),
    definition: String(row["index_definition"]),
    scans: toNumber(row["scans"]),
    sizeBytes: toNumber(row["size_bytes"]),
  }));
}

export async function getAdvisorSettings(
  db: Queryable,
): Promise<Record<string, string>> {
  const result = await db.query<{
    name: string;
    setting: string;
    unit: string | null;
  }>(`
    SELECT name, setting, unit
    FROM pg_settings
    WHERE name ~ '^(enable_)'
      OR name IN (
        'application_name', 'effective_cache_size', 'jit', 'join_collapse_limit',
        'max_parallel_workers_per_gather', 'random_page_cost', 'seq_page_cost',
        'shared_buffers', 'temp_buffers', 'work_mem', 'maintenance_work_mem',
        'default_statistics_target', 'plan_cache_mode'
      )
    ORDER BY name
    LIMIT 40
  `);
  return Object.fromEntries(
    result.rows.map((row) => [
      row.name,
      row.unit ? `${row.setting}${row.unit}` : row.setting,
    ]),
  );
}
