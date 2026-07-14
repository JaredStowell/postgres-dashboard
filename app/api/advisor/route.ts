import { analyzeAiPayload, buildAiPayload, getAiModel } from "@/lib/ai";
import { optionalString } from "@/lib/config/env";
import {
  completeAiAnalysis,
  createAiAnalysisRequest,
  failAiAnalysis,
  listAiAnalyses,
} from "@/lib/db/advisor";
import {
  ApiError,
  boundedInteger,
  jsonResponse,
  parseJson,
  route,
} from "@/lib/http/api";
import { getRuntimeEnv } from "@/lib/runtime/env";
import { getControlDatabase } from "@/lib/server/context";
import { resolveSourceDatabaseId } from "@/lib/server/control";
import { z } from "zod";

const scalarSchema = z.union([
  z.string().max(10_000),
  z.number().finite(),
  z.boolean(),
  z.null(),
]);

const columnSchema = z
  .object({
    name: z.string().min(1).max(255),
    dataType: z.string().min(1).max(255),
    nullable: z.boolean().optional(),
    statistics: z.record(z.string().max(255), scalarSchema).optional(),
  })
  .strict();

const tableSchema = z
  .object({
    schema: z.string().min(1).max(255),
    name: z.string().min(1).max(255),
    estimatedRows: z.number().finite().nonnegative().optional(),
    totalBytes: z.number().finite().nonnegative().optional(),
    columns: z.array(columnSchema).max(250),
  })
  .strict();

const indexSchema = z
  .object({
    schema: z.string().min(1).max(255),
    table: z.string().min(1).max(255),
    name: z.string().min(1).max(255),
    definition: z.string().min(1).max(20_000),
    scans: z.number().finite().nonnegative().optional(),
    sizeBytes: z.number().finite().nonnegative().optional(),
  })
  .strict();

const requestSchema = z
  .object({
    query: z.string().min(1).max(50_000),
    plan: z.unknown().optional(),
    tables: z.array(tableSchema).max(100).default([]),
    indexes: z.array(indexSchema).max(250).default([]),
    settings: z.record(z.string().max(255), scalarSchema).default({}),
    statistics: z.record(z.string().max(255), scalarSchema).default({}),
    context: z
      .object({
        database: z.string().max(255).optional(),
        schema: z.string().max(255).optional(),
        sourceLabel: z.string().max(255).optional(),
      })
      .strict()
      .default({}),
    mode: z.enum(["balanced", "deep"]).default("balanced"),
    submit: z.boolean().default(false),
    persist: z.boolean().default(false),
    sourceDatabaseId: z.number().int().positive().optional(),
    explainRunId: z.uuid().optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.persist && !value.sourceDatabaseId) {
      context.addIssue({
        code: "custom",
        path: ["sourceDatabaseId"],
        message: "sourceDatabaseId is required when persist is enabled",
      });
    }
  });

async function sha256(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export const GET = route(async (request: Request) => {
  const url = new URL(request.url);
  const limit = boundedInteger(url.searchParams.get("limit"), 50, {
    min: 1,
    max: 250,
    name: "limit",
  });
  const offset = boundedInteger(url.searchParams.get("offset"), 0, {
    min: 0,
    max: 100_000,
    name: "offset",
  });
  const requested = url.searchParams.get("sourceDatabaseId");
  const control = await getControlDatabase();
  const sourceDatabaseId = await resolveSourceDatabaseId(
    control,
    requested
      ? boundedInteger(requested, 0, {
          min: 1,
          max: Number.MAX_SAFE_INTEGER,
          name: "sourceDatabaseId",
        })
      : undefined,
  );
  const analyses = await listAiAnalyses(control, sourceDatabaseId, {
    limit,
    offset,
  });
  return jsonResponse({
    sourceDatabaseId,
    pagination: { limit, offset, returned: analyses.length },
    analyses,
  });
});

export const POST = route(async (request: Request) => {
  const input = await parseJson(request, requestSchema, {
    maxBytes: 256 * 1_024,
  });
  const built = buildAiPayload(input, { maxBytes: 128 * 1_024 });
  const env = await getRuntimeEnv();
  const configured = Boolean(optionalString(env, "OPENAI_API_KEY"));
  const mock = optionalString(env, "AI_MOCK_MODE")?.toLowerCase() === "true";
  const model = getAiModel(env, input.mode);

  const preview = {
    payload: built.payload,
    preview: built.preview,
    bytes: built.bytes,
    limitBytes: 128 * 1_024,
    truncated: built.truncated,
    omissions: built.omissions,
    privacy: built.payload.privacy,
    mode: input.mode,
    model,
    canSubmit: mock || configured,
    mock,
  };

  if (!input.submit) return jsonResponse({ preview });
  if (!mock && !configured) {
    throw new ApiError(
      503,
      "ai_disabled",
      "AI Advisor is disabled because OPENAI_API_KEY is not configured.",
    );
  }

  let analysisId: string | null = null;
  let controlDb: Awaited<ReturnType<typeof getControlDatabase>> | null = null;
  if (input.persist) {
    controlDb = await getControlDatabase();
    analysisId = await createAiAnalysisRequest(controlDb, {
      sourceDatabaseId: input.sourceDatabaseId!,
      explainRunId: input.explainRunId,
      mode: input.mode,
      model,
      payloadDigest: await sha256(built.preview),
      payloadPreview: built.payload,
      requestSizeBytes: built.bytes,
    });
  }

  try {
    const result = await analyzeAiPayload(built.payload, {
      env,
      mode: input.mode,
    });
    if (analysisId && controlDb) {
      const validationSteps = result.analysis.recommendations.flatMap(
        (recommendation) => recommendation.validationSteps,
      );
      await completeAiAnalysis(
        controlDb,
        analysisId,
        {
          ...result.analysis,
          validationSteps,
          rawStructuredResponse: result.analysis,
        },
        {
          providerRequestId: result.requestId ?? undefined,
          inputTokens: result.inputTokens ?? undefined,
          outputTokens: result.outputTokens ?? undefined,
        },
      );
    }
    return jsonResponse({
      preview,
      analysisId,
      analysis: result.analysis,
      metadata: {
        model: result.model,
        providerRequestId: result.requestId,
        inputTokens: result.inputTokens,
        outputTokens: result.outputTokens,
        mock: result.mock,
      },
    });
  } catch (error) {
    if (analysisId && controlDb)
      await failAiAnalysis(controlDb, analysisId, error);
    throw error;
  }
});
