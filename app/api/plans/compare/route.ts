import { diffPlans } from "@/lib/analysis/plans";
import { savePlanComparison } from "@/lib/db/plans";
import { ApiError, jsonResponse, parseJson, route } from "@/lib/http/api";
import { getControlDatabase } from "@/lib/server/context";
import { z } from "zod";

const requestSchema = z
  .object({
    baselineRunId: z.uuid(),
    candidateRunId: z.uuid(),
  })
  .strict()
  .refine((input) => input.baselineRunId !== input.candidateRunId, {
    message: "Select two different plan runs.",
  });

export const POST = route(async (request: Request) => {
  const input = await parseJson(request, requestSchema);
  const control = await getControlDatabase();
  const result = await control.query<{
    id: string;
    source_database_id: string;
    plan_json: unknown;
  }>(
    `SELECT id::text, source_database_id::text, plan_json
     FROM index_analyzer.explain_runs WHERE id = ANY($1::uuid[])`,
    [[input.baselineRunId, input.candidateRunId]],
  );
  const baseline = result.rows.find((row) => row.id === input.baselineRunId);
  const candidate = result.rows.find((row) => row.id === input.candidateRunId);
  if (!baseline || !candidate) {
    throw new ApiError(
      404,
      "plan_not_found",
      "One or both plan runs do not exist.",
    );
  }
  if (baseline.source_database_id !== candidate.source_database_id) {
    throw new ApiError(
      400,
      "plan_source_mismatch",
      "Plans must belong to the same source database.",
    );
  }
  const diff = diffPlans(baseline.plan_json, candidate.plan_json);
  const comparisonId = await savePlanComparison(control, {
    baselineRunId: baseline.id,
    candidateRunId: candidate.id,
    summary: diff.summary,
    diff,
  });
  return jsonResponse({ comparisonId, diff });
});
