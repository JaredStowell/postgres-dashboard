import { detectCapabilities } from "@/lib/db/capabilities";
import { exactBloatCheck } from "@/lib/db/maintenance";
import { ApiError, jsonResponse, parseJson, route } from "@/lib/http/api";
import { getTargetContext } from "@/lib/server/context";
import { z } from "zod";

const requestSchema = z
  .object({
    source: z.string().min(1).max(63).optional(),
    relationOid: z.number().int().positive().max(2_147_483_647),
    statementTimeoutMs: z.number().int().min(250).max(15_000).default(5_000),
    acknowledgement: z.literal("RUN EXPENSIVE BLOAT CHECK"),
  })
  .strict();

export const POST = route(async (request: Request) => {
  const input = await parseJson(request, requestSchema, {
    maxBytes: 8 * 1_024,
  });
  const { db, target } = await getTargetContext(input.source);
  const capabilities = await detectCapabilities(db);
  if (!capabilities.extensions.pgstattuple) {
    throw new ApiError(
      409,
      "pgstattuple_unavailable",
      "Exact bloat checks require the pgstattuple extension.",
    );
  }
  const result = await exactBloatCheck(
    db,
    input.relationOid,
    input.statementTimeoutMs,
  );
  return jsonResponse({
    source: { key: target.key, label: target.label },
    relationOid: input.relationOid,
    result,
  });
});
