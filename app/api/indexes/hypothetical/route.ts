import {
  calculatePlanMetrics,
  sanitizeExplainPlan,
  validateExplainSql,
} from "@/lib/analysis";
import { detectCapabilities, runHypotheticalIndexExperiment } from "@/lib/db";
import { validateHypotheticalIndexSql } from "@/lib/db/hypopg";
import {
  ApiError,
  assertJsonByteSize,
  jsonResponse,
  parseJson,
  route,
} from "@/lib/http/api";
import { getTargetContext } from "@/lib/server/context";
import { z } from "zod";

const parameterSchema = z.union([
  z.string().max(20_000),
  z.number().finite(),
  z.boolean(),
  z.null(),
]);

const requestSchema = z
  .object({
    source: z.string().min(1).max(63).optional(),
    schema: z.string().min(1).max(255).optional(),
    sql: z.string().min(1).max(50_000),
    indexSql: z.string().min(1).max(20_000),
    parameters: z.array(parameterSchema).max(100).default([]),
    statementTimeoutMs: z.number().int().min(250).max(15_000).default(5_000),
  })
  .strict();

export const POST = route(async (request: Request) => {
  const input = await parseJson(request, requestSchema, {
    maxBytes: 96 * 1_024,
  });
  const classification = validateExplainSql(input.sql, false);
  if (!classification.readOnly) {
    throw new ApiError(
      400,
      "unsafe_hypothetical_explain",
      classification.reason ?? "The statement cannot be explained.",
    );
  }
  try {
    validateHypotheticalIndexSql(input.indexSql);
  } catch (error) {
    throw new ApiError(
      400,
      "invalid_hypothetical_index",
      error instanceof Error ? error.message : "Invalid hypothetical index SQL",
    );
  }

  const { db, target } = await getTargetContext(input.source);
  const capabilities = await detectCapabilities(db);
  if (!capabilities.extensions.hypopg) {
    throw new ApiError(
      409,
      "hypopg_unavailable",
      "Hypothetical index experiments require the HypoPG extension.",
    );
  }

  const experiment = await runHypotheticalIndexExperiment(db, input);
  for (const [kind, plan] of [
    ["baseline", experiment.baselinePlan],
    ["hypothetical", experiment.hypotheticalPlan],
  ] as const) {
    assertJsonByteSize(plan, {
      maxBytes: 512 * 1_024,
      code: "plan_too_large",
      message: `The ${kind} HypoPG plan exceeds the 512 KiB analysis limit.`,
    });
  }
  const baselinePlan = sanitizeExplainPlan(experiment.baselinePlan);
  const hypotheticalPlan = sanitizeExplainPlan(experiment.hypotheticalPlan);
  const baselineMetrics = calculatePlanMetrics(baselinePlan);
  const hypotheticalMetrics = calculatePlanMetrics(hypotheticalPlan);
  const baselineCost = baselineMetrics.totalCost;
  const hypotheticalCost = hypotheticalMetrics.totalCost;
  const costChangePercent =
    baselineCost != null && baselineCost > 0 && hypotheticalCost != null
      ? ((hypotheticalCost - baselineCost) / baselineCost) * 100
      : null;

  return jsonResponse({
    source: { key: target.key, label: target.label },
    hypotheticalIndex: experiment.hypotheticalIndex,
    baseline: { plan: baselinePlan, metrics: baselineMetrics },
    hypothetical: { plan: hypotheticalPlan, metrics: hypotheticalMetrics },
    costChangePercent,
    advisory:
      "Planner cost is an estimate. Validate the result with production-shaped data before executing review-only DDL.",
  });
});
