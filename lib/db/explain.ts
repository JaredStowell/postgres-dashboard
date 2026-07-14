import type { DatabasePool } from "./client";
import { withReadOnlyTransaction } from "./client";
import {
  conservativeAnalyzeRelation,
  validateExplainSql,
} from "../analysis/sql-safety";

export interface ExplainRequest {
  sql: string;
  schema?: string;
  parameters?: readonly unknown[];
  analyze?: boolean;
  confirmation?: string;
  statementTimeoutMs?: number;
  lockTimeoutMs?: number;
}

export interface ExplainResult {
  plan: unknown;
  analyze: boolean;
  statementTimeoutMs: number;
}

const MAX_SQL_LENGTH = 50_000;
const ANALYZE_CONFIRMATION = "RUN EXPLAIN ANALYZE";
const blockedAnalyzeNodeTypes = new Set([
  "Custom Scan",
  "Foreign Scan",
  "Function Scan",
  "Table Function Scan",
]);
const expressionKeys = new Set([
  "Filter",
  "Index Cond",
  "Recheck Cond",
  "Hash Cond",
  "Join Filter",
  "Merge Cond",
  "Output",
  "Sort Key",
  "Group Key",
]);

interface AnalyzeRelation {
  schema: string;
  relation: string;
}

function inspectAnalyzePlan(value: unknown): AnalyzeRelation[] {
  const relations = new Map<string, AnalyzeRelation>();
  const visit = (candidate: unknown, key = ""): void => {
    if (Array.isArray(candidate)) {
      for (const item of candidate) visit(item, key);
      return;
    }
    if (!candidate || typeof candidate !== "object") {
      if (typeof candidate === "string" && expressionKeys.has(key)) {
        const calls = candidate.matchAll(
          /(?:^|[^A-Za-z0-9_$])([A-Za-z_][A-Za-z0-9_$.]*)\s*\(/g,
        );
        for (const call of calls) {
          if (!["ALL", "ANY", "ROW"].includes((call[1] ?? "").toUpperCase())) {
            throw new Error(
              "EXPLAIN ANALYZE rejected a plan expression that invokes a function.",
            );
          }
        }
      }
      return;
    }
    const record = candidate as Record<string, unknown>;
    const nodeType = String(record["Node Type"] ?? "");
    if (blockedAnalyzeNodeTypes.has(nodeType)) {
      throw new Error(
        `EXPLAIN ANALYZE does not permit ${nodeType} nodes in the conservative safety mode.`,
      );
    }
    const schema = record["Schema"];
    const relation = record["Relation Name"];
    if (typeof schema === "string" && typeof relation === "string") {
      relations.set(`${schema}\0${relation}`, { schema, relation });
    }
    for (const [childKey, child] of Object.entries(record)) {
      visit(child, childKey);
    }
  };
  visit(value);
  return [...relations.values()];
}

async function assertAnalyzeRootSafe(
  client: Awaited<ReturnType<DatabasePool["connect"]>>,
  relation: { schema?: string; relation: string },
): Promise<void> {
  const result = await client.query<{
    schema_name: string;
    relation_name: string;
    relkind: string;
    relrowsecurity: boolean;
    custom_type: boolean;
    access_method_oid: number;
    unsafe_index: boolean;
    unsafe_constraint: boolean;
  }>(
    `WITH RECURSIVE relation_tree(oid) AS (
       SELECT c.oid
       FROM pg_class c
       JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE ($1::text IS NOT NULL AND n.nspname = $1 AND c.relname = $2)
          OR ($1::text IS NULL AND c.oid = to_regclass(quote_ident($2)))
       UNION ALL
       SELECT child.oid
       FROM relation_tree parent
       JOIN pg_inherits inheritance ON inheritance.inhparent = parent.oid
       JOIN pg_class child ON child.oid = inheritance.inhrelid
     )
     SELECT n.nspname AS schema_name, c.relname AS relation_name, c.relkind,
       c.relrowsecurity,
       COALESCE(bool_or(type_n.nspname <> 'pg_catalog'), false) AS custom_type,
       COALESCE(c.relam, 0)::int AS access_method_oid,
       EXISTS (
         SELECT 1 FROM pg_index ix
         JOIN pg_class index_class ON index_class.oid = ix.indexrelid
         WHERE ix.indrelid = c.oid
           AND (index_class.relam >= 16384 OR ix.indexprs IS NOT NULL OR ix.indpred IS NOT NULL)
       ) AS unsafe_index,
       EXISTS (
         SELECT 1 FROM pg_constraint constraint_row
         JOIN pg_depend dependency ON dependency.classid = 'pg_constraint'::regclass
           AND dependency.objid = constraint_row.oid
           AND dependency.refclassid = 'pg_proc'::regclass
         JOIN pg_proc function_row ON function_row.oid = dependency.refobjid
         JOIN pg_namespace function_n ON function_n.oid = function_row.pronamespace
         WHERE constraint_row.conrelid = c.oid AND function_n.nspname <> 'pg_catalog'
       ) AS unsafe_constraint
     FROM relation_tree tree
     JOIN pg_class c ON c.oid = tree.oid
     JOIN pg_namespace n ON n.oid = c.relnamespace
     LEFT JOIN pg_attribute attribute ON attribute.attrelid = c.oid
       AND attribute.attnum > 0 AND NOT attribute.attisdropped
     LEFT JOIN pg_type attribute_type ON attribute_type.oid = attribute.atttypid
     LEFT JOIN pg_namespace type_n ON type_n.oid = attribute_type.typnamespace
     GROUP BY n.nspname, c.relname, c.relkind, c.relrowsecurity, c.relam, c.oid`,
    [relation.schema ?? null, relation.relation],
  );
  if (result.rows.length === 0) {
    throw new Error(
      "EXPLAIN ANALYZE relation was not found in the selected schema.",
    );
  }
  const unsafe = result.rows.find(
    (row) =>
      !["r", "m", "p"].includes(row.relkind) ||
      row.relrowsecurity ||
      row.custom_type ||
      row.access_method_oid >= 16_384 ||
      row.unsafe_index ||
      row.unsafe_constraint,
  );
  if (unsafe) {
    throw new Error(
      `EXPLAIN ANALYZE rejected ${unsafe.schema_name}.${unsafe.relation_name}; conservative mode requires base storage, built-in types/access methods, no RLS, and no expression/partial/custom indexes or function-backed constraints.`,
    );
  }
}

async function assertAnalyzeRelationsSafe(
  client: Awaited<ReturnType<DatabasePool["connect"]>>,
  plan: unknown,
): Promise<void> {
  const relations = inspectAnalyzePlan(plan);
  if (relations.length === 0) return;
  const result = await client.query<{
    schema_name: string;
    relation_name: string;
    relkind: string;
    relrowsecurity: boolean;
    custom_type: boolean;
    access_method_oid: number;
  }>(
    `SELECT n.nspname AS schema_name, c.relname AS relation_name, c.relkind,
       c.relrowsecurity,
       COALESCE(bool_or(type_n.nspname <> 'pg_catalog'), false) AS custom_type,
       COALESCE(c.relam, 0)::int AS access_method_oid
     FROM jsonb_to_recordset($1::jsonb) AS requested(schema_name text, relation_name text)
     JOIN pg_namespace n ON n.nspname = requested.schema_name
     JOIN pg_class c ON c.relnamespace = n.oid AND c.relname = requested.relation_name
     LEFT JOIN pg_attribute attribute ON attribute.attrelid = c.oid
       AND attribute.attnum > 0 AND NOT attribute.attisdropped
     LEFT JOIN pg_type attribute_type ON attribute_type.oid = attribute.atttypid
     LEFT JOIN pg_namespace type_n ON type_n.oid = attribute_type.typnamespace
     GROUP BY n.nspname, c.relname, c.relkind, c.relrowsecurity, c.relam`,
    [
      JSON.stringify(
        relations.map(({ schema, relation }) => ({
          schema_name: schema,
          relation_name: relation,
        })),
      ),
    ],
  );
  if (result.rows.length !== relations.length) {
    throw new Error(
      "EXPLAIN ANALYZE could not verify every referenced relation.",
    );
  }
  const unsafe = result.rows.find(
    (row) =>
      !["r", "m", "p"].includes(row.relkind) ||
      row.relrowsecurity ||
      row.custom_type ||
      row.access_method_oid >= 16_384,
  );
  if (unsafe) {
    throw new Error(
      `EXPLAIN ANALYZE rejected ${unsafe.schema_name}.${unsafe.relation_name}; conservative mode requires built-in types/access methods and no row-level security.`,
    );
  }
}

function maskSql(sql: string): string {
  let output = "";
  let position = 0;
  let state: "normal" | "single" | "double" | "line" | "block" | "dollar" =
    "normal";
  let dollarTag = "";
  let blockDepth = 0;
  while (position < sql.length) {
    const current = sql[position] ?? "";
    const next = sql[position + 1] ?? "";
    if (state === "normal") {
      if (current === "'") {
        state = "single";
        output += " ";
        position += 1;
        continue;
      }
      if (current === '"') {
        state = "double";
        output += " ";
        position += 1;
        continue;
      }
      if (current === "-" && next === "-") {
        state = "line";
        output += "  ";
        position += 2;
        continue;
      }
      if (current === "/" && next === "*") {
        state = "block";
        blockDepth = 1;
        output += "  ";
        position += 2;
        continue;
      }
      if (current === "$") {
        const match = sql
          .slice(position)
          .match(/^\$[A-Za-z_][A-Za-z0-9_]*\$|^\$\$/);
        if (match?.[0]) {
          state = "dollar";
          dollarTag = match[0];
          output += " ".repeat(dollarTag.length);
          position += dollarTag.length;
          continue;
        }
      }
      output += current;
      position += 1;
      continue;
    }
    if (state === "single") {
      if (current === "'" && next === "'") {
        output += "  ";
        position += 2;
        continue;
      }
      if (current === "'") state = "normal";
      output += " ";
      position += 1;
      continue;
    }
    if (state === "double") {
      if (current === '"' && next === '"') {
        output += "  ";
        position += 2;
        continue;
      }
      if (current === '"') state = "normal";
      output += " ";
      position += 1;
      continue;
    }
    if (state === "line") {
      if (current === "\n") {
        state = "normal";
        output += "\n";
      } else output += " ";
      position += 1;
      continue;
    }
    if (state === "block") {
      if (current === "/" && next === "*") {
        blockDepth += 1;
        output += "  ";
        position += 2;
        continue;
      }
      if (current === "*" && next === "/") {
        blockDepth -= 1;
        output += "  ";
        position += 2;
        if (blockDepth === 0) state = "normal";
        continue;
      }
      output += current === "\n" ? "\n" : " ";
      position += 1;
      continue;
    }
    if (state === "dollar") {
      if (sql.startsWith(dollarTag, position)) {
        output += " ".repeat(dollarTag.length);
        position += dollarTag.length;
        state = "normal";
        continue;
      }
      output += current === "\n" ? "\n" : " ";
      position += 1;
    }
  }
  if (state !== "normal" && state !== "line")
    throw new Error("Unterminated SQL literal or comment");
  return output;
}

export function validateReadOnlyStatement(sql: string): string {
  const trimmed = sql.trim();
  if (trimmed.length === 0) throw new Error("SQL is required");
  if (trimmed.length > MAX_SQL_LENGTH)
    throw new Error(`SQL exceeds ${MAX_SQL_LENGTH} characters`);
  const masked = maskSql(trimmed);
  const withoutTrailingSemicolon = masked.replace(/;\s*$/, "");
  if (withoutTrailingSemicolon.includes(";"))
    throw new Error("Multiple SQL statements are not allowed");
  const firstKeyword = withoutTrailingSemicolon
    .match(/^\s*([a-z]+)/i)?.[1]
    ?.toUpperCase();
  if (
    !firstKeyword ||
    !["SELECT", "WITH", "VALUES", "TABLE"].includes(firstKeyword)
  ) {
    throw new Error(
      "Only read-only SELECT, WITH, VALUES, or TABLE statements can be explained",
    );
  }
  if (
    /\bFOR\s+(UPDATE|NO\s+KEY\s+UPDATE|SHARE|KEY\s+SHARE)\b/i.test(
      withoutTrailingSemicolon,
    )
  ) {
    throw new Error("Row-locking clauses are not allowed");
  }
  if (
    /\b(INTO|COPY|CALL|DO|VACUUM|ANALYZE|INSERT|UPDATE|DELETE|MERGE|CREATE|ALTER|DROP|TRUNCATE|GRANT|REVOKE)\b/i.test(
      withoutTrailingSemicolon,
    )
  ) {
    throw new Error("The statement contains a prohibited operation");
  }
  return trimmed.replace(/;\s*$/, "");
}

export async function runExplain(
  pool: DatabasePool,
  request: ExplainRequest,
): Promise<ExplainResult> {
  const sql = validateReadOnlyStatement(request.sql);
  const analyze = request.analyze === true;
  const analyzeRelation = analyze ? conservativeAnalyzeRelation(sql) : null;
  if (analyze) {
    const classification = validateExplainSql(sql, true);
    if (!classification.readOnly) {
      throw new Error(
        classification.reason ?? "Statement is not safe for EXPLAIN ANALYZE",
      );
    }
  }
  if (analyze && request.confirmation !== ANALYZE_CONFIRMATION) {
    throw new Error(
      `EXPLAIN ANALYZE requires confirmation: ${ANALYZE_CONFIRMATION}`,
    );
  }
  const statementTimeoutMs = Math.min(
    Math.max(request.statementTimeoutMs ?? 5_000, 100),
    30_000,
  );
  return withReadOnlyTransaction(
    pool,
    async (client) => {
      if (request.schema) {
        if (request.schema.includes("\0") || request.schema.length > 255)
          throw new Error("Invalid schema context");
        await client.query(
          "SELECT set_config('search_path', 'pg_catalog, ' || quote_ident($1), true)",
          [request.schema],
        );
      }
      if (analyze && analyzeRelation) {
        await assertAnalyzeRootSafe(client, {
          schema: analyzeRelation.schema ?? request.schema,
          relation: analyzeRelation.relation,
        });
        await client.query(
          "SELECT set_config('constraint_exclusion', 'off', true)",
        );
      }
      const version = await client.query<{ version: number }>(
        "SELECT current_setting('server_version_num')::int AS version",
      );
      const serverVersion = version.rows[0]?.version ?? 0;
      const commonOptions = [
        "VERBOSE true",
        ...(serverVersion >= 120_000 ? ["SETTINGS true"] : []),
        "FORMAT JSON",
      ];
      const parameters = request.parameters ? [...request.parameters] : [];
      if (analyze) {
        const preflight = await client.query<{ "QUERY PLAN": unknown }>(
          `EXPLAIN (ANALYZE false, ${commonOptions.join(", ")}) ${sql}`,
          parameters,
        );
        await assertAnalyzeRelationsSafe(
          client,
          preflight.rows[0]?.["QUERY PLAN"] ?? null,
        );
      }
      const options = [
        `ANALYZE ${analyze ? "true" : "false"}`,
        ...(analyze ? ["BUFFERS true"] : []),
        ...(analyze && serverVersion >= 130_000 ? ["WAL true"] : []),
        ...commonOptions,
      ];
      const result = await client.query<{ "QUERY PLAN": unknown }>(
        `EXPLAIN (${options.join(", ")}) ${sql}`,
        parameters,
      );
      return {
        plan: result.rows[0]?.["QUERY PLAN"] ?? null,
        analyze,
        statementTimeoutMs,
      };
    },
    { statementTimeoutMs, lockTimeoutMs: request.lockTimeoutMs },
  );
}

export const EXPLAIN_ANALYZE_CONFIRMATION = ANALYZE_CONFIRMATION;
