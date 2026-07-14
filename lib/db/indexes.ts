import type { Queryable } from "./client";
import { boundedPage, escapeLike, type PageInput, toNumber } from "./sql";
import { analyzeIndexOverlaps } from "../analysis/indexes";

export interface IndexInfo {
  indexOid: number;
  tableOid: number;
  schema: string;
  table: string;
  name: string;
  definition: string;
  accessMethod: string;
  unique: boolean;
  primary: boolean;
  valid: boolean;
  ready: boolean;
  scans: number;
  tuplesRead: number;
  tuplesFetched: number;
  sizeBytes: number;
  keyColumns: string[];
  includedColumns: string[];
  predicate: string | null;
  constraintBacked: boolean;
  tableInserts: number;
  tableUpdates: number;
  tableDeletes: number;
  tableHotUpdates: number;
  tableBytes: number;
  tableIndexCount: number;
  totalTableIndexBytes: number;
}

export async function listIndexes(
  db: Queryable,
  input: PageInput & {
    schema?: string;
    relationOid?: number;
    search?: string;
    identityOrder?: boolean;
  } = {},
): Promise<IndexInfo[]> {
  const page = boundedPage(input);
  const values: unknown[] = [];
  const clauses = [
    "tn.nspname !~ '^pg_(toast|temp)'",
    "tn.nspname <> 'information_schema'",
  ];
  if (input.schema) {
    values.push(input.schema);
    clauses.push(`tn.nspname = $${values.length}`);
  }
  if (input.relationOid !== undefined) {
    if (!Number.isSafeInteger(input.relationOid) || input.relationOid <= 0) {
      throw new Error("Invalid relation OID");
    }
    values.push(input.relationOid);
    clauses.push(`t.oid = $${values.length}`);
  }
  if (input.search) {
    values.push(`%${escapeLike(input.search)}%`);
    clauses.push(
      `(i.relname ILIKE $${values.length} ESCAPE '\\' OR t.relname ILIKE $${values.length} ESCAPE '\\')`,
    );
  }
  values.push(page.limit, page.offset);
  const result = await db.query<Record<string, unknown>>(
    `
    SELECT
      i.oid::int AS index_oid, t.oid::int AS table_oid, tn.nspname AS schema_name,
      t.relname AS table_name, i.relname AS index_name,
      left(pg_get_indexdef(i.oid), 5000) AS index_definition,
      am.amname AS access_method, ix.indisunique AS is_unique, ix.indisprimary AS is_primary,
      ix.indisvalid AS is_valid, ix.indisready AS is_ready,
      COALESCE(si.idx_scan, 0) AS scans, COALESCE(si.idx_tup_read, 0) AS tuples_read,
      COALESCE(si.idx_tup_fetch, 0) AS tuples_fetched, pg_relation_size(i.oid) AS size_bytes,
      ARRAY(
        SELECT left(pg_get_indexdef(i.oid, position, true), 512)
        FROM generate_series(1, ix.indnkeyatts) position ORDER BY position
      ) AS key_columns,
      ARRAY(
        SELECT left(pg_get_indexdef(i.oid, position, true), 512)
        FROM generate_series(ix.indnkeyatts + 1, ix.indnatts) position ORDER BY position
      ) AS included_columns,
      left(pg_get_expr(ix.indpred, ix.indrelid), 2000) AS predicate,
      EXISTS (SELECT 1 FROM pg_constraint con WHERE con.conindid = i.oid) AS constraint_backed,
      COALESCE(st.n_tup_ins, 0) AS table_inserts, COALESCE(st.n_tup_upd, 0) AS table_updates,
      COALESCE(st.n_tup_del, 0) AS table_deletes,
      COALESCE(st.n_tup_hot_upd, 0) AS table_hot_updates,
      pg_relation_size(t.oid) AS table_bytes,
      count(*) OVER (PARTITION BY t.oid)::int AS table_index_count,
      sum(pg_relation_size(i.oid)) OVER (PARTITION BY t.oid) AS total_table_index_bytes
    FROM pg_index ix
    JOIN pg_class i ON i.oid = ix.indexrelid
    JOIN pg_class t ON t.oid = ix.indrelid
    JOIN pg_namespace tn ON tn.oid = t.relnamespace
    JOIN pg_am am ON am.oid = i.relam
    LEFT JOIN pg_stat_all_indexes si ON si.indexrelid = i.oid
    LEFT JOIN pg_stat_all_tables st ON st.relid = t.oid
    WHERE ${clauses.join(" AND ")}
    ORDER BY ${input.identityOrder ? "t.oid, i.oid" : "pg_relation_size(i.oid) DESC, tn.nspname, t.relname, i.relname"}
    LIMIT $${values.length - 1} OFFSET $${values.length}
  `,
    values,
  );
  return result.rows.map((row) => ({
    indexOid: toNumber(row["index_oid"]),
    tableOid: toNumber(row["table_oid"]),
    schema: String(row["schema_name"]),
    table: String(row["table_name"]),
    name: String(row["index_name"]),
    definition: String(row["index_definition"]),
    accessMethod: String(row["access_method"]),
    unique: row["is_unique"] === true,
    primary: row["is_primary"] === true,
    valid: row["is_valid"] === true,
    ready: row["is_ready"] === true,
    scans: toNumber(row["scans"]),
    tuplesRead: toNumber(row["tuples_read"]),
    tuplesFetched: toNumber(row["tuples_fetched"]),
    sizeBytes: toNumber(row["size_bytes"]),
    keyColumns: Array.isArray(row["key_columns"])
      ? row["key_columns"].map(String)
      : [],
    includedColumns: Array.isArray(row["included_columns"])
      ? row["included_columns"].map(String)
      : [],
    predicate: row["predicate"] === null ? null : String(row["predicate"]),
    constraintBacked: row["constraint_backed"] === true,
    tableInserts: toNumber(row["table_inserts"]),
    tableUpdates: toNumber(row["table_updates"]),
    tableDeletes: toNumber(row["table_deletes"]),
    tableHotUpdates: toNumber(row["table_hot_updates"]),
    tableBytes: toNumber(row["table_bytes"]),
    tableIndexCount: toNumber(row["table_index_count"]),
    totalTableIndexBytes: toNumber(row["total_table_index_bytes"]),
  }));
}

