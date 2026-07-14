import { redactSql } from "@/lib/analysis/sql-safety";
import type { AiPayloadInput } from "@/lib/ai/payload";
import { detectCapabilities } from "@/lib/db/capabilities";
import {
  getAdvisorExplainRun,
  getAdvisorFinding,
  getAdvisorIndexContexts,
  getAdvisorSettings,
  getAdvisorTableContexts,
  listRecentAdvisorExplainRuns,
  type AdvisorExplainEvidence,
  type QualifiedRelation,
} from "@/lib/db/advisor-evidence";
import { listQueryHistory, listRegisteredDatabases } from "@/lib/db/history";
import { getQueryStat, type QueryStat } from "@/lib/db/workload";
import { ApiError } from "@/lib/http/api";

import { getControlDatabase, getTargetContext } from "./context";

export interface AdvisorEvidenceSelection {
  source?: string;
  queryId?: string;
  findingId?: number;
  planId?: string;
  relation?: QualifiedRelation;
  index?: string;
}

export interface AdvisorEvidenceResult {
  ready: boolean;
  source: { key: string; label: string; database: string };
  sourceDatabaseId: number | null;
  selection: {
    queryId?: string;
    findingId?: number;
    planId?: string;
    relation?: string;
    index?: string;
  };
  evidence: {
    queryOrigin: "live" | "history" | "plan" | null;
    historySamples: number;
    planMatch: "explicit" | "query-shape" | null;
    tables: string[];
    indexes: number;
    settings: number;
  };
  omissions: string[];
  input: AiPayloadInput & {
    mode: "balanced";
    source?: string;
    sourceDatabaseId?: number;
    explainRunId?: string;
  };
}

const identifier = String.raw`(?:"(?:[^"]|"")*"|[A-Za-z_][A-Za-z0-9_$]*)`;
const qualifiedRelationPattern = new RegExp(
  String.raw`\b(?:FROM|JOIN|UPDATE|INTO|TABLE)\s+(${identifier})\s*\.\s*(${identifier})`,
  "gi",
);

function parseIdentifier(value: string): string | null {
  const identifierValue = value.startsWith('"')
    ? value.slice(1, -1).replaceAll('""', '"')
    : value.toLowerCase();
  return identifierValue.length > 0 && identifierValue.length <= 63
    ? identifierValue
    : null;
}

function uniqueRelations(relations: readonly QualifiedRelation[]) {
  const result = new Map<string, QualifiedRelation>();
  for (const relation of relations) {
    if (
      relation.schema.length === 0 ||
      relation.schema.length > 63 ||
      relation.table.length === 0 ||
      relation.table.length > 63
    )
      continue;
    result.set(`${relation.schema}\0${relation.table}`, relation);
    if (result.size >= 30) break;
  }
  return [...result.values()];
}

export function extractQualifiedRelationsFromSql(
  query: string,
): QualifiedRelation[] {
  const sanitized = redactSql(query);
  const relations: QualifiedRelation[] = [];
  qualifiedRelationPattern.lastIndex = 0;
  for (const match of sanitized.matchAll(qualifiedRelationPattern)) {
    const schema = match[1] ? parseIdentifier(match[1]) : null;
    const table = match[2] ? parseIdentifier(match[2]) : null;
    if (schema && table) relations.push({ schema, table });
  }
  return uniqueRelations(relations);
}

export function extractRelationsFromPlan(plan: unknown): QualifiedRelation[] {
  const relations: QualifiedRelation[] = [];
  const pending: unknown[] = [plan];
  let visited = 0;
  while (pending.length > 0 && visited < 10_000) {
    const value = pending.pop();
    visited += 1;
    if (Array.isArray(value)) {
      pending.push(...value);
      continue;
    }
    if (!value || typeof value !== "object") continue;
    const record = value as Record<string, unknown>;
    if (
      typeof record["Schema"] === "string" &&
      typeof record["Relation Name"] === "string"
    ) {
      relations.push({
        schema: record["Schema"],
        table: record["Relation Name"],
      });
    }
    pending.push(...Object.values(record));
  }
  return uniqueRelations(relations);
}

