import {
  createExplainConfirmationToken,
  validateExplainSql,
} from "@/lib/analysis";
import { optionalString } from "@/lib/config/env";
import { ApiError, jsonResponse, parseJson, route } from "@/lib/http/api";
import { getRuntimeEnv } from "@/lib/runtime/env";
import { z } from "zod";

const requestSchema = z
  .object({
    sql: z.string().min(1).max(50_000),
    acknowledgement: z.literal("RUN EXPLAIN ANALYZE"),
  })
  .strict();

export const POST = route(async (request: Request) => {
  const input = await parseJson(request, requestSchema);
  const classification = validateExplainSql(input.sql, true);
  if (!classification.readOnly) {
    throw new ApiError(
      400,
      "unsafe_explain_analyze",
      classification.reason ?? "The statement is not safe for EXPLAIN ANALYZE.",
    );
  }

  const env = await getRuntimeEnv();
  const secret = optionalString(env, "EXPLAIN_CONFIRMATION_SECRET");
  if (!secret) {
    throw new ApiError(
      503,
      "confirmation_unavailable",
      "EXPLAIN ANALYZE confirmation is not configured.",
    );
  }
  const token = await createExplainConfirmationToken(input.sql, secret);
  return jsonResponse({
    token,
    expiresInMs: 60_000,
    query: classification.normalizedSql,
  });
});
