import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { integerFromEnv, type RuntimeEnv } from "../lib/config/env";
import { parseTargetRegistry } from "../lib/config/targets";
import { createDatabasePool, type DatabasePool } from "../lib/db/client";
import { detectCapabilities } from "../lib/db/capabilities";
import { getDatabaseStat } from "../lib/db/database";
import { listQueryStats, type QueryStatCursor } from "../lib/db/workload";
import {
  listTableMaintenance,
  type TableMaintenance,
} from "../lib/db/maintenance";
import { listIndexes, type IndexInfo } from "../lib/db/indexes";
import { findIndexRelationships } from "../lib/db/indexes";
import { listActivity } from "../lib/db/activity";
import { ControlPlaneRepository } from "../lib/db/control-plane";
import { stableFindingFingerprint } from "../lib/analysis/findings";
import {
  deriveMissingIndexCandidates,
  type MissingIndexCandidateOptions,
} from "../lib/analysis/indexes";
import { diffPlans } from "../lib/analysis/plans";
import { effectiveFreezeMaxAge } from "../lib/analysis/maintenance";
import {
  moreSevere,
  ruleIsEnabled,
  ruleNumber,
  ruleSeverity,
  type AlertRuleRegistry,
  type FindingSeverity,
} from "../lib/analysis/rules";
import type { IndexRecord } from "../lib/types";

const BATCH_SIZE = 250;
const QUERY_BATCH_SIZE = 100;
const MAX_ROWS_PER_INVENTORY = 5_000;

async function collectPages<T>(
  loader: (offset: number) => Promise<T[]>,
): Promise<T[]> {
  const rows: T[] = [];
  while (rows.length < MAX_ROWS_PER_INVENTORY) {
    const page = await loader(rows.length);
    rows.push(...page);
    if (page.length < BATCH_SIZE) break;
  }
  return rows;
}

async function collectQuerySnapshots(
  control: ControlPlaneRepository,
  targetPool: DatabasePool,
  runId: number,
): Promise<number> {
  let scanned = 0;
  let persisted = 0;
  let cursor: QueryStatCursor | undefined;
  while (scanned < MAX_ROWS_PER_INVENTORY) {
    const page = await listQueryStats(targetPool, {
      limit: Math.min(QUERY_BATCH_SIZE, MAX_ROWS_PER_INVENTORY - scanned),
      queryTextLimit: 5_000,
      identityCursor: cursor,
      identityOrder: true,
    });
    scanned += page.length;
    persisted += await control.saveQuerySnapshots(runId, page);
    if (page.length < QUERY_BATCH_SIZE) break;
    const last = page.at(-1);
    if (!last) break;
    cursor = {
      queryId: last.queryId,
      userOid: last.userOid,
      databaseOid: last.databaseOid,
      toplevel: last.toplevel,
    };
  }
  return persisted;
}

async function collectIndexSnapshots(
  control: ControlPlaneRepository,
  targetPool: DatabasePool,
  runId: number,
): Promise<IndexInfo[]> {
  const analysisRows: IndexInfo[] = [];
  let scanned = 0;
  while (scanned < MAX_ROWS_PER_INVENTORY) {
    const page = await listIndexes(targetPool, {
      limit: Math.min(BATCH_SIZE, MAX_ROWS_PER_INVENTORY - scanned),
      offset: scanned,
      identityOrder: true,
    });
    await control.saveIndexSnapshots(runId, page);
    analysisRows.push(
      ...page.map((index) => ({
        ...index,
        // Persistence receives the bounded definition page-by-page. Finding
        // analysis retains only compact catalog identity and key evidence.
        definition: "",
      })),
    );
    scanned += page.length;
    if (page.length < BATCH_SIZE) break;
  }
  return analysisRows;
}

export interface CollectionSummary {
  target: string;
  runId: number;
  status: "succeeded" | "failed" | "skipped";
  queries: number;
  tables: number;
  indexes: number;
  activities: number;
  resetDetected: boolean;
  findings: number;
  prunedRuns: number;
  error?: string;
}

export async function pruneCollectionHistory(
  db: DatabasePool,
  sourceDatabaseId: number,
  options: { retentionDays?: number; maximumRuns?: number } = {},
): Promise<number> {
  if (!Number.isSafeInteger(sourceDatabaseId) || sourceDatabaseId <= 0)
    throw new Error("Invalid source database ID");
  const retentionDays = Math.min(
    3650,
    Math.max(1, Math.trunc(options.retentionDays ?? 14)),
  );
  const maximumRuns = Math.min(
    100_000,
    Math.max(10, Math.trunc(options.maximumRuns ?? 5_000)),
  );
  const result = await db.query(
    `DELETE FROM index_analyzer.collection_runs
     WHERE source_database_id = $1
       AND (
         started_at < clock_timestamp() - make_interval(days => $2)
         OR id NOT IN (
           SELECT id FROM index_analyzer.collection_runs
           WHERE source_database_id = $1
           ORDER BY started_at DESC LIMIT $3
         )
       )`,
    [sourceDatabaseId, retentionDays, maximumRuns],
  );
  return result.rowCount ?? 0;
}

