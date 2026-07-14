import { diffPlans } from "@/lib/analysis/plans";
import { savePlanComparison } from "@/lib/db/plans";
import {
  ApiError,
  assertJsonByteSize,
  jsonResponse,
  parseJson,
  route,
} from "@/lib/http/api";
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
  const metadata = await control.query<{
    id: string;
    source_database_id: string;
    plan_bytes: number;
  }>(
    `SELECT id::text, source_database_id::text,
       pg_column_size(plan_json)::int AS plan_bytes
     FROM index_analyzer.explain_runs WHERE id = ANY($1::uuid[])`,
    [[input.baselineRunId, input.candidateRunId]],
  );
  const baselineMetadata = metadata.rows.find(
    (row) => row.id === input.baselineRunId,
  );
  const candidateMetadata = metadata.rows.find(
    (row) => row.id === input.candidateRunId,
  );
  if (!baselineMetadata || !candidateMetadata) {
    throw new ApiError(
      404,
      "plan_not_found",
      "One or both plan runs do not exist.",
    );
  }
  if (
    baselineMetadata.source_database_id !== candidateMetadata.source_database_id
  ) {
    throw new ApiError(
      400,
      "plan_source_mismatch",
      "Plans must belong to the same source database.",
    );
  }
  if (
    baselineMetadata.plan_bytes > 512 * 1_024 ||
    candidateMetadata.plan_bytes > 512 * 1_024
  ) {
    throw new ApiError(
      413,
      "plan_too_large",
      "Plan comparison is limited to two plans of at most 512 KiB each.",
    );
  }
  const result = await control.query<{ id: string; plan_json: unknown }>(
    `SELECT id::text, plan_json FROM index_analyzer.explain_runs
     WHERE id = ANY($1::uuid[])`,
    [[input.baselineRunId, input.candidateRunId]],
  );
  const baseline = result.rows.find((row) => row.id === input.baselineRunId)!;
  const candidate = result.rows.find((row) => row.id === input.candidateRunId)!;
  const diff = diffPlans(baseline.plan_json, candidate.plan_json);
  assertJsonByteSize(diff, {
    maxBytes: 1 * 1_024 * 1_024,
    code: "plan_diff_too_large",
    message: "The plan comparison diff exceeds the 1 MiB response limit.",
  });
  const comparisonId = await savePlanComparison(control, {
    baselineRunId: baseline.id,
    candidateRunId: candidate.id,
    summary: diff.summary,
    diff,
  });
  return jsonResponse({ comparisonId, diff });
});
