import type { Queryable } from "./client";
import type { DatabaseCapabilities } from "./capabilities";
import type { DatabaseStat } from "./database";
import type { QueryStat } from "./workload";
import type { TableMaintenance } from "./maintenance";
import type { IndexInfo } from "./indexes";
import type { ActivitySession } from "./activity";
import { boundedPage, type PageInput, toNumber } from "./sql";
import { redactSql } from "../analysis/sql-safety";

export interface SourceRecord {
  id: number;
  sourceKey: string;
  displayName: string;
  bindingName: string;
}

export interface SourceDatabaseRecord {
  id: number;
  sourceId: number;
  databaseOid: number;
  databaseName: string;
}

export class ControlPlaneRepository {
  constructor(private readonly db: Queryable) {}

  async upsertSource(
    sourceKey: string,
    displayName: string,
    bindingName: string,
  ): Promise<SourceRecord> {
    const result = await this.db.query<Record<string, unknown>>(
      `
      INSERT INTO index_analyzer.sources (source_key, display_name, binding_name)
      VALUES ($1, $2, $3)
      ON CONFLICT (source_key) DO UPDATE SET display_name = EXCLUDED.display_name,
        binding_name = EXCLUDED.binding_name, updated_at = clock_timestamp()
      RETURNING id, source_key, display_name, binding_name
    `,
      [sourceKey, displayName, bindingName],
    );
    const row = result.rows[0];
    if (!row) throw new Error("Failed to upsert source");
    return {
      id: toNumber(row["id"]),
      sourceKey: String(row["source_key"]),
      displayName: String(row["display_name"]),
      bindingName: String(row["binding_name"]),
    };
  }

  async upsertDatabase(
    sourceId: number,
    capabilities: DatabaseCapabilities,
  ): Promise<SourceDatabaseRecord> {
    const result = await this.db.query<Record<string, unknown>>(
      `
      INSERT INTO index_analyzer.source_databases
        (source_id, database_oid, database_name, server_version, is_in_recovery)
      VALUES ($1, $2, $3, $4, $5)
      ON CONFLICT (source_id, database_oid) DO UPDATE SET database_name = EXCLUDED.database_name,
        server_version = EXCLUDED.server_version, is_in_recovery = EXCLUDED.is_in_recovery,
        last_seen_at = clock_timestamp()
      RETURNING id, source_id, database_oid::int, database_name
    `,
      [
        sourceId,
        capabilities.databaseOid,
        capabilities.databaseName,
        capabilities.serverVersionNumber,
        capabilities.isInRecovery,
      ],
    );
    const row = result.rows[0];
    if (!row) throw new Error("Failed to upsert source database");
    return {
      id: toNumber(row["id"]),
      sourceId: toNumber(row["source_id"]),
      databaseOid: toNumber(row["database_oid"]),
      databaseName: String(row["database_name"]),
    };
  }

  async saveCapabilities(
    sourceDatabaseId: number,
    capability: DatabaseCapabilities,
  ): Promise<void> {
    await this.db.query(
      `
      INSERT INTO index_analyzer.capabilities
        (source_database_id, server_version, extensions, privileges, settings, supported_columns, warnings)
      VALUES ($1, $2, $3::jsonb, $4::jsonb, $5::jsonb, $6::jsonb, $7::jsonb)
      ON CONFLICT (source_database_id) DO UPDATE SET detected_at = clock_timestamp(),
        server_version = EXCLUDED.server_version, extensions = EXCLUDED.extensions,
        privileges = EXCLUDED.privileges, settings = EXCLUDED.settings,
        supported_columns = EXCLUDED.supported_columns, warnings = EXCLUDED.warnings
    `,
      [
        sourceDatabaseId,
        capability.serverVersion,
        JSON.stringify(capability.extensions),
        JSON.stringify(capability.privileges),
        JSON.stringify(capability.settings),
        JSON.stringify(capability.supportedColumns),
        JSON.stringify(capability.warnings),
      ],
    );
  }

  async startCollection(sourceDatabaseId: number): Promise<number> {
    const result = await this.db.query<{ id: string }>(
      `
      INSERT INTO index_analyzer.collection_runs (source_database_id) VALUES ($1) RETURNING id
    `,
      [sourceDatabaseId],
    );
    const row = result.rows[0];
    if (!row) throw new Error("Failed to start collection");
    return toNumber(row.id);
  }

