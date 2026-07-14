import {
  calculatePlanMetrics,
  detectPlanWarnings,
  exportPlanJson,
  exportPlanMarkdown,
  redactSql,
  sanitizeExplainPlan,
  validateExplainSql,
  verifyExplainConfirmationToken,
} from "@/lib/analysis";
import { optionalString } from "@/lib/config/env";
import { EXPLAIN_ANALYZE_CONFIRMATION, runExplain } from "@/lib/db/explain";
import { listRegisteredDatabases, saveExplainRun } from "@/lib/db";
import {
  ApiError,
  assertJsonByteSize,
  jsonResponse,
  parseJson,
  route,
} from "@/lib/http/api";
import { getRuntimeEnv } from "@/lib/runtime/env";
import { getControlDatabase, getTargetContext } from "@/lib/server/context";
import { z } from "zod";

const parameterSchema = z.union([
  z.string().max(20_000),
  z.number().finite(),
  z.boolean(),
  z.null(),
]);

const requestSchema = z
  .object({
    source: z.string().min(1).max(63).optional(),
    schema: z.string().min(1).max(255).optional(),
    sql: z.string().min(1).max(50_000),
    parameters: z.array(parameterSchema).max(100).default([]),
    analyze: z.boolean().default(false),
    confirmationToken: z.string().max(4_096).optional(),
    statementTimeoutMs: z.number().int().min(100).max(30_000).default(5_000),
    lockTimeoutMs: z.number().int().min(50).max(5_000).default(1_000),
    persist: z.boolean().default(true),
  })
  .strict();

export const POST = route(async (request: Request) => {
  const input = await parseJson(request, requestSchema);
  const classification = validateExplainSql(input.sql, input.analyze);
  if (!classification.readOnly) {
    throw new ApiError(
      400,
      input.analyze ? "unsafe_explain_analyze" : "unsafe_explain",
      classification.reason ?? "The statement cannot be explained.",
    );
  }

  const env = await getRuntimeEnv();
  if (input.analyze) {
    const secret = optionalString(env, "EXPLAIN_CONFIRMATION_SECRET");
    if (
      !secret ||
      !input.confirmationToken ||
      !(await verifyExplainConfirmationToken(
        input.confirmationToken,
        input.sql,
        secret,
        {},
        {
          source: input.source,
          schema: input.schema,
          parameters: input.parameters,
        },
      ))
    ) {
      throw new ApiError(
        403,
        "invalid_explain_confirmation",
        "EXPLAIN ANALYZE requires a valid, unexpired confirmation token.",
      );
    }
  }

  const { db, target } = await getTargetContext(input.source);
  const result = await runExplain(db, {
    sql: input.sql,
    schema: input.schema,
    parameters: input.parameters,
    analyze: input.analyze,
    confirmation: input.analyze ? EXPLAIN_ANALYZE_CONFIRMATION : undefined,
    statementTimeoutMs: input.statementTimeoutMs,
    lockTimeoutMs: input.lockTimeoutMs,
  });
  assertJsonByteSize(result.plan, {
    maxBytes: 512 * 1_024,
    code: "plan_too_large",
    message:
      "The PostgreSQL plan exceeds the 512 KiB analysis and export limit.",
  });
  const sanitizedPlan = sanitizeExplainPlan(result.plan);
  const metrics = calculatePlanMetrics(sanitizedPlan);
  const warnings = detectPlanWarnings(sanitizedPlan);
  let runId: string | null = null;
  let persistence: "saved" | "unregistered" | "disabled" = "disabled";
  if (input.persist) {
    const [control, databaseResult] = await Promise.all([
      getControlDatabase(),
      db.query<{ name: string }>("SELECT current_database() AS name"),
    ]);
    const registered = await listRegisteredDatabases(control);
    const databaseName = databaseResult.rows[0]?.name;
    const sourceDatabase = registered.find(
      (candidate) =>
        candidate.sourceKey === target.key &&
        candidate.databaseName === databaseName,
    );
    if (sourceDatabase) {
      const redacted = redactSql(classification.normalizedSql);
      const digestBytes = await crypto.subtle.digest(
        "SHA-256",
        new TextEncoder().encode(redacted),
      );
      const queryDigest = [...new Uint8Array(digestBytes)]
        .map((byte) => byte.toString(16).padStart(2, "0"))
        .join("");
      runId = await saveExplainRun(control, {
        sourceDatabaseId: sourceDatabase.sourceDatabaseId,
        queryDigest,
        normalizedQuery: redacted,
        analyze: result.analyze,
        statementTimeoutMs: result.statementTimeoutMs,
        plan: sanitizedPlan,
        sanitizedExport: JSON.parse(
          exportPlanJson({ plan: sanitizedPlan, query: input.sql }),
        ),
        metadata: { sourceKey: target.key, warnings, metrics },
      });
      persistence = "saved";
    } else {
      persistence = "unregistered";
    }
  }

  return jsonResponse({
    source: { key: target.key, label: target.label },
    classification,
    analyze: result.analyze,
    statementTimeoutMs: result.statementTimeoutMs,
    plan: sanitizedPlan,
    metrics,
    warnings,
    runId,
    persistence,
    exports: {
      json: exportPlanJson({ plan: sanitizedPlan, query: input.sql }),
      markdown: exportPlanMarkdown({ plan: sanitizedPlan, query: input.sql }),
    },
  });
});
