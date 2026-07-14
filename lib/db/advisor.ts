import type { DatabasePool, Queryable } from "./client";
import { boundedPage, type PageInput } from "./sql";

export type AiMode = "balanced" | "deep";

export interface AiRequestInput {
  id?: string;
  sourceDatabaseId: number;
  explainRunId?: string;
  mode: AiMode;
  model: string;
  payloadDigest: string;
  payloadPreview: unknown;
  requestSizeBytes: number;
}

export async function createAiAnalysisRequest(
  db: Queryable,
  input: AiRequestInput,
): Promise<string> {
  if (input.requestSizeBytes < 0 || input.requestSizeBytes > 262_144) {
    throw new Error("AI request payload exceeds the 256 KiB persistence limit");
  }
  const id = input.id ?? crypto.randomUUID();
  await db.query(
    `
    INSERT INTO index_analyzer.ai_analysis_requests
      (id, source_database_id, explain_run_id, mode, model, payload_digest, payload_preview, request_size_bytes)
    VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8)
  `,
    [
      id,
      input.sourceDatabaseId,
      input.explainRunId ?? null,
      input.mode,
      input.model,
      input.payloadDigest,
      JSON.stringify(input.payloadPreview),
      input.requestSizeBytes,
    ],
  );
  return id;
}

export interface AiResultInput {
  summary: string;
  severity: "info" | "low" | "medium" | "high" | "critical";
  confidence: number;
  evidence: unknown[];
  caveats: unknown[];
  recommendations: Array<{
    title: string;
    rationale: string;
    risk: string;
    confidence: number;
    migrationSql?: string | null;
  }>;
  validationSteps?: unknown[];
  migrationSql?: string | null;
  rawStructuredResponse: unknown;
}

export async function completeAiAnalysis(
  db: DatabasePool,
  requestId: string,
  input: AiResultInput,
  metadata: {
    providerRequestId?: string;
    inputTokens?: number;
    outputTokens?: number;
  } = {},
): Promise<void> {
  const serializedResult = JSON.stringify(input.rawStructuredResponse);
  if (new TextEncoder().encode(serializedResult).byteLength > 256 * 1_024) {
    throw new Error("AI structured response exceeds the 256 KiB limit");
  }
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const request = await client.query(
      `UPDATE index_analyzer.ai_analysis_requests
       SET status = 'succeeded', completed_at = clock_timestamp(), provider_request_id = $2,
         input_tokens = $3, output_tokens = $4
       WHERE id = $1 RETURNING id`,
      [
        requestId,
        metadata.providerRequestId ?? null,
        metadata.inputTokens ?? null,
        metadata.outputTokens ?? null,
      ],
    );
    if (request.rowCount !== 1)
      throw new Error("AI analysis request not found");
    await client.query(
      `
      INSERT INTO index_analyzer.ai_analysis_results
        (request_id, summary, severity, confidence, evidence, caveats, recommendations,
         validation_steps, migration_sql, raw_structured_response)
      VALUES ($1,$2,$3,$4,$5::jsonb,$6::jsonb,$7::jsonb,$8::jsonb,$9,$10::jsonb)
      ON CONFLICT (request_id) DO UPDATE SET summary = EXCLUDED.summary, severity = EXCLUDED.severity,
        confidence = EXCLUDED.confidence, evidence = EXCLUDED.evidence, caveats = EXCLUDED.caveats,
        recommendations = EXCLUDED.recommendations, validation_steps = EXCLUDED.validation_steps,
        migration_sql = EXCLUDED.migration_sql, raw_structured_response = EXCLUDED.raw_structured_response
    `,
      [
        requestId,
        input.summary,
        input.severity,
        input.confidence,
        JSON.stringify(input.evidence),
        JSON.stringify(input.caveats),
        JSON.stringify(input.recommendations),
        JSON.stringify(input.validationSteps ?? []),
        input.migrationSql ?? null,
        serializedResult,
      ],
    );
    for (const [ordinal, recommendation] of input.recommendations.entries()) {
      await client.query(
        `
        INSERT INTO index_analyzer.ai_recommendations
          (request_id, ordinal, title, rationale, risk, confidence, migration_sql)
        VALUES ($1,$2,$3,$4,$5,$6,$7)
        ON CONFLICT (request_id, ordinal) DO UPDATE SET title = EXCLUDED.title,
          rationale = EXCLUDED.rationale, risk = EXCLUDED.risk,
          confidence = EXCLUDED.confidence, migration_sql = EXCLUDED.migration_sql
      `,
        [
          requestId,
          ordinal,
          recommendation.title,
          recommendation.rationale,
          recommendation.risk,
          recommendation.confidence,
          recommendation.migrationSql ?? null,
        ],
      );
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function failAiAnalysis(
  db: Queryable,
  requestId: string,
  error: unknown,
): Promise<void> {
  const message = error instanceof Error ? error.message : String(error);
  const code =
    typeof error === "object" && error !== null && "code" in error
      ? String(error.code)
      : "AI_ANALYSIS_FAILED";
  await db.query(
    `
    UPDATE index_analyzer.ai_analysis_requests SET status = 'failed', completed_at = clock_timestamp(),
      error_code = left($2, 100), error_message = left($3, 2000) WHERE id = $1
  `,
    [requestId, code, message],
  );
}

export async function listAiAnalyses(
  db: Queryable,
  sourceDatabaseId: number,
  input: PageInput = {},
): Promise<Record<string, unknown>[]> {
  const page = boundedPage(input);
  const result = await db.query<Record<string, unknown>>(
    `
    SELECT request.id, request.source_database_id, request.explain_run_id,
      request.created_at, request.completed_at, request.status, request.mode,
      request.model, request.payload_digest, request.request_size_bytes,
      request.provider_request_id, request.input_tokens, request.output_tokens,
      request.error_code, request.error_message,
      result.summary, result.severity, result.confidence, result.evidence,
      result.caveats, result.recommendations, result.validation_steps, result.migration_sql
    FROM index_analyzer.ai_analysis_requests request
    LEFT JOIN index_analyzer.ai_analysis_results result ON result.request_id = request.id
    WHERE request.source_database_id = $1
    ORDER BY request.created_at DESC LIMIT $2 OFFSET $3
  `,
    [sourceDatabaseId, page.limit, page.offset],
  );
  return result.rows;
}
