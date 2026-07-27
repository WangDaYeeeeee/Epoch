CREATE TABLE IF NOT EXISTS operational_alert (
  id uuid PRIMARY KEY,
  source text NOT NULL,
  fingerprint text NOT NULL,
  severity text NOT NULL CHECK (severity IN ('warning', 'error')),
  status text NOT NULL CHECK (status IN ('open', 'resolved')),
  title text NOT NULL,
  detail text NOT NULL,
  occurrence_count integer NOT NULL DEFAULT 1 CHECK (occurrence_count > 0),
  first_observed_at timestamptz NOT NULL DEFAULT now(),
  last_observed_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz,
  UNIQUE (source, fingerprint)
);

CREATE INDEX IF NOT EXISTS operational_alert_open_idx
  ON operational_alert (status, last_observed_at DESC);

INSERT INTO scheduled_job (id, handler, interval_seconds, next_run_at, enabled)
VALUES (
  'portfolio-risk-refresh',
  'portfolio-risk-refresh',
  21600,
  now() + interval '6 hours',
  true
)
ON CONFLICT (id) DO NOTHING;
