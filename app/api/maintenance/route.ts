import {
  listMaintenanceProgress,
  listTableMaintenance,
} from "@/lib/db/maintenance";
import { boundedInteger, jsonResponse, route } from "@/lib/http/api";
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
  const { db, target } = await getTargetContext(url.searchParams.get("source"));
  const [tables, progress] = await Promise.all([
    listTableMaintenance(db, { limit, offset, schema }),
    listMaintenanceProgress(db),
  ]);

  return jsonResponse({
    source: { key: target.key, label: target.label },
    pagination: { limit, offset, returned: tables.length },
    tables,
    progress,
  });
});
