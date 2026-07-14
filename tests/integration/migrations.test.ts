import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runMigrations } from "../../scripts/migrate";
import { createTestDatabase, type TestDatabase } from "./helpers";

describe("database migrations", () => {
  let database: TestDatabase;

  beforeAll(async () => {
    database = await createTestDatabase();
  });

  afterAll(async () => {
    await database.destroy();
  });

  it("applies all five migrations and records immutable checksums", async () => {
    const result = await database.pool.query<{
      version: string;
      checksum: string;
    }>(`
      SELECT version, checksum FROM index_analyzer.schema_migrations ORDER BY version
    `);
    expect(result.rows.map((row) => row.version)).toEqual([
      "0001_control_plane.sql",
      "0002_observability_history.sql",
      "0003_plans.sql",
      "0004_findings.sql",
      "0005_ai_advisor.sql",
    ]);
    expect(
      result.rows.every((row) => /^[a-f0-9]{64}$/.test(row.checksum)),
    ).toBe(true);
  });

  it("is safe to run repeatedly", async () => {
    const result = await runMigrations(database.pool);
    expect(result.applied).toEqual([]);
    expect(result.skipped).toHaveLength(5);
  });

  it("creates retention-friendly history indexes and default rules", async () => {
    const [indexes, rules] = await Promise.all([
      database.pool.query<{ indexname: string }>(`
        SELECT indexname FROM pg_indexes WHERE schemaname = 'index_analyzer'
      `),
      database.pool.query<{ rule_key: string }>(`
        SELECT rule_key FROM index_analyzer.alert_rules ORDER BY rule_key
      `),
    ]);
    expect(indexes.rows.map((row) => row.indexname)).toContain(
      "query_snapshots_query_history_idx",
    );
    expect(indexes.rows.map((row) => row.indexname)).toContain(
      "findings_database_status_seen_idx",
    );
    expect(rules.rows).toHaveLength(9);
  });
});
