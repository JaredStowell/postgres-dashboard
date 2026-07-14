import type { DatabasePool, Queryable } from "./client";
import { withReadOnlyTransaction } from "./client";
import { boundedPage, escapeLike, type PageInput, toNumber } from "./sql";

export interface TableMaintenance {
  relationOid: number;
  schema: string;
  table: string;
  estimatedRows: number;
  liveRows: number;
  deadRows: number;
  modificationsSinceAnalyze: number;
  sequentialScans: number;
  sequentialTuplesRead: number;
  indexScans: number | null;
  inserted: number;
  updated: number;
  deleted: number;
  hotUpdated: number;
  relationSizeBytes: number;
  totalSizeBytes: number;
  lastVacuum: Date | null;
  lastAutovacuum: Date | null;
  lastAnalyze: Date | null;
  lastAutoanalyze: Date | null;
  vacuumCount: number;
  autovacuumCount: number;
  analyzeCount: number;
  autoanalyzeCount: number;
  transactionIdAge: number;
  relationOptions: string[];
}

export async function listTableMaintenance(
  db: Queryable,
  input: PageInput & { schema?: string; search?: string } = {},
): Promise<TableMaintenance[]> {
  const page = boundedPage(input);
  const values: unknown[] = [];
  const clauses = [
    "c.relkind IN ('r', 'p', 'm')",
    "n.nspname !~ '^pg_(toast|temp)'",
    "n.nspname <> 'information_schema'",
  ];
  if (input.schema) {
    values.push(input.schema);
    clauses.push(`n.nspname = $${values.length}`);
  }
  if (input.search) {
    values.push(`%${escapeLike(input.search)}%`);
    clauses.push(
      `(c.relname ILIKE $${values.length} ESCAPE '\\' OR n.nspname ILIKE $${values.length} ESCAPE '\\')`,
    );
  }
  values.push(page.limit, page.offset);
  const result = await db.query<Record<string, unknown>>(
    `
    SELECT c.oid::int AS relation_oid, n.nspname AS schema_name, c.relname AS table_name,
      c.reltuples::bigint AS estimated_rows, COALESCE(st.n_live_tup, 0) AS live_rows,
      COALESCE(st.n_dead_tup, 0) AS dead_rows, COALESCE(st.n_mod_since_analyze, 0) AS modifications_since_analyze,
      COALESCE(st.seq_scan, 0) AS sequential_scans, COALESCE(st.seq_tup_read, 0) AS sequential_tuples_read,
      st.idx_scan AS index_scans, COALESCE(st.n_tup_ins, 0) AS inserted,
      COALESCE(st.n_tup_upd, 0) AS updated, COALESCE(st.n_tup_del, 0) AS deleted,
      COALESCE(st.n_tup_hot_upd, 0) AS hot_updated, pg_relation_size(c.oid) AS relation_size_bytes,
      pg_total_relation_size(c.oid) AS total_size_bytes, st.last_vacuum, st.last_autovacuum,
      st.last_analyze, st.last_autoanalyze, COALESCE(st.vacuum_count, 0) AS vacuum_count,
      COALESCE(st.autovacuum_count, 0) AS autovacuum_count, COALESCE(st.analyze_count, 0) AS analyze_count,
      COALESCE(st.autoanalyze_count, 0) AS autoanalyze_count,
      CASE WHEN c.relkind IN ('r', 'm') AND c.relfrozenxid <> '0'::xid
        THEN age(c.relfrozenxid) ELSE 0 END AS transaction_id_age,
      COALESCE(c.reloptions, '{}'::text[]) AS relation_options
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    LEFT JOIN pg_stat_all_tables st ON st.relid = c.oid
    WHERE ${clauses.join(" AND ")}
    ORDER BY COALESCE(st.n_dead_tup, 0) DESC, pg_total_relation_size(c.oid) DESC
    LIMIT $${values.length - 1} OFFSET $${values.length}
  `,
    values,
  );
  return result.rows.map(mapMaintenance);
}

