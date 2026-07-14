import { classifySql, quoteIdentifier } from "../analysis/sql-safety";
import type { DatabasePool } from "./client";
import { withReadOnlyTransaction } from "./client";
import { validateReadOnlyStatement } from "./explain";

const MAX_INDEX_SQL_LENGTH = 20_000;

export interface HypotheticalIndexExperiment {
  hypotheticalIndex: { oid: string; name: string };
  baselinePlan: unknown;
  hypotheticalPlan: unknown;
}

export function hypotheticalExplainOptions(serverVersion: number): string {
  return [
    "ANALYZE false",
    "VERBOSE true",
    ...(serverVersion >= 120_000 ? ["SETTINGS true"] : []),
    "FORMAT JSON",
  ].join(", ");
}

export function validateHypotheticalIndexSql(indexSql: string): string {
  const normalized = indexSql.trim().replace(/;\s*$/, "");
  if (!normalized) throw new Error("Hypothetical index SQL is required");
  if (normalized.length > MAX_INDEX_SQL_LENGTH)
    throw new Error(
      `Hypothetical index SQL exceeds ${MAX_INDEX_SQL_LENGTH} characters`,
    );

  const classification = classifySql(indexSql);
  if (!classification.singleStatement)
    throw new Error("Only one hypothetical index statement is allowed");
  if (classification.statementClass !== "ddl")
    throw new Error("Only CREATE INDEX statements can be simulated");
  if (!/^CREATE\s+(?:UNIQUE\s+)?INDEX\s+/i.test(normalized))
    throw new Error("Only CREATE INDEX statements can be simulated");
  if (/\bCONCURRENTLY\b/i.test(normalized))
    throw new Error(
      "Remove CONCURRENTLY for simulation; HypoPG never creates a real index",
    );
  return normalized;
}

export async function runHypotheticalIndexExperiment(
  pool: DatabasePool,
  input: {
    sql: string;
    indexSql: string;
    schema?: string;
    parameters?: readonly unknown[];
    statementTimeoutMs?: number;
  },
): Promise<HypotheticalIndexExperiment> {
  const sql = validateReadOnlyStatement(input.sql);
  const indexSql = validateHypotheticalIndexSql(input.indexSql);
  const statementTimeoutMs = Math.min(
    Math.max(input.statementTimeoutMs ?? 5_000, 250),
    15_000,
  );
  const values = input.parameters ? [...input.parameters] : [];

  return withReadOnlyTransaction(
    pool,
    async (client) => {
      const metadata = await client.query<{
        schema_name: string;
        server_version: number;
      }>(`
        SELECT n.nspname AS schema_name,
          current_setting('server_version_num')::int AS server_version
        FROM pg_extension extension_row
        JOIN pg_namespace n ON n.oid = extension_row.extnamespace
        WHERE extension_row.extname = 'hypopg'
      `);
      const extension = metadata.rows[0];
      if (!extension) throw new Error("HypoPG extension is unavailable");
      const hypopg = quoteIdentifier(extension.schema_name);
      const explainOptions = hypotheticalExplainOptions(
        extension.server_version,
      );
      if (input.schema) {
        if (input.schema.includes("\0") || input.schema.length > 255)
          throw new Error("Invalid schema context");
        await client.query(
          "SELECT set_config('search_path', 'pg_catalog, ' || quote_ident($1), true)",
          [input.schema],
        );
      }
      await client.query(`SELECT ${hypopg}.hypopg_reset()`);
      const baseline = await client.query<{ "QUERY PLAN": unknown }>(
        `EXPLAIN (${explainOptions}) ${sql}`,
        values,
      );
      try {
        const created = await client.query<{
          indexrelid: string;
          indexname: string;
        }>(
          `SELECT indexrelid::text, indexname FROM ${hypopg}.hypopg_create_index($1)`,
          [indexSql],
        );
        const candidate = await client.query<{ "QUERY PLAN": unknown }>(
          `EXPLAIN (${explainOptions}) ${sql}`,
          values,
        );
        const hypotheticalIndex = created.rows[0];
        if (!hypotheticalIndex)
          throw new Error("HypoPG did not return a hypothetical index");
        return {
          hypotheticalIndex: {
            oid: hypotheticalIndex.indexrelid,
            name: hypotheticalIndex.indexname,
          },
          baselinePlan: baseline.rows[0]?.["QUERY PLAN"] ?? null,
          hypotheticalPlan: candidate.rows[0]?.["QUERY PLAN"] ?? null,
        };
      } finally {
        await client.query(`SELECT ${hypopg}.hypopg_reset()`);
      }
    },
    { statementTimeoutMs, lockTimeoutMs: 1_000 },
  );
}
