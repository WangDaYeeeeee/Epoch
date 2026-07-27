CREATE TABLE IF NOT EXISTS market_refresh_run (
  id uuid PRIMARY KEY,
  fingerprint text NOT NULL,
  preflight jsonb NOT NULL,
  status text NOT NULL CHECK (status IN ('running', 'succeeded', 'failed')),
  result jsonb,
  failure_reason text,
  requested_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  CHECK (
    (status = 'running' AND finished_at IS NULL)
    OR (status IN ('succeeded', 'failed') AND finished_at IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS market_refresh_run_requested_idx
  ON market_refresh_run (requested_at DESC);
