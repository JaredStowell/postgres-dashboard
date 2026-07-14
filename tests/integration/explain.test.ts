import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  EXPLAIN_ANALYZE_CONFIRMATION,
  runExplain,
  validateReadOnlyStatement,
} from "../../lib/db/explain";
import { createTestDatabase, type TestDatabase } from "./helpers";

describe("safe EXPLAIN execution", () => {
  let database: TestDatabase;

  beforeAll(async () => {
    database = await createTestDatabase({ seed: true });
  }, 30_000);

  afterAll(async () => {
    await database.destroy();
  });

  it("allows one parameterized read-only statement and returns JSON", async () => {
    const result = await runExplain(database.pool, {
      sql: "SELECT * FROM sales.orders WHERE customer_id = $1 ORDER BY created_at DESC LIMIT 10",
      parameters: [42],
    });
    expect(result.analyze).toBe(false);
    expect(Array.isArray(result.plan)).toBe(true);
  });

  it("requires an exact confirmation before executing ANALYZE", async () => {
    await expect(
      runExplain(database.pool, {
        sql: "SELECT count(*) FROM sales.orders",
        analyze: true,
      }),
    ).rejects.toThrow("requires confirmation");
    const result = await runExplain(database.pool, {
      sql: "SELECT count(*) FROM sales.orders",
      analyze: true,
      confirmation: EXPLAIN_ANALYZE_CONFIRMATION,
      statementTimeoutMs: 2_000,
    });
    expect(result.analyze).toBe(true);
  });

  it.each([
    "DELETE FROM sales.orders",
    "SELECT 1; SELECT 2",
    "WITH changed AS (UPDATE sales.orders SET status = 'paid' RETURNING *) SELECT * FROM changed",
    "SELECT * FROM sales.orders FOR UPDATE",
    "CREATE TABLE nope (id int)",
  ])("rejects prohibited SQL: %s", (sql) => {
    expect(() => validateReadOnlyStatement(sql)).toThrow();
  });

  it("does not mistake semicolons or keywords inside literals and comments for operations", () => {
    expect(
      validateReadOnlyStatement("SELECT 'DELETE; UPDATE', 1 -- DROP TABLE\n"),
    ).toContain("SELECT");
  });

  it("enforces the transaction read-only boundary for volatile write functions", async () => {
    await database.pool.query(`
      CREATE OR REPLACE FUNCTION public.fixture_write() RETURNS integer LANGUAGE plpgsql VOLATILE AS $$
      BEGIN INSERT INTO sales.orders(customer_id, status, total_cents) VALUES (1, 'bad', 1); RETURN 1; END $$
    `);
    await expect(
      runExplain(database.pool, {
        sql: "SELECT public.fixture_write()",
        analyze: true,
        confirmation: EXPLAIN_ANALYZE_CONFIRMATION,
      }),
    ).rejects.toThrow(/read-only transaction/i);
  });
});
