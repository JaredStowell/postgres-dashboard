import { listActivity } from "@/lib/db/activity";
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
  const includeIdle = url.searchParams.get("includeIdle") !== "false";
  const { db, target } = await getTargetContext(url.searchParams.get("source"));
  const sessions = await listActivity(db, { limit, offset, includeIdle });

  const blockingEdges = sessions.flatMap((session) =>
    session.blockingProcessIds.map((blocker) => ({
      blocker,
      blocked: session.processId,
    })),
  );

  return jsonResponse({
    source: { key: target.key, label: target.label },
    capturedAt: new Date().toISOString(),
    pagination: { limit, offset, returned: sessions.length },
    sessions,
    blockingEdges,
  });
});
