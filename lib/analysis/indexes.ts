import type { ExplainInput } from "./plans";
import { traversePlan } from "./plans";
import type {
  IndexOverlap,
  IndexRecord,
  MissingIndexCandidate,
  MissingIndexEvidence,
  PlanNode,
  WriteCostInput,
  WriteCostSignal,
} from "@/lib/types";

function normalized(value: string | null | undefined): string {
  return (value ?? "").replace(/\s+/g, " ").trim().toLowerCase();
}

function normalizedColumns(columns: string[] | undefined): string[] {
  return (columns ?? []).map(normalized);
}

function sameArray(left: string[], right: string[]): boolean {
  return (
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  );
}

function sameTable(left: IndexRecord, right: IndexRecord): boolean {
  return (
    normalized(left.schema) === normalized(right.schema) &&
    normalized(left.table) === normalized(right.table)
  );
}

function comparable(left: IndexRecord, right: IndexRecord): boolean {
  return (
    sameTable(left, right) &&
    normalized(left.method) === normalized(right.method) &&
    normalized(left.predicate) === normalized(right.predicate) &&
    sameArray(
      normalizedColumns(left.expressions),
      normalizedColumns(right.expressions),
    )
  );
}

function preferredDuplicate(
  left: IndexRecord,
  right: IndexRecord,
): [IndexRecord, IndexRecord] {
  const leftProtected = left.primary === true || left.constraintBacked === true;
  const rightProtected =
    right.primary === true || right.constraintBacked === true;
  if (leftProtected !== rightProtected)
    return leftProtected ? [right, left] : [left, right];
  if (left.valid !== false && right.valid === false) return [right, left];
  if (right.valid !== false && left.valid === false) return [left, right];
  const leftScans = left.scans ?? 0;
  const rightScans = right.scans ?? 0;
  if (leftScans !== rightScans)
    return leftScans < rightScans ? [left, right] : [right, left];
  const leftSize = left.sizeBytes ?? 0;
  const rightSize = right.sizeBytes ?? 0;
  if (leftSize !== rightSize)
    return leftSize > rightSize ? [left, right] : [right, left];
  return left.id.localeCompare(right.id) <= 0 ? [right, left] : [left, right];
}

export function analyzeIndexOverlaps(indexes: IndexRecord[]): IndexOverlap[] {
  const overlaps: IndexOverlap[] = [];
  for (let leftIndex = 0; leftIndex < indexes.length; leftIndex += 1) {
    const left = indexes[leftIndex]!;
    for (
      let rightIndex = leftIndex + 1;
      rightIndex < indexes.length;
      rightIndex += 1
    ) {
      const right = indexes[rightIndex]!;
      if (!comparable(left, right)) continue;
      const leftKeys = normalizedColumns(left.keyColumns);
      const rightKeys = normalizedColumns(right.keyColumns);
      const leftInclude = [...normalizedColumns(left.includeColumns)].sort();
      const rightInclude = [...normalizedColumns(right.includeColumns)].sort();
      if (
        sameArray(leftKeys, rightKeys) &&
        sameArray(leftInclude, rightInclude) &&
        Boolean(left.unique) === Boolean(right.unique)
      ) {
        // Separate constraints can have the same physical definition without
        // either being safely redundant at the schema level.
        if (left.constraintBacked && right.constraintBacked) continue;
        const [redundant, covering] = preferredDuplicate(left, right);
        overlaps.push({
          kind: "duplicate",
          redundantId: redundant.id,
          coveringId: covering.id,
          confidence: 1,
          reason:
            "Indexes have the same table, method, keys, included columns, predicate, expressions, and uniqueness; protected primary/constraint indexes are retained.",
        });
        continue;
      }
      if (normalized(left.method) !== "btree") continue;
      let shorter: IndexRecord;
      let longer: IndexRecord;
      let shorterKeys: string[];
      let longerKeys: string[];
      if (leftKeys.length < rightKeys.length) {
        [shorter, longer, shorterKeys, longerKeys] = [
          left,
          right,
          leftKeys,
          rightKeys,
        ];
      } else if (rightKeys.length < leftKeys.length) {
        [shorter, longer, shorterKeys, longerKeys] = [
          right,
          left,
          rightKeys,
          leftKeys,
        ];
      } else continue;
      const isPrefix = shorterKeys.every(
        (key, index) => key === longerKeys[index],
      );
      if (!isPrefix) continue;
      if (shorter.primary || shorter.constraintBacked) continue;
      // A longer non-unique index cannot preserve a shorter unique constraint.
      if (shorter.unique && !longer.unique) continue;
      const longerCoverage = new Set([
        ...longerKeys,
        ...normalizedColumns(longer.includeColumns),
      ]);
      const includesCovered = normalizedColumns(shorter.includeColumns).every(
        (column) => longerCoverage.has(column),
      );
      if (!includesCovered) continue;
      overlaps.push({
        kind: "prefix",
        redundantId: shorter.id,
        coveringId: longer.id,
        confidence: shorter.unique === longer.unique ? 0.9 : 0.82,
        reason: `The ${longerKeys.length}-column btree begins with all ${shorterKeys.length} key columns and covers included columns. Validate ordering and workload before removal.`,
      });
    }
  }
  return overlaps.sort(
    (left, right) =>
      left.redundantId.localeCompare(right.redundantId) ||
      left.coveringId.localeCompare(right.coveringId),
  );
}