  async finishCollection(
    runId: number,
    counts: {
      queries: number;
      tables: number;
      indexes: number;
      activities: number;
      resetDetected: boolean;
    },
  ): Promise<void> {
    await this.db.query(
      `
      UPDATE index_analyzer.collection_runs SET finished_at = clock_timestamp(), status = 'succeeded',
        query_count = $2, table_count = $3, index_count = $4, activity_count = $5, reset_detected = $6
      WHERE id = $1 AND status = 'running'
    `,
      [
        runId,
        counts.queries,
        counts.tables,
        counts.indexes,
        counts.activities,
        counts.resetDetected,
      ],
    );
  }

  async failCollection(runId: number, error: unknown): Promise<void> {
    const message = error instanceof Error ? error.message : String(error);
    const code =
      typeof error === "object" && error !== null && "code" in error
        ? String(error.code)
        : "COLLECTION_FAILED";
    await this.db.query(
      `
      UPDATE index_analyzer.collection_runs SET finished_at = clock_timestamp(), status = 'failed',
        error_code = left($2, 100), error_message = left($3, 2000)
      WHERE id = $1 AND status = 'running'
    `,
      [runId, code, message],
    );
  }

  async saveDatabaseSnapshot(
    runId: number,
    snapshot: DatabaseStat,
  ): Promise<boolean> {
    const prior = await this.db.query<{ stats_reset: Date | null }>(
      `
      SELECT ds.stats_reset FROM index_analyzer.database_snapshots ds
      JOIN index_analyzer.collection_runs cr ON cr.id = ds.collection_run_id
      JOIN index_analyzer.collection_runs current_run ON current_run.id = $1
      WHERE cr.source_database_id = current_run.source_database_id
      ORDER BY ds.captured_at DESC LIMIT 1
    `,
      [runId],
    );
    await this.db.query(
      `
      INSERT INTO index_analyzer.database_snapshots
        (collection_run_id, captured_at, stats_reset, database_size_bytes, active_connections,
         xact_commit, xact_rollback, blks_read, blks_hit, temp_bytes, deadlocks)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
    `,
      [
        runId,
        snapshot.capturedAt,
        snapshot.statsReset,
        snapshot.databaseSizeBytes,
        snapshot.activeConnections,
        snapshot.transactionCommits,
        snapshot.transactionRollbacks,
        snapshot.blocksRead,
        snapshot.blocksHit,
        snapshot.tempBytes,
        snapshot.deadlocks,
      ],
    );
    const previousReset = prior.rows[0]?.stats_reset;
    return (
      previousReset !== undefined &&
      String(previousReset ?? "") !== String(snapshot.statsReset ?? "")
    );
  }

  async saveQuerySnapshots(
    runId: number,
    rows: readonly QueryStat[],
  ): Promise<void> {
    if (rows.length === 0) return;
    await this.db.query(
      `
      INSERT INTO index_analyzer.query_snapshots
      SELECT $1, x.query_id, x.user_oid::oid, x.database_oid::oid, x.normalized_query, x.toplevel,
        x.calls, x.total_plan_time, x.mean_plan_time, x.total_exec_time, x.mean_exec_time, x.rows,
        x.shared_blks_hit, x.shared_blks_read, x.shared_blks_dirtied, x.shared_blks_written,
        x.temp_blks_read, x.temp_blks_written, x.wal_records, x.wal_bytes, x.stats_since, x.minmax_stats_since
      FROM jsonb_to_recordset($2::jsonb) AS x(
        query_id text, user_oid int, database_oid int, normalized_query text, toplevel boolean,
        calls bigint, total_plan_time float8, mean_plan_time float8, total_exec_time float8,
        mean_exec_time float8, rows bigint, shared_blks_hit bigint, shared_blks_read bigint,
        shared_blks_dirtied bigint, shared_blks_written bigint, temp_blks_read bigint,
        temp_blks_written bigint, wal_records bigint, wal_bytes numeric,
        stats_since timestamptz, minmax_stats_since timestamptz)
      ON CONFLICT DO NOTHING
    `,
      [
        runId,
        JSON.stringify(
          rows.map((row) => ({
            query_id: row.queryId,
            user_oid: row.userOid,
            database_oid: row.databaseOid,
            normalized_query: redactSql(row.query),
            toplevel: row.toplevel,
            calls: row.calls,
            total_plan_time: row.totalPlanTime,
            mean_plan_time: row.meanPlanTime,
            total_exec_time: row.totalExecTime,
            mean_exec_time: row.meanExecTime,
            rows: row.rows,
            shared_blks_hit: row.sharedBlocksHit,
            shared_blks_read: row.sharedBlocksRead,
            shared_blks_dirtied: row.sharedBlocksDirtied,
            shared_blks_written: row.sharedBlocksWritten,
            temp_blks_read: row.tempBlocksRead,
            temp_blks_written: row.tempBlocksWritten,
            wal_records: row.walRecords,
            wal_bytes: row.walBytes,
            stats_since: row.statsSince,
            minmax_stats_since: row.minmaxStatsSince,
          })),
        ),
      ],
    );
  }

