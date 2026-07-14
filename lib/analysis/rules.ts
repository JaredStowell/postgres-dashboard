export type FindingSeverity =
  "info" | "low" | "medium" | "warning" | "high" | "critical";

export interface AlertRule {
  ruleKey: string;
  enabled: boolean;
  severity: FindingSeverity;
  configuration: Readonly<Record<string, unknown>>;
}

export type AlertRuleRegistry = ReadonlyMap<string, AlertRule>;

export function ruleIsEnabled(
  rules: AlertRuleRegistry,
  ruleKey: string,
): boolean {
  return rules.get(ruleKey)?.enabled ?? false;
}

export function ruleSeverity(
  rules: AlertRuleRegistry,
  ruleKey: string,
  fallback: FindingSeverity,
): FindingSeverity {
  return rules.get(ruleKey)?.severity ?? fallback;
}

export function ruleNumber(
  rules: AlertRuleRegistry,
  ruleKey: string,
  key: string,
  fallback: number,
  bounds: { min: number; max: number },
): number {
  const configured = rules.get(ruleKey)?.configuration[key];
  const value =
    typeof configured === "number"
      ? configured
      : typeof configured === "string" && configured.trim() !== ""
        ? Number(configured)
        : Number.NaN;
  return Number.isFinite(value) && value >= bounds.min && value <= bounds.max
    ? value
    : fallback;
}

export function moreSevere(
  configured: FindingSeverity,
  elevated: FindingSeverity,
): FindingSeverity {
  const rank: Record<FindingSeverity, number> = {
    info: 0,
    low: 1,
    medium: 2,
    warning: 3,
    high: 4,
    critical: 5,
  };
  return rank[elevated] > rank[configured] ? elevated : configured;
}
