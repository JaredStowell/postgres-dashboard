import { describe, expect, it } from "vitest";

import {
  hypotheticalExplainOptions,
  validateHypotheticalIndexSql,
} from "@/lib/db/hypopg";

describe("HypoPG input contract", () => {
  it("accepts one review-only CREATE INDEX statement", () => {
    expect(
      validateHypotheticalIndexSql(
        "CREATE INDEX orders_customer_candidate ON sales.orders (customer_id)",
      ),
    ).toContain("CREATE INDEX");
  });

  it.each([
    "DROP INDEX sales.orders_customer_idx",
    "SELECT 1",
    "CREATE INDEX candidate ON sales.orders (customer_id); DROP TABLE sales.orders",
    "CREATE INDEX CONCURRENTLY candidate ON sales.orders (customer_id)",
  ])("rejects unsupported or multi-statement SQL: %s", (sql) => {
    expect(() => validateHypotheticalIndexSql(sql)).toThrow();
  });

  it("adds SETTINGS only on PostgreSQL versions that support it", () => {
    expect(hypotheticalExplainOptions(110_000)).not.toContain("SETTINGS");
    expect(hypotheticalExplainOptions(120_000)).toContain("SETTINGS true");
  });
});