interface FindingCandidate {
  ruleKey: string;
  category: string;
  severity: FindingSeverity;
  title: string;
  summary: string;
  resourceType: string;
  resourceKey: string;
  evidence: Record<string, unknown>;
  href: string;
}

async function queryRegressionFindings(
  controlPool: DatabasePool,
  sourceDatabaseId: number,
  currentRunId: number,
  rules: AlertRuleRegistry,
): Promise<FindingCandidate[]> {
  if (!ruleIsEnabled(rules, "query-regression")) return [];
  const minimumCalls = ruleNumber(rules, "query-regression", "minCalls", 20, {
    min: 1,
    max: 1_000_000_000,
  });
  const regressionRatio = ruleNumber(rules, "query-regression", "ratio", 1.5, {
    min: 1.01,
    max: 100,
  });
  const result = await controlPool.query<Record<string, unknown>>(
    `
    WITH sampled_runs AS (
      SELECT id, started_at, reset_detected,
        row_number() OVER (ORDER BY started_at DESC, id DESC) AS run_rank
      FROM index_analyzer.collection_runs
      WHERE source_database_id = $1 AND id <= $2
        AND (id = $2 OR status = 'succeeded')
      ORDER BY started_at DESC LIMIT 6
    ), marked_runs AS (
      SELECT *, COALESCE(
        sum(CASE WHEN reset_detected THEN 1 ELSE 0 END) OVER (
          ORDER BY started_at DESC
          ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING
        ), 0
      ) AS older_reset_boundaries
      FROM sampled_runs
    ), recent_runs AS (
      SELECT * FROM marked_runs WHERE older_reset_boundaries = 0
    ), query_samples AS (
      SELECT qs.query_id, r.started_at, r.run_rank,
        sum(qs.calls)::bigint AS calls,
        sum(qs.total_exec_time)::float8 AS total_exec_time,
        max(qs.stats_since) AS stats_since,
        max(qs.minmax_stats_since) AS minmax_stats_since
      FROM recent_runs r
      JOIN index_analyzer.query_snapshots qs ON qs.collection_run_id = r.id
      GROUP BY qs.query_id, r.started_at, r.run_rank
    ), ordered AS (
      SELECT *,
        lag(calls) OVER (PARTITION BY query_id ORDER BY started_at) AS prior_calls,
        lag(total_exec_time) OVER (PARTITION BY query_id ORDER BY started_at) AS prior_exec,
        lag(run_rank) OVER (PARTITION BY query_id ORDER BY started_at) AS prior_run_rank,
        lag(stats_since) OVER (PARTITION BY query_id ORDER BY started_at) AS prior_stats_since,
        lag(minmax_stats_since) OVER (PARTITION BY query_id ORDER BY started_at) AS prior_minmax_stats_since
      FROM query_samples
    ), query_boundaries AS (
      SELECT *, prior_calls IS NOT NULL AND
        (prior_run_rank <> run_rank + 1
          OR calls < prior_calls OR total_exec_time < prior_exec
          OR stats_since IS DISTINCT FROM prior_stats_since
          OR minmax_stats_since IS DISTINCT FROM prior_minmax_stats_since) AS implicit_reset
      FROM ordered
    ), query_epoch_marked AS (
      SELECT *, COALESCE(
        sum(CASE WHEN implicit_reset THEN 1 ELSE 0 END) OVER (
          PARTITION BY query_id ORDER BY started_at DESC
          ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING
        ), 0
      ) AS older_reset_boundaries
      FROM query_boundaries
    ), usable AS (
      SELECT * FROM query_epoch_marked
      WHERE older_reset_boundaries = 0 AND prior_calls IS NOT NULL
        AND NOT implicit_reset
    ), deltas AS (
      SELECT *, calls - prior_calls AS call_delta, total_exec_time - prior_exec AS exec_delta,
        row_number() OVER (PARTITION BY query_id ORDER BY started_at DESC) AS recency
      FROM usable
    ), windows AS (
      SELECT query_id,
        COALESCE(sum(call_delta) FILTER (WHERE recency = 1), 0) AS recent_calls,
        COALESCE(sum(exec_delta) FILTER (WHERE recency = 1), 0) AS recent_exec,
        COALESCE(sum(call_delta) FILTER (WHERE recency BETWEEN 2 AND 4), 0) AS baseline_calls,
        COALESCE(sum(exec_delta) FILTER (WHERE recency BETWEEN 2 AND 4), 0) AS baseline_exec
      FROM deltas GROUP BY query_id
    )
    SELECT query_id, recent_calls, recent_exec / NULLIF(recent_calls, 0) AS recent_mean,
      baseline_calls, baseline_exec / NULLIF(baseline_calls, 0) AS baseline_mean
    FROM windows
    WHERE recent_calls >= $3 AND baseline_calls >= $3
      AND recent_exec / NULLIF(recent_calls, 0) >
        (baseline_exec / NULLIF(baseline_calls, 0)) * $4
    ORDER BY recent_exec DESC LIMIT 100
  `,
    [sourceDatabaseId, currentRunId, minimumCalls, regressionRatio],
  );
  return result.rows.map((row) => {
    const recent = Number(row["recent_mean"]);
    const baseline = Number(row["baseline_mean"]);
    const ratio = recent / baseline;
    return {
      ruleKey: "query-regression",
      category: "query",
      severity:
        ratio >= regressionRatio * 1.5
          ? moreSevere(
              ruleSeverity(rules, "query-regression", "warning"),
              "critical",
            )
          : ruleSeverity(rules, "query-regression", "warning"),
      title: `Query ${String(row["query_id"])} regressed ${Math.round((ratio - 1) * 100)}%`,
      summary:
        "The latest reset-safe interval is materially slower than its recent baseline.",
      resourceType: "query",
      resourceKey: String(row["query_id"]),
      evidence: {
        recentMeanExecTimeMs: recent,
        baselineMeanExecTimeMs: baseline,
        recentCalls: Number(row["recent_calls"]),
        baselineCalls: Number(row["baseline_calls"]),
      },
      href: `/queries/${String(row["query_id"])}`,
    };
  });
}

