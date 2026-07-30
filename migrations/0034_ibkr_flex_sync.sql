CREATE TABLE IF NOT EXISTS ibkr_flex_sync_run (
  id uuid PRIMARY KEY,
  account_id text NOT NULL REFERENCES account(id),
  query_id text NOT NULL,
  reference_code text,
  status text NOT NULL CHECK (status IN ('running', 'succeeded', 'failed')),
  raw_import_id uuid REFERENCES raw_import(id),
  result jsonb,
  failure_reason text,
  requested_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz
);

CREATE INDEX IF NOT EXISTS ibkr_flex_sync_run_latest_idx
  ON ibkr_flex_sync_run (account_id, requested_at DESC);

CREATE TABLE IF NOT EXISTS ibkr_account_nav_snapshot (
  raw_import_id uuid NOT NULL REFERENCES raw_import(id),
  account_id text NOT NULL REFERENCES account(id),
  snapshot_date date NOT NULL,
  nav numeric(30, 10) NOT NULL,
  cash numeric(30, 10),
  currency char(3) NOT NULL,
  source text NOT NULL,
  observed_at timestamptz NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (raw_import_id, account_id, snapshot_date)
);

CREATE INDEX IF NOT EXISTS ibkr_account_nav_snapshot_latest_idx
  ON ibkr_account_nav_snapshot (account_id, snapshot_date DESC, observed_at DESC);

INSERT INTO scheduled_job (id, handler, interval_seconds, next_run_at, enabled)
VALUES ('ibkr-flex-sync', 'ibkr-flex-sync', 86400, now(), true)
ON CONFLICT (id) DO UPDATE
SET handler = EXCLUDED.handler, interval_seconds = EXCLUDED.interval_seconds, enabled = true;
