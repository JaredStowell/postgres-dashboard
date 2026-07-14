import { describe, expect, it, vi } from "vitest";

import { analyzeAiPayload } from "@/lib/ai/client";
import type { AiAdvisorPayload } from "@/lib/ai/payload";

const payload: AiAdvisorPayload = {
  version: 1,
  privacy: {
    literalsRedacted: true,
    commentsRemoved: true,
    resultRowsIncluded: false,
  },
  context: { database: "index_analyzer" },
  query: "SELECT * FROM public.orders WHERE store_id = ?",
  plan: null,
  planSummary: null,
  tables: [],
  indexes: [],
  settings: {},
  statistics: {},
};

describe("AI advisor client", () => {
  it("supports deterministic mock analysis without a key", async () => {
    const result = await analyzeAiPayload(payload, {
      env: { AI_MOCK_MODE: "true" },
      mode: "balanced",
    });
    expect(result.mock).toBe(true);
    expect(result.model).toBe("deterministic-mock");
    expect(result.analysis.summary).toContain("Mock analysis");
  });

  it("requires a key outside mock mode", async () => {
    await expect(
      analyzeAiPayload(payload, {
        env: { AI_MOCK_MODE: "false" },
        mode: "balanced",
      }),
    ).rejects.toThrow("OPENAI_API_KEY");
  });

  it("uses Responses structured output with storage disabled", async () => {
    const parse = vi.fn().mockResolvedValue({
      output_parsed: {
        summary: "Evidence is limited.",
        severity: "info",
        confidence: 0.5,
        evidence: [],
        caveats: ["No plan was supplied."],
        recommendations: [],
      },
      _request_id: "req_test",
      usage: { input_tokens: 120, output_tokens: 42 },
    });
    const client = { responses: { parse } };
    const result = await analyzeAiPayload(payload, {
      env: { OPENAI_BALANCED_MODEL: "test-model" },
      mode: "balanced",
      client: client as never,
    });

    expect(parse).toHaveBeenCalledWith(
      expect.objectContaining({ model: "test-model", store: false }),
    );
    expect(result).toMatchObject({
      model: "test-model",
      requestId: "req_test",
      inputTokens: 120,
      outputTokens: 42,
      mock: false,
    });
  });
});