  async saveTableSnapshots(
    runId: number,
    rows: readonly TableMaintenance[],
  ): Promise<void> {
    if (rows.length === 0) return;
    await this.db.query(
      `
      INSERT INTO index_analyzer.table_snapshots
      SELECT $1, x.relation_oid::oid, x.schema_name::name, x.table_name::name, x.estimated_rows,
        x.live_rows, x.dead_rows, x.modifications_since_analyze, x.sequential_scans,
        x.sequential_tuples_read, x.index_scans, x.inserted, x.updated, x.deleted, x.hot_updated,
        x.relation_size_bytes, x.total_size_bytes, x.last_vacuum, x.last_autovacuum,
        x.last_analyze, x.last_autoanalyze, x.vacuum_count, x.autovacuum_count,
        x.analyze_count, x.autoanalyze_count
      FROM jsonb_to_recordset($2::jsonb) AS x(
        relation_oid int, schema_name text, table_name text, estimated_rows bigint, live_rows bigint,
        dead_rows bigint, modifications_since_analyze bigint, sequential_scans bigint,
        sequential_tuples_read bigint, index_scans bigint, inserted bigint, updated bigint,
        deleted bigint, hot_updated bigint, relation_size_bytes bigint, total_size_bytes bigint,
        last_vacuum timestamptz, last_autovacuum timestamptz, last_analyze timestamptz,
        last_autoanalyze timestamptz, vacuum_count bigint, autovacuum_count bigint,
        analyze_count bigint, autoanalyze_count bigint)
      ON CONFLICT DO NOTHING
    `,
      [
        runId,
        JSON.stringify(
          rows.map((row) => ({
            relation_oid: row.relationOid,
            schema_name: row.schema,
            table_name: row.table,
            estimated_rows: row.estimatedRows,
            live_rows: row.liveRows,
            dead_rows: row.deadRows,
            modifications_since_analyze: row.modificationsSinceAnalyze,
            sequential_scans: row.sequentialScans,
            sequential_tuples_read: row.sequentialTuplesRead,
            index_scans: row.indexScans,
            inserted: row.inserted,
            updated: row.updated,
            deleted: row.deleted,
            hot_updated: row.hotUpdated,
            relation_size_bytes: row.relationSizeBytes,
            total_size_bytes: row.totalSizeBytes,
            last_vacuum: row.lastVacuum,
            last_autovacuum: row.lastAutovacuum,
            last_analyze: row.lastAnalyze,
            last_autoanalyze: row.lastAutoanalyze,
            vacuum_count: row.vacuumCount,
            autovacuum_count: row.autovacuumCount,
            analyze_count: row.analyzeCount,
            autoanalyze_count: row.autoanalyzeCount,
          })),
        ),
      ],
    );
  }

  async saveIndexSnapshots(
    runId: number,
    rows: readonly IndexInfo[],
  ): Promise<void> {
    if (rows.length === 0) return;
    await this.db.query(
      `
      INSERT INTO index_analyzer.index_snapshots
      SELECT $1, x.index_oid::oid, x.table_oid::oid, x.schema_name::name, x.table_name::name,
        x.index_name::name, x.index_definition, x.access_method::name, x.is_unique, x.is_primary,
        x.is_valid, x.is_ready, x.scans, x.tuples_read, x.tuples_fetched, x.size_bytes,
        x.key_columns, x.included_columns, x.predicate
      FROM jsonb_to_recordset($2::jsonb) AS x(
        index_oid int, table_oid int, schema_name text, table_name text, index_name text,
        index_definition text, access_method text, is_unique boolean, is_primary boolean,
        is_valid boolean, is_ready boolean, scans bigint, tuples_read bigint, tuples_fetched bigint,
        size_bytes bigint, key_columns text[], included_columns text[], predicate text)
      ON CONFLICT DO NOTHING
    `,
      [
        runId,
        JSON.stringify(
          rows.map((row) => ({
            index_oid: row.indexOid,
            table_oid: row.tableOid,
            schema_name: row.schema,
            table_name: row.table,
            index_name: row.name,
            index_definition: row.definition,
            access_method: row.accessMethod,
            is_unique: row.unique,
            is_primary: row.primary,
            is_valid: row.valid,
            is_ready: row.ready,
            scans: row.scans,
            tuples_read: row.tuplesRead,
            tuples_fetched: row.tuplesFetched,
            size_bytes: row.sizeBytes,
            key_columns: row.keyColumns,
            included_columns: row.includedColumns,
            predicate: row.predicate,
          })),
        ),
      ],
    );
  }

