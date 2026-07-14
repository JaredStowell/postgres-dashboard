import type { Queryable } from "./client";

export interface DatabaseCapabilities {
  databaseOid: number;
  databaseName: string;
  serverVersion: string;
  serverVersionNumber: number;
  isInRecovery: boolean;
  extensions: Record<string, string>;
  privileges: {
    readAllStats: boolean;
    readAllSettings: boolean;
    databaseConnect: boolean;
    databaseCreate: boolean;
  };
  settings: Record<string, string | null>;
  supportedColumns: Record<string, string[]>;
  warnings: string[];
}

interface CapabilityRow {
  database_oid: number;
  database_name: string;
  server_version: string;
  server_version_num: string;
  is_in_recovery: boolean;
  read_all_stats: boolean;
  read_all_settings: boolean;
  database_connect: boolean;
  database_create: boolean;
}

export async function detectCapabilities(
  db: Queryable,
): Promise<DatabaseCapabilities> {
  const [base, extensions, settings, columns] = await Promise.all([
    db.query<CapabilityRow>(`
      SELECT
        d.oid::int AS database_oid,
        current_database() AS database_name,
        current_setting('server_version') AS server_version,
        current_setting('server_version_num') AS server_version_num,
        pg_is_in_recovery() AS is_in_recovery,
        pg_has_role(current_user, 'pg_read_all_stats', 'MEMBER') AS read_all_stats,
        pg_has_role(current_user, 'pg_read_all_settings', 'MEMBER') AS read_all_settings,
        has_database_privilege(current_database(), 'CONNECT') AS database_connect,
        has_database_privilege(current_database(), 'CREATE') AS database_create
      FROM pg_database d
      WHERE d.datname = current_database()
    `),
    db.query<{ extname: string; extversion: string }>(`
      SELECT extname, extversion FROM pg_extension
      WHERE extname IN ('pg_stat_statements', 'pgstattuple', 'hypopg')
      ORDER BY extname
    `),
    db.query<{ name: string; setting: string }>(`
      SELECT name, setting FROM pg_settings
      WHERE name IN (
        'autovacuum', 'autovacuum_analyze_scale_factor', 'autovacuum_vacuum_scale_factor',
        'autovacuum_freeze_max_age', 'max_connections', 'pg_stat_statements.track',
        'track_io_timing', 'track_planning'
      )
    `),
    db.query<{ table_name: string; column_name: string }>(`
      SELECT table_name, column_name
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name IN ('pg_stat_statements', 'pg_stat_progress_vacuum', 'pg_stat_progress_create_index')
      UNION ALL
      SELECT c.relname, a.attname
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped
      WHERE n.nspname = 'pg_catalog'
        AND c.relname IN ('pg_stat_activity', 'pg_stat_all_tables', 'pg_stat_all_indexes')
      ORDER BY 1, 2
    `),
  ]);

  const row = base.rows[0];
  if (!row) throw new Error("Unable to detect database capabilities");
  const extensionMap = Object.fromEntries(
    extensions.rows.map((item) => [item.extname, item.extversion]),
  );
  const settingMap: Record<string, string | null> = Object.fromEntries(
    settings.rows.map((item) => [item.name, item.setting]),
  );
  const supportedColumns: Record<string, string[]> = {};
  for (const column of columns.rows) {
    (supportedColumns[column.table_name] ??= []).push(column.column_name);
  }

  const warnings: string[] = [];
  if (!("pg_stat_statements" in extensionMap))
    warnings.push("pg_stat_statements is not installed");
  if (!row.read_all_stats)
    warnings.push("Current role is not a member of pg_read_all_stats");
  if (settingMap["track_io_timing"] !== "on")
    warnings.push("track_io_timing is disabled");
  if (settingMap["track_planning"] !== "on")
    warnings.push("track_planning is disabled");

  return {
    databaseOid: row.database_oid,
    databaseName: row.database_name,
    serverVersion: row.server_version,
    serverVersionNumber: Number(row.server_version_num),
    isInRecovery: row.is_in_recovery,
    extensions: extensionMap,
    privileges: {
      readAllStats: row.read_all_stats,
      readAllSettings: row.read_all_settings,
      databaseConnect: row.database_connect,
      databaseCreate: row.database_create,
    },
    settings: settingMap,
    supportedColumns,
    warnings,
  };
}
