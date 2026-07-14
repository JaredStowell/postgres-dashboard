import { describe, expect, it } from "vitest";

import {
  canonicalAdvisorQuery,
  extractQualifiedRelationsFromSql,
  extractRelationsFromPlan,
} from "@/lib/server/advisor-evidence";

describe("advisor evidence matching", () => {
  it("extracts only schema-qualified relations and preserves quoted names", () => {
    expect(
      extractQualifiedRelationsFromSql(`
        SELECT * FROM sales.orders o
        JOIN "Odd Schema"."Order Items" i ON i.order_id = o.id
        JOIN unqualified ignored ON true
        WHERE o.email = 'FROM secret.fake'
      `),
    ).toEqual([
      { schema: "sales", table: "orders" },
      { schema: "Odd Schema", table: "Order Items" },
    ]);
  });

  it("extracts bounded relation identity from nested plan nodes", () => {
    expect(
      extractRelationsFromPlan([
        {
          Plan: {
            "Node Type": "Nested Loop",
            Plans: [
              { Schema: "sales", "Relation Name": "orders" },
              { Schema: "sales", "Relation Name": "customers" },
              { Schema: "sales", "Relation Name": "orders" },
            ],
          },
        },
      ]),
    ).toEqual([
      { schema: "sales", table: "orders" },
      { schema: "sales", table: "customers" },
    ]);
  });

  it("matches literal and pg_stat_statements placeholders without exposing values", () => {
    expect(
      canonicalAdvisorQuery(
        "SELECT * FROM sales.orders WHERE customer_id = 42 AND status = 'paid' -- private",
      ),
    ).toBe(
      canonicalAdvisorQuery(
        "SELECT * FROM sales.orders WHERE customer_id = $1 AND status = $2",
      ),
    );
  });
});
