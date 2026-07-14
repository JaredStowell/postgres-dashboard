import { createDatabasePool, type DatabasePool } from "../../lib/db/client";
import { quoteIdentifier } from "../../lib/db/sql";
import { runMigrations } from "../../scripts/migrate";
import { seedDatabase } from "../../scripts/seed";

const adminUrl =
  process.env["DATABASE_URL"] ??
  "postgres://index_analyzer:index_analyzer@127.0.0.1:55433/index_analyzer";

export interface TestDatabase {
  name: string;
  url: string;
  pool: DatabasePool;
  destroy(): Promise<void>;
}

export async function createTestDatabase(
  options: { seed?: boolean } = {},
): Promise<TestDatabase> {
  const name = `ia_test_${process.pid}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const admin = createDatabasePool(adminUrl, { max: 2 });
  await admin.query(`CREATE DATABASE ${quoteIdentifier(name)}`);
  const url = new URL(adminUrl);
  url.pathname = `/${name}`;
  const pool = createDatabasePool(url.toString(), { max: 8 });
  try {
    await pool.query("CREATE EXTENSION IF NOT EXISTS pg_stat_statements");
    await pool.query("CREATE EXTENSION IF NOT EXISTS pgstattuple");
    await runMigrations(pool);
    if (options.seed) await seedDatabase(pool);
  } catch (error) {
    await pool.end();
    await admin.query(`DROP DATABASE IF EXISTS ${quoteIdentifier(name)}`);
    await admin.end();
    throw error;
  }
  return {
    name,
    url: url.toString(),
    pool,
    async destroy() {
      await pool.end();
      await admin.query(`DROP DATABASE IF EXISTS ${quoteIdentifier(name)}`);
      await admin.end();
    },
  };
}
