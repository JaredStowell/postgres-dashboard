import { listExplainRuns } from "@/lib/db/plans";
import { boundedInteger, jsonResponse, route } from "@/lib/http/api";
import { getControlDatabase } from "@/lib/server/context";
import { resolveSourceDatabaseId } from "@/lib/server/control";

export const GET = route(async (request: Request) => {
  const url = new URL(request.url);
  const requested = url.searchParams.get("sourceDatabaseId");
  const limit = boundedInteger(url.searchParams.get("limit"), 50, {
    min: 1,
    max: 250,
    name: "limit",
  });
  const offset = boundedInteger(url.searchParams.get("offset"), 0, {
    min: 0,
    max: 100_000,
    name: "offset",
  });
  const control = await getControlDatabase();
  const sourceDatabaseId = await resolveSourceDatabaseId(
    control,
    requested
      ? boundedInteger(requested, 0, {
          min: 1,
          max: Number.MAX_SAFE_INTEGER,
          name: "sourceDatabaseId",
        })
      : undefined,
  );
  const plans = await listExplainRuns(control, sourceDatabaseId, {
    limit,
    offset,
    queryDigest:
      url.searchParams.get("queryDigest")?.slice(0, 128) || undefined,
  });
  return jsonResponse({
    sourceDatabaseId,
    pagination: { limit, offset, returned: plans.length },
    plans,
  });
});
