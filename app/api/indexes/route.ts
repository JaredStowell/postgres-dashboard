import { findIndexRelationships, listIndexes } from "@/lib/db/indexes";
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
  const relationOidInput = url.searchParams.get("relationOid");
  const relationOid = relationOidInput
    ? boundedInteger(relationOidInput, 0, {
        min: 1,
        max: 2_147_483_647,
        name: "relationOid",
      })
    : undefined;
  const schema =
    url.searchParams.get("schema")?.trim().slice(0, 63) || undefined;
  const search =
    url.searchParams.get("search")?.trim().slice(0, 500) || undefined;
  const { db, target } = await getTargetContext(url.searchParams.get("source"));
  const indexes = await listIndexes(db, {
    limit,
    offset,
    relationOid,
    schema,
    search,
  });

  return jsonResponse({
    source: { key: target.key, label: target.label },
    pagination: { limit, offset, returned: indexes.length },
    indexes,
    relationships: findIndexRelationships(indexes),
  });
});
