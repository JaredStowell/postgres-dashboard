import {
  capabilityFor,
  evaluateCapabilities,
} from "@/lib/analysis/capabilities";
import {
  deduplicateFindings,
  stableFindingFingerprint,
} from "@/lib/analysis/findings";
import { calculateMaintenanceScore } from "@/lib/analysis/maintenance";
import { describe, expect, it } from "vitest";

describe("maintenance scoring", () => {
  const now = new Date("2026-01-31T00:00:00Z");

  it("elevates dead tuples, stale statistics, freeze age, and disabled autovacuum", () => {
    const result = calculateMaintenanceScore(
      {
        liveRows: 1_000,
        deadRows: 1_000,
        modificationsSinceAnalyze: 800,
        lastVacuumAt: "2025-12-01T00:00:00Z",
        lastAnalyzeAt: null,
        transactionAge: 190_000_000,
        freezeMaxAge: 200_000_000,
        tableBytes: 1_000_000_000,
        autovacuumEnabled: false,
      },
      now,
    );
    expect(result.overall).toBeGreaterThan(75);
    expect(result.freezeRisk).toBeGreaterThan(80);
    expect(result.reasons.join(" ")).toContain("Autovacuum is disabled");
  });

  it("keeps a recently maintained table low risk", () => {
    const result = calculateMaintenanceScore(
      {
        liveRows: 10_000,
        deadRows: 10,
        modificationsSinceAnalyze: 5,
        lastVacuumAt: now,
        lastAnalyzeAt: now,
        transactionAge: 1_000,
        freezeMaxAge: 200_000_000,
      },
      now,
    );
    expect(result.overall).toBeLessThan(20);
    expect(result.severity).toBe("info");
  });

  it("handles empty relations without NaN", () => {
    expect(
      calculateMaintenanceScore(
        { liveRows: 0, deadRows: 0, modificationsSinceAnalyze: 0 },
        now,
      ).overall,
    ).toBeTypeOf("number");
  });
});

describe("finding fingerprints and deduplication", () => {
  const finding = {
    sourceKey: "prod",
    database: "app",
    rule: "dead-tuples",
    resourceType: "table",
    resourceKey: "public.events",
  };

  it("is stable across object key order and changes with identity", () => {
    const a = stableFindingFingerprint({
      ...finding,
      identity: { threshold: 1, region: "us" },
    });
    const b = stableFindingFingerprint({
      ...finding,
      identity: { region: "us", threshold: 1 },
    });
    expect(a).toBe(b);
    expect(
      stableFindingFingerprint({
        ...finding,
        identity: { threshold: 2, region: "us" },
      }),
    ).not.toBe(a);
  });

  it("deduplicates occurrences while preserving time bounds and peak severity", () => {
    const result = deduplicateFindings([
      {
        ...finding,
        severity: "low",
        firstSeenAt: "2026-01-02Z",
        lastSeenAt: "2026-01-03Z",
      },
      {
        ...finding,
        severity: "high",
        firstSeenAt: "2026-01-01Z",
        lastSeenAt: "2026-01-04Z",
        occurrenceCount: 2,
      },
    ]);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      severity: "high",
      firstSeenAt: "2026-01-01Z",
      lastSeenAt: "2026-01-04Z",
      occurrenceCount: 3,
    });
  });

  it("rejects circular identity input", () => {
    const identity: Record<string, unknown> = {};
    identity.self = identity;
    expect(() => stableFindingFingerprint({ ...finding, identity })).toThrow(
      /circular/,
    );
  });
});

describe("capability helpers", () => {
  const full = {
    serverVersionNum: 170000,
    extensions: ["pg_stat_statements", "pgstattuple", "hypopg"],
    views: [
      "pg_stat_statements",
      "pg_stat_activity",
      "pg_stat_progress_vacuum",
    ],
    privileges: ["pg_read_all_stats"],
    settings: { jit: "on" },
  };

  it("exposes fully available capabilities", () => {
    expect(
      evaluateCapabilities(full).every(
        (item) => item.available && !item.degraded,
      ),
    ).toBe(true);
  });

  it("distinguishes degraded query text access from missing query stats", () => {
    const degraded = { ...full, privileges: [] };
    expect(capabilityFor(degraded, "query_text_all_roles")).toMatchObject({
      available: true,
      degraded: true,
    });
    expect(
      capabilityFor({ ...degraded, extensions: [] }, "query_stats"),
    ).toMatchObject({ available: false, degraded: false });
  });

  it("explains version and extension gates", () => {
    const old = {
      serverVersionNum: 110000,
      extensions: [],
      views: [],
      privileges: [],
      settings: {},
    };
    expect(capabilityFor(old, "vacuum_progress").reason).toContain("12");
    expect(capabilityFor(old, "exact_bloat").reason).toContain("pgstattuple");
  });
});
