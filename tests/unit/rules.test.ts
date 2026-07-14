import {
  moreSevere,
  ruleIsEnabled,
  ruleNumber,
  ruleSeverity,
  type AlertRule,
} from "@/lib/analysis/rules";
import { describe, expect, it } from "vitest";

function rules(...items: AlertRule[]): Map<string, AlertRule> {
  return new Map(items.map((item) => [item.ruleKey, item]));
}

describe("collector rule configuration", () => {
  const configured = rules({
    ruleKey: "dead-tuples",
    enabled: true,
    severity: "medium",
    configuration: { ratio: 0.37, minimum: "4200", invalid: "nope" },
  });

  it("honors enabled state, configured severity, and numeric JSON values", () => {
    expect(ruleIsEnabled(configured, "dead-tuples")).toBe(true);
    expect(ruleIsEnabled(configured, "absent")).toBe(false);
    expect(ruleSeverity(configured, "dead-tuples", "warning")).toBe("medium");
    expect(
      ruleNumber(configured, "dead-tuples", "ratio", 0.2, { min: 0, max: 1 }),
    ).toBe(0.37);
    expect(
      ruleNumber(configured, "dead-tuples", "minimum", 1000, {
        min: 0,
        max: 10_000,
      }),
    ).toBe(4200);
  });

  it("falls back for malformed, missing, or out-of-range thresholds", () => {
    expect(
      ruleNumber(configured, "dead-tuples", "invalid", 12, {
        min: 0,
        max: 100,
      }),
    ).toBe(12);
    expect(
      ruleNumber(configured, "dead-tuples", "ratio", 0.2, { min: 0.5, max: 1 }),
    ).toBe(0.2);
    expect(
      ruleNumber(configured, "absent", "ratio", 0.2, { min: 0, max: 1 }),
    ).toBe(0.2);
  });

  it("elevates severity without weakening configured policy", () => {
    expect(moreSevere("warning", "critical")).toBe("critical");
    expect(moreSevere("critical", "warning")).toBe("critical");
  });
});