interface ExplainPlanRow {
  id: string;
  query_digest: string;
  plan_json: unknown;
  recency: string | number;
}

function catalogIndexRecords(indexes: readonly IndexInfo[]): IndexRecord[] {
  return indexes.map((index) => ({
    id: String(index.indexOid),
    schema: index.schema,
    table: index.table,
    name: index.name,
    method: index.accessMethod,
    keyColumns: index.keyColumns,
    includeColumns: index.includedColumns,
    predicate: index.predicate,
    unique: index.unique,
    primary: index.primary,
    constraintBacked: index.constraintBacked,
    valid: index.valid,
    ready: index.ready,
    sizeBytes: index.sizeBytes,
    scans: index.scans,
  }));
}

async function planDerivedFindings(
  controlPool: DatabasePool,
  sourceDatabaseId: number,
  indexes: readonly IndexInfo[],
  rules: AlertRuleRegistry,
): Promise<FindingCandidate[]> {
  const findPlanChanges = ruleIsEnabled(rules, "plan-change");
  const findMissingIndexes = ruleIsEnabled(rules, "missing-index");
  if (!findPlanChanges && !findMissingIndexes) return [];
  const maximumPlans = Math.round(
    Math.max(
      findMissingIndexes
        ? ruleNumber(rules, "missing-index", "maximumPlans", 100, {
            min: 1,
            max: 250,
          })
        : 0,
      findPlanChanges
        ? ruleNumber(rules, "plan-change", "maximumPlans", 100, {
            min: 1,
            max: 250,
          })
        : 0,
    ),
  );
  const result = await controlPool.query<ExplainPlanRow>(
    `
    WITH digests AS (
      SELECT query_digest, max(created_at) AS latest_at
      FROM index_analyzer.explain_runs
      WHERE source_database_id = $1
      GROUP BY query_digest
      ORDER BY latest_at DESC
      LIMIT $2
    )
    SELECT plans.id::text, plans.query_digest, plans.plan_json, plans.recency
    FROM digests
    CROSS JOIN LATERAL (
      SELECT er.id, er.query_digest, er.plan_json,
        row_number() OVER (ORDER BY er.created_at DESC, er.id DESC) AS recency
      FROM index_analyzer.explain_runs er
      WHERE er.source_database_id = $1
        AND er.query_digest = digests.query_digest
      ORDER BY er.created_at DESC, er.id DESC
      LIMIT 2
    ) plans
    ORDER BY digests.latest_at DESC, plans.recency
  `,
    [sourceDatabaseId, maximumPlans],
  );
  const byDigest = new Map<string, ExplainPlanRow[]>();
  for (const row of result.rows) {
    const rows = byDigest.get(row.query_digest) ?? [];
    rows.push(row);
    byDigest.set(row.query_digest, rows);
  }

  const candidates: FindingCandidate[] = [];
  const missingByResource = new Map<string, FindingCandidate>();
  const existingIndexes = catalogIndexRecords(indexes);
  const missingOptions: MissingIndexCandidateOptions = {
    minimumScore: ruleNumber(rules, "missing-index", "minimumScore", 55, {
      min: 0,
      max: 100,
    }),
    minimumRows: ruleNumber(rules, "missing-index", "minimumRows", 1_000, {
      min: 100,
      max: 1_000_000_000_000,
    }),
  };
  const planChangeRatio = ruleNumber(
    rules,
    "plan-change",
    "executionRatio",
    0.25,
    { min: 0.01, max: 100 },
  );
  const costChangeRatio = ruleNumber(rules, "plan-change", "costRatio", 0.3, {
    min: 0.01,
    max: 100,
  });

  for (const [digest, rows] of byDigest) {
    const current = rows.find((row) => Number(row.recency) === 1) ?? rows[0];
    const baseline = rows.find((row) => Number(row.recency) === 2) ?? rows[1];
    if (!current) continue;
    if (findMissingIndexes) {
      try {
        for (const missing of deriveMissingIndexCandidates(
          current.plan_json,
          existingIndexes,
          missingOptions,
        )) {
          const resourceKey = `${missing.schema ?? ""}.${missing.table}:${missing.columns.join(",")}`;
          const candidate: FindingCandidate = {
            ruleKey: "missing-index",
            category: "index",
            severity:
              missing.confidence === "high"
                ? moreSevere(
                    ruleSeverity(rules, "missing-index", "warning"),
                    "high",
                  )
                : ruleSeverity(rules, "missing-index", "warning"),
            title: `Missing index candidate on ${missing.schema ? `${missing.schema}.` : ""}${missing.table}`,
            summary: missing.recommendation,
            resourceType: "table-columns",
            resourceKey,
            evidence: {
              schema: missing.schema,
              table: missing.table,
              queryDigest: digest,
              explainRunId: current.id,
              columns: missing.columns,
              paths: missing.paths,
              estimatedRows: missing.estimatedRows,
              actualRows: missing.actualRows,
              rowsRemovedByFilter: missing.rowsRemovedByFilter,
              score: missing.score,
              confidence: missing.confidence,
            },
            href: `/plans?planId=${encodeURIComponent(current.id)}`,
          };
          const existing = missingByResource.get(resourceKey);
          if (
            !existing ||
            Number(candidate.evidence["score"]) >
              Number(existing.evidence["score"])
          )
            missingByResource.set(resourceKey, candidate);
        }
      } catch {
        // A single malformed historic plan must not stop collection.
      }
    }
    if (findPlanChanges && baseline) {
      try {
        const diff = diffPlans(baseline.plan_json, current.plan_json);
        const structurallyChanged = diff.nodes.filter(
          (node) =>
            node.status === "added" ||
            node.status === "removed" ||
            (node.status === "changed" &&
              node.nodeTypeBefore !== node.nodeTypeAfter),
        ).length;
        const materiallyCosted = diff.nodes.some(
          (node) =>
            node.costChangeRatio !== null &&
            Math.abs(node.costChangeRatio) >= costChangeRatio,
        );
        const executionRatio = diff.executionTimeChangeRatio;
        if (
          structurallyChanged === 0 &&
          !materiallyCosted &&
          (executionRatio === null ||
            Math.abs(executionRatio) < planChangeRatio)
        )
          continue;
        candidates.push({
          ruleKey: "plan-change",
          category: "plan",
          severity:
            executionRatio !== null && executionRatio >= planChangeRatio * 2
              ? moreSevere(
                  ruleSeverity(rules, "plan-change", "warning"),
                  "high",
                )
              : ruleSeverity(rules, "plan-change", "warning"),
          title: `Material plan change for query ${digest}`,
          summary:
            diff.summary.join(" ") ||
            "The latest saved plan differs materially from its baseline.",
          resourceType: "query-plan",
          resourceKey: digest,
          evidence: {
            explainRunId: current.id,
            baselineExplainRunId: baseline.id,
            candidateExplainRunId: current.id,
            executionTimeChangeRatio: executionRatio,
            structurallyChangedNodes: structurallyChanged,
            materiallyCostedNodes: diff.nodes.filter(
              (node) =>
                node.costChangeRatio !== null &&
                Math.abs(node.costChangeRatio) >= costChangeRatio,
            ).length,
            summary: diff.summary,
          },
          href: "/plans",
        });
      } catch {
        // A single malformed historic plan must not stop collection.
      }
    }
  }
  candidates.push(...missingByResource.values());
  return candidates;
}

