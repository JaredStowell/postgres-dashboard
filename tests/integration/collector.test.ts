import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ControlPlaneRepository } from "../../lib/db/control-plane";
import { collectTarget } from "../../scripts/collect";
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
});
