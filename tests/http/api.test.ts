import { describe, expect, it } from "vitest";
import { z } from "zod";

import {
  ApiError,
  boundedInteger,
  errorResponse,
  jsonResponse,
  parseJson,
  route,
} from "@/lib/http/api";

describe("HTTP API helpers", () => {
  it("returns no-store JSON responses", async () => {
    const response = jsonResponse({ ok: true });
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("content-type")).toContain("application/json");
    await expect(response.json()).resolves.toEqual({ ok: true });
  });

  it("maps typed errors without leaking stacks", async () => {
    const response = errorResponse(
      new ApiError(409, "conflict", "Already exists", { id: 1 }),
    );
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "conflict",
        message: "Already exists",
        details: { id: 1 },
      },
    });
  });

  it("validates content type and JSON shape", async () => {
    const schema = z.object({ name: z.string().min(1) });
    const request = new Request("http://local.test", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "index" }),
    });
    await expect(parseJson(request, schema)).resolves.toEqual({
      name: "index",
    });
  });

  it("rejects oversized JSON before parsing", async () => {
    const request = new Request("http://local.test", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ value: "x".repeat(2_000) }),
    });
    await expect(
      parseJson(request, z.unknown(), { maxBytes: 1_024 }),
    ).rejects.toMatchObject({
      status: 413,
      code: "payload_too_large",
    });
  });

  it("bounds integers", () => {
    expect(boundedInteger(null, 25, { min: 1, max: 100, name: "limit" })).toBe(
      25,
    );
    expect(boundedInteger("50", 25, { min: 1, max: 100, name: "limit" })).toBe(
      50,
    );
    expect(() =>
      boundedInteger("500", 25, { min: 1, max: 100, name: "limit" }),
    ).toThrow(ApiError);
  });

  it("wraps route failures", async () => {
    const handler = route(async () => {
      throw new ApiError(403, "forbidden", "No access");
    });
    const response = await handler();
    expect(response.status).toBe(403);
  });
});
