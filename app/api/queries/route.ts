import { listQueryStats, type WorkloadSort } from "@/lib/db/workload";
import { listFindings } from "@/lib/db/findings";
import { listRegisteredDatabases } from "@/lib/db/history";
import { ApiError, boundedInteger, jsonResponse, route } from "@/lib/http/api";
import {
  applyQueryFindingSignals,
  presentQuery,
} from "@/lib/presentation/inventory";
import { getControlDatabase, getTargetContext } from "@/lib/server/context";

const SORTS = new Set<WorkloadSort>([
  "total_exec_time",
  "mean_exec_time",
  "total_plan_time",
  "mean_plan_time",
  "calls",
  "rows",
  "shared_blks_read",
  "temp_blks_written",
  "wal_bytes",
]);
export const GET = route(async (request: Request) => {
  const url = new URL(request.url);
  const sortInput = url.searchParams.get("sort") ?? "total_exec_time";
  if (sortInput !== "delta" && !SORTS.has(sortInput as WorkloadSort)) {
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
  const page = await listQueryStats(db, {
    limit: Math.min(limit + 1, 250),
    offset,
    search,
    sort:
      sortInput === "delta" ? "total_exec_time" : (sortInput as WorkloadSort),
    direction: directionInput,
  });
  let hasMore = page.length > limit;
  const queries = page.slice(0, limit);
  if (limit === 250 && queries.length === limit) {
    hasMore =
      (
        await listQueryStats(db, {
          limit: 1,
          offset: offset + limit,
          search,
          sort:
            sortInput === "delta"
              ? "total_exec_time"
              : (sortInput as WorkloadSort),
          direction: directionInput,
        })
      ).length > 0;
  }
  const queryViews = queries.map(presentQuery);
  try {
    const control = await getControlDatabase();
    const registered = await listRegisteredDatabases(control);
    const sourceDatabaseId = registered.find(
      (database) =>
        database.sourceKey === target.key &&
        database.databaseName === queries[0]?.databaseName,
    )?.sourceDatabaseId;
    if (sourceDatabaseId) {
      const findings = await listFindings(control, {
        sourceDatabaseId,
        status: "open",
        limit: 250,
      });
      applyQueryFindingSignals(queryViews, findings);
    }
  } catch {
    // Live workload browsing remains available before collector initialization.
  }
  if (sortInput === "delta") {
    queryViews.sort((left, right) =>
      directionInput === "asc"
        ? left.delta - right.delta
        : right.delta - left.delta,
    );
  }

  return jsonResponse({
    source: { key: target.key, label: target.label },
    pagination: { limit, offset, returned: queries.length, hasMore },
    queries,
    queryViews,
  });
});
