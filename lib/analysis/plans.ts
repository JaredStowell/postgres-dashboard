import type {
  ExplainDocument,
  PlanDiff,
  PlanMetrics,
  PlanNode,
  PlanNodeDiff,
  PlanNodeMatch,
  PlanWarning,
  VisitedPlanNode,
} from "@/lib/types";
import { redactSql } from "./sql-safety";

export type ExplainInput = ExplainDocument | ExplainDocument[] | unknown;

function numberValue(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function textValue(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

export function normalizeExplainDocument(input: ExplainInput): ExplainDocument {
  const candidate = Array.isArray(input) ? input[0] : input;
  if (!candidate || typeof candidate !== "object") {
    throw new Error(
      "EXPLAIN JSON must be an object or a non-empty result array.",
    );
  }
  const document = candidate as Record<string, unknown>;
  const plan = document.Plan;
  if (
    !plan ||
    typeof plan !== "object" ||
    typeof (plan as PlanNode)["Node Type"] !== "string"
  ) {
    throw new Error("EXPLAIN JSON is missing a valid Plan root node.");
  }
  return document as ExplainDocument;
}

export function traversePlan(input: ExplainInput): VisitedPlanNode[] {
  const document = normalizeExplainDocument(input);
  const visited: VisitedPlanNode[] = [];
  const stack: Array<{
    node: PlanNode;
    path: string;
    parentPath: string | null;
    depth: number;
  }> = [{ node: document.Plan, path: "0", parentPath: null, depth: 0 }];
  while (stack.length > 0) {
    const current = stack.pop()!;
    visited.push({ ...current, ordinal: visited.length });
    const children = Array.isArray(current.node.Plans)
      ? current.node.Plans
      : [];
    for (let index = children.length - 1; index >= 0; index -= 1) {
      const child = children[index];
      if (child && typeof child["Node Type"] === "string") {
        stack.push({
          node: child,
          path: `${current.path}.${index}`,
          parentPath: current.path,
          depth: current.depth + 1,
        });
      }
    }
  }
  return visited;
}

function sumMetric(nodes: VisitedPlanNode[], key: string): number {
  return nodes.reduce(
    (sum, item) => sum + (numberValue(item.node[key]) ?? 0),
    0,
  );
}

function nodeTotalTime(item: VisitedPlanNode): number {
  return (
    (numberValue(item.node["Actual Total Time"]) ?? 0) *
    Math.max(1, numberValue(item.node["Actual Loops"]) ?? 1)
  );
}

export function calculatePlanMetrics(input: ExplainInput): PlanMetrics {
  const document = normalizeExplainDocument(input);
  const nodes = traversePlan(document);
  const root = nodes[0]?.node;
  let dominantNodePath: string | null = null;
  let dominantTime = -1;
  for (const item of nodes) {
    const totalTime = nodeTotalTime(item);
    if (totalTime > dominantTime) {
      dominantTime = totalTime;
      dominantNodePath = item.path;
    }
  }
  return {
    nodeCount: nodes.length,
    maxDepth: nodes.reduce((maximum, item) => Math.max(maximum, item.depth), 0),
    planningTimeMs: numberValue(document["Planning Time"]),
    executionTimeMs: numberValue(document["Execution Time"]),
    totalCost: root ? numberValue(root["Total Cost"]) : null,
    actualTotalTimeMs: root ? numberValue(root["Actual Total Time"]) : null,
    sharedBlocksHit: sumMetric(nodes, "Shared Hit Blocks"),
    sharedBlocksRead: sumMetric(nodes, "Shared Read Blocks"),
    tempBlocksRead: sumMetric(nodes, "Temp Read Blocks"),
    tempBlocksWritten: sumMetric(nodes, "Temp Written Blocks"),
    walRecords: sumMetric(nodes, "WAL Records"),
    dominantNodePath,
  };
}

function estimateRatio(node: PlanNode): number | null {
  const estimated = numberValue(node["Plan Rows"]);
  const actual = numberValue(node["Actual Rows"]);
  if (estimated == null || actual == null) return null;
  if (estimated === 0 && actual === 0) return 1;
  if (estimated === 0 || actual === 0) return Number.POSITIVE_INFINITY;
  return Math.max(actual / estimated, estimated / actual);
}

function warning(
  code: PlanWarning["code"],
  severity: PlanWarning["severity"],
  path: string,
  message: string,
  evidence: PlanWarning["evidence"],
): PlanWarning {
  return { code, severity, path, message, evidence };
}

export interface PlanWarningOptions {
  sequentialScanRows?: number;
  estimateErrorRatio?: number;
  filterRejectionRatio?: number;
  dominantTimeRatio?: number;
}

export function detectPlanWarnings(
  input: ExplainInput,
  options: PlanWarningOptions = {},
): PlanWarning[] {
  const document = normalizeExplainDocument(input);
  const nodes = traversePlan(document);
  const warnings: PlanWarning[] = [];
  const sequentialRows = options.sequentialScanRows ?? 1_000;
  const estimateThreshold = options.estimateErrorRatio ?? 10;
  const rejectionThreshold = options.filterRejectionRatio ?? 0.5;
  const dominantThreshold = options.dominantTimeRatio ?? 0.5;
  const executionTime = numberValue(document["Execution Time"]);

  for (const item of nodes) {
    const node = item.node;
    const nodeType = node["Node Type"];
    const actualRows = numberValue(node["Actual Rows"]) ?? 0;
    const planRows = numberValue(node["Plan Rows"]) ?? 0;
    const loops = Math.max(1, numberValue(node["Actual Loops"]) ?? 1);
    const time = nodeTotalTime(item);
    const relation = textValue(node["Relation Name"]);

    if (
      executionTime &&
      time / executionTime >= dominantThreshold &&
      item.depth > 0
    ) {
      warnings.push(
        warning(
          "dominant_node",
          time / executionTime >= 0.8 ? "high" : "medium",
          item.path,
          `${nodeType} accounts for a dominant share of execution time.`,
          {
            nodeTimeMs: time,
            executionTimeMs: executionTime,
            share: time / executionTime,
          },
        ),
      );
    }
    if (
      nodeType.includes("Seq Scan") &&
      Math.max(actualRows, planRows) >= sequentialRows
    ) {
      warnings.push(
        warning(
          "sequential_scan",
          Math.max(actualRows, planRows) >= 100_000 ? "high" : "medium",
          item.path,
          `Sequential scan reads a substantial ${relation ? `${relation} ` : ""}row set.`,
          {
            relation,
            actualRows,
            planRows,
          },
        ),
      );
    }
    const sortMethod = textValue(node["Sort Method"]);
    const tempBlocks =
      (numberValue(node["Temp Read Blocks"]) ?? 0) +
      (numberValue(node["Temp Written Blocks"]) ?? 0);
    if (
      nodeType.includes("Sort") &&
      ((sortMethod != null && /external|disk/i.test(sortMethod)) ||
        tempBlocks > 0)
    ) {
      warnings.push(
        warning(
          "sort_spill",
          tempBlocks > 1_024 ? "high" : "medium",
          item.path,
          "Sort spilled to temporary storage.",
          { sortMethod, tempBlocks },
        ),
      );
    }
    const innerLoops = Array.isArray(node.Plans)
      ? node.Plans.reduce(
          (maximum, child) =>
            Math.max(maximum, numberValue(child["Actual Loops"]) ?? 1),
          1,
        )
      : 1;
    const loopAmplification =
      Math.max(loops, innerLoops) * Math.max(actualRows, 1);
    if (nodeType === "Nested Loop" && loopAmplification >= 10_000) {
      warnings.push(
        warning(
          "nested_loop_amplification",
          loopAmplification >= 1_000_000 ? "high" : "medium",
          item.path,
          "Nested loop multiplies work across many rows or iterations.",
          {
            actualRows,
            loops,
            innerLoops,
            amplification: loopAmplification,
          },
        ),
      );
    }
    const ratio = estimateRatio(node);
    if (ratio != null && ratio >= estimateThreshold) {
      warnings.push(
        warning(
          "row_estimate_error",
          ratio >= 100 ? "high" : "medium",
          item.path,
          "Planner row estimate differs materially from execution.",
          {
            actualRows,
            planRows,
            errorRatio: ratio,
          },
        ),
      );
    }
    const removed =
      (numberValue(node["Rows Removed by Filter"]) ?? 0) +
      (numberValue(node["Rows Removed by Join Filter"]) ?? 0);
    const examined = removed + actualRows;
    const rejectionRatio = examined > 0 ? removed / examined : 0;
    if (removed > 0 && rejectionRatio >= rejectionThreshold) {
      warnings.push(
        warning(
          "filter_rejection",
          rejectionRatio >= 0.9 ? "high" : "medium",
          item.path,
          "A large share of examined rows is discarded by filters.",
          {
            actualRows,
            rowsRemoved: removed,
            rejectionRatio,
          },
        ),
      );
    }
    const hit = numberValue(node["Shared Hit Blocks"]) ?? 0;
    const read = numberValue(node["Shared Read Blocks"]) ?? 0;
    if (read >= 128 && read > hit) {
      warnings.push(
        warning(
          "buffer_pressure",
          read >= 10_000 ? "high" : "medium",
          item.path,
          "This node reads more shared blocks from storage than from cache.",
          {
            sharedHitBlocks: hit,
            sharedReadBlocks: read,
          },
        ),
      );
    }
    const walRecords = numberValue(node["WAL Records"]) ?? 0;
    if (walRecords > 0) {
      warnings.push(
        warning(
          "wal_activity",
          walRecords >= 10_000 ? "high" : "low",
          item.path,
          "Execution generated WAL; verify this was expected for an analysis run.",
          { walRecords },
        ),
      );
    }
    const plannedWorkers = numberValue(node["Workers Planned"]) ?? 0;
    const launchedWorkers =
      numberValue(node["Workers Launched"]) ?? plannedWorkers;
    if (plannedWorkers > launchedWorkers) {
      warnings.push(
        warning(
          "parallel_shortfall",
          "medium",
          item.path,
          "Fewer parallel workers launched than the plan requested.",
          {
            plannedWorkers,
            launchedWorkers,
          },
        ),
      );
    }
  }
  return warnings;
}

function normalizedIdentity(node: PlanNode): string {
  return [
    node["Node Type"],
    textValue(node["Schema"])?.toLowerCase() ?? "",
    textValue(node["Relation Name"])?.toLowerCase() ?? "",
    textValue(node["Alias"])?.toLowerCase() ?? "",
    textValue(node["Index Name"])?.toLowerCase() ?? "",
    textValue(node["Join Type"])?.toLowerCase() ?? "",
  ].join("|");
}

function relationIdentity(node: PlanNode): string {
  return [
    textValue(node["Schema"])?.toLowerCase() ?? "",
    textValue(node["Relation Name"])?.toLowerCase() ?? "",
    textValue(node["Alias"])?.toLowerCase() ?? "",
  ].join("|");
}

function matchScore(before: VisitedPlanNode, after: VisitedPlanNode): number {
  if (normalizedIdentity(before.node) === normalizedIdentity(after.node)) {
    return before.path === after.path ? 1 : 0.94;
  }
  const beforeRelation = relationIdentity(before.node);
  if (
    beforeRelation !== "||" &&
    beforeRelation === relationIdentity(after.node)
  ) {
    return before.parentPath === after.parentPath ? 0.88 : 0.8;
  }
  if (before.node["Node Type"] === after.node["Node Type"]) {
    if (before.path === after.path) return 0.76;
    if (before.depth === after.depth) return 0.62;
  }
  return 0;
}

export function matchPlanNodes(
  beforeInput: ExplainInput,
  afterInput: ExplainInput,
): PlanNodeMatch[] {
  const before = traversePlan(beforeInput);
  const after = traversePlan(afterInput);
  const candidates: Array<{
    before: VisitedPlanNode;
    after: VisitedPlanNode;
    score: number;
  }> = [];
  for (const left of before) {
    for (const right of after) {
      const score = matchScore(left, right);
      if (score >= 0.6) candidates.push({ before: left, after: right, score });
    }
  }
  candidates.sort(
    (left, right) =>
      right.score - left.score ||
      left.before.ordinal - right.before.ordinal ||
      left.after.ordinal - right.after.ordinal,
  );
  const usedBefore = new Set<string>();
  const usedAfter = new Set<string>();
  const matches: PlanNodeMatch[] = [];
  for (const candidate of candidates) {
    if (
      usedBefore.has(candidate.before.path) ||
      usedAfter.has(candidate.after.path)
    )
      continue;
    usedBefore.add(candidate.before.path);
    usedAfter.add(candidate.after.path);
    matches.push({
      beforePath: candidate.before.path,
      afterPath: candidate.after.path,
      confidence: candidate.score,
      reason:
        candidate.score >= 0.9
          ? "identity"
          : candidate.score >= 0.8
            ? "relation"
            : "structure",
    });
  }
  return matches.sort((left, right) =>
    left.beforePath.localeCompare(right.beforePath, undefined, {
      numeric: true,
    }),
  );
}

function ratioChange(
  before: number | null,
  after: number | null,
): number | null {
  if (before == null || after == null || before === 0) return null;
  return (after - before) / before;
}

function diffMatchedNode(
  beforeItem: VisitedPlanNode,
  afterItem: VisitedPlanNode,
): PlanNodeDiff {
  const beforeTime = numberValue(beforeItem.node["Actual Total Time"]);
  const afterTime = numberValue(afterItem.node["Actual Total Time"]);
  const timeRatio = ratioChange(beforeTime, afterTime);
  const costRatio = ratioChange(
    numberValue(beforeItem.node["Total Cost"]),
    numberValue(afterItem.node["Total Cost"]),
  );
  const rowRatio = ratioChange(
    numberValue(beforeItem.node["Plan Rows"]),
    numberValue(afterItem.node["Plan Rows"]),
  );
  const changes: string[] = [];
  if (beforeItem.node["Node Type"] !== afterItem.node["Node Type"]) {
    changes.push(
      `Node changed from ${beforeItem.node["Node Type"]} to ${afterItem.node["Node Type"]}.`,
    );
  }
  if (timeRatio != null && Math.abs(timeRatio) >= 0.2) {
    changes.push(
      `Actual time ${timeRatio > 0 ? "increased" : "decreased"} by ${Math.round(Math.abs(timeRatio) * 100)}%.`,
    );
  }
  if (costRatio != null && Math.abs(costRatio) >= 0.2) {
    changes.push(`Estimated cost changed by ${Math.round(costRatio * 100)}%.`);
  }
  if (rowRatio != null && Math.abs(rowRatio) >= 0.5) {
    changes.push(`Estimated rows changed by ${Math.round(rowRatio * 100)}%.`);
  }
  return {
    status: changes.length > 0 ? "changed" : "unchanged",
    beforePath: beforeItem.path,
    afterPath: afterItem.path,
    nodeTypeBefore: beforeItem.node["Node Type"],
    nodeTypeAfter: afterItem.node["Node Type"],
    actualTimeChangeMs:
      beforeTime == null || afterTime == null ? null : afterTime - beforeTime,
    actualTimeChangeRatio: timeRatio,
    costChangeRatio: costRatio,
    rowEstimateChangeRatio: rowRatio,
    materialChanges: changes,
  };
}

export function diffPlans(
  beforeInput: ExplainInput,
  afterInput: ExplainInput,
): PlanDiff {
  const beforeDocument = normalizeExplainDocument(beforeInput);
  const afterDocument = normalizeExplainDocument(afterInput);
  const before = traversePlan(beforeDocument);
  const after = traversePlan(afterDocument);
  const matches = matchPlanNodes(beforeDocument, afterDocument);
  const beforeByPath = new Map(before.map((item) => [item.path, item]));
  const afterByPath = new Map(after.map((item) => [item.path, item]));
  const matchedBefore = new Set(matches.map((match) => match.beforePath));
  const matchedAfter = new Set(matches.map((match) => match.afterPath));
  const nodes: PlanNodeDiff[] = matches.map((match) =>
    diffMatchedNode(
      beforeByPath.get(match.beforePath)!,
      afterByPath.get(match.afterPath)!,
    ),
  );
  for (const item of before) {
    if (!matchedBefore.has(item.path)) {
      nodes.push({
        status: "removed",
        beforePath: item.path,
        afterPath: null,
        nodeTypeBefore: item.node["Node Type"],
        nodeTypeAfter: null,
        actualTimeChangeMs: null,
        actualTimeChangeRatio: null,
        costChangeRatio: null,
        rowEstimateChangeRatio: null,
        materialChanges: [`${item.node["Node Type"]} was removed.`],
      });
    }
  }
  for (const item of after) {
    if (!matchedAfter.has(item.path)) {
      nodes.push({
        status: "added",
        beforePath: null,
        afterPath: item.path,
        nodeTypeBefore: null,
        nodeTypeAfter: item.node["Node Type"],
        actualTimeChangeMs: null,
        actualTimeChangeRatio: null,
        costChangeRatio: null,
        rowEstimateChangeRatio: null,
        materialChanges: [`${item.node["Node Type"]} was added.`],
      });
    }
  }
  const beforeExecution = numberValue(beforeDocument["Execution Time"]);
  const afterExecution = numberValue(afterDocument["Execution Time"]);
  const executionRatio = ratioChange(beforeExecution, afterExecution);
  const summary: string[] = [];
  if (executionRatio != null && Math.abs(executionRatio) >= 0.05) {
    summary.push(
      `Execution time ${executionRatio > 0 ? "increased" : "decreased"} by ${Math.round(Math.abs(executionRatio) * 100)}%.`,
    );
  }
  const changed = nodes.filter((node) => node.status === "changed").length;
  const added = nodes.filter((node) => node.status === "added").length;
  const removed = nodes.filter((node) => node.status === "removed").length;
  if (changed || added || removed)
    summary.push(
      `${changed} changed, ${added} added, and ${removed} removed plan nodes.`,
    );
  return {
    matches,
    nodes,
    executionTimeChangeMs:
      beforeExecution == null || afterExecution == null
        ? null
        : afterExecution - beforeExecution,
    executionTimeChangeRatio: executionRatio,
    summary,
  };
}

const sensitiveKeys =
  /query text|sql|statement|parameters?|connection|string|password|secret|token/i;
const expressionKeys =
  /filter|condition|cond$|sort key|group key|hash key|output|function call/i;

function sanitizeValue(
  value: unknown,
  key = "",
  seen = new WeakSet<object>(),
): unknown {
  if (sensitiveKeys.test(key)) return "[REDACTED]";
  if (typeof value === "string")
    return expressionKeys.test(key) ? redactSql(value) : value;
  if (Array.isArray(value))
    return value.map((item) => sanitizeValue(item, key, seen));
  if (value && typeof value === "object") {
    if (seen.has(value)) return "[CIRCULAR]";
    seen.add(value);
    const output: Record<string, unknown> = {};
    for (const [childKey, childValue] of Object.entries(value)) {
      output[childKey] = sanitizeValue(childValue, childKey, seen);
    }
    seen.delete(value);
    return output;
  }
  return value;
}

export function sanitizeExplainPlan(input: ExplainInput): ExplainDocument {
  return sanitizeValue(normalizeExplainDocument(input)) as ExplainDocument;
}

export interface PlanReport {
  title?: string;
  query?: string;
  generatedAt?: string;
  plan: ExplainInput;
}

export function exportPlanJson(report: PlanReport): string {
  return JSON.stringify(
    {
      title: report.title ?? "Sanitized query plan",
      generatedAt: report.generatedAt ?? new Date().toISOString(),
      query: report.query ? redactSql(report.query) : undefined,
      metrics: calculatePlanMetrics(report.plan),
      warnings: detectPlanWarnings(report.plan),
      plan: sanitizeExplainPlan(report.plan),
    },
    null,
    2,
  );
}

function escapeMarkdown(value: string): string {
  return value
    .replaceAll("\\", "\\\\")
    .replaceAll("`", "\\`")
    .replaceAll("|", "\\|");
}

export function exportPlanMarkdown(report: PlanReport): string {
  const title = escapeMarkdown(report.title ?? "Sanitized query plan");
  const metrics = calculatePlanMetrics(report.plan);
  const warnings = detectPlanWarnings(report.plan);
  const lines = [
    `# ${title}`,
    "",
    `Generated: ${report.generatedAt ?? new Date().toISOString()}`,
    "",
    `- Execution time: ${metrics.executionTimeMs == null ? "not measured" : `${metrics.executionTimeMs} ms`}`,
    `- Planning time: ${metrics.planningTimeMs == null ? "not measured" : `${metrics.planningTimeMs} ms`}`,
    `- Plan nodes: ${metrics.nodeCount}`,
    "",
  ];
  if (report.query) {
    lines.push("## Query", "", "```sql", redactSql(report.query), "```", "");
  }
  lines.push("## Warnings", "");
  if (warnings.length === 0)
    lines.push("No material plan warnings detected.", "");
  else {
    for (const item of warnings) {
      lines.push(
        `- **${item.severity.toUpperCase()}** \`${item.code}\` at \`${item.path}\`: ${escapeMarkdown(item.message)}`,
      );
    }
    lines.push("");
  }
  lines.push(
    "## Sanitized plan",
    "",
    "```json",
    JSON.stringify(sanitizeExplainPlan(report.plan), null, 2),
    "```",
    "",
  );
  return lines.join("\n");
}

export const planMetrics = calculatePlanMetrics;
export const planWarnings = detectPlanWarnings;
export const planDiff = diffPlans;
