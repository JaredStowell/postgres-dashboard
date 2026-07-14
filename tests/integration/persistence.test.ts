import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { collectTarget } from "../../scripts/collect";
import { createTestDatabase, type TestDatabase } from "./helpers";
import { ControlPlaneRepository } from "../../lib/db/control-plane";
import {
  getQueryRegressionWindows,
  listLatestFleetSnapshots,
  listQueryHistory,
  listRegisteredDatabases,
} from "../../lib/db/history";
import {
  listExplainRuns,
  saveExplainRun,
  savePlanComparison,
} from "../../lib/db/plans";
import {
  addFindingAnnotation,
  listFindings,
  updateFindingStatus,
} from "../../lib/db/findings";
import {
  completeAiAnalysis,
  createAiAnalysisRequest,
  listAiAnalyses,
} from "../../lib/db/advisor";

describe("route-facing control-plane persistence", () => {
  let database: TestDatabase;
  let sourceDatabaseId: number;

  beforeAll(async () => {
    database = await createTestDatabase({ seed: true });
    for (let sample = 0; sample < 3; sample += 1) {
      await collectTarget(database.pool, database.pool, {
        key: "fixture",
        label: "Fixture",
        binding: "DATABASE_URL",
      });
    }
    const result = await database.pool.query<{ id: string }>(`
      SELECT sd.id FROM index_analyzer.source_databases sd
      JOIN index_analyzer.sources s ON s.id = sd.source_id WHERE s.source_key = 'fixture'
    `);
    sourceDatabaseId = Number(result.rows[0]?.id);
  }, 30_000);

  afterAll(async () => {
    await database.destroy();
  });

  it("reads registered targets, latest fleet state, history, and reset-aware regression windows", async () => {
    const [registered, fleet] = await Promise.all([
      listRegisteredDatabases(database.pool),
      listLatestFleetSnapshots(database.pool),
    ]);
    expect(registered[0]).toMatchObject({
      sourceKey: "fixture",
      databaseName: database.name,
    });
    expect(fleet[0]?.queryCount).toBeGreaterThan(0);

    const query = await database.pool.query<{ query_id: string }>(
      `
      SELECT query_id FROM index_analyzer.query_snapshots qs
      JOIN index_analyzer.collection_runs cr ON cr.id = qs.collection_run_id
      WHERE cr.source_database_id = $1
      GROUP BY query_id HAVING count(DISTINCT collection_run_id) >= 3
      ORDER BY count(*) DESC LIMIT 1
    `,
      [sourceDatabaseId],
    );
    const queryId = query.rows[0]!.query_id;
    expect(
      await listQueryHistory(database.pool, sourceDatabaseId, queryId, {
        limit: 20,
      }),
    ).toHaveLength(3);
    const windows = await getQueryRegressionWindows(
      database.pool,
      sourceDatabaseId,
      queryId,
      {
        recentSamples: 1,
        baselineSamples: 1,
      },
    );
    expect(windows.recent?.sampleCount).toBe(1);
    expect(windows.baseline?.sampleCount).toBe(1);
  });

  it("segments implicit pg_stat_statements counter resets from older baselines", async () => {
    const queryId = "-900000000000001";
    const calls = [100, 200, 10, 30, 60];
    const execution = [1_000, 2_000, 100, 500, 1_400];
    for (const [index, count] of calls.entries()) {
      const run = await database.pool.query<{ id: string }>(
        `INSERT INTO index_analyzer.collection_runs
          (source_database_id, started_at, finished_at, status)
         VALUES ($1, $2, $2, 'succeeded') RETURNING id::text`,
        [
          sourceDatabaseId,
          new Date(Date.now() + (index + 1) * 1_000).toISOString(),
        ],
      );
      await database.pool.query(
        `INSERT INTO index_analyzer.query_snapshots
          (collection_run_id, query_id, user_oid, database_oid,
           normalized_query, calls, total_plan_time, mean_plan_time,
           total_exec_time, mean_exec_time, rows, shared_blks_hit,
           shared_blks_read, shared_blks_dirtied, shared_blks_written,
           temp_blks_read, temp_blks_written, wal_records, wal_bytes)
         VALUES ($1, $2,
           (SELECT oid FROM pg_roles WHERE rolname = current_user),
           (SELECT oid FROM pg_database WHERE datname = current_database()),
           'SELECT implicit_reset_fixture', $3::bigint, 0, 0, $4::float8,
           $4::float8 / $3::float8, $3::bigint * 2, 0, 0, 0, 0, 0, 0, 0, 0)`,
        [Number(run.rows[0]?.id), queryId, count, execution[index]],
      );
    }
    const windows = await getQueryRegressionWindows(
      database.pool,
      sourceDatabaseId,
      queryId,
      { recentSamples: 1, baselineSamples: 3 },
    );
    expect(windows.recent).toMatchObject({
      sampleCount: 1,
      calls: 30,
      meanExecTimeMs: 30,
    });
    expect(windows.baseline).toMatchObject({
      sampleCount: 1,
      calls: 20,
      meanExecTimeMs: 20,
    });
    expect(windows.resetSamplesDiscarded).toBeGreaterThanOrEqual(3);
  });

  it("segments explicit collection reset boundaries from older baselines", async () => {
    const queryId = "-900000000000002";
    for (let index = 0; index < 5; index += 1) {
      const count = (index + 1) * 100;
      const run = await database.pool.query<{ id: string }>(
        `INSERT INTO index_analyzer.collection_runs
          (source_database_id, started_at, finished_at, status, reset_detected)
         VALUES ($1, $2, $2, 'succeeded', $3) RETURNING id::text`,
        [
          sourceDatabaseId,
          new Date(Date.now() + 60_000 + (index + 1) * 1_000).toISOString(),
          index === 2,
        ],
      );
      await database.pool.query(
        `INSERT INTO index_analyzer.query_snapshots
          (collection_run_id, query_id, user_oid, database_oid,
           normalized_query, calls, total_plan_time, mean_plan_time,
           total_exec_time, mean_exec_time, rows, shared_blks_hit,
           shared_blks_read, shared_blks_dirtied, shared_blks_written,
           temp_blks_read, temp_blks_written, wal_records, wal_bytes)
         VALUES ($1, $2,
           (SELECT oid FROM pg_roles WHERE rolname = current_user),
           (SELECT oid FROM pg_database WHERE datname = current_database()),
           'SELECT explicit_reset_fixture', $3::bigint, 0, 0,
           $3::float8 * 10, 10, $3::bigint * 2, 0, 0, 0, 0, 0, 0, 0, 0)`,
        [Number(run.rows[0]?.id), queryId, count],
      );
    }
    const windows = await getQueryRegressionWindows(
      database.pool,
      sourceDatabaseId,
      queryId,
      { recentSamples: 1, baselineSamples: 3 },
    );
    expect(windows.recent).toMatchObject({ sampleCount: 1, calls: 100 });
    expect(windows.baseline).toMatchObject({ sampleCount: 1, calls: 100 });
    expect(windows.resetSamplesDiscarded).toBeGreaterThanOrEqual(3);
  });

  it("does not bridge a query disappearance and later reappearance", async () => {
    const queryId = "-900000000000003";
    const calls = [100, null, 10, 20] as const;
    for (const [index, count] of calls.entries()) {
      const run = await database.pool.query<{ id: string }>(
        `INSERT INTO index_analyzer.collection_runs
          (source_database_id, started_at, finished_at, status)
         VALUES ($1, $2, $2, 'succeeded') RETURNING id::text`,
        [
          sourceDatabaseId,
          new Date(Date.now() + 120_000 + (index + 1) * 1_000).toISOString(),
        ],
      );
      if (count === null) continue;
      await database.pool.query(
        `INSERT INTO index_analyzer.query_snapshots
          (collection_run_id, query_id, user_oid, database_oid,
           normalized_query, calls, total_plan_time, mean_plan_time,
           total_exec_time, mean_exec_time, rows, shared_blks_hit,
           shared_blks_read, shared_blks_dirtied, shared_blks_written,
           temp_blks_read, temp_blks_written, wal_records, wal_bytes)
         VALUES ($1, $2,
           (SELECT oid FROM pg_roles WHERE rolname = current_user),
           (SELECT oid FROM pg_database WHERE datname = current_database()),
           'SELECT disappearance_fixture', $3::bigint, 0, 0,
           $3::float8 * 10, 10, $3::bigint, 0, 0, 0, 0, 0, 0, 0, 0)`,
        [Number(run.rows[0]?.id), queryId, count],
      );
    }
    const windows = await getQueryRegressionWindows(
      database.pool,
      sourceDatabaseId,
      queryId,
      { recentSamples: 1, baselineSamples: 3 },
    );
    expect(windows.recent).toMatchObject({ sampleCount: 1, calls: 10 });
    expect(windows.baseline).toBeNull();
    expect(windows.resetSamplesDiscarded).toBeGreaterThanOrEqual(2);
  });

  it("persists explain runs and idempotent plan comparisons", async () => {
    const baseline = await saveExplainRun(database.pool, {
      sourceDatabaseId,
      queryDigest: "sha256:fixture",
      normalizedQuery: "SELECT * FROM sales.orders WHERE customer_id = $1",
      parameterTypes: ["bigint"],
      analyze: false,
      statementTimeoutMs: 5_000,
      plan: [
        {
          Plan: {
            "Node Type": "Index Scan",
            "Total Cost": 10,
            Filter: "status = 'private-literal'",
          },
        },
      ],
    });
    const candidate = await saveExplainRun(database.pool, {
      sourceDatabaseId,
      queryDigest: "sha256:fixture",
      normalizedQuery: "SELECT * FROM sales.orders WHERE customer_id = $1",
      parameterTypes: ["bigint"],
      analyze: true,
      statementTimeoutMs: 5_000,
      plan: [
        {
          Plan: { "Node Type": "Index Scan", "Total Cost": 8 },
          "Execution Time": 0.2,
        },
      ],
    });
    const comparison = await savePlanComparison(database.pool, {
      baselineRunId: baseline,
      candidateRunId: candidate,
      summary: ["Cost decreased"],
      diff: { costRatio: 0.8 },
    });
    expect(comparison).toBeGreaterThan(0);
    expect(
      await savePlanComparison(database.pool, {
        baselineRunId: baseline,
        candidateRunId: candidate,
        summary: ["Cost decreased"],
        diff: { costRatio: 0.8 },
      }),
    ).toBe(comparison);
    const runs = await listExplainRuns(database.pool, sourceDatabaseId, {
      queryDigest: "sha256:fixture",
    });
    expect(runs).toHaveLength(2);
    expect(JSON.stringify(runs)).not.toContain("private-literal");
  });

  it("lists, transitions, and annotates deduplicated findings", async () => {
    const repository = new ControlPlaneRepository(database.pool);
    const findingId = await repository.upsertFinding({
      sourceDatabaseId,
      ruleKey: "duplicate-index",
      fingerprint: "duplicate:sales.orders:fixture",
      category: "index",
      severity: "high",
      title: "Duplicate fixture indexes",
      summary: "Equivalent key columns and predicates were observed.",
      evidence: { indexOids: [1, 2] },
    });
    await updateFindingStatus(database.pool, {
      findingId,
      status: "acknowledged",
      changedBy: "integration-test",
      note: "Review scheduled",
    });
    const annotationId = await addFindingAnnotation(
      database.pool,
      findingId,
      "Validated against the fixture workload.",
      "integration-test",
    );
    expect(annotationId).toBeGreaterThan(0);
    const findings = await listFindings(database.pool, {
      sourceDatabaseId,
      status: "acknowledged",
    });
    expect(findings[0]?.["id"]).toBe(String(findingId));
  });

  it("persists structured AI request, result, metadata, and recommendations atomically", async () => {
    const requestId = await createAiAnalysisRequest(database.pool, {
      sourceDatabaseId,
      mode: "balanced",
      model: "fixture-model",
      payloadDigest: "sha256:payload",
      payloadPreview: {
        query: "SELECT …",
        privacy: { resultRowsIncluded: false },
      },
      requestSizeBytes: 128,
    });
    await completeAiAnalysis(
      database.pool,
      requestId,
      {
        summary: "The plan is healthy but one redundant index is present.",
        severity: "medium",
        confidence: 0.9,
        evidence: [{ source: "index", claim: "Equivalent keys" }],
        caveats: ["Validate on production statistics"],
        recommendations: [
          {
            title: "Review redundant index",
            rationale: "Equivalent coverage increases write work.",
            risk: "low",
            confidence: 0.8,
            migrationSql:
              "DROP INDEX CONCURRENTLY sales.orders_customer_prefix_idx;",
          },
        ],
        validationSteps: ["Compare index usage over a full workload cycle"],
        rawStructuredResponse: { fixture: true },
      },
      { providerRequestId: "req_fixture", inputTokens: 100, outputTokens: 50 },
    );
    const analyses = await listAiAnalyses(database.pool, sourceDatabaseId);
    expect(analyses[0]).toMatchObject({
      id: requestId,
      status: "succeeded",
      provider_request_id: "req_fixture",
      severity: "medium",
    });
    const recommendations = await database.pool.query(
      "SELECT * FROM index_analyzer.ai_recommendations WHERE request_id = $1",
      [requestId],
    );
    expect(recommendations.rows).toHaveLength(1);
  });

  it("rejects oversized AI results before mutating persistence state", async () => {
    const requestId = await createAiAnalysisRequest(database.pool, {
      sourceDatabaseId,
      mode: "deep",
      model: "fixture-model",
      payloadDigest: "sha256:oversized",
      payloadPreview: { query: "SELECT * FROM sales.orders" },
      requestSizeBytes: 64,
    });
    await expect(
      completeAiAnalysis(
        database.pool,
        requestId,
        {
          summary: "Oversized fixture",
          severity: "info",
          confidence: 0.5,
          evidence: [],
          caveats: [],
          recommendations: [],
          validationSteps: [],
          rawStructuredResponse: { payload: "x".repeat(300 * 1_024) },
        },
        {},
      ),
    ).rejects.toThrow(/256 KiB/);
    const state = await database.pool.query<{
      status: string;
      results: string;
      recommendations: string;
    }>(
      `SELECT request.status,
        (SELECT count(*)::text FROM index_analyzer.ai_analysis_results result
         WHERE result.request_id = request.id) AS results,
        (SELECT count(*)::text FROM index_analyzer.ai_recommendations recommendation
         WHERE recommendation.request_id = request.id) AS recommendations
       FROM index_analyzer.ai_analysis_requests request WHERE request.id = $1`,
      [requestId],
    );
    expect(state.rows[0]).toEqual({
      status: "pending",
      results: "0",
      recommendations: "0",
    });
  });
});
