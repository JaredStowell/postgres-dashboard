import {
  listMaintenanceProgress,
  listTableMaintenance,
} from "@/lib/db/maintenance";
import { detectCapabilities } from "@/lib/db/capabilities";
import { boundedInteger, jsonResponse, route } from "@/lib/http/api";
import { presentMaintenance } from "@/lib/presentation/inventory";
import { getTargetContext } from "@/lib/server/context";

export const GET = route(async (request: Request) => {
  const url = new URL(request.url);
  const limit = boundedInteger(url.searchParams.get("limit"), 100, {
    min: 1,
    max: 250,
    name: "limit",
  });
  const offset = boundedInteger(url.searchParams.get("offset"), 0, {
    min: 0,
    max: 100_000,
    name: "offset",
  });
  const schema =
    url.searchParams.get("schema")?.trim().slice(0, 63) || undefined;
  const search =
    url.searchParams.get("search")?.trim().slice(0, 500) || undefined;
  const { db, target } = await getTargetContext(url.searchParams.get("source"));
  const capabilities = await detectCapabilities(db);
  const [page, progress, freeze] = await Promise.all([
    listTableMaintenance(db, {
      limit: Math.min(limit + 1, 250),
      offset,
      schema,
      search,
    }),
    listMaintenanceProgress(db, capabilities.supportedColumns),
    db.query<{ setting: string }>(
      "SELECT setting FROM pg_settings WHERE name = 'autovacuum_freeze_max_age'",
    ),
  ]);
  let hasMore = page.length > limit;
  const tables = page.slice(0, limit);
  if (limit === 250 && tables.length === limit) {
    hasMore =
      (
        await listTableMaintenance(db, {
          limit: 1,
          offset: offset + limit,
          schema,
          search,
        })
      ).length > 0;
  }
  const freezeMaxAge = Number(freeze.rows[0]?.setting ?? 200_000_000);

  return jsonResponse({
    source: { key: target.key, label: target.label },
    pagination: { limit, offset, returned: tables.length, hasMore },
    tables,
    tableViews: tables.map((table) => presentMaintenance(table, freezeMaxAge)),
    progress,
    progressCapabilities: {
      vacuum: Boolean(capabilities.supportedColumns.pg_stat_progress_vacuum),
      createIndex: Boolean(
        capabilities.supportedColumns.pg_stat_progress_create_index,
      ),
    },
  });
});
