import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { RuntimeEnv } from "../lib/config/env";
import { parseTargetRegistry } from "../lib/config/targets";
import { createDatabasePool, type DatabasePool } from "../lib/db/client";
import { detectCapabilities } from "../lib/db/capabilities";
import { getDatabaseStat } from "../lib/db/database";
import { listQueryStats, type QueryStat } from "../lib/db/workload";
import {
  listTableMaintenance,
  type TableMaintenance,
} from "../lib/db/maintenance";
import { listIndexes, type IndexInfo } from "../lib/db/indexes";
import { findIndexRelationships } from "../lib/db/indexes";
import { listActivity } from "../lib/db/activity";
import { ControlPlaneRepository } from "../lib/db/control-plane";
import { stableFindingFingerprint } from "../lib/analysis/findings";

const BATCH_SIZE = 250;
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

export interface CollectionSummary {
  target: string;
  runId: number;
  queries: number;
  tables: number;
  indexes: number;
  activities: number;
  resetDetected: boolean;
  findings: number;
}

interface FindingCandidate {
  ruleKey: string;
  category: string;
  severity: "info" | "warning" | "critical";
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
): Promise<FindingCandidate[]> {
  const result = await controlPool.query<Record<string, unknown>>(
    `
    WITH recent_runs AS (
      SELECT id, started_at FROM index_analyzer.collection_runs
      WHERE source_database_id = $1 AND id <= $2
      ORDER BY started_at DESC LIMIT 5
    ), ordered AS (
      SELECT qs.query_id, r.started_at, qs.calls, qs.total_exec_time,
        lag(qs.calls) OVER (PARTITION BY qs.query_id ORDER BY r.started_at) AS prior_calls,
        lag(qs.total_exec_time) OVER (PARTITION BY qs.query_id ORDER BY r.started_at) AS prior_exec
      FROM recent_runs r
      JOIN index_analyzer.query_snapshots qs ON qs.collection_run_id = r.id
    ), deltas AS (
      SELECT *, calls - prior_calls AS call_delta, total_exec_time - prior_exec AS exec_delta,
        row_number() OVER (PARTITION BY query_id ORDER BY started_at DESC) AS recency
      FROM ordered
      WHERE prior_calls IS NOT NULL AND calls >= prior_calls AND total_exec_time >= prior_exec
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
    WHERE recent_calls >= 20 AND baseline_calls >= 20
      AND recent_exec / NULLIF(recent_calls, 0) >
        (baseline_exec / NULLIF(baseline_calls, 0)) * 1.25
    ORDER BY recent_exec DESC LIMIT 100
  `,
    [sourceDatabaseId, currentRunId],
  );
  return result.rows.map((row) => {
    const recent = Number(row["recent_mean"]);
    const baseline = Number(row["baseline_mean"]);
    const ratio = recent / baseline;
    return {
      ruleKey: "query-regression",
      category: "query",
      severity: ratio >= 2 ? "critical" : "warning",
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
  },
): Promise<number> {
  const candidates: FindingCandidate[] = [];
  for (const table of input.tables) {
    const deadRatio =
      table.deadRows / Math.max(1, table.liveRows + table.deadRows);
    if (table.deadRows >= 1_000 && deadRatio >= 0.1) {
      candidates.push({
        ruleKey: "dead-tuples",
        category: "maintenance",
        severity: deadRatio >= 0.3 ? "critical" : "warning",
        title: `Dead tuple pressure on ${table.schema}.${table.table}`,
        summary:
          "The observed dead tuple ratio exceeds the bounded collector threshold.",
        resourceType: "table",
        resourceKey: `${table.schema}.${table.table}`,
        evidence: {
          deadRows: table.deadRows,
          liveRows: table.liveRows,
          deadRatio,
        },
        href: "/maintenance",
      });
    }
    if (table.transactionIdAge >= 150_000_000) {
      candidates.push({
        ruleKey: "freeze-risk",
        category: "maintenance",
        severity:
          table.transactionIdAge >= 180_000_000 ? "critical" : "warning",
        title: `Freeze age risk on ${table.schema}.${table.table}`,
        summary:
          "The relation transaction ID age is approaching the default freeze ceiling.",
        resourceType: "table",
        resourceKey: `${table.schema}.${table.table}:freeze`,
        evidence: {
          transactionIdAge: table.transactionIdAge,
          defaultFreezeMaxAge: 200_000_000,
        },
        href: "/maintenance",
      });
    }
  }
  for (const index of input.indexes) {
    if (
      index.scans === 0 &&
      !index.constraintBacked &&
      index.sizeBytes >= 1_048_576
    ) {
      candidates.push({
        ruleKey: "unused-index",
        category: "index",
        severity: "info",
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
        },
        href: "/indexes",
      });
    }
  }
  for (const relationship of findIndexRelationships(input.indexes)) {
    candidates.push({
      ruleKey: "duplicate-index",
      category: "index",
      severity: relationship.kind === "duplicate" ? "warning" : "info",
      title: `${relationship.kind === "duplicate" ? "Duplicate" : "Overlapping"} indexes ${relationship.leftName} and ${relationship.rightName}`,
      summary:
        "Catalog definitions show redundant or left-prefix coverage; validate workload before removal.",
      resourceType: "index-pair",
      resourceKey: `${relationship.leftIndexOid}:${relationship.rightIndexOid}`,
      evidence: { kind: relationship.kind, evidence: relationship.evidence },
      href: "/indexes",
    });
  }
  for (const session of input.activities) {
    if (session.blockingProcessIds.length > 0) {
      candidates.push({
        ruleKey: "blocked-session",
        category: "activity",
        severity: "critical",
        title: `Session ${session.processId} is blocked`,
        summary: "PostgreSQL reports one or more blocking backend process IDs.",
        resourceType: "session",
        resourceKey: String(session.processId),
        evidence: {
          processId: session.processId,
          blockingProcessIds: session.blockingProcessIds,
          waitEvent: session.waitEvent,
        },
        href: "/live",
      });
    }
    if (session.transactionAgeSeconds >= 60) {
      candidates.push({
        ruleKey: "long-transaction",
        category: "activity",
        severity: session.transactionAgeSeconds >= 600 ? "critical" : "warning",
        title: `Long transaction in session ${session.processId}`,
        summary:
          "The transaction age exceeds the configured observation threshold.",
        resourceType: "session",
        resourceKey: `${session.processId}:transaction`,
        evidence: {
          processId: session.processId,
          transactionAgeSeconds: session.transactionAgeSeconds,
          state: session.state,
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

export async function collectTarget(
  controlPool: DatabasePool,
  targetPool: DatabasePool,
  target: { key: string; label: string; binding: string },
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
  const runId = await control.startCollection(database.id);

  try {
    const [databaseStat, queries, tables, indexes, activities] =
      await Promise.all([
        getDatabaseStat(targetPool),
        capabilities.extensions["pg_stat_statements"]
          ? collectPages<QueryStat>((offset) =>
              listQueryStats(targetPool, { limit: BATCH_SIZE, offset }),
            )
          : Promise.resolve([]),
        collectPages<TableMaintenance>((offset) =>
          listTableMaintenance(targetPool, { limit: BATCH_SIZE, offset }),
        ),
        collectPages<IndexInfo>((offset) =>
          listIndexes(targetPool, { limit: BATCH_SIZE, offset }),
        ),
        listActivity(targetPool, { limit: BATCH_SIZE, includeIdle: true }),
      ]);
    const resetDetected = await control.saveDatabaseSnapshot(
      runId,
      databaseStat,
    );
    await control.saveQuerySnapshots(runId, queries);
    await control.saveTableSnapshots(runId, tables);
    await control.saveIndexSnapshots(runId, indexes);
    await control.saveActivitySnapshots(runId, activities);
    const findings = await generateFindings(control, controlPool, {
      sourceDatabaseId: database.id,
      sourceKey: target.key,
      database: capabilities.databaseName,
      runId,
      tables,
      indexes,
      activities,
    });
    await control.finishCollection(runId, {
      queries: queries.length,
      tables: tables.length,
      indexes: indexes.length,
      activities: activities.length,
      resetDetected,
    });
    return {
      target: target.key,
      runId,
      queries: queries.length,
      tables: tables.length,
      indexes: indexes.length,
      activities: activities.length,
      resetDetected,
      findings,
    };
  } catch (error) {
    await control.failCollection(runId, error);
    throw error;
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
    const results: CollectionSummary[] = [];
    for (const { target, pool } of targetPools) {
      results.push(await collectTarget(controlPool, pool, target));
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
