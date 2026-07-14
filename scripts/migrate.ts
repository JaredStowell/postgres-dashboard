import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createDatabasePool, type DatabasePool } from "../lib/db/client";

const MIGRATION_PATTERN = /^\d{4}_[a-z0-9_]+\.sql$/;

export interface MigrationResult {
  applied: string[];
  skipped: string[];
}

export async function runMigrations(
  pool: DatabasePool,
  directory = resolve(process.cwd(), "migrations"),
): Promise<MigrationResult> {
  await pool.query("CREATE SCHEMA IF NOT EXISTS index_analyzer");
  await pool.query(`
    CREATE TABLE IF NOT EXISTS index_analyzer.schema_migrations (
      version text PRIMARY KEY,
      checksum text NOT NULL,
      applied_at timestamptz NOT NULL DEFAULT clock_timestamp()
    )
  `);
  const filenames = (await readdir(directory))
    .filter((name) => MIGRATION_PATTERN.test(name))
    .sort();
  if (filenames.length === 0)
    throw new Error(`No migrations found in ${directory}`);
  const applied: string[] = [];
  const skipped: string[] = [];

  for (const filename of filenames) {
    const sql = await readFile(resolve(directory, filename), "utf8");
    const checksum = createHash("sha256").update(sql).digest("hex");
    const existing = await pool.query<{ checksum: string }>(
      "SELECT checksum FROM index_analyzer.schema_migrations WHERE version = $1",
      [filename],
    );
    const previous = existing.rows[0];
    if (previous) {
      if (previous.checksum !== checksum) {
        throw new Error(`Migration checksum mismatch for ${filename}`);
      }
      skipped.push(filename);
      continue;
    }

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(sql);
      await client.query(
        "INSERT INTO index_analyzer.schema_migrations (version, checksum) VALUES ($1, $2)",
        [filename, checksum],
      );
      await client.query("COMMIT");
      applied.push(filename);
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
  return { applied, skipped };
}

async function main(): Promise<void> {
  const connectionString =
    process.env["CONTROL_DATABASE_URL"] ?? process.env["DATABASE_URL"];
  if (!connectionString)
    throw new Error("CONTROL_DATABASE_URL or DATABASE_URL is required");
  const pool = createDatabasePool(connectionString, { max: 2 });
  try {
    const result = await runMigrations(pool);
    console.log(
      `Migrations complete: ${result.applied.length} applied, ${result.skipped.length} unchanged`,
    );
  } finally {
    await pool.end();
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
