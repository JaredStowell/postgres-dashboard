import { detectCapabilities } from "@/lib/db/capabilities";
import { listDatabases, listSchemas } from "@/lib/db/catalog";
import { jsonResponse, route } from "@/lib/http/api";
import { listRegisteredDatabases } from "@/lib/db/history";
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
  try {
    const registered = await listRegisteredDatabases(
      await getControlDatabase(),
    );
    sourceDatabaseId =
      registered.find(
        (candidate) =>
          candidate.sourceKey === target.key &&
          candidate.databaseName === capabilities.databaseName,
      )?.sourceDatabaseId ?? null;
  } catch {
    // Health remains available before control-plane initialization.
  }

  return jsonResponse({
    source: { key: target.key, label: target.label },
    database: capabilities.databaseName,
    sourceDatabaseId,
    collectedAt: new Date().toISOString(),
    capabilities,
    databases,
    schemas,
  });
});
