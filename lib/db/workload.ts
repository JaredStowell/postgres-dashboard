import type { Queryable } from "./client";
import { boundedPage, escapeLike, type PageInput, toNumber } from "./sql";

export type WorkloadSort =
  | "total_exec_time"
  | "mean_exec_time"
  | "calls"
  | "rows"
  | "shared_blks_read"
  | "temp_blks_written"
  | "wal_bytes";

export interface QueryStat {
  queryId: string;
  userOid: number;
  userName: string;
  databaseOid: number;
  databaseName: string;
  query: string;
  toplevel: boolean;
  calls: number;
  totalPlanTime: number;
  meanPlanTime: number;
  totalExecTime: number;
  meanExecTime: number;
  rows: number;
  sharedBlocksHit: number;
  sharedBlocksRead: number;
  sharedBlocksDirtied: number;
  sharedBlocksWritten: number;
  tempBlocksRead: number;
  tempBlocksWritten: number;
  walRecords: number;
  walBytes: number;
  statsSince: Date | null;
  minmaxStatsSince: Date | null;
}

const SORT_COLUMNS: Record<WorkloadSort, string> = {
  total_exec_time: "s.total_exec_time",
  mean_exec_time: "s.mean_exec_time",
  calls: "s.calls",
  rows: "s.rows",
  shared_blks_read: "s.shared_blks_read",
  temp_blks_written: "s.temp_blks_written",
  wal_bytes: "s.wal_bytes",
};

async function pgssColumns(db: Queryable): Promise<Set<string>> {
  const result = await db.query<{ attname: string }>(`
    SELECT a.attname FROM pg_attribute a
    WHERE a.attrelid = to_regclass('public.pg_stat_statements')
      AND a.attnum > 0 AND NOT a.attisdropped
  `);
  return new Set(result.rows.map((row) => row.attname));
}

export async function listQueryStats(
  db: Queryable,
  input: PageInput & {
    search?: string;
    sort?: WorkloadSort;
    direction?: "asc" | "desc";
  } = {},
): Promise<QueryStat[]> {
  const page = boundedPage(input);
  const columns = await pgssColumns(db);
  if (columns.size === 0) return [];
  const sort = SORT_COLUMNS[input.sort ?? "total_exec_time"];
  const direction = input.direction === "asc" ? "ASC" : "DESC";
  const values: unknown[] = [];
  const clauses = [
    "s.dbid = (SELECT oid FROM pg_database WHERE datname = current_database())",
  ];
  if (input.search) {
    values.push(`%${escapeLike(input.search)}%`);
    clauses.push(
      `(s.query ILIKE $${values.length} ESCAPE '\\' OR s.queryid::text = $${values.length + 1})`,
    );
    values.push(input.search);
  }
  values.push(page.limit, page.offset);
  const optional = (name: string, fallback: string) =>
    columns.has(name) ? `s.${name}` : fallback;
  const result = await db.query<Record<string, unknown>>(
    `
    SELECT s.queryid::text AS query_id, s.userid::int AS user_oid,
      COALESCE(r.rolname, '<unknown>') AS user_name, s.dbid::int AS database_oid,
      d.datname AS database_name, left(s.query, 50000) AS query,
      ${optional("toplevel", "true")} AS toplevel,
      s.calls, ${optional("total_plan_time", "0")} AS total_plan_time,
      ${optional("mean_plan_time", "0")} AS mean_plan_time,
      s.total_exec_time, s.mean_exec_time, s.rows, s.shared_blks_hit, s.shared_blks_read,
      s.shared_blks_dirtied, s.shared_blks_written, s.temp_blks_read, s.temp_blks_written,
      ${optional("wal_records", "0")} AS wal_records, ${optional("wal_bytes", "0")} AS wal_bytes,
      ${optional("stats_since", "NULL::timestamptz")} AS stats_since,
      ${optional("minmax_stats_since", "NULL::timestamptz")} AS minmax_stats_since
    FROM public.pg_stat_statements s
    JOIN pg_database d ON d.oid = s.dbid
    LEFT JOIN pg_roles r ON r.oid = s.userid
    WHERE ${clauses.join(" AND ")}
    ORDER BY ${sort} ${direction}, s.queryid
    LIMIT $${values.length - 1} OFFSET $${values.length}
  `,
    values,
  );
  return result.rows.map(mapQueryStat);
}

export async function getQueryStat(
  db: Queryable,
  queryId: string,
): Promise<QueryStat | null> {
  if (!/^-?\d+$/.test(queryId)) throw new Error("Invalid query ID");
  const rows = await listQueryStats(db, { search: queryId, limit: 250 });
  return rows.find((row) => row.queryId === queryId) ?? null;
}

function mapQueryStat(row: Record<string, unknown>): QueryStat {
  return {
    queryId: String(row["query_id"]),
    userOid: toNumber(row["user_oid"]),
    userName: String(row["user_name"]),
    databaseOid: toNumber(row["database_oid"]),
    databaseName: String(row["database_name"]),
    query: String(row["query"]),
    toplevel: row["toplevel"] !== false,
    calls: toNumber(row["calls"]),
    totalPlanTime: toNumber(row["total_plan_time"]),
    meanPlanTime: toNumber(row["mean_plan_time"]),
    totalExecTime: toNumber(row["total_exec_time"]),
    meanExecTime: toNumber(row["mean_exec_time"]),
    rows: toNumber(row["rows"]),
    sharedBlocksHit: toNumber(row["shared_blks_hit"]),
    sharedBlocksRead: toNumber(row["shared_blks_read"]),
    sharedBlocksDirtied: toNumber(row["shared_blks_dirtied"]),
    sharedBlocksWritten: toNumber(row["shared_blks_written"]),
    tempBlocksRead: toNumber(row["temp_blks_read"]),
    tempBlocksWritten: toNumber(row["temp_blks_written"]),
    walRecords: toNumber(row["wal_records"]),
    walBytes: toNumber(row["wal_bytes"]),
    statsSince: row["stats_since"]
      ? new Date(String(row["stats_since"]))
      : null,
    minmaxStatsSince: row["minmax_stats_since"]
      ? new Date(String(row["minmax_stats_since"]))
      : null,
  };
}