async function generateFindings(
  control: ControlPlaneRepository,
  controlPool: DatabasePool,
  input: {
    sourceDatabaseId: number;
    sourceKey: string;
    database: string;
    runId: number;
    tables: TableMaintenance[];
    indexes: IndexInfo[];
    activities: Awaited<ReturnType<typeof listActivity>>;
    rules: AlertRuleRegistry;
    freezeMaxAge: number;
  },
): Promise<number> {
  const candidates: FindingCandidate[] = [];
  const now = Date.now();
  const ageHours = (...values: Array<Date | null>): number | null => {
    const latest = values.reduce<Date | null>(
      (maximum, value) =>
        value && (!maximum || value.getTime() > maximum.getTime())
          ? value
          : maximum,
      null,
    );
    return latest ? Math.max(0, (now - latest.getTime()) / 3_600_000) : null;
  };
  for (const table of input.tables) {
    const tableFreezeMaxAge = effectiveFreezeMaxAge(
      table.relationOptions,
      input.freezeMaxAge,
    );
    const deadRatio =
      table.deadRows / Math.max(1, table.liveRows + table.deadRows);
    const deadMinimum = ruleNumber(
      input.rules,
      "dead-tuples",
      "minimum",
      1_000,
      { min: 0, max: 1_000_000_000_000 },
    );
    const deadThreshold = ruleNumber(input.rules, "dead-tuples", "ratio", 0.2, {
      min: 0,
      max: 1,
    });
    if (
      ruleIsEnabled(input.rules, "dead-tuples") &&
      table.deadRows >= deadMinimum &&
      deadRatio >= deadThreshold
    ) {
      candidates.push({
        ruleKey: "dead-tuples",
        category: "maintenance",
        severity:
          deadRatio >= Math.min(1, deadThreshold * 1.5)
            ? moreSevere(
                ruleSeverity(input.rules, "dead-tuples", "warning"),
                "critical",
              )
            : ruleSeverity(input.rules, "dead-tuples", "warning"),
        title: `Dead tuple pressure on ${table.schema}.${table.table}`,
        summary:
          "The observed dead tuple ratio exceeds the bounded collector threshold.",
        resourceType: "table",
        resourceKey: `${table.schema}.${table.table}`,
        evidence: {
          schema: table.schema,
          table: table.table,
          deadRows: table.deadRows,
          liveRows: table.liveRows,
          deadRatio,
        },
        href: "/maintenance",
      });
    }
    const vacuumHours = ruleNumber(
      input.rules,
      "vacuum-staleness",
      "hours",
      72,
      { min: 1, max: 24 * 365 * 10 },
    );
    const vacuumMinimum = ruleNumber(
      input.rules,
      "vacuum-staleness",
      "minimum",
      1_000,
      { min: 0, max: 1_000_000_000_000 },
    );
    const vacuumAge = ageHours(table.lastVacuum, table.lastAutovacuum);
    if (
      ruleIsEnabled(input.rules, "vacuum-staleness") &&
      table.deadRows >= vacuumMinimum &&
      (vacuumAge === null || vacuumAge >= vacuumHours)
    ) {
      candidates.push({
        ruleKey: "vacuum-staleness",
        category: "maintenance",
        severity:
          vacuumAge === null || vacuumAge >= vacuumHours * 2
            ? moreSevere(
                ruleSeverity(input.rules, "vacuum-staleness", "warning"),
                "high",
              )
            : ruleSeverity(input.rules, "vacuum-staleness", "warning"),
        title: `Vacuum is stale on ${table.schema}.${table.table}`,
        summary:
          "Dead tuples are accumulating and no sufficiently recent vacuum is recorded.",
        resourceType: "table",
        resourceKey: `${table.schema}.${table.table}:vacuum`,
        evidence: {
          schema: table.schema,
          table: table.table,
          deadRows: table.deadRows,
          deadRatio,
          lastVacuum: table.lastVacuum,
          lastAutovacuum: table.lastAutovacuum,
          ageHours: vacuumAge,
          configuredHours: vacuumHours,
          configuredMinimumDeadRows: vacuumMinimum,
        },
        href: "/maintenance",
      });
    }
    const analyzeHours = ruleNumber(
      input.rules,
      "analyze-staleness",
      "hours",
      24,
      { min: 1, max: 24 * 365 * 10 },
    );
    const analyzeMinimum = ruleNumber(
      input.rules,
      "analyze-staleness",
      "minimum",
      1_000,
      { min: 0, max: 1_000_000_000_000 },
    );
    const analyzeRatio = ruleNumber(
      input.rules,
      "analyze-staleness",
      "ratio",
      0.1,
      { min: 0, max: 1 },
    );
    const modificationRatio =
      table.modificationsSinceAnalyze / Math.max(1, table.liveRows);
    const analyzeAge = ageHours(table.lastAnalyze, table.lastAutoanalyze);
    if (
      ruleIsEnabled(input.rules, "analyze-staleness") &&
      table.modificationsSinceAnalyze >= analyzeMinimum &&
      modificationRatio >= analyzeRatio &&
      (analyzeAge === null || analyzeAge >= analyzeHours)
    ) {
      candidates.push({
        ruleKey: "analyze-staleness",
        category: "maintenance",
        severity:
          modificationRatio >= Math.min(1, analyzeRatio * 2)
            ? moreSevere(
                ruleSeverity(input.rules, "analyze-staleness", "warning"),
                "high",
              )
            : ruleSeverity(input.rules, "analyze-staleness", "warning"),
        title: `Planner statistics are stale on ${table.schema}.${table.table}`,
        summary:
          "Table changes exceed the configured analyze threshold and the last analyze is stale.",
        resourceType: "table",
        resourceKey: `${table.schema}.${table.table}:analyze`,
        evidence: {
          schema: table.schema,
          table: table.table,
          modificationsSinceAnalyze: table.modificationsSinceAnalyze,
          liveRows: table.liveRows,
          modificationRatio,
          lastAnalyze: table.lastAnalyze,
          lastAutoanalyze: table.lastAutoanalyze,
          ageHours: analyzeAge,
          configuredHours: analyzeHours,
          configuredRatio: analyzeRatio,
          configuredMinimumModifications: analyzeMinimum,
        },
        href: "/maintenance",
      });
    }
    const freezeRatio = ruleNumber(input.rules, "freeze-risk", "ratio", 0.8, {
      min: 0.01,
      max: 1,
    });
    const freezeThreshold = tableFreezeMaxAge * freezeRatio;
    if (
      ruleIsEnabled(input.rules, "freeze-risk") &&
      table.transactionIdAge >= freezeThreshold
    ) {
      candidates.push({
        ruleKey: "freeze-risk",
        category: "maintenance",
        severity:
          table.transactionIdAge >= tableFreezeMaxAge * 0.9
            ? moreSevere(
                ruleSeverity(input.rules, "freeze-risk", "critical"),
                "critical",
              )
            : ruleSeverity(input.rules, "freeze-risk", "critical"),
        title: `Freeze age risk on ${table.schema}.${table.table}`,
        summary:
          "The relation transaction ID age is approaching its effective freeze ceiling.",
        resourceType: "table",
        resourceKey: `${table.schema}.${table.table}:freeze`,
        evidence: {
          schema: table.schema,
          table: table.table,
          transactionIdAge: table.transactionIdAge,
          freezeMaxAge: tableFreezeMaxAge,
          configuredRatio: freezeRatio,
        },
        href: "/maintenance",
      });
    }
  }
  const unusedMinimumBytes = ruleNumber(
    input.rules,
    "unused-index",
    "minimumBytes",
    1_048_576,
    { min: 0, max: Number.MAX_SAFE_INTEGER },
  );
  for (const index of input.indexes) {
    if (
      ruleIsEnabled(input.rules, "unused-index") &&
      index.scans === 0 &&
      !index.constraintBacked &&
      index.sizeBytes >= unusedMinimumBytes
    ) {
      candidates.push({
        ruleKey: "unused-index",
        category: "index",
        severity: ruleSeverity(input.rules, "unused-index", "info"),
        title: `Unused index candidate ${index.name}`,
        summary:
          "This non-constraint index has no scans in the current PostgreSQL statistics window.",
        resourceType: "index",
        resourceKey: String(index.indexOid),
        evidence: {
          schema: index.schema,
          table: index.table,
          sizeBytes: index.sizeBytes,
          scans: index.scans,
          configuredMinimumBytes: unusedMinimumBytes,
        },
        href: "/indexes",
      });
    }
  }
  for (const relationship of ruleIsEnabled(input.rules, "duplicate-index")
    ? findIndexRelationships(input.indexes)
    : []) {
    const relatedIndex = input.indexes.find(
      (index) => index.indexOid === relationship.leftIndexOid,
    );
    candidates.push({
      ruleKey: "duplicate-index",
      category: "index",
      severity:
        relationship.kind === "duplicate"
          ? ruleSeverity(input.rules, "duplicate-index", "warning")
          : "info",
      title: `${relationship.kind === "duplicate" ? "Duplicate" : "Overlapping"} indexes ${relationship.leftName} and ${relationship.rightName}`,
      summary:
        "Catalog definitions show redundant or left-prefix coverage; validate workload before removal.",
      resourceType: "index-pair",
      resourceKey: `${relationship.leftIndexOid}:${relationship.rightIndexOid}`,
      evidence: {
        schema: relatedIndex?.schema,
        table: relatedIndex?.table,
        index: relationship.leftName,
        relatedIndex: relationship.rightName,
        kind: relationship.kind,
        evidence: relationship.evidence,
      },
      href: "/indexes",
    });
  }
  const blockedSeconds = ruleNumber(
    input.rules,
    "blocked-session",
    "seconds",
    5,
    { min: 0, max: 31_536_000 },
  );
  const longTransactionSeconds = ruleNumber(
    input.rules,
    "long-transaction",
    "seconds",
    60,
    { min: 1, max: 31_536_000 },
  );
  for (const session of input.activities) {
    if (
      ruleIsEnabled(input.rules, "blocked-session") &&
      session.blockingProcessIds.length > 0 &&
      session.queryAgeSeconds >= blockedSeconds
    ) {
      candidates.push({
        ruleKey: "blocked-session",
        category: "activity",
        severity: ruleSeverity(input.rules, "blocked-session", "critical"),
        title: `Session ${session.processId} is blocked`,
        summary:
          "PostgreSQL currently reports blocking backend process IDs; the threshold is applied to query age because PostgreSQL does not expose a wait-start timestamp.",
        resourceType: "session",
        resourceKey: String(session.processId),
        evidence: {
          processId: session.processId,
          blockingProcessIds: session.blockingProcessIds,
          waitEvent: session.waitEvent,
          blockedQueryAgeSeconds: session.queryAgeSeconds,
          configuredMinimumQueryAgeSeconds: blockedSeconds,
        },
        href: "/live",
      });
    }
    if (
      ruleIsEnabled(input.rules, "long-transaction") &&
      session.transactionAgeSeconds >= longTransactionSeconds
    ) {
      candidates.push({
        ruleKey: "long-transaction",
        category: "activity",
        severity:
          session.transactionAgeSeconds >= longTransactionSeconds * 10
            ? moreSevere(
                ruleSeverity(input.rules, "long-transaction", "warning"),
                "critical",
              )
            : ruleSeverity(input.rules, "long-transaction", "warning"),
        title: `Long transaction in session ${session.processId}`,
        summary:
          "The transaction age exceeds the configured observation threshold.",
        resourceType: "session",
        resourceKey: `${session.processId}:transaction`,
        evidence: {
          processId: session.processId,
          transactionAgeSeconds: session.transactionAgeSeconds,
          state: session.state,
          configuredSeconds: longTransactionSeconds,
        },
        href: "/live",
      });
    }
  }
  candidates.push(
    ...(await queryRegressionFindings(
      controlPool,
      input.sourceDatabaseId,
      input.runId,
      input.rules,
    )),
  );
  candidates.push(
    ...(await planDerivedFindings(
      controlPool,
      input.sourceDatabaseId,
      input.indexes,
      input.rules,
    )),
  );

  let saved = 0;
  for (let offset = 0; offset < candidates.length; offset += 8) {
    const batch = candidates.slice(offset, offset + 8);
    await Promise.all(
      batch.map((candidate) => {
        const fingerprint = stableFindingFingerprint({
          sourceKey: input.sourceKey,
          database: input.database,
          rule: candidate.ruleKey,
          resourceType: candidate.resourceType,
          resourceKey: candidate.resourceKey,
        });
        return control.upsertFinding({
          sourceDatabaseId: input.sourceDatabaseId,
          ruleKey: candidate.ruleKey,
          fingerprint,
          category: candidate.category,
          severity: candidate.severity,
          title: candidate.title,
          summary: candidate.summary,
          evidence: candidate.evidence,
          destination: { href: candidate.href },
        });
      }),
    );
    saved += batch.length;
  }
  return saved;
}

