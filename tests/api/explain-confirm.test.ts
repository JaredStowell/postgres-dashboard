import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { POST } from "@/app/api/explain/confirm/route";

function request(body: unknown): Request {
  return new Request("http://local.test/api/explain/confirm", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("EXPLAIN ANALYZE confirmation route", () => {
  beforeEach(() => {
    process.env.EXPLAIN_CONFIRMATION_SECRET =
      "a-test-secret-that-is-long-enough";
  });

  afterEach(() => {
    delete process.env.EXPLAIN_CONFIRMATION_SECRET;
  });

  it("issues a short-lived token for an acknowledged read-only statement", async () => {
    const response = await POST(
      request({
        sql: "SELECT * FROM public.orders WHERE id = 42",
        acknowledgement: "RUN EXPLAIN ANALYZE",
      }),
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      token: string;
      expiresInMs: number;
    };
    expect(body.token.split(".")).toHaveLength(2);
    expect(body.expiresInMs).toBe(60_000);
  });

  it("rejects writes hidden inside a CTE", async () => {
    const response = await POST(
      request({
        sql: "WITH changed AS (DELETE FROM orders RETURNING *) SELECT * FROM changed",
        acknowledgement: "RUN EXPLAIN ANALYZE",
      }),
    );
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "unsafe_explain_analyze" },
    });
  });

  it("requires the explicit acknowledgement phrase", async () => {
    const response = await POST(
      request({ sql: "SELECT 1", acknowledgement: "sure" }),
    );
    expect(response.status).toBe(400);
  });
});
