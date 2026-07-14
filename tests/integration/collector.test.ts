import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ControlPlaneRepository } from "../../lib/db/control-plane";
import type { DatabasePool } from "../../lib/db/client";
import { collectTarget, pruneCollectionHistory } from "../../scripts/collect";
import { createTestDatabase, type TestDatabase } from "./helpers";

describe("snapshot collector and control plane", () => {
  let database: TestDatabase;

  beforeAll(async () => {
    database = await createTestDatabase({ seed: true });
  }, 30_000);

  afterAll(async () => {
    await database.destroy();
  });

  it("collects query, table, index, database, and activity snapshots", async () => {
    const summary = await collectTarget(database.pool, database.pool, {
      key: "fixture",
      label: "Fixture",
      binding: "DATABASE_URL",
    });
    expect(summary.queries).toBeGreaterThan(0);
    expect(summary.tables).toBeGreaterThanOrEqual(4);
    expect(summary.indexes).toBeGreaterThanOrEqual(6);
    expect(summary.findings).toBeGreaterThan(0);
    const run = await database.pool.query<Record<string, unknown>>(
      "SELECT * FROM index_analyzer.collection_runs WHERE id = $1",
      [summary.runId],
    );
    expect(run.rows[0]?.["status"]).toBe("succeeded");
    const snapshotCounts = await database.pool.query<{
      queries: string;
      tables: string;
      indexes: string;
    }>(
      `
      SELECT
        (SELECT count(*) FROM index_analyzer.query_snapshots WHERE collection_run_id = $1) AS queries,
        (SELECT count(*) FROM index_analyzer.table_snapshots WHERE collection_run_id = $1) AS tables,
        (SELECT count(*) FROM index_analyzer.index_snapshots WHERE collection_run_id = $1) AS indexes
    `,
      [summary.runId],
    );
    expect(Number(snapshotCounts.rows[0]?.queries)).toBe(summary.queries);
    expect(Number(snapshotCounts.rows[0]?.tables)).toBe(summary.tables);
    expect(Number(snapshotCounts.rows[0]?.indexes)).toBe(summary.indexes);
    const generatedFindings = await database.pool.query<{ count: string }>(
      "SELECT count(*) FROM index_analyzer.findings",
    );
    expect(Number(generatedFindings.rows[0]?.count)).toBeGreaterThan(0);
  });

  it("streams a complete multi-page pg_stat_statements inventory in identity order", async () => {
    for (let terms = 2; terms <= 225; terms += 1) {
      await database.pool.query(
        `SELECT ${Array.from({ length: terms }, () => "1").join(" + ")}`,
      );
    }
    const fixtureQueries = await database.pool.query<{ query_id: string }>(`
      SELECT queryid::text AS query_id
      FROM pg_stat_statements
      WHERE query LIKE 'SELECT $1 + $2%'
      ORDER BY queryid, userid, dbid, toplevel
    `);
    const fixtureIds = fixtureQueries.rows.map((row) => row.query_id);
    expect(fixtureIds.length).toBeGreaterThan(200);

    const summary = await collectTarget(database.pool, database.pool, {
      key: "fixture",
      label: "Fixture",
      binding: "DATABASE_URL",
    });
    expect(summary.queries).toBeGreaterThan(200);
    const persisted = await database.pool.query<{ query_id: string }>(
      `SELECT query_id FROM index_analyzer.query_snapshots
       WHERE collection_run_id = $1 AND query_id = ANY($2::text[])
       ORDER BY query_id`,
      [summary.runId, fixtureIds],
    );
    expect(new Set(persisted.rows.map((row) => row.query_id))).toEqual(
      new Set(fixtureIds),
    );
    const durableCount = await database.pool.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM index_analyzer.query_snapshots
       WHERE collection_run_id = $1`,
      [summary.runId],
    );
    expect(Number(durableCount.rows[0]?.count)).toBe(summary.queries);
  });

  it("creates history and deduplicates findings by stable fingerprint", async () => {
    const second = await collectTarget(database.pool, database.pool, {
      key: "fixture",
      label: "Fixture",
      binding: "DATABASE_URL",
    });
    const sourceDatabase = await database.pool.query<{ id: string }>(`
      SELECT sd.id FROM index_analyzer.source_databases sd
      JOIN index_analyzer.sources s ON s.id = sd.source_id WHERE s.source_key = 'fixture'
    `);
    const id = Number(sourceDatabase.rows[0]?.id);
    const repository = new ControlPlaneRepository(database.pool);
    const finding = {
      sourceDatabaseId: id,
      ruleKey: "duplicate-index",
      fingerprint: "duplicate:sales.orders:a:b",
      category: "index",
      severity: "warning" as const,
      title: "Duplicate index",
      summary: "Two fixture indexes have equivalent definitions.",
      evidence: { indexes: ["a", "b"] },
    };
    const firstFindingId = await repository.upsertFinding(finding);
    const secondFindingId = await repository.upsertFinding(finding);
    expect(secondFindingId).toBe(firstFindingId);
    const persisted = await database.pool.query<{ occurrence_count: number }>(
      "SELECT occurrence_count FROM index_analyzer.findings WHERE id = $1",
      [firstFindingId],
    );
    expect(persisted.rows[0]?.occurrence_count).toBe(2);
    expect(
      (await repository.listCollectionRuns(id, { limit: 10 })).length,
    ).toBeGreaterThanOrEqual(2);
    expect(second.runId).toBeGreaterThan(0);
  });

  it("skips overlapping collection under the per-target advisory lock", async () => {
    const lockClient = await database.pool.connect();
    const before = await database.pool.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM index_analyzer.collection_runs",
    );
    try {
      await lockClient.query(
        "SELECT pg_advisory_lock(hashtextextended($1, 0))",
        ["index-analyzer-collector:fixture"],
      );
      const summary = await collectTarget(database.pool, database.pool, {
        key: "fixture",
        label: "Fixture",
        binding: "DATABASE_URL",
      });
      expect(summary).toMatchObject({ status: "skipped", runId: 0 });
      const after = await database.pool.query<{ count: string }>(
        "SELECT count(*)::text AS count FROM index_analyzer.collection_runs",
      );
      expect(after.rows[0]?.count).toBe(before.rows[0]?.count);
    } finally {
      await lockClient.query(
        "SELECT pg_advisory_unlock(hashtextextended($1, 0))",
        ["index-analyzer-collector:fixture"],
      );
      lockClient.release();
    }
  });

  it("prunes aged and excess runs with snapshot cascades", async () => {
    const source = await database.pool.query<{ id: string }>(`
      SELECT sd.id::text FROM index_analyzer.source_databases sd
      JOIN index_analyzer.sources s ON s.id = sd.source_id
      WHERE s.source_key = 'fixture'
    `);
    const sourceDatabaseId = Number(source.rows[0]?.id);
    const aged = await database.pool.query<{ id: string }>(
      `SELECT id::text FROM index_analyzer.collection_runs
       WHERE source_database_id = $1 AND query_count > 0
       ORDER BY started_at LIMIT 1`,
      [sourceDatabaseId],
    );
    const agedRunId = Number(aged.rows[0]?.id);
    expect(agedRunId).toBeGreaterThan(0);
    await database.pool.query(
      "UPDATE index_analyzer.collection_runs SET started_at = clock_timestamp() - interval '30 days' WHERE id = $1",
      [agedRunId],
    );
    for (let index = 0; index < 12; index += 1) {
      await database.pool.query(
        `INSERT INTO index_analyzer.collection_runs
          (source_database_id, started_at, finished_at, status)
         VALUES ($1, clock_timestamp() - make_interval(secs => $2), clock_timestamp(), 'failed')`,
        [sourceDatabaseId, index],
      );
    }
    const before = await database.pool.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM index_analyzer.collection_runs WHERE source_database_id = $1",
      [sourceDatabaseId],
    );
    const pruned = await pruneCollectionHistory(
      database.pool,
      sourceDatabaseId,
      { retentionDays: 1, maximumRuns: 10 },
    );
    const after = await database.pool.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM index_analyzer.collection_runs WHERE source_database_id = $1",
      [sourceDatabaseId],
    );
    expect(Number(after.rows[0]?.count)).toBe(10);
    expect(pruned).toBe(Number(before.rows[0]?.count) - 10);
    const cascades = await database.pool.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM index_analyzer.query_snapshots WHERE collection_run_id = $1",
      [agedRunId],
    );
    expect(cascades.rows[0]?.count).toBe("0");
  });

  it("prunes retained history after an actual collection failure", async () => {
    const failingTarget = {
      query(text: string, values?: readonly unknown[]) {
        if (text.includes('"pg_stat_statements" s')) {
          return Promise.reject(new Error("fixture collection failure"));
        }
        return database.pool.query(text, values);
      },
      connect: () => database.pool.connect(),
      end: async () => undefined,
    } as DatabasePool;
    await expect(
      collectTarget(
        database.pool,
        failingTarget,
        {
          key: "fixture",
          label: "Fixture",
          binding: "DATABASE_URL",
        },
        { retentionDays: 1, maximumRuns: 10 },
      ),
    ).rejects.toThrow("fixture collection failure");
    const retained = await database.pool.query<{
      count: string;
      failed: string;
    }>(`
      SELECT count(*)::text AS count,
        count(*) FILTER (WHERE status = 'failed' AND error_message LIKE '%fixture collection failure%')::text AS failed
      FROM index_analyzer.collection_runs cr
      JOIN index_analyzer.source_databases sd ON sd.id = cr.source_database_id
      JOIN index_analyzer.sources s ON s.id = sd.source_id
      WHERE s.source_key = 'fixture'
    `);
    expect(retained.rows[0]).toEqual({ count: "10", failed: "1" });
  });

  it("honors seeded thresholds and emits maintenance, plan-change, and missing-index findings", async () => {
    const sourceDatabase = await database.pool.query<{ id: string }>(`
      SELECT sd.id FROM index_analyzer.source_databases sd
      JOIN index_analyzer.sources s ON s.id = sd.source_id WHERE s.source_key = 'fixture'
    `);
    const sourceDatabaseId = Number(sourceDatabase.rows[0]?.id);
    await database.pool.query(`
      UPDATE index_analyzer.alert_rules
      SET configuration = CASE rule_key
        WHEN 'vacuum-staleness' THEN '{"hours": 1, "minimum": 1}'::jsonb
        WHEN 'analyze-staleness' THEN '{"hours": 1, "ratio": 0, "minimum": 1}'::jsonb
        WHEN 'missing-index' THEN '{"minimumScore": 0, "minimumRows": 100, "maximumPlans": 20}'::jsonb
        WHEN 'plan-change' THEN '{"executionRatio": 0.1, "costRatio": 0.1}'::jsonb
        ELSE configuration
      END
      WHERE rule_key IN ('vacuum-staleness', 'analyze-staleness', 'missing-index', 'plan-change')
    `);
    await database.pool.query(`
      ALTER TABLE support.tickets SET (autovacuum_enabled = false, toast.autovacuum_enabled = false)
    `);
    await database.pool.query(
      `SELECT pg_stat_reset_single_table_counters('support.tickets'::regclass)`,
    );
    await database.pool.query(`
      UPDATE support.tickets SET priority = priority WHERE id <= 25
    `);
    await database.pool.query("SELECT pg_stat_force_next_flush()");

    const baselineId = crypto.randomUUID();
    const candidateId = crypto.randomUUID();
    const missingId = crypto.randomUUID();
    await database.pool.query(
      `
      INSERT INTO index_analyzer.explain_runs
        (id, source_database_id, created_at, query_digest, normalized_query,
         analyze_enabled, statement_timeout_ms, plan_json)
      VALUES
        ($1, $4, clock_timestamp() - interval '2 minutes', 'plan-change-fixture',
         'select * from support.tickets where customer_id = $1', false, 5000, $5::jsonb),
        ($2, $4, clock_timestamp() - interval '1 minute', 'plan-change-fixture',
         'select * from support.tickets where customer_id = $1', false, 5000, $6::jsonb),
        ($3, $4, clock_timestamp(), 'missing-index-fixture',
         'select * from support.tickets where priority = $1', false, 5000, $7::jsonb)
    `,
      [
        baselineId,
        candidateId,
        missingId,
        sourceDatabaseId,
        JSON.stringify([
          {
            Plan: {
              "Node Type": "Seq Scan",
              Schema: "support",
              "Relation Name": "tickets",
              Alias: "tickets",
              Filter: "(customer_id = 42)",
              "Plan Rows": 2500,
              "Total Cost": 80,
            },
            "Execution Time": 5,
          },
        ]),
        JSON.stringify([
          {
            Plan: {
              "Node Type": "Index Scan",
              Schema: "support",
              "Relation Name": "tickets",
              Alias: "tickets",
              "Index Name": "tickets_customer_idx",
              "Index Cond": "(customer_id = 42)",
              "Plan Rows": 25,
              "Total Cost": 8,
            },
            "Execution Time": 1,
          },
        ]),
        JSON.stringify([
          {
            Plan: {
              "Node Type": "Seq Scan",
              Schema: "support",
              "Relation Name": "tickets",
              Alias: "tickets",
              Filter: "(priority = 4)",
              "Plan Rows": 2500,
              "Actual Rows": 25,
              "Rows Removed by Filter": 2475,
              "Actual Loops": 1,
              "Total Cost": 90,
            },
            "Execution Time": 7,
          },
        ]),
      ],
    );

    await collectTarget(database.pool, database.pool, {
      key: "fixture",
      label: "Fixture",
      binding: "DATABASE_URL",
    });

    const findings = await database.pool.query<{
      rule_key: string;
      evidence: Record<string, unknown>;
    }>(`
      SELECT r.rule_key, f.evidence
      FROM index_analyzer.findings f
      JOIN index_analyzer.alert_rules r ON r.id = f.rule_id
      WHERE r.rule_key IN ('vacuum-staleness', 'analyze-staleness', 'missing-index', 'plan-change')
    `);
    const keys = findings.rows.map((row) => row.rule_key);
    expect(keys).toEqual(
      expect.arrayContaining([
        "vacuum-staleness",
        "analyze-staleness",
        "missing-index",
        "plan-change",
      ]),
    );
    expect(
      findings.rows.find((row) => row.rule_key === "missing-index")?.evidence,
    ).toMatchObject({
      queryDigest: "missing-index-fixture",
      columns: ["priority"],
    });
    expect(
      findings.rows.find((row) => row.rule_key === "plan-change")?.evidence,
    ).toMatchObject({
      baselineExplainRunId: baselineId,
      candidateExplainRunId: candidateId,
    });
  });
});
