import type { MaintenanceInput, MaintenanceScore, Severity } from "@/lib/types";

function clamp(value: number): number {
  return Math.max(
    0,
    Math.min(100, Math.round(Number.isFinite(value) ? value : 0)),
  );
}

function ageInDays(
  value: Date | string | null | undefined,
  now: Date,
): number | null {
  if (value == null) return null;
  const time = value instanceof Date ? value.getTime() : Date.parse(value);
  if (!Number.isFinite(time)) return null;
  return Math.max(0, (now.getTime() - time) / 86_400_000);
}

function severityForScore(score: number): Severity {
  return score >= 85
    ? "critical"
    : score >= 65
      ? "high"
      : score >= 40
        ? "medium"
        : score >= 20
          ? "low"
          : "info";
}

export function effectiveFreezeMaxAge(
  relationOptions: readonly string[],
  fallback: number,
): number {
  const configured = relationOptions
    .find((option) => option.startsWith("autovacuum_freeze_max_age="))
    ?.split("=", 2)[1];
  const value = Number(configured);
  return Number.isSafeInteger(value) && value > 0 ? value : fallback;
}

export function calculateMaintenanceScore(
  input: MaintenanceInput,
  now = new Date(),
): MaintenanceScore {
  const liveRows = Math.max(0, input.liveRows);
  const deadRows = Math.max(0, input.deadRows);
  const totalRows = liveRows + deadRows;
  const deadRatio = totalRows > 0 ? deadRows / totalRows : 0;
  const modificationRatio =
    Math.max(0, input.modificationsSinceAnalyze) / Math.max(1, liveRows);
  const vacuumAge = ageInDays(input.lastVacuumAt, now);
  const analyzeAge = ageInDays(input.lastAnalyzeAt, now);
  const freezeRatio =
    input.freezeMaxAge && input.freezeMaxAge > 0
      ? Math.max(0, input.transactionAge ?? 0) / input.freezeMaxAge
      : 0;
  const sizeFactor = Math.min(
    1,
    Math.log10(Math.max(1, input.tableBytes ?? 0)) / 12,
  );

  let vacuumUrgency = clamp(
    deadRatio * 150 + (vacuumAge == null ? 10 : Math.min(30, vacuumAge)),
  );
  if (input.autovacuumEnabled === false)
    vacuumUrgency = Math.max(vacuumUrgency, 75);
  const analyzeStaleness = clamp(
    modificationRatio * 180 +
      (analyzeAge == null ? 15 : Math.min(35, analyzeAge * 1.5)),
  );
  const freezeRisk = clamp(
    freezeRatio <= 0.5
      ? freezeRatio * 40
      : 20 + ((freezeRatio - 0.5) / 0.5) * 80,
  );
  const bloatRisk = clamp(deadRatio * 120 * (0.65 + sizeFactor * 0.35));
  const overall = clamp(
    Math.max(vacuumUrgency, analyzeStaleness, freezeRisk) * 0.65 +
      ((vacuumUrgency + analyzeStaleness + freezeRisk + bloatRisk) / 4) * 0.35,
  );
  const reasons: string[] = [];
  if (deadRatio >= 0.1)
    reasons.push(
      `${Math.round(deadRatio * 100)}% of estimated tuples are dead.`,
    );
  if (modificationRatio >= 0.1)
    reasons.push(
      `${Math.round(modificationRatio * 100)}% of live-row count changed since analyze.`,
    );
  if (freezeRatio >= 0.75)
    reasons.push(
      `Transaction age is ${Math.round(freezeRatio * 100)}% of freeze_max_age.`,
    );
  if (input.autovacuumEnabled === false)
    reasons.push("Autovacuum is disabled for this table.");
  if (vacuumAge == null) reasons.push("No vacuum timestamp is available.");
  if (analyzeAge == null) reasons.push("No analyze timestamp is available.");
  if (reasons.length === 0)
    reasons.push(
      "No material maintenance risk is visible in the supplied statistics.",
    );
  return {
    overall,
    vacuumUrgency,
    analyzeStaleness,
    freezeRisk,
    bloatRisk,
    severity: severityForScore(overall),
    reasons,
  };
}

export const maintenanceScore = calculateMaintenanceScore;
