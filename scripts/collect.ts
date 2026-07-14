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
import { listActivity } from "../lib/db/activity";
import { ControlPlaneRepository } from "../lib/db/control-plane";

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
      `${result.target}: ${result.queries} queries, ${result.tables} tables, ${result.indexes} indexes, ${result.activities} sessions`,
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
