import type {
  CapabilityFeature,
  CapabilitySnapshot,
  CapabilityStatus,
} from "@/lib/types";

function includes(values: string[], value: string): boolean {
  return values.some(
    (candidate) => candidate.toLowerCase() === value.toLowerCase(),
  );
}

function status(
  feature: CapabilityFeature,
  available: boolean,
  reason: string | null,
  degraded = false,
): CapabilityStatus {
  return { feature, available, degraded, reason };
}

export function evaluateCapabilities(
  snapshot: CapabilitySnapshot,
): CapabilityStatus[] {
  const extensions = snapshot.extensions ?? [];
  const views = snapshot.views ?? [];
  const privileges = snapshot.privileges ?? [];
  const settings = snapshot.settings ?? {};
  const hasStats =
    includes(extensions, "pg_stat_statements") &&
    includes(views, "pg_stat_statements");
  const readsAllStats =
    includes(privileges, "pg_read_all_stats") ||
    includes(privileges, "superuser");
  const trackWal = snapshot.serverVersionNum >= 130000;
  const jitEnabled = settings.jit === true || settings.jit === "on";
  return [
    status(
      "query_stats",
      hasStats,
      hasStats ? null : "pg_stat_statements is not enabled or visible.",
    ),
    status(
      "query_text_all_roles",
      hasStats,
      !hasStats
        ? "Query statistics are unavailable."
        : readsAllStats
          ? null
          : "pg_read_all_stats is required to see query text for other roles.",
      hasStats && !readsAllStats,
    ),
    status(
      "exact_bloat",
      includes(extensions, "pgstattuple"),
      includes(extensions, "pgstattuple")
        ? null
        : "Install pgstattuple for exact, explicitly invoked bloat checks.",
    ),
    status(
      "hypothetical_indexes",
      includes(extensions, "hypopg"),
      includes(extensions, "hypopg")
        ? null
        : "Install HypoPG to simulate hypothetical indexes.",
    ),
    status(
      "live_activity",
      includes(views, "pg_stat_activity"),
      includes(views, "pg_stat_activity")
        ? null
        : "pg_stat_activity is not visible.",
    ),
    status(
      "vacuum_progress",
      snapshot.serverVersionNum >= 120000 &&
        includes(views, "pg_stat_progress_vacuum"),
      snapshot.serverVersionNum < 120000
        ? "PostgreSQL 12 or newer is required."
        : includes(views, "pg_stat_progress_vacuum")
          ? null
          : "pg_stat_progress_vacuum is not visible.",
    ),
    status(
      "explain_settings",
      snapshot.serverVersionNum >= 120000,
      snapshot.serverVersionNum >= 120000
        ? null
        : "EXPLAIN SETTINGS requires PostgreSQL 12 or newer.",
    ),
    status(
      "wal_metrics",
      trackWal,
      trackWal ? null : "WAL plan metrics require PostgreSQL 13 or newer.",
    ),
    status(
      "jit_metrics",
      snapshot.serverVersionNum >= 110000 && jitEnabled,
      snapshot.serverVersionNum < 110000
        ? "JIT reporting requires PostgreSQL 11 or newer."
        : jitEnabled
          ? null
          : "JIT is disabled.",
      snapshot.serverVersionNum >= 110000 && !jitEnabled,
    ),
  ];
}

export function capabilityFor(
  snapshot: CapabilitySnapshot,
  feature: CapabilityFeature,
): CapabilityStatus {
  return evaluateCapabilities(snapshot).find(
    (item) => item.feature === feature,
  )!;
}

export function availableFeatures(
  snapshot: CapabilitySnapshot,
): CapabilityFeature[] {
  return evaluateCapabilities(snapshot)
    .filter((item) => item.available && !item.degraded)
    .map((item) => item.feature);
}

export const capabilityMatrix = evaluateCapabilities;
