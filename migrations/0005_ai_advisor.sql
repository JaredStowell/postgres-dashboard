CREATE TABLE IF NOT EXISTS index_analyzer.ai_analysis_requests (
  id uuid PRIMARY KEY,
  source_database_id bigint NOT NULL REFERENCES index_analyzer.source_databases(id) ON DELETE CASCADE,
  explain_run_id uuid REFERENCES index_analyzer.explain_runs(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  completed_at timestamptz,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'running', 'succeeded', 'failed')),
  mode text NOT NULL CHECK (mode IN ('balanced', 'deep')),
  model text NOT NULL,
  payload_digest text NOT NULL,
  payload_preview jsonb NOT NULL,
  request_size_bytes integer NOT NULL CHECK (request_size_bytes BETWEEN 0 AND 262144),
  provider_request_id text,
  input_tokens integer,
  output_tokens integer,
  error_code text,
  error_message text CHECK (error_message IS NULL OR length(error_message) <= 2000)
);

CREATE INDEX IF NOT EXISTS ai_requests_database_created_idx
  ON index_analyzer.ai_analysis_requests (source_database_id, created_at DESC);
CREATE INDEX IF NOT EXISTS ai_requests_digest_idx
  ON index_analyzer.ai_analysis_requests (payload_digest, created_at DESC);

CREATE TABLE IF NOT EXISTS index_analyzer.ai_analysis_results (
  request_id uuid PRIMARY KEY REFERENCES index_analyzer.ai_analysis_requests(id) ON DELETE CASCADE,
  summary text NOT NULL,
  severity text NOT NULL CHECK (severity IN ('info', 'low', 'medium', 'high', 'critical')),
  confidence double precision NOT NULL CHECK (confidence BETWEEN 0 AND 1),
  evidence jsonb NOT NULL,
  caveats jsonb NOT NULL,
  recommendations jsonb NOT NULL,
  validation_steps jsonb NOT NULL,
  migration_sql text,
  raw_structured_response jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE TABLE IF NOT EXISTS index_analyzer.ai_recommendations (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  request_id uuid NOT NULL REFERENCES index_analyzer.ai_analysis_requests(id) ON DELETE CASCADE,
  ordinal integer NOT NULL CHECK (ordinal >= 0),
  title text NOT NULL,
  rationale text NOT NULL,
  risk text NOT NULL,
  confidence double precision NOT NULL CHECK (confidence BETWEEN 0 AND 1),
  migration_sql text,
  status text NOT NULL DEFAULT 'proposed' CHECK (status IN ('proposed', 'accepted', 'dismissed')),
  UNIQUE (request_id, ordinal)
);
