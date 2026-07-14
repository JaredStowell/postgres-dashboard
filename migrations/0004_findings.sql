CREATE TABLE IF NOT EXISTS index_analyzer.alert_rules (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  rule_key text NOT NULL UNIQUE,
  display_name text NOT NULL,
  description text NOT NULL,
  enabled boolean NOT NULL DEFAULT true,
  severity text NOT NULL CHECK (severity IN ('info', 'low', 'medium', 'high', 'critical', 'warning')),
  configuration jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE TABLE IF NOT EXISTS index_analyzer.findings (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  source_database_id bigint NOT NULL REFERENCES index_analyzer.source_databases(id) ON DELETE CASCADE,
  rule_id bigint REFERENCES index_analyzer.alert_rules(id) ON DELETE SET NULL,
  fingerprint text NOT NULL,
  category text NOT NULL,
  severity text NOT NULL CHECK (severity IN ('info', 'low', 'medium', 'high', 'critical', 'warning')),
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'acknowledged', 'resolved', 'dismissed')),
  title text NOT NULL,
  summary text NOT NULL,
  evidence jsonb NOT NULL,
  destination jsonb NOT NULL DEFAULT '{}'::jsonb,
  first_seen_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  last_seen_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  occurrence_count integer NOT NULL DEFAULT 1 CHECK (occurrence_count > 0),
  resolved_at timestamptz,
  UNIQUE (source_database_id, fingerprint)
);

CREATE INDEX IF NOT EXISTS findings_database_status_seen_idx
  ON index_analyzer.findings (source_database_id, status, last_seen_at DESC);
CREATE INDEX IF NOT EXISTS findings_severity_open_idx
  ON index_analyzer.findings (severity, last_seen_at DESC)
  WHERE status IN ('open', 'acknowledged');

CREATE TABLE IF NOT EXISTS index_analyzer.finding_status_history (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  finding_id bigint NOT NULL REFERENCES index_analyzer.findings(id) ON DELETE CASCADE,
  from_status text,
  to_status text NOT NULL,
  changed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  changed_by text,
  note text CHECK (note IS NULL OR length(note) <= 4000)
);

CREATE TABLE IF NOT EXISTS index_analyzer.finding_annotations (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  finding_id bigint NOT NULL REFERENCES index_analyzer.findings(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  created_by text,
  body text NOT NULL CHECK (length(body) BETWEEN 1 AND 4000)
);

INSERT INTO index_analyzer.alert_rules (rule_key, display_name, description, severity, configuration)
VALUES
  ('query-regression', 'Query regression', 'Recent execution time materially exceeds the baseline.', 'warning', '{"ratio": 1.5, "minCalls": 20}'),
  ('long-transaction', 'Long transaction', 'A transaction exceeded the configured duration.', 'warning', '{"seconds": 60}'),
  ('blocked-session', 'Blocked session', 'A backend is waiting on another backend.', 'critical', '{"seconds": 5}'),
  ('dead-tuples', 'Dead tuple pressure', 'Dead tuple ratio indicates vacuum pressure.', 'warning', '{"ratio": 0.2, "minimum": 1000}'),
  ('vacuum-staleness', 'Vacuum staleness', 'A modified table has not been vacuumed recently.', 'warning', '{"hours": 72}'),
  ('freeze-risk', 'Transaction ID freeze risk', 'Relation age is approaching autovacuum freeze limits.', 'critical', '{"ratio": 0.8}'),
  ('unused-index', 'Unused index', 'A non-constraint index has no observed scans and material size.', 'info', '{"minimumBytes": 1048576}'),
  ('duplicate-index', 'Duplicate index', 'Two indexes provide the same key coverage and predicate.', 'warning', '{}'),
  ('plan-change', 'Plan change', 'A query execution plan changed materially.', 'warning', '{}')
ON CONFLICT (rule_key) DO NOTHING;
