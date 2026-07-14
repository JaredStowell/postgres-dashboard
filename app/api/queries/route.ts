import { listQueryStats, type WorkloadSort } from "@/lib/db/workload";
import { ApiError, boundedInteger, jsonResponse, route } from "@/lib/http/api";
import { getTargetContext } from "@/lib/server/context";

const SORTS = new Set<WorkloadSort>([
  "total_exec_time",
  "mean_exec_time",
  "calls",
  "rows",
  "shared_blks_read",
  "temp_blks_written",
  "wal_bytes",
]);

export const GET = route(async (request: Request) => {
  const url = new URL(request.url);
  const sortInput = url.searchParams.get("sort") ?? "total_exec_time";
  if (!SORTS.has(sortInput as WorkloadSort)) {
    throw new ApiError(
      400,
      "invalid_sort",
      `Unsupported query sort: ${sortInput}`,
    );
  }
  const directionInput = url.searchParams.get("direction") ?? "desc";
  if (directionInput !== "asc" && directionInput !== "desc") {
    throw new ApiError(
      400,
      "invalid_direction",
      "direction must be asc or desc",
    );
  }

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
  const search =
    url.searchParams.get("search")?.trim().slice(0, 500) || undefined;
  const { db, target } = await getTargetContext(url.searchParams.get("source"));
  const queries = await listQueryStats(db, {
    limit,
    offset,
    search,
    sort: sortInput as WorkloadSort,
    direction: directionInput,
  });

  return jsonResponse({
    source: { key: target.key, label: target.label },
    pagination: { limit, offset, returned: queries.length },
    queries,
  });
});