export function calculateWriteCostSignal(
  input: WriteCostInput,
): WriteCostSignal {
  const inserts = Math.max(0, input.inserts);
  const updates = Math.max(0, input.updates);
  const deletes = Math.max(0, input.deletes);
  const hotUpdates = Math.min(updates, Math.max(0, input.hotUpdates ?? 0));
  const nonHotUpdates = updates - hotUpdates;
  const mutations = inserts + deletes + nonHotUpdates;
  const indexCount = Math.max(0, input.indexCount);
  const indexToTableRatio =
    input.tableBytes && input.tableBytes > 0
      ? Math.max(0, input.totalIndexBytes) / input.tableBytes
      : 0;
  const mutationFactor = Math.min(1, Math.log10(mutations + 1) / 7);
  const countFactor = Math.min(1, indexCount / 12);
  const sizeFactor = Math.min(1, Math.log2(indexToTableRatio + 1) / 3);
  const score = Math.round(
    Math.min(
      100,
      100 * (mutationFactor * 0.45 + countFactor * 0.35 + sizeFactor * 0.2),
    ),
  );
  const amplification = mutations * indexCount;
  const reasons: string[] = [];
  if (indexCount >= 8)
    reasons.push(`${indexCount} indexes amplify writes to this table.`);
  if (nonHotUpdates > 0)
    reasons.push(
      `${nonHotUpdates} non-HOT updates may require index maintenance.`,
    );
  if (indexToTableRatio >= 1)
    reasons.push(
      `Index bytes are ${indexToTableRatio.toFixed(1)}x the table size.`,
    );
  if (reasons.length === 0)
    reasons.push("Observed index write amplification is limited.");
  return {
    score,
    level:
      score >= 80
        ? "extreme"
        : score >= 60
          ? "high"
          : score >= 30
            ? "moderate"
            : "low",
    mutations,
    nonHotUpdates,
    amplification,
    reasons,
  };
}

