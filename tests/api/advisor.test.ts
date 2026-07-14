import { afterEach, describe, expect, it } from "vitest";

import { POST } from "@/app/api/advisor/route";

const originalEnv = { ...process.env };

function request(body: unknown): Request {
  return new Request("http://local.test/api/advisor", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

afterEach(() => {
  process.env = { ...originalEnv };
});

describe("AI Advisor route", () => {
  it("previews the exact redacted payload without submitting", async () => {
    delete process.env.OPENAI_API_KEY;
    process.env.AI_MOCK_MODE = "false";
    const response = await POST(
      request({
        query:
          "SELECT * FROM private.orders WHERE email = 'person@example.com' -- secret",
        settings: { work_mem: "64MB", password: "do-not-send" },
      }),
    );
    const body = (await response.json()) as Record<string, any>;

    expect(response.status).toBe(200);
    expect(body.preview.canSubmit).toBe(false);
    expect(body.preview.payload.query).not.toContain("person@example.com");
    expect(body.preview.payload.query).not.toContain("secret");
    expect(body.preview.payload.settings).toEqual({ work_mem: "64MB" });
    expect(body.preview.payload.privacy.resultRowsIncluded).toBe(false);
    expect(body.preview.bytes).toBeLessThanOrEqual(body.preview.limitBytes);
  });

  it("returns a deterministic structured analysis in mock mode", async () => {
    process.env.AI_MOCK_MODE = "true";
    const response = await POST(
      request({
        query: "SELECT * FROM public.orders WHERE store_id = 42",
        submit: true,
      }),
    );
    const body = (await response.json()) as Record<string, any>;

    expect(response.status).toBe(200);
    expect(body.metadata).toMatchObject({
      model: "deterministic-mock",
      mock: true,
    });
    expect(body.analysis.summary).toContain("Mock analysis");
    expect(body.analysis.recommendations).toBeInstanceOf(Array);
  });

  it("refuses submission without a configured provider or mock mode", async () => {
    delete process.env.OPENAI_API_KEY;
    process.env.AI_MOCK_MODE = "false";
    const response = await POST(request({ query: "SELECT 1", submit: true }));
    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "ai_disabled" },
    });
  });

  it("requires a source database when persistence is requested", async () => {
    process.env.AI_MOCK_MODE = "true";
    const response = await POST(
      request({ query: "SELECT 1", submit: true, persist: true }),
    );
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "validation_failed" },
    });
  });
});
