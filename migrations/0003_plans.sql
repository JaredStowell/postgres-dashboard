CREATE TABLE IF NOT EXISTS index_analyzer.explain_runs (
  id uuid PRIMARY KEY,
  source_database_id bigint NOT NULL REFERENCES index_analyzer.source_databases(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  created_by text,
  query_digest text NOT NULL,
  normalized_query text NOT NULL CHECK (length(normalized_query) <= 50000),
  parameter_types text[] NOT NULL DEFAULT '{}',
  analyze_enabled boolean NOT NULL DEFAULT false,
  settings boolean NOT NULL DEFAULT true,
  statement_timeout_ms integer NOT NULL CHECK (statement_timeout_ms BETWEEN 100 AND 30000),
  plan_json jsonb NOT NULL,
  planning_time_ms double precision,
  execution_time_ms double precision,
  sanitized_export jsonb,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS explain_runs_database_created_idx
  ON index_analyzer.explain_runs (source_database_id, created_at DESC);
CREATE INDEX IF NOT EXISTS explain_runs_digest_created_idx
  ON index_analyzer.explain_runs (query_digest, created_at DESC);

CREATE TABLE IF NOT EXISTS index_analyzer.plan_comparisons (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  baseline_explain_run_id uuid NOT NULL REFERENCES index_analyzer.explain_runs(id) ON DELETE CASCADE,
  candidate_explain_run_id uuid NOT NULL REFERENCES index_analyzer.explain_runs(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  summary jsonb NOT NULL,
  diff jsonb NOT NULL,
  UNIQUE (baseline_explain_run_id, candidate_explain_run_id),
  CHECK (baseline_explain_run_id <> candidate_explain_run_id)
);