async function collectTargetUnlocked(
  controlPool: DatabasePool,
  targetPool: DatabasePool,
  target: { key: string; label: string; binding: string },
  options: { retentionDays?: number; maximumRuns?: number } = {},
): Promise<CollectionSummary> {
  const control = new ControlPlaneRepository(controlPool);
  const capabilities = await detectCapabilities(targetPool);
  const source = await control.upsertSource(
    target.key,
    target.label,
    target.binding,
  );
  const database = await control.upsertDatabase(source.id, capabilities);
  await control.saveCapabilities(database.id, capabilities);
  await controlPool.query(
    `UPDATE index_analyzer.collection_runs
     SET status = 'failed', finished_at = clock_timestamp(),
       error_code = 'STALE_COLLECTION',
       error_message = 'Collector lease expired before completion.'
     WHERE source_database_id = $1 AND status = 'running'
       AND started_at < clock_timestamp() - interval '30 minutes'`,
    [database.id],
  );
  const rules = await control.listAlertRules();
  const runId = await control.startCollection(database.id);

  try {
    const [databaseStat, queryCount, tables, indexes, activities] =
      await Promise.all([
        getDatabaseStat(targetPool),
        capabilities.extensions["pg_stat_statements"]
          ? collectQuerySnapshots(control, targetPool, runId)
          : Promise.resolve(0),
        collectPages<TableMaintenance>((offset) =>
          listTableMaintenance(targetPool, { limit: BATCH_SIZE, offset }),
        ),
        collectIndexSnapshots(control, targetPool, runId),
        listActivity(targetPool, { limit: BATCH_SIZE, includeIdle: true }),
      ]);
    const resetDetected = await control.saveDatabaseSnapshot(
      runId,
      databaseStat,
    );
    await control.saveTableSnapshots(runId, tables);
    await control.saveActivitySnapshots(runId, activities);
    const findings = await generateFindings(control, controlPool, {
      sourceDatabaseId: database.id,
      sourceKey: target.key,
      database: capabilities.databaseName,
      runId,
      tables,
      indexes,
      activities,
      rules,
      freezeMaxAge: Math.max(
        1,
        Number(
          capabilities.settings["autovacuum_freeze_max_age"] ?? 200_000_000,
        ) || 200_000_000,
      ),
    });
    await control.finishCollection(runId, {
      queries: queryCount,
      tables: tables.length,
      indexes: indexes.length,
      activities: activities.length,
      resetDetected,
    });
    const prunedRuns = await pruneCollectionHistory(
      controlPool,
      database.id,
      options,
    );
    return {
      target: target.key,
      runId,
      status: "succeeded",
      queries: queryCount,
      tables: tables.length,
      indexes: indexes.length,
      activities: activities.length,
      resetDetected,
      findings,
      prunedRuns,
    };
  } catch (error) {
    await control.failCollection(runId, error);
    await pruneCollectionHistory(controlPool, database.id, options).catch(
      () => undefined,
    );
    throw error;
  }
}

