import { createMockAiAnalysis } from "@/lib/ai/mock";
import { buildAiPayload } from "@/lib/ai/payload";
import {
  aiAnalysisResponseSchema,
  parseAiAnalysisResponse,
} from "@/lib/ai/schema";
import { describe, expect, it } from "vitest";

function samplePlan() {
  return [
    {
      "Execution Time": 30,
      Plan: {
        "Node Type": "Seq Scan",
        "Relation Name": "users",
        Filter: "(email = 'private@example.com'::text)",
        "Plan Rows": 10_000,
        "Actual Rows": 10,
        "Rows Removed by Filter": 50_000,
      },
    },
  ];
}

describe("AI payload", () => {
  it("whitelists context, redacts literals, omits result rows, and produces an exact preview", () => {
    const input = {
      query:
        "-- person\nSELECT * FROM users WHERE email='private@example.com' AND age=42",
      plan: samplePlan(),
      tables: [
        {
          schema: "public",
          name: "users",
          columns: [{ name: "email", dataType: "text" }],
        },
      ],
      indexes: [
        {
          schema: "public",
          table: "users",
          name: "users_email",
          definition: "CREATE INDEX users_email ON users(email) WHERE age > 42",
        },
      ],
      settings: { work_mem: "4MB", password: "secret", random_page_cost: 1.1 },
      statistics: { calls: 42 },
      resultRows: [{ email: "leak@example.com" }],
    };
    const result = buildAiPayload(input);
    expect(result.preview).toBe(JSON.stringify(result.payload, null, 2));
    expect(result.preview).not.toContain("private@example.com");
    expect(result.preview).not.toContain("leak@example.com");
    expect(result.preview).not.toContain("secret");
    expect(result.payload.privacy.resultRowsIncluded).toBe(false);
    expect(result.payload.settings).toEqual({
      random_page_cost: 1.1,
      work_mem: "4MB",
    });
  });

  it("enforces item and byte limits deterministically", () => {
    const result = buildAiPayload(
      {
        query: `SELECT '${"x".repeat(20_000)}'`,
        plan: samplePlan(),
        tables: Array.from({ length: 20 }, (_, index) => ({
          schema: "public",
          name: `table_${index}`,
          columns: Array.from({ length: 20 }, (_, column) => ({
            name: `column_${column}`,
            dataType: "text",
            statistics: { long: "x".repeat(500) },
          })),
        })),
        indexes: Array.from({ length: 100 }, (_, index) => ({
          schema: "public",
          table: "users",
          name: `index_${index}`,
          definition: `CREATE INDEX index_${index} ON users(email)`,
        })),
      },
      { maxBytes: 5_000, maxTables: 5, maxColumnsPerTable: 5, maxIndexes: 10 },
    );
    expect(result.bytes).toBeLessThanOrEqual(5_000);
    expect(result.truncated).toBe(true);
    expect(result.payload.tables.length).toBeLessThanOrEqual(5);
    expect(result.omissions).toEqual(
      expect.arrayContaining(["tables", "indexes"]),
    );
  });

  it("surfaces invalid plans without failing the entire request", () => {
    const result = buildAiPayload({ query: "SELECT 1", plan: { nope: true } });
    expect(result.payload.plan).toBeNull();
    expect(result.omissions).toContain("invalid plan");
  });
});

describe("AI response schema", () => {
  const valid = {
    summary: "A useful summary",
    severity: "medium",
    confidence: 0.8,
    evidence: [
      { claim: "Scan is expensive", source: "plan", reference: "node 0" },
    ],
    caveats: ["Parameters vary"],
    recommendations: [
      {
        title: "Test an index",
        rationale: "The filter is selective",
        risk: "low",
        confidence: 0.7,
        validationSteps: ["Compare plans"],
        migrationSql: null,
      },
    ],
  };

  it("accepts strict structured output", () => {
    expect(parseAiAnalysisResponse(valid)).toEqual(valid);
  });

  it("rejects unknown keys, invalid confidence, empty validation, and bad enums", () => {
    expect(
      aiAnalysisResponseSchema.safeParse({ ...valid, surprise: true }).success,
    ).toBe(false);
    expect(
      aiAnalysisResponseSchema.safeParse({ ...valid, confidence: 2 }).success,
    ).toBe(false);
    expect(
      aiAnalysisResponseSchema.safeParse({ ...valid, severity: "urgent" })
        .success,
    ).toBe(false);
    expect(
      aiAnalysisResponseSchema.safeParse({
        ...valid,
        recommendations: [{ ...valid.recommendations[0], validationSteps: [] }],
      }).success,
    ).toBe(false);
  });
});

describe("mock AI", () => {
  it("returns deterministic schema-valid evidence based analysis", () => {
    const { payload } = buildAiPayload({
      query: "SELECT * FROM users WHERE email='x'",
      plan: samplePlan(),
    });
    const first = createMockAiAnalysis(payload);
    const second = createMockAiAnalysis(payload);
    expect(first).toEqual(second);
    expect(aiAnalysisResponseSchema.parse(first)).toEqual(first);
    expect(first.evidence.length).toBeGreaterThan(0);
  });

  it("returns a conservative no-plan response", () => {
    const { payload } = buildAiPayload({ query: "SELECT 1" });
    expect(createMockAiAnalysis(payload)).toMatchObject({
      severity: "info",
      confidence: 0.45,
      recommendations: [],
    });
  });
});
