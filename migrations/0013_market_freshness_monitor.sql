INSERT INTO scheduled_job (id, handler, interval_seconds, next_run_at, enabled)
VALUES (
  'market-data-freshness-monitor',
  'market-data-freshness-monitor',
  3600,
  now() + interval '1 hour',
  true
)
ON CONFLICT (id) DO NOTHING;
