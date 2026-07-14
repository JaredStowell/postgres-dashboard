import {
  findIndexRelationships,
  listIndexes,
  listIndexRelationshipCandidates,
} from "@/lib/db/indexes";
import { boundedInteger, jsonResponse, route } from "@/lib/http/api";
import { presentIndexes } from "@/lib/presentation/inventory";
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
  const page = await listIndexes(db, {
    limit: Math.min(limit + 1, 250),
    offset,
    relationOid,
    schema,
    search,
  });
  let hasMore = page.length > limit;
  const indexes = page.slice(0, limit);
  if (limit === 250 && indexes.length === limit) {
    hasMore =
      (
        await listIndexes(db, {
          limit: 1,
          offset: offset + limit,
          relationOid,
          schema,
          search,
        })
      ).length > 0;
  }
  const relationshipCandidates = await listIndexRelationshipCandidates(db, {
    relationOids: [...new Set(indexes.map((index) => index.tableOid))],
  });
  const visibleIndexOids = new Set(indexes.map((index) => index.indexOid));
  const relationships = findIndexRelationships(
    relationshipCandidates.indexes,
  ).filter((relationship) => visibleIndexOids.has(relationship.leftIndexOid));

  return jsonResponse({
    source: { key: target.key, label: target.label },
    pagination: { limit, offset, returned: indexes.length, hasMore },
    indexes,
    relationships,
    relationshipAnalysis: {
      candidateCount: relationshipCandidates.indexes.length,
      truncated: relationshipCandidates.truncated,
      limit: relationshipCandidates.limit,
    },
    indexViews: presentIndexes(indexes, relationships),
  });
});
