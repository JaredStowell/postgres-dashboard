import { detectCapabilities } from "@/lib/db/capabilities";
import { listDatabases, listSchemas } from "@/lib/db/catalog";
import { jsonResponse, route } from "@/lib/http/api";
import {
  listLatestFleetSnapshots,
  listRegisteredDatabases,
} from "@/lib/db/history";
import { getControlDatabase, getTargetContext } from "@/lib/server/context";

export const GET = route(async (request: Request) => {
  const url = new URL(request.url);
  const { db, target } = await getTargetContext(url.searchParams.get("source"));
  const [capabilities, databases, schemas] = await Promise.all([
    detectCapabilities(db),
    listDatabases(db),
    listSchemas(db),
  ]);
  let sourceDatabaseId: number | null = null;
  let collectedAt: string | null = null;
  try {
    const control = await getControlDatabase();
    const [registered, snapshots] = await Promise.all([
      listRegisteredDatabases(control),
      listLatestFleetSnapshots(control),
    ]);
    sourceDatabaseId =
      registered.find(
        (candidate) =>
          candidate.sourceKey === target.key &&
          candidate.databaseName === capabilities.databaseName,
      )?.sourceDatabaseId ?? null;
    collectedAt =
      snapshots
        .find(
          (candidate) =>
            candidate.sourceKey === target.key &&
            candidate.databaseName === capabilities.databaseName,
        )
        ?.capturedAt.toISOString() ?? null;
  } catch {
    // Health remains available before control-plane initialization.
  }

  return jsonResponse({
    source: { key: target.key, label: target.label },
    database: capabilities.databaseName,
    sourceDatabaseId,
    collectedAt,
    capabilities,
    databases,
    schemas,
  });
});
