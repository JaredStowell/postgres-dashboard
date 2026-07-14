CREATE TABLE IF NOT EXISTS index_analyzer.database_snapshots (
  collection_run_id bigint PRIMARY KEY REFERENCES index_analyzer.collection_runs(id) ON DELETE CASCADE,
  captured_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  stats_reset timestamptz,
  database_size_bytes bigint NOT NULL,
  active_connections integer NOT NULL,
  xact_commit bigint NOT NULL,
  xact_rollback bigint NOT NULL,
  blks_read bigint NOT NULL,
  blks_hit bigint NOT NULL,
  temp_bytes bigint NOT NULL,
  deadlocks bigint NOT NULL
);

CREATE INDEX IF NOT EXISTS database_snapshots_captured_idx
  ON index_analyzer.database_snapshots (captured_at DESC);

CREATE TABLE IF NOT EXISTS index_analyzer.query_snapshots (
  collection_run_id bigint NOT NULL REFERENCES index_analyzer.collection_runs(id) ON DELETE CASCADE,
  query_id text NOT NULL,
  user_oid oid NOT NULL,
  database_oid oid NOT NULL,
  normalized_query text NOT NULL CHECK (length(normalized_query) <= 50000),
  toplevel boolean NOT NULL DEFAULT true,
  calls bigint NOT NULL,
  total_plan_time double precision NOT NULL,
  mean_plan_time double precision NOT NULL,
  total_exec_time double precision NOT NULL,
  mean_exec_time double precision NOT NULL,
  rows bigint NOT NULL,
  shared_blks_hit bigint NOT NULL,
  shared_blks_read bigint NOT NULL,
  shared_blks_dirtied bigint NOT NULL,
  shared_blks_written bigint NOT NULL,
  temp_blks_read bigint NOT NULL,
  temp_blks_written bigint NOT NULL,
  wal_records bigint NOT NULL,
  wal_bytes numeric NOT NULL,
  stats_since timestamptz,
  minmax_stats_since timestamptz,
  PRIMARY KEY (collection_run_id, query_id, user_oid, database_oid, toplevel)
);

CREATE INDEX IF NOT EXISTS query_snapshots_query_history_idx
  ON index_analyzer.query_snapshots (query_id, collection_run_id DESC);
CREATE INDEX IF NOT EXISTS query_snapshots_total_time_idx
  ON index_analyzer.query_snapshots (collection_run_id, total_exec_time DESC);

CREATE TABLE IF NOT EXISTS index_analyzer.table_snapshots (
  collection_run_id bigint NOT NULL REFERENCES index_analyzer.collection_runs(id) ON DELETE CASCADE,
  relation_oid oid NOT NULL,
  schema_name name NOT NULL,
  table_name name NOT NULL,
  estimated_rows bigint NOT NULL,
  live_rows bigint NOT NULL,
  dead_rows bigint NOT NULL,
  modifications_since_analyze bigint NOT NULL,
  sequential_scans bigint NOT NULL,
  sequential_tuples_read bigint NOT NULL,
  index_scans bigint,
  inserted bigint NOT NULL,
  updated bigint NOT NULL,
  deleted bigint NOT NULL,
  hot_updated bigint NOT NULL,
  relation_size_bytes bigint NOT NULL,
  total_size_bytes bigint NOT NULL,
  last_vacuum timestamptz,
  last_autovacuum timestamptz,
  last_analyze timestamptz,
  last_autoanalyze timestamptz,
  vacuum_count bigint NOT NULL,
  autovacuum_count bigint NOT NULL,
  analyze_count bigint NOT NULL,
  autoanalyze_count bigint NOT NULL,
  PRIMARY KEY (collection_run_id, relation_oid)
);

CREATE INDEX IF NOT EXISTS table_snapshots_relation_history_idx
  ON index_analyzer.table_snapshots (relation_oid, collection_run_id DESC);
CREATE INDEX IF NOT EXISTS table_snapshots_dead_rows_idx
  ON index_analyzer.table_snapshots (collection_run_id, dead_rows DESC);

CREATE TABLE IF NOT EXISTS index_analyzer.index_snapshots (
  collection_run_id bigint NOT NULL REFERENCES index_analyzer.collection_runs(id) ON DELETE CASCADE,
  index_oid oid NOT NULL,
  table_oid oid NOT NULL,
  schema_name name NOT NULL,
  table_name name NOT NULL,
  index_name name NOT NULL,
  index_definition text NOT NULL,
  access_method name NOT NULL,
  is_unique boolean NOT NULL,
  is_primary boolean NOT NULL,
  is_valid boolean NOT NULL,
  is_ready boolean NOT NULL,
  scans bigint NOT NULL,
  tuples_read bigint NOT NULL,
  tuples_fetched bigint NOT NULL,
  size_bytes bigint NOT NULL,
  key_columns text[] NOT NULL DEFAULT '{}',
  included_columns text[] NOT NULL DEFAULT '{}',
  predicate text,
  PRIMARY KEY (collection_run_id, index_oid)
);

CREATE INDEX IF NOT EXISTS index_snapshots_index_history_idx
  ON index_analyzer.index_snapshots (index_oid, collection_run_id DESC);
CREATE INDEX IF NOT EXISTS index_snapshots_usage_idx
  ON index_analyzer.index_snapshots (collection_run_id, scans, size_bytes DESC);

CREATE TABLE IF NOT EXISTS index_analyzer.activity_snapshots (
  collection_run_id bigint NOT NULL REFERENCES index_analyzer.collection_runs(id) ON DELETE CASCADE,
  process_id integer NOT NULL,
  captured_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  user_name name,
  application_name text,
  client_addr inet,
  state text,
  wait_event_type text,
  wait_event text,
  transaction_started_at timestamptz,
  query_started_at timestamptz,
  state_changed_at timestamptz,
  backend_type text,
  blocking_process_ids integer[] NOT NULL DEFAULT '{}',
  query_preview text,
  PRIMARY KEY (collection_run_id, process_id)
);

CREATE INDEX IF NOT EXISTS activity_snapshots_captured_idx
  ON index_analyzer.activity_snapshots (captured_at DESC);