  async saveActivitySnapshots(
    runId: number,
    rows: readonly ActivitySession[],
  ): Promise<void> {
    if (rows.length === 0) return;
    await this.db.query(
      `
      INSERT INTO index_analyzer.activity_snapshots
      SELECT $1, x.process_id, clock_timestamp(), x.user_name::name, x.application_name,
        x.client_addr::inet, x.state, x.wait_event_type, x.wait_event, x.transaction_started_at,
        x.query_started_at, x.state_changed_at, x.backend_type, x.blocking_process_ids, x.query_preview
      FROM jsonb_to_recordset($2::jsonb) AS x(
        process_id int, user_name text, application_name text, client_addr text, state text,
        wait_event_type text, wait_event text, transaction_started_at timestamptz,
        query_started_at timestamptz, state_changed_at timestamptz, backend_type text,
        blocking_process_ids int[], query_preview text)
      ON CONFLICT DO NOTHING
    `,
      [
        runId,
        JSON.stringify(
          rows.map((row) => ({
            process_id: row.processId,
            user_name: row.userName,
            application_name: row.applicationName,
            client_addr: row.clientAddress,
            state: row.state,
            wait_event_type: row.waitEventType,
            wait_event: row.waitEvent,
            transaction_started_at: row.transactionStartedAt,
            query_started_at: row.queryStartedAt,
            state_changed_at: row.stateChangedAt,
            backend_type: row.backendType,
            blocking_process_ids: row.blockingProcessIds,
            query_preview: redactSql(row.queryPreview),
          })),
        ),
      ],
    );
  }

  async listCollectionRuns(
    sourceDatabaseId: number,
    input: PageInput = {},
  ): Promise<Record<string, unknown>[]> {
    const page = boundedPage(input);
    const result = await this.db.query<Record<string, unknown>>(
      `
      SELECT * FROM index_analyzer.collection_runs WHERE source_database_id = $1
      ORDER BY started_at DESC LIMIT $2 OFFSET $3
    `,
      [sourceDatabaseId, page.limit, page.offset],
    );
    return result.rows;
  }

  async upsertFinding(input: {
    sourceDatabaseId: number;
    ruleKey?: string;
    fingerprint: string;
    category: string;
    severity: "info" | "low" | "medium" | "warning" | "high" | "critical";
    title: string;
    summary: string;
    evidence: unknown;
    destination?: unknown;
  }): Promise<number> {
    const result = await this.db.query<{ id: string }>(
      `
      INSERT INTO index_analyzer.findings
        (source_database_id, rule_id, fingerprint, category, severity, title, summary, evidence, destination)
      VALUES ($1, (SELECT id FROM index_analyzer.alert_rules WHERE rule_key = $2), $3, $4, $5, $6, $7, $8::jsonb, $9::jsonb)
      ON CONFLICT (source_database_id, fingerprint) DO UPDATE SET last_seen_at = clock_timestamp(),
        occurrence_count = index_analyzer.findings.occurrence_count + 1, severity = EXCLUDED.severity,
        title = EXCLUDED.title, summary = EXCLUDED.summary, evidence = EXCLUDED.evidence,
        destination = EXCLUDED.destination,
        status = CASE WHEN index_analyzer.findings.status = 'resolved' THEN 'open' ELSE index_analyzer.findings.status END,
        resolved_at = CASE WHEN index_analyzer.findings.status = 'resolved' THEN NULL ELSE index_analyzer.findings.resolved_at END
      RETURNING id
    `,
      [
        input.sourceDatabaseId,
        input.ruleKey ?? null,
        input.fingerprint,
        input.category,
        input.severity,
        input.title,
        input.summary,
        JSON.stringify(input.evidence),
        JSON.stringify(input.destination ?? {}),
      ],
    );
    const row = result.rows[0];
    if (!row) throw new Error("Failed to upsert finding");
    return toNumber(row.id);
  }
}
