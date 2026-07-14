import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { detectCapabilities } from "../../lib/db/capabilities";
import {
  getTable,
  listDatabases,
  listSchemas,
  listTables,
} from "../../lib/db/catalog";
import { listQueryStats } from "../../lib/db/workload";
import { findIndexRelationships, listIndexes } from "../../lib/db/indexes";
import {
  exactBloatCheck,
  listMaintenanceProgress,
  listTableMaintenance,
} from "../../lib/db/maintenance";
import { listActivity } from "../../lib/db/activity";
import { getDatabaseStat } from "../../lib/db/database";
import { createTestDatabase, type TestDatabase } from "./helpers";

describe("PostgreSQL repositories", () => {
  let database: TestDatabase;

  beforeAll(async () => {
    database = await createTestDatabase({ seed: true });
  }, 30_000);

  afterAll(async () => {
    await database.destroy();
  });

  it("detects extensions, settings, privileges, and supported columns", async () => {
    const capabilities = await detectCapabilities(database.pool);
    expect(capabilities.databaseName).toBe(database.name);
    expect(capabilities.serverVersionNumber).toBeGreaterThanOrEqual(140_000);
    expect(capabilities.extensions).toHaveProperty("pg_stat_statements");
    expect(capabilities.extensions).toHaveProperty("pgstattuple");
    expect(capabilities.supportedColumns["pg_stat_statements"]).toContain(
      "queryid",
    );
    expect(capabilities.settings["track_io_timing"]).toBe("on");
  });

  it("discovers every fixture schema and bounded table metadata", async () => {
    const [databases, schemas, tables] = await Promise.all([
      listDatabases(database.pool),
      listSchemas(database.pool),
      listTables(database.pool, { limit: 20 }),
    ]);
    expect(databases.some((item) => item.name === database.name)).toBe(true);
    expect(schemas.map((schema) => schema.name)).toEqual(
      expect.arrayContaining(["sales", "support", "analytics"]),
    );
    expect(
      tables.some(
        (table) => table.schema === "sales" && table.name === "orders",
      ),
    ).toBe(true);
    const orders = tables.find(
      (table) => table.schema === "sales" && table.name === "orders",
    );
    expect(orders?.totalBytes).toBeGreaterThan(0);
    const detail = await getTable(database.pool, orders!.oid);
    expect(detail?.columns?.map((column) => column.name)).toEqual(
      expect.arrayContaining(["customer_id", "status", "total_cents"]),
    );
  });

  it("reads pg_stat_statements with numeric metrics and search", async () => {
    const queries = await listQueryStats(database.pool, { limit: 100 });
    expect(queries.length).toBeGreaterThan(0);
    expect(queries.every((query) => Number.isFinite(query.totalExecTime))).toBe(
      true,
    );
    const workload = await listQueryStats(database.pool, {
      search: "sales.orders",
      limit: 100,
    });
    expect(workload.some((query) => query.query.includes("sales.orders"))).toBe(
      true,
    );
  });

  it("finds duplicate and prefix-overlapping indexes", async () => {
    const indexes = await listIndexes(database.pool, {
      schema: "sales",
      limit: 100,
    });
    const relationships = findIndexRelationships(indexes);
    expect(
      indexes.some((index) => index.name === "orders_status_unused_idx"),
    ).toBe(true);
    expect(relationships.some((item) => item.kind === "duplicate")).toBe(true);
    expect(relationships.some((item) => item.kind === "prefix")).toBe(true);
  });

  it("reports table maintenance, progress, and exact bloat", async () => {
    const maintenance = await listTableMaintenance(database.pool, {
      schema: "sales",
      limit: 100,
    });
    const orders = maintenance.find((table) => table.table === "orders");
    expect(orders?.liveRows).toBeGreaterThanOrEqual(8_000);
    expect(orders?.totalSizeBytes).toBeGreaterThan(0);
    expect(await listMaintenanceProgress(database.pool)).toEqual([]);
    const exact = await exactBloatCheck(database.pool, orders!.relationOid);
    expect(exact.tableLength).toBeGreaterThan(0);
    expect(exact.tuplePercent).toBeGreaterThan(0);
  });

  it("returns bounded activity and database health", async () => {
    const [activity, stats] = await Promise.all([
      listActivity(database.pool, { limit: 10 }),
      getDatabaseStat(database.pool),
    ]);
    expect(activity.length).toBeLessThanOrEqual(10);
    expect(stats.databaseSizeBytes).toBeGreaterThan(0);
    expect(stats.cacheHitRatio).toBeGreaterThanOrEqual(0);
    expect(stats.cacheHitRatio).toBeLessThanOrEqual(1);
  });
});