export interface IndexRelationship {
  kind: "duplicate" | "prefix";
  tableOid: number;
  leftIndexOid: number;
  rightIndexOid: number;
  leftName: string;
  rightName: string;
  redundantIndexOid: number;
  coveringIndexOid: number;
  evidence: string;
}

export type IndexRelationshipInput = Pick<
  IndexInfo,
  | "indexOid"
  | "tableOid"
  | "schema"
  | "table"
  | "name"
  | "accessMethod"
  | "unique"
  | "primary"
  | "valid"
  | "ready"
  | "scans"
  | "sizeBytes"
  | "keyColumns"
  | "includedColumns"
  | "predicate"
  | "constraintBacked"
>;

export interface IndexRelationshipCandidateSet {
  indexes: IndexRelationshipInput[];
  truncated: boolean;
  limit: number;
}

export async function listIndexRelationshipCandidates(
  db: Queryable,
  input: {
    schema?: string;
    relationOid?: number;
    relationOids?: readonly number[];
    search?: string;
  } = {},
): Promise<IndexRelationshipCandidateSet> {
  const values: unknown[] = [];
  const clauses = [
    "tn.nspname !~ '^pg_(toast|temp)'",
    "tn.nspname <> 'information_schema'",
  ];
  if (input.schema) {
    values.push(input.schema);
    clauses.push(`tn.nspname = $${values.length}`);
  }
  if (input.relationOid !== undefined) {
    if (!Number.isSafeInteger(input.relationOid) || input.relationOid <= 0)
      throw new Error("Invalid relation OID");
    values.push(input.relationOid);
    clauses.push(`t.oid = $${values.length}`);
  }
  if (input.relationOids !== undefined) {
    const relationOids = [...new Set(input.relationOids)];
    if (
      relationOids.length > 250 ||
      relationOids.some(
        (oid) => !Number.isSafeInteger(oid) || oid <= 0 || oid > 2_147_483_647,
      )
    ) {
      throw new Error("Invalid relation OID set");
    }
    if (relationOids.length === 0) {
      return { indexes: [], truncated: false, limit: 5_000 };
    }
    values.push(relationOids);
    clauses.push(`t.oid = ANY($${values.length}::oid[])`);
  }
  if (input.search) {
    values.push(`%${escapeLike(input.search)}%`);
    clauses.push(
      `(i.relname ILIKE $${values.length} ESCAPE '\\' OR t.relname ILIKE $${values.length} ESCAPE '\\')`,
    );
  }
  const result = await db.query<Record<string, unknown>>(
    `
    SELECT i.oid::int AS index_oid, t.oid::int AS table_oid,
      tn.nspname AS schema_name, t.relname AS table_name, i.relname AS index_name,
      am.amname AS access_method, ix.indisunique AS is_unique,
      ix.indisprimary AS is_primary, ix.indisvalid AS is_valid,
      ix.indisready AS is_ready, COALESCE(si.idx_scan, 0) AS scans,
      pg_relation_size(i.oid) AS size_bytes,
      ARRAY(
        SELECT left(pg_get_indexdef(i.oid, position, true), 512)
        FROM generate_series(1, ix.indnkeyatts) position ORDER BY position
      ) AS key_columns,
      ARRAY(
        SELECT left(pg_get_indexdef(i.oid, position, true), 512)
        FROM generate_series(ix.indnkeyatts + 1, ix.indnatts) position ORDER BY position
      ) AS included_columns,
      left(pg_get_expr(ix.indpred, ix.indrelid), 2000) AS predicate,
      EXISTS (SELECT 1 FROM pg_constraint con WHERE con.conindid = i.oid) AS constraint_backed
    FROM pg_index ix
    JOIN pg_class i ON i.oid = ix.indexrelid
    JOIN pg_class t ON t.oid = ix.indrelid
    JOIN pg_namespace tn ON tn.oid = t.relnamespace
    JOIN pg_am am ON am.oid = i.relam
    LEFT JOIN pg_stat_all_indexes si ON si.indexrelid = i.oid
    WHERE ${clauses.join(" AND ")}
    ORDER BY t.oid, i.oid
    LIMIT 5001
  `,
    values,
  );
  const limit = 5_000;
  const indexes = result.rows.slice(0, limit).map((row) => ({
    indexOid: toNumber(row["index_oid"]),
    tableOid: toNumber(row["table_oid"]),
    schema: String(row["schema_name"]),
    table: String(row["table_name"]),
    name: String(row["index_name"]),
    accessMethod: String(row["access_method"]),
    unique: row["is_unique"] === true,
    primary: row["is_primary"] === true,
    valid: row["is_valid"] === true,
    ready: row["is_ready"] === true,
    scans: toNumber(row["scans"]),
    sizeBytes: toNumber(row["size_bytes"]),
    keyColumns: Array.isArray(row["key_columns"])
      ? row["key_columns"].map(String)
      : [],
    includedColumns: Array.isArray(row["included_columns"])
      ? row["included_columns"].map(String)
      : [],
    predicate: row["predicate"] === null ? null : String(row["predicate"]),
    constraintBacked: row["constraint_backed"] === true,
  }));
  return { indexes, truncated: result.rows.length > limit, limit };
}

