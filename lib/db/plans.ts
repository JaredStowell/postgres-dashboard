import type { Queryable } from "./client";
import { boundedPage, type PageInput, toNumber } from "./sql";
import { sanitizeExplainPlan } from "../analysis/plans";
import { redactSql } from "../analysis/sql-safety";

export interface SaveExplainRunInput {
  id?: string;
  sourceDatabaseId: number;
  createdBy?: string;
  queryDigest: string;
  normalizedQuery: string;
  parameterTypes?: string[];
  analyze: boolean;
  statementTimeoutMs: number;
  plan: unknown;
  sanitizedExport?: unknown;
  metadata?: Record<string, unknown>;
}

function planTimings(plan: unknown): {
  planning: number | null;
  execution: number | null;
} {
  const document = Array.isArray(plan) ? plan[0] : plan;
  if (!document || typeof document !== "object")
    return { planning: null, execution: null };
  const record = document as Record<string, unknown>;
  return {
    planning:
      typeof record["Planning Time"] === "number"
        ? record["Planning Time"]
        : null,
    execution:
      typeof record["Execution Time"] === "number"
        ? record["Execution Time"]
        : null,
  };
}

export async function saveExplainRun(
  db: Queryable,
  input: SaveExplainRunInput,
): Promise<string> {
  const id = input.id ?? crypto.randomUUID();
  const sanitizedPlan = sanitizeExplainPlan(input.plan);
  const timings = planTimings(sanitizedPlan);
  await db.query(
    `
    INSERT INTO index_analyzer.explain_runs
      (id, source_database_id, created_by, query_digest, normalized_query, parameter_types,
       analyze_enabled, statement_timeout_ms, plan_json, planning_time_ms, execution_time_ms,
       sanitized_export, metadata)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10,$11,$12::jsonb,$13::jsonb)
  `,
    [
      id,
      input.sourceDatabaseId,
      input.createdBy ?? null,
      input.queryDigest,
      redactSql(input.normalizedQuery).slice(0, 50_000),
      input.parameterTypes ?? [],
      input.analyze,
      input.statementTimeoutMs,
      JSON.stringify(sanitizedPlan),
      timings.planning,
      timings.execution,
      input.sanitizedExport === undefined
        ? JSON.stringify(sanitizedPlan)
        : JSON.stringify(input.sanitizedExport),
      JSON.stringify(input.metadata ?? {}),
    ],
  );
  return id;
}

export async function listExplainRuns(
  db: Queryable,
  sourceDatabaseId: number,
  input: PageInput & { queryDigest?: string } = {},
): Promise<Record<string, unknown>[]> {
  const page = boundedPage(input);
  const result = await db.query<Record<string, unknown>>(
    `
    SELECT id, created_at, created_by, query_digest,
      left(normalized_query, 2000) AS normalized_query, parameter_types,
      analyze_enabled, statement_timeout_ms, planning_time_ms, execution_time_ms,
      metadata, pg_column_size(plan_json) AS plan_bytes
    FROM index_analyzer.explain_runs
    WHERE source_database_id = $1 AND ($2::text IS NULL OR query_digest = $2)
    ORDER BY created_at DESC LIMIT $3 OFFSET $4
  `,
    [sourceDatabaseId, input.queryDigest ?? null, page.limit, page.offset],
  );
  return result.rows;
}

export async function savePlanComparison(
  db: Queryable,
  input: {
    baselineRunId: string;
    candidateRunId: string;
    summary: unknown;
    diff: unknown;
  },
): Promise<number> {
  const result = await db.query<{ id: string }>(
    `
    INSERT INTO index_analyzer.plan_comparisons
      (baseline_explain_run_id, candidate_explain_run_id, summary, diff)
    VALUES ($1, $2, $3::jsonb, $4::jsonb)
    ON CONFLICT (baseline_explain_run_id, candidate_explain_run_id)
    DO UPDATE SET summary = EXCLUDED.summary, diff = EXCLUDED.diff
    RETURNING id
  `,
    [
      input.baselineRunId,
      input.candidateRunId,
      JSON.stringify(input.summary),
      JSON.stringify(input.diff),
    ],
  );
  const row = result.rows[0];
  if (!row) throw new Error("Failed to save plan comparison");
  return toNumber(row.id);
}
