CREATE SCHEMA IF NOT EXISTS index_analyzer;

CREATE TABLE IF NOT EXISTS index_analyzer.schema_migrations (
  version text PRIMARY KEY,
  checksum text NOT NULL,
  applied_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE TABLE IF NOT EXISTS index_analyzer.sources (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  source_key text NOT NULL UNIQUE CHECK (source_key ~ '^[a-z][a-z0-9_-]{0,62}$'),
  display_name text NOT NULL,
  binding_name text NOT NULL,
  enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE TABLE IF NOT EXISTS index_analyzer.source_databases (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  source_id bigint NOT NULL REFERENCES index_analyzer.sources(id) ON DELETE CASCADE,
  database_oid oid NOT NULL,
  database_name name NOT NULL,
  server_version integer NOT NULL,
  is_in_recovery boolean NOT NULL DEFAULT false,
  discovered_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  last_seen_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (source_id, database_oid)
);

CREATE INDEX IF NOT EXISTS source_databases_source_name_idx
  ON index_analyzer.source_databases (source_id, database_name);

CREATE TABLE IF NOT EXISTS index_analyzer.capabilities (
  source_database_id bigint PRIMARY KEY REFERENCES index_analyzer.source_databases(id) ON DELETE CASCADE,
  detected_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  server_version text NOT NULL,
  extensions jsonb NOT NULL DEFAULT '{}'::jsonb,
  privileges jsonb NOT NULL DEFAULT '{}'::jsonb,
  settings jsonb NOT NULL DEFAULT '{}'::jsonb,
  supported_columns jsonb NOT NULL DEFAULT '{}'::jsonb,
  warnings jsonb NOT NULL DEFAULT '[]'::jsonb
);

CREATE TABLE IF NOT EXISTS index_analyzer.collection_runs (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  source_database_id bigint NOT NULL REFERENCES index_analyzer.source_databases(id) ON DELETE CASCADE,
  started_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  finished_at timestamptz,
  status text NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'succeeded', 'failed')),
  query_count integer NOT NULL DEFAULT 0,
  table_count integer NOT NULL DEFAULT 0,
  index_count integer NOT NULL DEFAULT 0,
  activity_count integer NOT NULL DEFAULT 0,
  reset_detected boolean NOT NULL DEFAULT false,
  error_code text,
  error_message text CHECK (error_message IS NULL OR length(error_message) <= 2000)
);

CREATE INDEX IF NOT EXISTS collection_runs_database_started_idx
  ON index_analyzer.collection_runs (source_database_id, started_at DESC);
