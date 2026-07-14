import type { DatabasePool } from "./client";
import { withReadOnlyTransaction } from "./client";

export interface ExplainRequest {
  sql: string;
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
  if (analyze && request.confirmation !== ANALYZE_CONFIRMATION) {
    throw new Error(
      `EXPLAIN ANALYZE requires confirmation: ${ANALYZE_CONFIRMATION}`,
    );
  }
  const statementTimeoutMs = Math.min(
    Math.max(request.statementTimeoutMs ?? 5_000, 100),
    30_000,
  );
  const options = analyze
    ? "ANALYZE true, BUFFERS true, WAL true, VERBOSE true, SETTINGS true, FORMAT JSON"
    : "ANALYZE false, VERBOSE true, SETTINGS true, FORMAT JSON";
  return withReadOnlyTransaction(
    pool,
    async (client) => {
      const result = await client.query<{ "QUERY PLAN": unknown }>(
        `EXPLAIN (${options}) ${sql}`,
        request.parameters ? [...request.parameters] : [],
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
