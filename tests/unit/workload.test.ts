import { describe, expect, it } from "vitest";

import type { Queryable } from "@/lib/db/client";
import { listQueryStats } from "@/lib/db/workload";

describe("pg_stat_statements capability degradation", () => {
  it("uses the extension schema and substitutes missing optional columns", async () => {
    const statements: string[] = [];
    const requiredColumns = [
      "queryid",
      "userid",
      "dbid",
      "query",
      "calls",
      "total_exec_time",
      "mean_exec_time",
      "rows",
      "shared_blks_hit",
      "shared_blks_read",
      "shared_blks_dirtied",
      "shared_blks_written",
      "temp_blks_read",
      "temp_blks_written",
    ];
    const db = {
      async query(text: string) {
        statements.push(text);
        if (text.includes("FROM pg_extension")) {
          return {
            rows: requiredColumns.map((attname) => ({
              schema_name: "telemetry",
              attname,
            })),
            rowCount: requiredColumns.length,
          };
        }
        return {
          rows: [
            {
              query_id: "42",
              user_oid: 10,
              user_name: "observer",
              database_oid: 20,
              database_name: "app",
              query: "SELECT 1",
              toplevel: true,
              calls: 1,
              total_plan_time: 0,
              mean_plan_time: 0,
              total_exec_time: 1,
              mean_exec_time: 1,
              rows: 1,
              shared_blks_hit: 1,
              shared_blks_read: 0,
              shared_blks_dirtied: 0,
              shared_blks_written: 0,
              temp_blks_read: 0,
              temp_blks_written: 0,
              wal_records: 0,
              wal_bytes: 0,
              stats_since: null,
              minmax_stats_since: null,
            },
          ],
          rowCount: 1,
        };
      },
    } as unknown as Queryable;

    const rows = await listQueryStats(db, { limit: 10 });
    expect(rows[0]).toMatchObject({
      queryId: "42",
      totalPlanTime: 0,
      walBytes: 0,
      statsSince: null,
    });
    const workloadSql = statements.at(-1) ?? "";
    expect(workloadSql).toContain('FROM "telemetry"."pg_stat_statements" s');
    expect(workloadSql).toContain("0 AS total_plan_time");
    expect(workloadSql).toContain("0 AS wal_bytes");
    expect(workloadSql).not.toContain("s.wal_bytes");
  });
});
