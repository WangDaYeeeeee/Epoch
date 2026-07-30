CREATE TABLE IF NOT EXISTS daily_data_refresh_run (
  id uuid PRIMARY KEY,
  trigger text NOT NULL CHECK (trigger IN ('manual', 'startup', 'scheduled')),
  status text NOT NULL CHECK (status IN ('running', 'succeeded', 'failed')),
  result jsonb,
  failure_reason text,
  requested_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz
);

CREATE INDEX IF NOT EXISTS daily_data_refresh_run_latest_idx
  ON daily_data_refresh_run (requested_at DESC);

UPDATE scheduled_job
SET enabled = false, updated_at = now()
WHERE id IN ('ibkr-flex-sync', 'nasdaq100-benchmark-sync');

INSERT INTO scheduled_job (id, handler, interval_seconds, next_run_at, enabled)
VALUES ('daily-data-refresh', 'daily-data-refresh', 86400, now() + interval '10 minutes', true)
ON CONFLICT (id) DO UPDATE
SET handler = EXCLUDED.handler, interval_seconds = EXCLUDED.interval_seconds, enabled = true;
