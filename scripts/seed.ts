import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createDatabasePool, type Queryable } from "../lib/db/client";

export async function seedDatabase(
  db: Queryable,
  fixturePath = resolve(process.cwd(), "db/fixtures/seed.sql"),
): Promise<void> {
  const fixture = await readFile(fixturePath, "utf8");
  await db.query(fixture);
  const workload = await readFile(
    resolve(process.cwd(), "db/fixtures/workload.sql"),
    "utf8",
  );
  for (let iteration = 0; iteration < 12; iteration += 1)
    await db.query(workload);
}

async function main(): Promise<void> {
  const connectionString = process.env["DATABASE_URL"];
  if (!connectionString) throw new Error("DATABASE_URL is required");
  const pool = createDatabasePool(connectionString, { max: 2 });
  try {
    await seedDatabase(pool);
    console.log("Fixture schemas, data, indexes, and workload are ready");
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
