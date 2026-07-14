INSERT INTO index_analyzer.alert_rules
  (rule_key, display_name, description, severity, configuration)
VALUES
  (
    'analyze-staleness',
    'Analyze staleness',
    'A materially changed table has stale planner statistics.',
    'warning',
    '{"hours": 24, "ratio": 0.1, "minimum": 1000}'
  ),
  (
    'missing-index',
    'Missing index candidate',
    'A recent query plan contains a large selective sequential scan without equivalent index coverage.',
    'warning',
    '{"minimumScore": 55, "minimumRows": 1000, "maximumPlans": 100}'
  )
ON CONFLICT (rule_key) DO NOTHING;

UPDATE index_analyzer.alert_rules
SET configuration = '{"hours": 72, "minimum": 1000}'::jsonb || configuration,
    updated_at = clock_timestamp()
WHERE rule_key = 'vacuum-staleness';

UPDATE index_analyzer.alert_rules
SET configuration = '{"executionRatio": 0.25, "costRatio": 0.3, "maximumPlans": 100}'::jsonb || configuration,
    updated_at = clock_timestamp()
WHERE rule_key = 'plan-change';
