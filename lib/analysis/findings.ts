import type { FindingLike, Severity } from "@/lib/types";

function canonicalize(value: unknown, seen = new WeakSet<object>()): unknown {
  if (value == null || typeof value === "string" || typeof value === "boolean")
    return value;
  if (typeof value === "number")
    return Number.isFinite(value) ? value : String(value);
  if (typeof value === "bigint") return value.toString();
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value))
    return value.map((item) => canonicalize(item, seen));
  if (typeof value === "object") {
    if (seen.has(value))
      throw new Error("Finding identity cannot contain circular data.");
    seen.add(value);
    const record = value as Record<string, unknown>;
    const output: Record<string, unknown> = {};
    for (const key of Object.keys(record).sort())
      output[key] = canonicalize(record[key], seen);
    seen.delete(value);
    return output;
  }
  return String(value);
}

function fnv1a(value: string, seed: number): number {
  let hash = seed >>> 0;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash;
}

export function stableFindingFingerprint(
  finding: Pick<
    FindingLike,
    "sourceKey" | "database" | "rule" | "resourceType" | "resourceKey"
  > & {
    identity?: unknown;
  },
): string {
  const canonical = JSON.stringify(
    canonicalize({
      sourceKey: finding.sourceKey,
      database: finding.database,
      rule: finding.rule,
      resourceType: finding.resourceType,
      resourceKey: finding.resourceKey,
      identity: finding.identity ?? null,
    }),
  );
  const first = fnv1a(canonical, 0x811c9dc5);
  const second = fnv1a(canonical, 0x9e3779b9);
  return `v1_${first.toString(16).padStart(8, "0")}${second.toString(16).padStart(8, "0")}`;
}

const severityRank: Record<Severity, number> = {
  info: 0,
  low: 1,
  medium: 2,
  high: 3,
  critical: 4,
};

function later(
  left: Date | string | undefined,
  right: Date | string | undefined,
): Date | string | undefined {
  if (left == null) return right;
  if (right == null) return left;
  return new Date(left).getTime() >= new Date(right).getTime() ? left : right;
}

function earlier(
  left: Date | string | undefined,
  right: Date | string | undefined,
): Date | string | undefined {
  if (left == null) return right;
  if (right == null) return left;
  return new Date(left).getTime() <= new Date(right).getTime() ? left : right;
}

export interface DeduplicatedFinding extends FindingLike {
  fingerprint: string;
}

export function deduplicateFindings(
  findings: FindingLike[],
): DeduplicatedFinding[] {
  const deduplicated = new Map<string, DeduplicatedFinding>();
  for (const finding of findings) {
    const fingerprint = stableFindingFingerprint(finding);
    const existing = deduplicated.get(fingerprint);
    if (!existing) {
      deduplicated.set(fingerprint, {
        ...finding,
        fingerprint,
        occurrenceCount: finding.occurrenceCount ?? 1,
      });
      continue;
    }
    const existingSeverity = existing.severity ?? "info";
    const incomingSeverity = finding.severity ?? "info";
    deduplicated.set(fingerprint, {
      ...existing,
      severity:
        severityRank[incomingSeverity] > severityRank[existingSeverity]
          ? incomingSeverity
          : existingSeverity,
      evidence: finding.evidence ?? existing.evidence,
      firstSeenAt: earlier(existing.firstSeenAt, finding.firstSeenAt),
      lastSeenAt: later(existing.lastSeenAt, finding.lastSeenAt),
      occurrenceCount:
        (existing.occurrenceCount ?? 1) + (finding.occurrenceCount ?? 1),
    });
  }
  return [...deduplicated.values()].sort((left, right) =>
    left.fingerprint.localeCompare(right.fingerprint),
  );
}

export const findingFingerprint = stableFindingFingerprint;
