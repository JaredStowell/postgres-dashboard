import type {
  CounterDelta,
  QuerySnapshot,
  RegressionResult,
  RegressionWindow,
  SnapshotDelta,
} from "@/lib/types";

const counterKeys = [
  "calls",
  "totalExecTimeMs",
  "totalPlanTimeMs",
  "rows",
  "sharedBlocksHit",
  "sharedBlocksRead",
  "tempBlocksRead",
  "tempBlocksWritten",
  "walBytes",
] as const;

type CounterKey = (typeof counterKeys)[number];

function timestamp(value: Date | string | null | undefined): number | null {
  if (value == null) return null;
  const time = value instanceof Date ? value.getTime() : Date.parse(value);
  return Number.isFinite(time) ? time : null;
}

function counter(snapshot: QuerySnapshot, key: CounterKey): number {
  const value = snapshot[key];
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function emptyCounters(): CounterDelta {
  return {
    calls: null,
    totalExecTimeMs: null,
    totalPlanTimeMs: null,
    rows: null,
    sharedBlocksHit: null,
    sharedBlocksRead: null,
    tempBlocksRead: null,
    tempBlocksWritten: null,
    walBytes: null,
  };
}

export function calculateSnapshotDelta(
  previous: QuerySnapshot,
  current: QuerySnapshot,
): SnapshotDelta {
  const previousTime = timestamp(previous.capturedAt);
  const currentTime = timestamp(current.capturedAt);
  const intervalSeconds =
    previousTime == null || currentTime == null
      ? 0
      : (currentTime - previousTime) / 1_000;

  const previousReset = timestamp(previous.statsResetAt);
  const currentReset = timestamp(current.statsResetAt);
  const resetChanged =
    previousReset != null &&
    currentReset != null &&
    previousReset !== currentReset;
  const decreased = counterKeys.some(
    (key) => counter(current, key) < counter(previous, key),
  );
  const invalidInterval =
    !Number.isFinite(intervalSeconds) || intervalSeconds <= 0;

  if (resetChanged || decreased || invalidInterval) {
    return {
      usable: false,
      resetDetected: resetChanged || decreased,
      resetReason: resetChanged
        ? "stats_reset_changed"
        : decreased
          ? "counter_decreased"
          : "invalid_interval",
      intervalSeconds: Math.max(0, intervalSeconds || 0),
      counters: emptyCounters(),
      meanExecTimeMs: null,
      callsPerSecond: null,
      rowsPerCall: null,
      cacheHitRatio: null,
    };
  }

  const values = Object.fromEntries(
    counterKeys.map((key) => [
      key,
      counter(current, key) - counter(previous, key),
    ]),
  ) as unknown as Record<CounterKey, number>;
  const calls = values.calls;
  const blockAccess = values.sharedBlocksHit + values.sharedBlocksRead;

  return {
    usable: true,
    resetDetected: false,
    intervalSeconds,
    counters: values,
    meanExecTimeMs: calls > 0 ? values.totalExecTimeMs / calls : null,
    callsPerSecond: calls / intervalSeconds,
    rowsPerCall: calls > 0 ? values.rows / calls : null,
    cacheHitRatio:
      blockAccess > 0 ? values.sharedBlocksHit / blockAccess : null,
  };
}

export interface RegressionOptions {
  minimumRecentCalls?: number;
  latencyThresholdRatio?: number;
  p95ThresholdRatio?: number;
  rowThresholdRatio?: number;
  minimumBaselineLatencyMs?: number;
}

function changeRatio(
  current: number | undefined,
  baseline: number | undefined,
): number | null {
  if (
    current == null ||
    baseline == null ||
    !Number.isFinite(current) ||
    !Number.isFinite(baseline) ||
    baseline <= 0
  ) {
    return null;
  }
  return (current - baseline) / baseline;
}

export function scoreQueryRegression(
  baseline: RegressionWindow,
  recent: RegressionWindow,
  options: RegressionOptions = {},
): RegressionResult {
  const minimumCalls = options.minimumRecentCalls ?? 20;
  const latencyThreshold = options.latencyThresholdRatio ?? 0.25;
  const p95Threshold = options.p95ThresholdRatio ?? 0.3;
  const rowThreshold = options.rowThresholdRatio ?? 0.5;
  const minimumLatency = options.minimumBaselineLatencyMs ?? 1;
  const latencyChangeRatio = changeRatio(
    recent.meanExecTimeMs,
    baseline.meanExecTimeMs,
  );
  const p95ChangeRatio = changeRatio(
    recent.p95ExecTimeMs,
    baseline.p95ExecTimeMs,
  );
  const rowChangeRatio = changeRatio(recent.rowsPerCall, baseline.rowsPerCall);
  const reasons: string[] = [];

  if (recent.calls < minimumCalls) {
    reasons.push(
      `Only ${recent.calls} recent calls; at least ${minimumCalls} are required.`,
    );
    return {
      regressed: false,
      score: 0,
      latencyChangeRatio,
      p95ChangeRatio,
      rowChangeRatio,
      reasons,
    };
  }
  if (baseline.meanExecTimeMs < minimumLatency) {
    reasons.push(
      "Baseline latency is too small for a stable relative comparison.",
    );
  }

  let score = 0;
  if (
    baseline.meanExecTimeMs >= minimumLatency &&
    latencyChangeRatio != null &&
    latencyChangeRatio > latencyThreshold
  ) {
    score += Math.min(60, 20 + latencyChangeRatio * 40);
    reasons.push(
      `Mean execution latency increased by ${Math.round(latencyChangeRatio * 100)}%.`,
    );
  }
  if (p95ChangeRatio != null && p95ChangeRatio > p95Threshold) {
    score += Math.min(25, 8 + p95ChangeRatio * 17);
    reasons.push(
      `P95 execution latency increased by ${Math.round(p95ChangeRatio * 100)}%.`,
    );
  }
  if (rowChangeRatio != null && rowChangeRatio > rowThreshold) {
    score += Math.min(15, 5 + rowChangeRatio * 10);
    reasons.push(
      `Rows returned per call increased by ${Math.round(rowChangeRatio * 100)}%.`,
    );
  }

  const roundedScore = Math.min(100, Math.round(score));
  return {
    regressed:
      roundedScore >= 25 &&
      latencyChangeRatio != null &&
      latencyChangeRatio > latencyThreshold,
    score: roundedScore,
    latencyChangeRatio,
    p95ChangeRatio,
    rowChangeRatio,
    reasons,
  };
}

export const snapshotDelta = calculateSnapshotDelta;
export const regressionScore = scoreQueryRegression;
