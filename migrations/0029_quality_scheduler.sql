INSERT INTO scheduled_job (id, handler, interval_seconds, next_run_at, enabled)
VALUES ('quality-metrics-refresh', 'quality-metrics-refresh', 86400, now(), true)
ON CONFLICT (id) DO UPDATE
SET handler = EXCLUDED.handler, interval_seconds = EXCLUDED.interval_seconds, enabled = true;
