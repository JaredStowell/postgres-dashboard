import { ApiError, boundedInteger, jsonResponse, route } from "@/lib/http/api";
import { assembleAdvisorEvidence } from "@/lib/server/advisor-evidence";

const queryIdPattern = /^-?\d{1,20}$/;
const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export const GET = route(async (request: Request) => {
  const url = new URL(request.url);
  const source =
    url.searchParams.get("source")?.trim().slice(0, 63) || undefined;
  const queryId =
    url.searchParams.get("queryId") ??
    url.searchParams.get("query") ??
    undefined;
  const findingInput =
    url.searchParams.get("findingId") ?? url.searchParams.get("finding");
  const planId =
    url.searchParams.get("planId") ?? url.searchParams.get("plan") ?? undefined;
  const relationSchema = url.searchParams.get("relationSchema") ?? undefined;
  const relationTable = url.searchParams.get("relationTable") ?? undefined;
  const index = url.searchParams.get("index") ?? undefined;
  if (
    !queryId &&
    !findingInput &&
    !planId &&
    !relationSchema &&
    !relationTable
  ) {
    throw new ApiError(
      400,
      "advisor_context_required",
      "Select a query, finding, saved plan, or catalog relation before opening AI Advisor.",
    );
  }
  if (queryId && !queryIdPattern.test(queryId)) {
    throw new ApiError(
      400,
      "invalid_query_id",
      "queryId must be a signed PostgreSQL query identifier.",
    );
  }
  if (planId && !uuidPattern.test(planId)) {
    throw new ApiError(400, "invalid_plan_id", "planId must be a UUID.");
  }
  if (Boolean(relationSchema) !== Boolean(relationTable)) {
    throw new ApiError(
      400,
      "invalid_relation_context",
      "relationSchema and relationTable must be provided together.",
    );
  }
  for (const [name, value] of [
    ["relationSchema", relationSchema],
    ["relationTable", relationTable],
    ["index", index],
  ] as const) {
    if (value && (value.length > 255 || value.includes("\0")))
      throw new ApiError(400, `invalid_${name}`, `${name} is invalid.`);
  }
  const findingId = findingInput
    ? boundedInteger(findingInput, 0, {
        min: 1,
        max: Number.MAX_SAFE_INTEGER,
        name: "findingId",
      })
    : undefined;
  return jsonResponse(
    await assembleAdvisorEvidence({
      source,
      queryId,
      findingId,
      planId,
      relation:
        relationSchema && relationTable
          ? { schema: relationSchema, table: relationTable }
          : undefined,
      index,
    }),
  );
});
