import {
  calculateSnapshotDelta,
  scoreQueryRegression,
} from "@/lib/analysis/deltas";
import { describe, expect, it } from "vitest";

describe("calculateSnapshotDelta", () => {
  const previous = {
    capturedAt: "2026-01-01T00:00:00Z",
    statsResetAt: "2025-12-31T00:00:00Z",
    calls: 10,
    totalExecTimeMs: 100,
    rows: 50,
    sharedBlocksHit: 80,
    sharedBlocksRead: 20,
  };

  it("calculates derived rates from cumulative counters", () => {
    const delta = calculateSnapshotDelta(previous, {
      ...previous,
      capturedAt: "2026-01-01T00:00:10Z",
      calls: 15,
      totalExecTimeMs: 150,
      rows: 70,
      sharedBlocksHit: 98,
      sharedBlocksRead: 22,
    });
    expect(delta.usable).toBe(true);
    expect(delta.counters.calls).toBe(5);
    expect(delta.meanExecTimeMs).toBe(10);
    expect(delta.callsPerSecond).toBe(0.5);
    expect(delta.rowsPerCall).toBe(4);
    expect(delta.cacheHitRatio).toBe(0.9);
  });

  it("marks a changed stats reset boundary unusable", () => {
    const delta = calculateSnapshotDelta(previous, {
      ...previous,
      capturedAt: "2026-01-01T00:00:10Z",
      statsResetAt: "2026-01-01T00:00:05Z",
    });
    expect(delta).toMatchObject({
      usable: false,
      resetDetected: true,
      resetReason: "stats_reset_changed",
    });
    expect(delta.counters.calls).toBeNull();
  });

  it("detects an implicit reset when any counter decreases", () => {
    const delta = calculateSnapshotDelta(previous, {
      ...previous,
      capturedAt: "2026-01-01T00:00:10Z",
      calls: 1,
    });
    expect(delta.resetReason).toBe("counter_decreased");
  });

  it("rejects zero and reversed intervals", () => {
    expect(calculateSnapshotDelta(previous, previous).resetReason).toBe(
      "invalid_interval",
    );
  });

  it("returns null per-call metrics when there are no new calls", () => {
    const delta = calculateSnapshotDelta(previous, {
      ...previous,
      capturedAt: "2026-01-01T00:00:10Z",
    });
    expect(delta.meanExecTimeMs).toBeNull();
    expect(delta.rowsPerCall).toBeNull();
  });
});

describe("scoreQueryRegression", () => {
  it("scores a material latency regression", () => {
    const result = scoreQueryRegression(
      { calls: 100, meanExecTimeMs: 10, p95ExecTimeMs: 20, rowsPerCall: 10 },
      { calls: 100, meanExecTimeMs: 20, p95ExecTimeMs: 50, rowsPerCall: 25 },
    );
    expect(result.regressed).toBe(true);
    expect(result.score).toBeGreaterThan(50);
    expect(result.reasons).toHaveLength(3);
  });

  it("applies the minimum call guard", () => {
    const result = scoreQueryRegression(
      { calls: 100, meanExecTimeMs: 10 },
      { calls: 2, meanExecTimeMs: 100 },
    );
    expect(result).toMatchObject({ regressed: false, score: 0 });
  });

  it("does not turn row growth alone into a query latency regression", () => {
    const result = scoreQueryRegression(
      { calls: 100, meanExecTimeMs: 10, rowsPerCall: 1 },
      { calls: 100, meanExecTimeMs: 10, rowsPerCall: 100 },
    );
    expect(result.regressed).toBe(false);
  });
});