function extractColumns(expression: string, aliases: string[]): string[] {
  const columns = new Set<string>();
  const aliasPattern = aliases
    .filter(Boolean)
    .map((alias) => alias.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join("|");
  if (aliasPattern) {
    const qualified = new RegExp(
      `(?:${aliasPattern})\\s*\\.\\s*(?:"([^"]+)"|([A-Za-z_][A-Za-z0-9_$]*))`,
      "gi",
    );
    for (const match of expression.matchAll(qualified))
      columns.add(normalized(match[1] ?? match[2]));
  }
  // Unqualified columns are used only for simple column/operator/value filters.
  const simple =
    /(?:^|\(|\bAND\b|\bOR\b)\s*(?:"([^"]+)"|([A-Za-z_][A-Za-z0-9_$]*))\s*(?:=|<|>|<=|>=|<>|!=|\bIN\b|\bLIKE\b|\bIS\b)/gi;
  const keywords = new Set(["and", "or", "not", "null", "true", "false"]);
  for (const match of expression.matchAll(simple)) {
    const column = normalized(match[1] ?? match[2]);
    if (column && !keywords.has(column)) columns.add(column);
  }
  return [...columns].filter(Boolean).slice(0, 8);
}

function nodeNumber(node: PlanNode, key: string): number {
  const value = node[key];
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

export function deriveMissingIndexEvidence(
  input: ExplainInput,
): MissingIndexEvidence[] {
  const byRelation = new Map<string, MissingIndexEvidence>();
  for (const item of traversePlan(input)) {
    const node = item.node;
    if (!node["Node Type"].includes("Seq Scan")) continue;
    const table =
      typeof node["Relation Name"] === "string" ? node["Relation Name"] : null;
    if (!table) continue;
    const schema = typeof node.Schema === "string" ? node.Schema : null;
    const alias = typeof node.Alias === "string" ? node.Alias : table;
    const expressions = [
      node.Filter,
      node["Join Filter"],
      node["Hash Cond"],
    ].filter((value): value is string => typeof value === "string");
    const columns = [
      ...new Set(
        expressions.flatMap((expression) =>
          extractColumns(expression, [alias, table]),
        ),
      ),
    ];
    if (columns.length === 0) continue;
    const actualRows =
      nodeNumber(node, "Actual Rows") *
      Math.max(1, nodeNumber(node, "Actual Loops"));
    const estimatedRows = nodeNumber(node, "Plan Rows");
    const removed =
      nodeNumber(node, "Rows Removed by Filter") +
      nodeNumber(node, "Rows Removed by Join Filter");
    if (Math.max(actualRows + removed, estimatedRows) < 100) continue;
    const key = `${normalized(schema)}.${normalized(table)}:${columns.sort().join(",")}`;
    const existing = byRelation.get(key) ?? {
      schema,
      table,
      columns,
      paths: [],
      estimatedRows: 0,
      actualRows: 0,
      rowsRemovedByFilter: 0,
      score: 0,
      evidence: [],
    };
    existing.paths.push(item.path);
    existing.estimatedRows += estimatedRows;
    existing.actualRows += actualRows;
    existing.rowsRemovedByFilter += removed;
    const examined = actualRows + removed;
    const rejection = examined > 0 ? removed / examined : 0;
    existing.score = Math.min(
      100,
      Math.round(
        Math.max(
          existing.score,
          Math.log10(Math.max(100, actualRows + removed, estimatedRows)) * 14 +
            rejection * 35,
        ),
      ),
    );
    existing.evidence.push(
      `${node["Node Type"]} at ${item.path} filters on ${columns.join(", ")} across ${Math.round(Math.max(examined, estimatedRows))} rows.`,
    );
    byRelation.set(key, existing);
  }
  return [...byRelation.values()].sort(
    (left, right) => right.score - left.score,
  );
}

export interface MissingIndexCandidateOptions {
  minimumScore?: number;
  minimumRows?: number;
}

function simpleIndexColumn(column: string): string {
  return normalized(column)
    .replace(/\s+(asc|desc)(\s+nulls\s+(first|last))?$/i, "")
    .replace(/\s+nulls\s+(first|last)$/i, "")
    .replace(/^"|"$/g, "");
}

function indexCoversEvidence(
  evidence: MissingIndexEvidence,
  index: IndexRecord,
): boolean {
  if (
    evidence.schema === null ||
    normalized(evidence.schema) !== normalized(index.schema) ||
    normalized(evidence.table) !== normalized(index.table) ||
    normalized(index.method) !== "btree" ||
    index.valid === false ||
    index.ready === false ||
    normalized(index.predicate) !== ""
  )
    return false;
  const wanted = new Set(evidence.columns.map(simpleIndexColumn));
  const leadingKeys = normalizedColumns(index.keyColumns)
    .slice(0, wanted.size)
    .map(simpleIndexColumn);
  return (
    leadingKeys.length === wanted.size &&
    leadingKeys.every((column) => wanted.has(column))
  );
}

export function deriveMissingIndexCandidates(
  input: ExplainInput,
  indexes: readonly IndexRecord[],
  options: MissingIndexCandidateOptions = {},
): MissingIndexCandidate[] {
  const minimumScore = Math.max(0, Math.min(100, options.minimumScore ?? 55));
  const minimumRows = Math.max(100, options.minimumRows ?? 1_000);
  return deriveMissingIndexEvidence(input)
    .filter(
      (evidence) =>
        evidence.score >= minimumScore &&
        Math.max(
          evidence.estimatedRows,
          evidence.actualRows + evidence.rowsRemovedByFilter,
        ) >= minimumRows &&
        !indexes.some((index) => indexCoversEvidence(evidence, index)),
    )
    .map((evidence) => ({
      ...evidence,
      confidence: evidence.score >= 75 ? "high" : "medium",
      recommendation: `Consider a btree index beginning with (${evidence.columns.join(", ")}) on ${evidence.schema ? `${evidence.schema}.` : ""}${evidence.table}; verify with a hypothetical or real EXPLAIN before creation.`,
    }));
}

export const findDuplicateIndexes = analyzeIndexOverlaps;
export const writeCostSignal = calculateWriteCostSignal;
export const missingIndexEvidence = deriveMissingIndexEvidence;
