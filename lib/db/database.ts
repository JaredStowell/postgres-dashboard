import type { Queryable } from "./client";
import { toNumber } from "./sql";

export interface DatabaseStat {
  capturedAt: Date;
  statsReset: Date | null;
  databaseSizeBytes: number;
  activeConnections: number;
  transactionCommits: number;
  transactionRollbacks: number;
  blocksRead: number;
  blocksHit: number;
  tempBytes: number;
  deadlocks: number;
  cacheHitRatio: number;
}

export async function getDatabaseStat(db: Queryable): Promise<DatabaseStat> {
  const result = await db.query<Record<string, unknown>>(`
    SELECT clock_timestamp() AS captured_at, d.stats_reset,
      pg_database_size(d.datid) AS database_size_bytes,
      (SELECT count(*) FROM pg_stat_activity a WHERE a.datid = d.datid) AS active_connections,
      d.xact_commit, d.xact_rollback, d.blks_read, d.blks_hit, d.temp_bytes, d.deadlocks
    FROM pg_stat_database d WHERE d.datname = current_database()
  `);
  const row = result.rows[0];
  if (!row) throw new Error("Current database statistics are unavailable");
  const hits = toNumber(row["blks_hit"]);
  const reads = toNumber(row["blks_read"]);
  return {
    capturedAt: new Date(String(row["captured_at"])),
    statsReset: row["stats_reset"]
      ? new Date(String(row["stats_reset"]))
      : null,
    databaseSizeBytes: toNumber(row["database_size_bytes"]),
    activeConnections: toNumber(row["active_connections"]),
    transactionCommits: toNumber(row["xact_commit"]),
    transactionRollbacks: toNumber(row["xact_rollback"]),
    blocksRead: reads,
    blocksHit: hits,
    tempBytes: toNumber(row["temp_bytes"]),
    deadlocks: toNumber(row["deadlocks"]),
    cacheHitRatio: hits + reads === 0 ? 1 : hits / (hits + reads),
  };
}