export async function collectTarget(
  controlPool: DatabasePool,
  targetPool: DatabasePool,
  target: { key: string; label: string; binding: string },
  options: { retentionDays?: number; maximumRuns?: number } = {},
): Promise<CollectionSummary> {
  const lockClient = await controlPool.connect();
  const lockKey = `index-analyzer-collector:${target.key}`;
  let acquired = false;
  try {
    const lock = await lockClient.query<{ acquired: boolean }>(
      "SELECT pg_try_advisory_lock(hashtextextended($1, 0)) AS acquired",
      [lockKey],
    );
    acquired = lock.rows[0]?.acquired === true;
    if (!acquired) {
      return {
        target: target.key,
        runId: 0,
        status: "skipped",
        queries: 0,
        tables: 0,
        indexes: 0,
        activities: 0,
        resetDetected: false,
        findings: 0,
        prunedRuns: 0,
        error: "A collection for this target is already running",
      };
    }
    return await collectTargetUnlocked(
      controlPool,
      targetPool,
      target,
      options,
    );
  } finally {
    if (acquired)
      await lockClient
        .query("SELECT pg_advisory_unlock(hashtextextended($1, 0))", [lockKey])
        .catch(() => undefined);
    lockClient.release();
  }
}

export async function collectAll(
  env: RuntimeEnv,
): Promise<CollectionSummary[]> {
  const registry = parseTargetRegistry(env);
  const controlConnection =
    typeof env["CONTROL_DATABASE_URL"] === "string"
      ? env["CONTROL_DATABASE_URL"]
      : typeof env["CONTROL_DB"] === "object" &&
          env["CONTROL_DB"] !== null &&
          "connectionString" in env["CONTROL_DB"]
        ? String(
            (env["CONTROL_DB"] as { connectionString: unknown })
              .connectionString,
          )
        : typeof env["DATABASE_URL"] === "string"
          ? env["DATABASE_URL"]
          : undefined;
  if (!controlConnection)
    throw new Error(
      "A control database binding or connection string is required",
    );
  const controlPool = createDatabasePool(controlConnection, { max: 4 });
  const targetPools = [...registry.values()].map((target) => ({
    target,
    pool: createDatabasePool(target.connectionString, { max: 8 }),
  }));
  try {
    const retention = {
      retentionDays: integerFromEnv(env, "COLLECTION_RETENTION_DAYS", 14, {
        min: 1,
        max: 3650,
      }),
      maximumRuns: integerFromEnv(env, "COLLECTION_MAX_RUNS", 5_000, {
        min: 10,
        max: 100_000,
      }),
    };
    const results: CollectionSummary[] = [];
    for (let offset = 0; offset < targetPools.length; offset += 2) {
      const batch = await Promise.all(
        targetPools.slice(offset, offset + 2).map(async ({ target, pool }) => {
          try {
            return await collectTarget(controlPool, pool, target, retention);
          } catch (error) {
            return {
              target: target.key,
              runId: 0,
              status: "failed" as const,
              queries: 0,
              tables: 0,
              indexes: 0,
              activities: 0,
              resetDetected: false,
              findings: 0,
              prunedRuns: 0,
              error: (error instanceof Error
                ? error.message
                : "Collection failed"
              ).slice(0, 500),
            };
          }
        }),
      );
      results.push(...batch);
    }
    return results;
  } finally {
    await Promise.allSettled([
      controlPool.end(),
      ...targetPools.map(({ pool }) => pool.end()),
    ]);
  }
}

async function main(): Promise<void> {
  const results = await collectAll(process.env);
  for (const result of results) {
    console.log(
      `${result.target}: ${result.queries} queries, ${result.tables} tables, ${result.indexes} indexes, ${result.activities} sessions, ${result.findings} findings`,
    );
  }
}

const isDirectRun =
  process.argv[1] &&
  fileURLToPath(import.meta.url) === resolve(process.argv[1]);
if (isDirectRun) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
