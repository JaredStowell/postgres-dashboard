import type { Queryable } from "./client";
import { boundedPage, escapeLike, type PageInput, toNumber } from "./sql";

export interface SchemaInfo {
  oid: number;
  name: string;
  owner: string;
  tableCount: number;
  totalBytes: number;
}

export interface ColumnInfo {
  ordinal: number;
  name: string;
  dataType: string;
  nullable: boolean;
  defaultExpression: string | null;
  statisticsTarget: number;
}

export interface TableInfo {
  oid: number;
  schema: string;
  name: string;
  kind: string;
  owner: string;
  estimatedRows: number;
  relationBytes: number;
  totalBytes: number;
  columns?: ColumnInfo[];
}

export async function listDatabases(
  db: Queryable,
): Promise<Array<{ oid: number; name: string }>> {
  const result = await db.query<{ oid: number; name: string }>(`
    SELECT oid::int, datname AS name
    FROM pg_database
    WHERE datallowconn AND NOT datistemplate
    ORDER BY datname
    LIMIT 250
  `);
  return result.rows;
}

export async function listSchemas(db: Queryable): Promise<SchemaInfo[]> {
  const result = await db.query<{
    oid: number;
    name: string;
    owner: string;
    table_count: string;
    total_bytes: string;
  }>(`
    SELECT
      n.oid::int,
      n.nspname AS name,
      pg_get_userbyid(n.nspowner) AS owner,
      count(c.oid) FILTER (WHERE c.relkind IN ('r', 'p', 'm')) AS table_count,
      COALESCE(sum(pg_total_relation_size(c.oid)) FILTER (WHERE c.relkind IN ('r', 'p', 'm')), 0) AS total_bytes
    FROM pg_namespace n
    LEFT JOIN pg_class c ON c.relnamespace = n.oid
    WHERE n.nspname <> 'information_schema'
      AND n.nspname !~ '^pg_(toast|temp)'
    GROUP BY n.oid, n.nspname, n.nspowner
    ORDER BY n.nspname
    LIMIT 250
  `);
  return result.rows.map((row) => ({
    oid: row.oid,
    name: row.name,
    owner: row.owner,
    tableCount: toNumber(row.table_count),
    totalBytes: toNumber(row.total_bytes),
  }));
}

export async function listTables(
  db: Queryable,
  input: PageInput & { schema?: string; search?: string } = {},
): Promise<TableInfo[]> {
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
      `(n.nspname || '.' || c.relname) ILIKE $${values.length} ESCAPE '\\'`,
    );
  }
  values.push(page.limit, page.offset);
  const result = await db.query<{
    oid: number;
    schema: string;
    name: string;
    kind: string;
    owner: string;
    estimated_rows: string;
    relation_bytes: string;
    total_bytes: string;
  }>(
    `
    SELECT c.oid::int, n.nspname AS schema, c.relname AS name, c.relkind AS kind,
      pg_get_userbyid(c.relowner) AS owner, c.reltuples::bigint AS estimated_rows,
      pg_relation_size(c.oid) AS relation_bytes, pg_total_relation_size(c.oid) AS total_bytes
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE ${clauses.join(" AND ")}
    ORDER BY pg_total_relation_size(c.oid) DESC, n.nspname, c.relname
    LIMIT $${values.length - 1} OFFSET $${values.length}
  `,
    values,
  );
  return result.rows.map((row) => ({
    ...row,
    estimatedRows: toNumber(row.estimated_rows),
    relationBytes: toNumber(row.relation_bytes),
    totalBytes: toNumber(row.total_bytes),
  }));
}

export async function getTable(
  db: Queryable,
  relationOid: number,
): Promise<TableInfo | null> {
  if (!Number.isSafeInteger(relationOid) || relationOid <= 0)
    throw new Error("Invalid relation OID");
  const [table, columns] = await Promise.all([
    db.query<{
      oid: number;
      schema: string;
      name: string;
      kind: string;
      owner: string;
      estimated_rows: string;
      relation_bytes: string;
      total_bytes: string;
    }>(
      `
      SELECT c.oid::int, n.nspname AS schema, c.relname AS name, c.relkind AS kind,
        pg_get_userbyid(c.relowner) AS owner, c.reltuples::bigint AS estimated_rows,
        pg_relation_size(c.oid) AS relation_bytes, pg_total_relation_size(c.oid) AS total_bytes
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE c.oid = $1 AND c.relkind IN ('r', 'p', 'm')
    `,
      [relationOid],
    ),
    db.query<{
      ordinal: number;
      name: string;
      data_type: string;
      nullable: boolean;
      default_expression: string | null;
      statistics_target: number;
    }>(
      `
      SELECT a.attnum AS ordinal, a.attname AS name, format_type(a.atttypid, a.atttypmod) AS data_type,
        NOT a.attnotnull AS nullable, pg_get_expr(d.adbin, d.adrelid) AS default_expression,
        a.attstattarget AS statistics_target
      FROM pg_attribute a
      LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
      WHERE a.attrelid = $1 AND a.attnum > 0 AND NOT a.attisdropped
      ORDER BY a.attnum
      LIMIT 500
    `,
      [relationOid],
    ),
  ]);
  const row = table.rows[0];
  if (!row) return null;
  return {
    ...row,
    estimatedRows: toNumber(row.estimated_rows),
    relationBytes: toNumber(row.relation_bytes),
    totalBytes: toNumber(row.total_bytes),
    columns: columns.rows.map((column) => ({
      ordinal: column.ordinal,
      name: column.name,
      dataType: column.data_type,
      nullable: column.nullable,
      defaultExpression: column.default_expression,
      statisticsTarget: column.statistics_target,
    })),
  };
}
