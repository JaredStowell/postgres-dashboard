import {
  analyzeIndexOverlaps,
  calculateWriteCostSignal,
  deriveMissingIndexEvidence,
} from "@/lib/analysis/indexes";
import type { IndexRecord } from "@/lib/types";
import { describe, expect, it } from "vitest";

const base: IndexRecord = {
  id: "a",
  schema: "public",
  table: "events",
  name: "events_tenant_idx",
  method: "btree",
  keyColumns: ["tenant_id"],
  scans: 10,
  sizeBytes: 100,
};

describe("index overlap analysis", () => {
  it("finds exact duplicates and deterministically picks the less-used copy", () => {
    const result = analyzeIndexOverlaps([
      base,
      { ...base, id: "b", name: "copy", scans: 0 },
    ]);
    expect(result).toEqual([
      expect.objectContaining({
        kind: "duplicate",
        redundantId: "b",
        coveringId: "a",
        confidence: 1,
      }),
    ]);
  });

  it("finds btree prefix coverage including INCLUDE columns", () => {
    const result = analyzeIndexOverlaps([
      { ...base, includeColumns: ["created_at"] },
      {
        ...base,
        id: "b",
        keyColumns: ["tenant_id", "status"],
        includeColumns: ["created_at"],
      },
    ]);
    expect(result[0]).toMatchObject({
      kind: "prefix",
      redundantId: "a",
      coveringId: "b",
    });
  });

  it("does not claim prefix coverage across predicates, methods, or unique semantics", () => {
    expect(
      analyzeIndexOverlaps([
        base,
        {
          ...base,
          id: "b",
          keyColumns: ["tenant_id", "status"],
          predicate: "active",
        },
      ]),
    ).toEqual([]);
    expect(
      analyzeIndexOverlaps([
        { ...base, method: "hash" },
        {
          ...base,
          id: "b",
          method: "hash",
          keyColumns: ["tenant_id", "status"],
        },
      ]),
    ).toEqual([]);
    expect(
      analyzeIndexOverlaps([
        { ...base, unique: true },
        {
          ...base,
          id: "b",
          unique: false,
          keyColumns: ["tenant_id", "status"],
        },
      ]),
    ).toEqual([]);
  });
});

describe("write cost", () => {
  it("scores mutation, index count, index size, and non-HOT updates", () => {
    const result = calculateWriteCostSignal({
      inserts: 1_000_000,
      updates: 1_000_000,
      deletes: 50_000,
      hotUpdates: 100_000,
      indexCount: 14,
      totalIndexBytes: 4_000,
      tableBytes: 1_000,
    });
    expect(result.score).toBeGreaterThan(70);
    expect(result.amplification).toBe((1_000_000 + 900_000 + 50_000) * 14);
    expect(result.reasons.join(" ")).toContain("non-HOT");
  });

  it("reports low cost for a small idle table", () => {
    expect(
      calculateWriteCostSignal({
        inserts: 0,
        updates: 0,
        deletes: 0,
        indexCount: 1,
        totalIndexBytes: 10,
        tableBytes: 100,
      }).level,
    ).toBe("low");
  });
});

describe("missing-index evidence", () => {
  it("derives evidence from large filtered sequential scans", () => {
    const result = deriveMissingIndexEvidence([
      {
        Plan: {
          "Node Type": "Seq Scan",
          Schema: "sales",
          "Relation Name": "orders",
          Alias: "o",
          Filter: "((o.tenant_id = 42) AND (o.status = 'open'::text))",
          "Plan Rows": 10_000,
          "Actual Rows": 100,
          "Rows Removed by Filter": 50_000,
          "Actual Loops": 1,
        },
      },
    ]);
    expect(result[0]).toMatchObject({
      schema: "sales",
      table: "orders",
      columns: ["status", "tenant_id"],
      actualRows: 100,
      rowsRemovedByFilter: 50_000,
    });
    expect(result[0]!.score).toBeGreaterThan(50);
  });

  it("ignores small scans and filters with no attributable columns", () => {
    expect(
      deriveMissingIndexEvidence([
        {
          Plan: {
            "Node Type": "Seq Scan",
            "Relation Name": "tiny",
            Filter: "random() > 0.5",
            "Plan Rows": 5,
          },
        },
      ]),
    ).toEqual([]);
  });
});