export function canonicalAdvisorQuery(query: string): string {
  return redactSql(query)
    .replaceAll(/'\?'/g, "?")
    .replaceAll(/\$\d+/g, "?")
    .replaceAll(/\s+/g, " ")
    .trim();
}

function queriesSafelyMatch(left: string, right: string): boolean {
  const leftShape = canonicalAdvisorQuery(left);
  return leftShape.length > 0 && leftShape === canonicalAdvisorQuery(right);
}

function queryIdFromFinding(destination: Record<string, unknown>) {
  const href =
    typeof destination["href"] === "string" ? destination["href"] : "";
  return /^\/queries\/(-?\d+)(?:[/?#]|$)/.exec(href)?.[1];
}

function scalar(value: unknown): string | number | boolean | null | undefined {
  if (value == null) return null;
  if (typeof value === "boolean") return value;
  if (typeof value === "number")
    return Number.isFinite(value) ? value : undefined;
  if (typeof value === "bigint") return value.toString();
  if (typeof value === "string") return value.slice(0, 10_000);
  if (value instanceof Date) return value.toISOString();
  return undefined;
}

function flattenScalars(
  value: unknown,
  prefix: string,
  output: Record<string, string | number | boolean | null>,
  limit: number,
) {
  if (Object.keys(output).length >= limit) return;
  const direct = scalar(value);
  if (direct !== undefined) {
    output[prefix.slice(0, 255)] = direct;
    return;
  }
  if (!value || typeof value !== "object") return;
  const entries = Array.isArray(value)
    ? value.map((child, index) => [String(index), child] as const)
    : Object.entries(value as Record<string, unknown>);
  for (const [key, child] of entries) {
    if (Object.keys(output).length >= limit) break;
    flattenScalars(child, `${prefix}.${key}`, output, limit);
  }
}

function addQueryStatistics(
  statistics: Record<string, string | number | boolean | null>,
  query: QueryStat,
) {
  Object.assign(statistics, {
    "query.calls": query.calls,
    "query.totalPlanTimeMs": query.totalPlanTime,
    "query.meanPlanTimeMs": query.meanPlanTime,
    "query.totalExecTimeMs": query.totalExecTime,
    "query.meanExecTimeMs": query.meanExecTime,
    "query.rows": query.rows,
    "query.sharedBlocksHit": query.sharedBlocksHit,
    "query.sharedBlocksRead": query.sharedBlocksRead,
    "query.sharedBlocksDirtied": query.sharedBlocksDirtied,
    "query.sharedBlocksWritten": query.sharedBlocksWritten,
    "query.tempBlocksRead": query.tempBlocksRead,
    "query.tempBlocksWritten": query.tempBlocksWritten,
    "query.walRecords": query.walRecords,
    "query.walBytes": query.walBytes,
    "query.statsSince": query.statsSince?.toISOString() ?? null,
  });
}

function addHistoryStatistics(
  statistics: Record<string, string | number | boolean | null>,
  history: readonly Record<string, unknown>[],
) {
  history.slice(0, 8).forEach((sample, index) => {
    for (const key of [
      "captured_at",
      "calls",
      "total_exec_time",
      "mean_exec_time",
      "rows",
      "shared_blks_read",
      "temp_blks_written",
      "wal_bytes",
      "reset_detected",
    ]) {
      const value = scalar(sample[key]);
      if (value !== undefined)
        statistics[`history.${index + 1}.${key}`] = value;
    }
  });
}

function relationFromFindingEvidence(
  evidence: Record<string, unknown>,
): QualifiedRelation[] {
  return typeof evidence["schema"] === "string" &&
    typeof evidence["table"] === "string"
    ? [{ schema: evidence["schema"], table: evidence["table"] }]
    : [];
}

function planIdFromFindingEvidence(
  evidence: Record<string, unknown>,
): string | undefined {
  for (const key of [
    "explainRunId",
    "candidateExplainRunId",
    "baselineExplainRunId",
  ]) {
    const value = evidence[key];
    if (typeof value === "string" && /^[0-9a-f-]{36}$/i.test(value))
      return value;
  }
  return undefined;
}

export async function assembleAdvisorEvidence(
  selection: AdvisorEvidenceSelection,
): Promise<AdvisorEvidenceResult> {
  const omissions: string[] = [];
  const { db, target } = await getTargetContext(selection.source);
  const control = await getControlDatabase();
  const [capabilities, registered, settings] = await Promise.all([
    detectCapabilities(db),
    listRegisteredDatabases(control),
    getAdvisorSettings(db),
  ]);
  const sourceDatabase = registered.find(
    (candidate) =>
      candidate.sourceKey === target.key &&
      candidate.databaseName === capabilities.databaseName,
  );
  const sourceDatabaseId = sourceDatabase?.sourceDatabaseId ?? null;
  if (!sourceDatabaseId)
    omissions.push(
      "Snapshot history, findings, and saved plans are unavailable until this target is collected.",
    );

  let finding = null;
  if (selection.findingId !== undefined) {
    if (!sourceDatabaseId)
      throw new ApiError(
        404,
        "advisor_finding_unavailable",
        "The selected target has no collected finding history.",
      );
    finding = await getAdvisorFinding(
      control,
      sourceDatabaseId,
      selection.findingId,
    );
    if (!finding)
      throw new ApiError(
        404,
        "advisor_finding_not_found",
        "The selected finding does not belong to this database target.",
      );
  }

  const resolvedQueryId =
    selection.queryId ??
    (finding ? queryIdFromFinding(finding.destination) : undefined);
  let liveQuery: QueryStat | null = null;
  let history: Record<string, unknown>[] = [];
  if (resolvedQueryId) {
    [liveQuery, history] = await Promise.all([
      getQueryStat(db, resolvedQueryId),
      sourceDatabaseId
        ? listQueryHistory(control, sourceDatabaseId, resolvedQueryId, {
            limit: 8,
          })
        : Promise.resolve([]),
    ]);
  }

  let query = liveQuery?.query;
  let queryOrigin: AdvisorEvidenceResult["evidence"]["queryOrigin"] = liveQuery
    ? "live"
    : null;
  if (!query && history[0]?.["normalized_query"]) {
    query = String(history[0]["normalized_query"]);
    queryOrigin = "history";
    omissions.push(
      "The live pg_stat_statements row was unavailable; the newest collected normalized query was used.",
    );
  }
  if (resolvedQueryId && !query)
    omissions.push(
      `No live or collected query text matched query ID ${resolvedQueryId}.`,
    );

  let plan: AdvisorExplainEvidence | null = null;
  let planMatch: AdvisorEvidenceResult["evidence"]["planMatch"] = null;
  const requestedPlanId =
    selection.planId ??
    (finding ? planIdFromFindingEvidence(finding.evidence) : undefined);
  if (requestedPlanId !== undefined) {
    if (!sourceDatabaseId)
      throw new ApiError(
        404,
        "advisor_plan_unavailable",
        "The selected target has no saved plans.",
      );
    const selectedPlan = await getAdvisorExplainRun(
      control,
      sourceDatabaseId,
      requestedPlanId,
    );
    if (!selectedPlan)
      throw new ApiError(
        404,
        "advisor_plan_not_found",
        "The selected plan does not belong to this database target.",
      );
    if (query && !queriesSafelyMatch(query, selectedPlan.normalizedQuery)) {
      omissions.push(
        "The explicitly selected plan was omitted because its normalized query does not match the selected query.",
      );
    } else {
      plan = selectedPlan;
      planMatch = "explicit";
    }
  } else if (query && sourceDatabaseId) {
    const recentPlans = await listRecentAdvisorExplainRuns(
      control,
      sourceDatabaseId,
      50,
    );
    const matchingPlan = recentPlans.find((candidate) =>
      queriesSafelyMatch(query!, candidate.normalizedQuery),
    );
    plan = matchingPlan
      ? await getAdvisorExplainRun(control, sourceDatabaseId, matchingPlan.id)
      : null;
    if (plan) planMatch = "query-shape";
    else
      omissions.push(
        "No recent saved plan safely matched the selected normalized query.",
      );
  }
  if (!query && plan) {
    query = plan.normalizedQuery;
    queryOrigin = "plan";
  }

  const relations = uniqueRelations([
    ...(selection.relation ? [selection.relation] : []),
    ...(plan ? extractRelationsFromPlan(plan.plan) : []),
    ...(query ? extractQualifiedRelationsFromSql(query) : []),
    ...(finding ? relationFromFindingEvidence(finding.evidence) : []),
  ]);
  const tables = await getAdvisorTableContexts(db, relations);
  const indexes = await getAdvisorIndexContexts(
    db,
    tables.map((table) => table.relationOid),
  );
  if (relations.length === 0)
    omissions.push(
      "Table metadata was not guessed because no schema-qualified relation was proven by the selected evidence.",
    );
  else if (tables.length < relations.length)
    omissions.push(
      `${relations.length - tables.length} referenced relation(s) were not visible in the selected target catalog.`,
    );
  if (tables.length > 0 && indexes.length === 0)
    omissions.push("No indexes were visible for the resolved relations.");
  if (
    selection.index &&
    !indexes.some((candidate) => candidate.name === selection.index)
  )
    omissions.push(
      `The selected index ${selection.index} was not visible on the resolved relation.`,
    );
  if (resolvedQueryId && history.length === 0)
    omissions.push("No collected query-history samples were available.");

  const statistics: Record<string, string | number | boolean | null> = {};
  if (liveQuery) addQueryStatistics(statistics, liveQuery);
  addHistoryStatistics(statistics, history);
  if (finding)
    flattenScalars(finding.evidence, "finding.evidence", statistics, 100);
  if (selection.index) statistics["selection.index"] = selection.index;

  const context: NonNullable<AiPayloadInput["context"]> = {
    database: capabilities.databaseName,
    sourceLabel: target.label,
    queryId: resolvedQueryId,
    planId: plan?.id,
    relation: selection.relation
      ? `${selection.relation.schema}.${selection.relation.table}`
      : undefined,
    index: selection.index,
    finding: finding
      ? {
          id: String(finding.id),
          category: finding.category,
          severity: finding.severity,
          title: finding.title,
          summary: finding.summary,
        }
      : undefined,
  };
  if (!query)
    omissions.push(
      finding
        ? "No normalized query is associated with this finding; the advisor will analyze the finding and catalog evidence only."
        : tables.length > 0
          ? "No normalized query was selected; the advisor will analyze catalog and index evidence only."
          : "No normalized query was available.",
    );

  const selectionResult = {
    queryId: resolvedQueryId,
    findingId: selection.findingId,
    planId: plan?.id,
    relation: selection.relation
      ? `${selection.relation.schema}.${selection.relation.table}`
      : undefined,
    index: selection.index,
  };
  return {
    ready: Boolean(query || finding || plan || tables.length || indexes.length),
    source: {
      key: target.key,
      label: target.label,
      database: capabilities.databaseName,
    },
    sourceDatabaseId,
    selection: selectionResult,
    evidence: {
      queryOrigin,
      historySamples: history.length,
      planMatch,
      tables: tables.map((table) => `${table.schema}.${table.name}`),
      indexes: indexes.length,
      settings: Object.keys(settings).length,
    },
    omissions: [...new Set(omissions)],
    input: {
      query,
      plan: plan?.plan,
      tables: tables.map(({ relationOid: _relationOid, ...table }) => table),
      indexes,
      settings,
      statistics,
      context,
      mode: "balanced",
      source: target.key,
      sourceDatabaseId: sourceDatabaseId ?? undefined,
      explainRunId: plan?.id,
    },
  };
}