function mapMaintenance(row: Record<string, unknown>): TableMaintenance {
  const date = (key: string) => (row[key] ? new Date(String(row[key])) : null);
  return {
    relationOid: toNumber(row["relation_oid"]),
    schema: String(row["schema_name"]),
    table: String(row["table_name"]),
    estimatedRows: toNumber(row["estimated_rows"]),
    liveRows: toNumber(row["live_rows"]),
    deadRows: toNumber(row["dead_rows"]),
    modificationsSinceAnalyze: toNumber(row["modifications_since_analyze"]),
    sequentialScans: toNumber(row["sequential_scans"]),
    sequentialTuplesRead: toNumber(row["sequential_tuples_read"]),
    indexScans:
      row["index_scans"] === null ? null : toNumber(row["index_scans"]),
    inserted: toNumber(row["inserted"]),
    updated: toNumber(row["updated"]),
    deleted: toNumber(row["deleted"]),
    hotUpdated: toNumber(row["hot_updated"]),
    relationSizeBytes: toNumber(row["relation_size_bytes"]),
    totalSizeBytes: toNumber(row["total_size_bytes"]),
    lastVacuum: date("last_vacuum"),
    lastAutovacuum: date("last_autovacuum"),
    lastAnalyze: date("last_analyze"),
    lastAutoanalyze: date("last_autoanalyze"),
    vacuumCount: toNumber(row["vacuum_count"]),
    autovacuumCount: toNumber(row["autovacuum_count"]),
    analyzeCount: toNumber(row["analyze_count"]),
    autoanalyzeCount: toNumber(row["autoanalyze_count"]),
    transactionIdAge: toNumber(row["transaction_id_age"]),
    relationOptions: Array.isArray(row["relation_options"])
      ? row["relation_options"].map(String)
      : [],
  };
}

export interface ProgressOperation {
  processId: number;
  operation: "vacuum" | "create_index";
  relationOid: number;
  phase: string;
  completed: number;
  total: number;
}

export async function listMaintenanceProgress(
  db: Queryable,
  supportedColumns?: Record<string, string[]>,
): Promise<ProgressOperation[]> {
  let columns = supportedColumns;
  if (!columns) {
    const discovered = await db.query<{
      table_name: string;
      column_name: string;
    }>(`
      SELECT c.relname AS table_name, a.attname AS column_name
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = 'pg_catalog'
      JOIN pg_attribute a ON a.attrelid = c.oid
        AND a.attnum > 0 AND NOT a.attisdropped
      WHERE c.relname IN ('pg_stat_progress_vacuum', 'pg_stat_progress_create_index')
    `);
    columns = {};
    for (const column of discovered.rows) {
      (columns[column.table_name] ??= []).push(column.column_name);
    }
  }
  const hasColumns = (view: string, required: string[]) => {
    const available = new Set(columns?.[view] ?? []);
    return required.every((column) => available.has(column));
  };
  const selections: string[] = [];
  if (
    hasColumns("pg_stat_progress_vacuum", [
      "pid",
      "relid",
      "phase",
      "heap_blks_scanned",
      "heap_blks_total",
    ])
  ) {
    selections.push(`SELECT pid, 'vacuum' AS operation, relid::int AS relation_oid, phase,
      heap_blks_scanned AS completed, heap_blks_total AS total
      FROM pg_catalog.pg_stat_progress_vacuum`);
  }
  if (
    hasColumns("pg_stat_progress_create_index", [
      "pid",
      "relid",
      "phase",
      "blocks_done",
      "blocks_total",
    ])
  ) {
    selections.push(`SELECT pid, 'create_index' AS operation, relid::int AS relation_oid, phase,
      blocks_done AS completed, blocks_total AS total
      FROM pg_catalog.pg_stat_progress_create_index`);
  }
  if (selections.length === 0) return [];
  const result = await db.query<Record<string, unknown>>(
    `${selections.join(" UNION ALL ")} LIMIT 250`,
  );
  return result.rows.map((row) => ({
    processId: toNumber(row["pid"]),
    operation: row["operation"] === "vacuum" ? "vacuum" : "create_index",
    relationOid: toNumber(row["relation_oid"]),
    phase: String(row["phase"]),
    completed: toNumber(row["completed"]),
    total: toNumber(row["total"]),
  }));
}

export async function exactBloatCheck(
  db: DatabasePool,
  relationOid: number,
  statementTimeoutMs = 5_000,
): Promise<{
  tableLength: number;
  tuplePercent: number;
  deadTuplePercent: number;
  freePercent: number;
}> {
  if (!Number.isSafeInteger(relationOid) || relationOid <= 0)
    throw new Error("Invalid relation OID");
  const result = await withReadOnlyTransaction(
    db,
    (client) =>
      client.query<Record<string, unknown>>(
        `
          SELECT s.table_len, s.tuple_percent, s.dead_tuple_percent, s.free_percent
          FROM pg_class c
          CROSS JOIN LATERAL pgstattuple(c.oid) s
          WHERE c.oid = $1 AND c.relkind IN ('r', 'm')
        `,
        [relationOid],
      ),
    { statementTimeoutMs, lockTimeoutMs: 1_000 },
  );
  const row = result.rows[0];
  if (!row) throw new Error("Relation not found or unsupported");
  return {
    tableLength: toNumber(row["table_len"]),
    tuplePercent: toNumber(row["tuple_percent"]),
    deadTuplePercent: toNumber(row["dead_tuple_percent"]),
    freePercent: toNumber(row["free_percent"]),
  };
}
