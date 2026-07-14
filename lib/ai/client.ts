import OpenAI from "openai";
import { zodTextFormat } from "openai/helpers/zod";

import { optionalString, type RuntimeEnv } from "@/lib/config/env";

import { createMockAiAnalysis } from "./mock";
import type { AiAdvisorPayload } from "./payload";
import {
  aiAnalysisResponseSchema,
  parseAiAnalysisResponse,
  type AiAnalysisResponse,
} from "./schema";

export type AiAnalysisMode = "balanced" | "deep";

export interface AiAnalysisResult {
  analysis: AiAnalysisResponse;
  model: string;
  requestId: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
  mock: boolean;
}

export interface AnalyzePayloadOptions {
  env: RuntimeEnv;
  mode: AiAnalysisMode;
  client?: OpenAI;
}

const ADVISOR_INSTRUCTIONS = `You are a senior PostgreSQL performance engineer. Analyze only the supplied sanitized evidence.
Return evidence-backed findings and safe validation steps. Do not claim a table, index, column, statistic, setting, or plan fact that is absent from the payload. Call out missing parameter values, stale statistics, and uncertainty. Prefer reversible changes. Treat generated SQL as review-only and use CREATE INDEX CONCURRENTLY when an index is appropriate. Never propose executing SQL automatically.`;

function booleanEnv(env: RuntimeEnv, key: string): boolean {
  return optionalString(env, key)?.toLowerCase() === "true";
}

function modelFor(env: RuntimeEnv, mode: AiAnalysisMode): string {
  return mode === "deep"
    ? (optionalString(env, "OPENAI_DEEP_MODEL") ?? "gpt-5.6-sol")
    : (optionalString(env, "OPENAI_BALANCED_MODEL") ?? "gpt-5.6-terra");
}

export async function analyzeAiPayload(
  payload: AiAdvisorPayload,
  options: AnalyzePayloadOptions,
): Promise<AiAnalysisResult> {
  const model = modelFor(options.env, options.mode);
  if (booleanEnv(options.env, "AI_MOCK_MODE")) {
    return {
      analysis: createMockAiAnalysis(payload),
      model: "deterministic-mock",
      requestId: null,
      inputTokens: null,
      outputTokens: null,
      mock: true,
    };
  }

  const apiKey = optionalString(options.env, "OPENAI_API_KEY");
  if (!apiKey && !options.client) {
    throw new Error(
      "AI Advisor is disabled because OPENAI_API_KEY is not configured.",
    );
  }

  const client =
    options.client ??
    new OpenAI({
      apiKey,
      maxRetries: 1,
      timeout: 45_000,
    });

  const response = await client.responses.parse({
    model,
    store: false,
    instructions: ADVISOR_INSTRUCTIONS,
    input: JSON.stringify(payload),
    text: {
      format: zodTextFormat(aiAnalysisResponseSchema, "postgres_analysis"),
    },
  });
  if (!response.output_parsed) {
    throw new Error("OpenAI returned no structured PostgreSQL analysis.");
  }

  return {
    analysis: parseAiAnalysisResponse(response.output_parsed),
    model,
    requestId: response._request_id ?? null,
    inputTokens: response.usage?.input_tokens ?? null,
    outputTokens: response.usage?.output_tokens ?? null,
    mock: false,
  };
}
