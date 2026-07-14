CREATE EXTENSION IF NOT EXISTS pg_stat_statements;
CREATE EXTENSION IF NOT EXISTS pgstattuple;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'analyzer_monitor') THEN
    CREATE ROLE analyzer_monitor LOGIN PASSWORD 'analyzer_monitor' CONNECTION LIMIT 8;
  END IF;
END
$$;

GRANT CONNECT ON DATABASE index_analyzer TO analyzer_monitor;
GRANT pg_read_all_stats TO analyzer_monitor;
GRANT pg_read_all_settings TO analyzer_monitor;
