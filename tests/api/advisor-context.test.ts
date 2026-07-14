import { describe, expect, it } from "vitest";

import { GET } from "@/app/api/advisor/context/route";

describe("Advisor context route validation", () => {
  it("requires an explicit evidence selection", async () => {
    const response = await GET(
      new Request("http://local.test/api/advisor/context?source=local"),
    );
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "advisor_context_required" },
    });
  });

  it.each([
    ["queryId=not-a-number", "invalid_query_id"],
    ["planId=not-a-uuid", "invalid_plan_id"],
    ["findingId=0", "invalid_parameter"],
  ])("rejects invalid selection %s", async (query, code) => {
    const response = await GET(
      new Request(`http://local.test/api/advisor/context?${query}`),
    );
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: { code },
    });
  });
});
