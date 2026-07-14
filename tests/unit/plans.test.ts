import {
  calculatePlanMetrics,
  detectPlanWarnings,
  diffPlans,
  exportPlanJson,
  exportPlanMarkdown,
  matchPlanNodes,
  normalizeExplainDocument,
  sanitizeExplainPlan,
  traversePlan,
} from "@/lib/analysis/plans";
import { describe, expect, it } from "vitest";

function plan(overrides: Record<string, unknown> = {}) {
  return [
    {
      "Planning Time": 1.2,
      "Execution Time": 100,
      "Query Text": "SELECT * FROM customers WHERE email='private@example.com'",
      Plan: {
        "Node Type": "Nested Loop",
        "Total Cost": 200,
        "Plan Rows": 10,
        "Actual Rows": 100,
        "Actual Total Time": 95,
        "Actual Loops": 1,
        Plans: [
          {
            "Node Type": "Seq Scan",
            Schema: "public",
            "Relation Name": "customers",
            Alias: "c",
            Filter: "(email = 'private@example.com'::text)",
            "Plan Rows": 100,
            "Actual Rows": 10,
            "Actual Loops": 1,
            "Actual Total Time": 70,
            "Rows Removed by Filter": 9990,
            "Shared Hit Blocks": 10,
            "Shared Read Blocks": 500,
          },
          {
            "Node Type": "Sort",
            "Plan Rows": 100,
            "Actual Rows": 100,
            "Actual Loops": 200,
            "Actual Total Time": 0.1,
            "Sort Method": "external merge Disk",
            "Temp Written Blocks": 2000,
          },
        ],
      },
      ...overrides,
    },
  ];
}

describe("plan traversal and metrics", () => {
  it("normalizes array and object EXPLAIN shapes", () => {
    expect(normalizeExplainDocument(plan()).Plan["Node Type"]).toBe(
      "Nested Loop",
    );
    expect(normalizeExplainDocument(plan()[0]).Plan["Node Type"]).toBe(
      "Nested Loop",
    );
    expect(() => normalizeExplainDocument([])).toThrow(/non-empty/);
    expect(() => normalizeExplainDocument({})).toThrow(/Plan/);
  });

  it("traverses in stable preorder with paths", () => {
    expect(
      traversePlan(plan()).map((item) => [
        item.path,
        item.parentPath,
        item.depth,
      ]),
    ).toEqual([
      ["0", null, 0],
      ["0.0", "0", 1],
      ["0.1", "0", 1],
    ]);
  });

  it("computes aggregate metrics", () => {
    expect(calculatePlanMetrics(plan())).toMatchObject({
      nodeCount: 3,
      maxDepth: 1,
      planningTimeMs: 1.2,
      executionTimeMs: 100,
      totalCost: 200,
      sharedBlocksRead: 500,
      tempBlocksWritten: 2000,
      dominantNodePath: "0",
    });
  });
});

describe("plan warnings", () => {
  it("detects scan, rejection, estimate, buffers, spill, and amplification evidence", () => {
    const codes = detectPlanWarnings(plan(), { sequentialScanRows: 10 }).map(
      (item) => item.code,
    );
    expect(codes).toEqual(
      expect.arrayContaining([
        "nested_loop_amplification",
        "sequential_scan",
        "filter_rejection",
        "row_estimate_error",
        "buffer_pressure",
        "sort_spill",
      ]),
    );
  });

  it("detects parallel worker shortfalls and WAL", () => {
    const sample = [
      {
        Plan: {
          "Node Type": "Gather",
          "Plan Rows": 1,
          "Actual Rows": 1,
          "Workers Planned": 4,
          "Workers Launched": 2,
          "WAL Records": 5,
        },
      },
    ];
    expect(detectPlanWarnings(sample).map((item) => item.code)).toEqual([
      "wal_activity",
      "parallel_shortfall",
    ]);
  });
});

describe("plan matching and diff", () => {
  const before = [
    {
      "Execution Time": 10,
      Plan: {
        "Node Type": "Seq Scan",
        Schema: "public",
        "Relation Name": "events",
        "Total Cost": 100,
        "Actual Total Time": 9,
        "Plan Rows": 1000,
      },
    },
  ];
  const after = [
    {
      "Execution Time": 2,
      Plan: {
        "Node Type": "Index Scan",
        Schema: "public",
        "Relation Name": "events",
        "Index Name": "events_time_idx",
        "Total Cost": 20,
        "Actual Total Time": 1,
        "Plan Rows": 10,
      },
    },
  ];

  it("matches relation nodes when scan strategy changes", () => {
    expect(matchPlanNodes(before, after)).toEqual([
      { beforePath: "0", afterPath: "0", confidence: 0.88, reason: "relation" },
    ]);
  });

  it("reports material node and execution changes", () => {
    const diff = diffPlans(before, after);
    expect(diff.executionTimeChangeRatio).toBe(-0.8);
    expect(diff.nodes[0]).toMatchObject({
      status: "changed",
      nodeTypeBefore: "Seq Scan",
      nodeTypeAfter: "Index Scan",
    });
    expect(diff.summary.join(" ")).toContain("decreased by 80%");
  });

  it("reports added and removed nodes", () => {
    const result = diffPlans(
      [{ Plan: { "Node Type": "Result" } }],
      [{ Plan: { "Node Type": "Limit" } }],
    );
    expect(result.nodes.map((item) => item.status)).toEqual(
      expect.arrayContaining(["removed", "added"]),
    );
  });
});

describe("sanitized plan exports", () => {
  it("redacts query text and expression literals without mutating input", () => {
    const input = plan();
    const sanitized = sanitizeExplainPlan(input);
    expect(sanitized["Query Text"]).toBe("[REDACTED]");
    expect(JSON.stringify(sanitized)).not.toContain("private@example.com");
    expect(JSON.stringify(input)).toContain("private@example.com");
  });

  it("exports parseable JSON with no raw literals", () => {
    const exported = exportPlanJson({
      plan: plan(),
      query: "SELECT * FROM x WHERE email='me@example.com'",
      generatedAt: "2026-01-01Z",
    });
    expect(() => JSON.parse(exported)).not.toThrow();
    expect(exported).not.toContain("me@example.com");
  });

  it("exports a readable Markdown report", () => {
    const exported = exportPlanMarkdown({
      title: "Plan | report",
      plan: plan(),
      query: "SELECT 42",
    });
    expect(exported).toContain("# Plan \\| report");
    expect(exported).toContain("```sql\nSELECT ?\n```");
    expect(exported).toContain("## Warnings");
  });
});
