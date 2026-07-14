import { describe, expect, it } from "vitest";

import { POST as indexRecommendation } from "@/app/api/indexes/recommendation/route";
import { POST as maintenanceCommand } from "@/app/api/maintenance/command/route";

function request(url: string, body: unknown): Request {
  return new Request(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("review-only SQL generators", () => {
  it("quotes every index identifier and never marks output executable", async () => {
    const response = await indexRecommendation(
      request("http://local.test/api/indexes/recommendation", {
        schema: "odd schema",
        table: "orders",
        columns: ["customer_id", 'created"at'],
        include: ["total_cents"],
      }),
    );
    const body = (await response.json()) as {
      sql: string;
      executable: boolean;
    };
    expect(response.status).toBe(200);
    expect(body.executable).toBe(false);
    expect(body.sql).toContain('ON "odd schema"."orders"');
    expect(body.sql).toContain('"created""at"');
    expect(body.sql).toContain("CREATE INDEX CONCURRENTLY");
  });

  it("generates copy-only maintenance SQL", async () => {
    const response = await maintenanceCommand(
      request("http://local.test/api/maintenance/command", {
        schema: "sales",
        table: "orders",
        operation: "vacuum_analyze",
      }),
    );
    await expect(response.json()).resolves.toMatchObject({
      sql: 'VACUUM (ANALYZE) "sales"."orders";',
      executable: false,
    });
  });
});
