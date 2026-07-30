CREATE TABLE IF NOT EXISTS benchmark_observation (
  benchmark_id text NOT NULL,
  effective_date date NOT NULL,
  close numeric(30, 10) NOT NULL CHECK (close > 0),
  source text NOT NULL,
  observed_at timestamptz NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (benchmark_id, effective_date, source)
);

CREATE INDEX IF NOT EXISTS benchmark_observation_latest_idx
  ON benchmark_observation (benchmark_id, effective_date DESC);

CREATE TABLE IF NOT EXISTS benchmark_sync_run (
  id uuid PRIMARY KEY,
  benchmark_id text NOT NULL,
  provider text NOT NULL,
  status text NOT NULL CHECK (status IN ('running', 'succeeded', 'failed')),
  observations_upserted integer,
  latest_observation_date date,
  failure_reason text,
  requested_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz
);

CREATE INDEX IF NOT EXISTS benchmark_sync_run_latest_idx
  ON benchmark_sync_run (benchmark_id, requested_at DESC);

INSERT INTO scheduled_job (id, handler, interval_seconds, next_run_at, enabled)
VALUES ('nasdaq100-benchmark-sync', 'nasdaq100-benchmark-sync', 86400, now(), true)
ON CONFLICT (id) DO UPDATE
SET handler = EXCLUDED.handler, interval_seconds = EXCLUDED.interval_seconds, enabled = true;