export function findIndexRelationships(
  indexes: readonly IndexRelationshipInput[],
): IndexRelationship[] {
  const byId = new Map(indexes.map((index) => [String(index.indexOid), index]));
  return analyzeIndexOverlaps(
    indexes.map((index) => ({
      id: String(index.indexOid),
      schema: index.schema,
      table: index.table,
      name: index.name,
      method: index.accessMethod,
      keyColumns: index.keyColumns,
      includeColumns: index.includedColumns,
      predicate: index.predicate,
      unique: index.unique,
      primary: index.primary,
      constraintBacked: index.constraintBacked,
      valid: index.valid,
      ready: index.ready,
      sizeBytes: index.sizeBytes,
      scans: index.scans,
    })),
  ).flatMap((overlap) => {
    const redundant = byId.get(overlap.redundantId);
    const covering = byId.get(overlap.coveringId);
    if (!redundant || !covering) return [];
    return [
      {
        kind: overlap.kind,
        tableOid: redundant.tableOid,
        // left is deliberately the removable side for existing consumers.
        leftIndexOid: redundant.indexOid,
        rightIndexOid: covering.indexOid,
        leftName: redundant.name,
        rightName: covering.name,
        redundantIndexOid: redundant.indexOid,
        coveringIndexOid: covering.indexOid,
        evidence: overlap.reason,
      },
    ];
  });
}
