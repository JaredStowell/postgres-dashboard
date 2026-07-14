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
});
