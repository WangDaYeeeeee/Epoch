CREATE TABLE IF NOT EXISTS schema_migration (
  version text PRIMARY KEY,
  content_hash text NOT NULL,
  applied_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS strategy_version (
  id text PRIMARY KEY,
  version text NOT NULL UNIQUE,
  status text NOT NULL CHECK (status IN ('draft', 'active', 'retired')),
  schema_version text NOT NULL,
  content_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS parameter_set (
  id text PRIMARY KEY,
  strategy_version_id text NOT NULL REFERENCES strategy_version(id),
  version text NOT NULL,
  status text NOT NULL CHECK (status IN ('draft', 'active', 'retired')),
  parameters jsonb NOT NULL,
  content_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (strategy_version_id, version)
);

CREATE TABLE IF NOT EXISTS account (
  id text PRIMARY KEY,
  portfolio_id text NOT NULL,
  provider text NOT NULL,
  base_currency char(3) NOT NULL,
  is_read_only boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS instrument (
  id text PRIMARY KEY CHECK (position(':' in id) > 1),
  ticker text NOT NULL,
  name text NOT NULL,
  venue text NOT NULL,
  currency char(3) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS raw_import (
  id uuid PRIMARY KEY,
  source text NOT NULL,
  source_id text NOT NULL,
  content_hash text NOT NULL,
  observed_at timestamptz NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  object_path text NOT NULL,
  UNIQUE (source, source_id, content_hash)
);

CREATE TABLE IF NOT EXISTS ledger_transaction (
  external_id text PRIMARY KEY,
  account_id text NOT NULL REFERENCES account(id),
  instrument_id text NOT NULL REFERENCES instrument(id),
  effective_at timestamptz NOT NULL,
  quantity numeric(30, 10) NOT NULL,
  price_minor bigint NOT NULL,
  fee_minor bigint NOT NULL DEFAULT 0,
  currency char(3) NOT NULL,
  raw_import_id uuid REFERENCES raw_import(id),
  recorded_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS cash_flow (
  external_id text PRIMARY KEY,
  account_id text NOT NULL REFERENCES account(id),
  effective_at timestamptz NOT NULL,
  kind text NOT NULL CHECK (kind IN ('deposit', 'withdrawal', 'dividend', 'fee', 'interest', 'transfer')),
  amount_minor bigint NOT NULL,
  currency char(3) NOT NULL,
  raw_import_id uuid REFERENCES raw_import(id),
  recorded_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS price_observation (
  instrument_id text NOT NULL REFERENCES instrument(id),
  effective_date date NOT NULL,
  close_minor bigint NOT NULL,
  currency char(3) NOT NULL,
  observed_at timestamptz NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (instrument_id, effective_date, observed_at)
);

CREATE TABLE IF NOT EXISTS calculation_run (
  id uuid PRIMARY KEY,
  calculation_type text NOT NULL,
  as_of timestamptz NOT NULL,
  input_hash text NOT NULL,
  code_version text NOT NULL,
  strategy_version_id text REFERENCES strategy_version(id),
  parameter_set_id text REFERENCES parameter_set(id),
  status text NOT NULL CHECK (status IN ('running', 'succeeded', 'degraded', 'failed')),
  output jsonb,
  failure_reason text,
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  UNIQUE (calculation_type, as_of, input_hash, code_version)
);

CREATE TABLE IF NOT EXISTS position_snapshot (
  calculation_run_id uuid NOT NULL REFERENCES calculation_run(id),
  snapshot_date date NOT NULL,
  instrument_id text NOT NULL,
  quantity numeric(30, 10) NOT NULL,
  market_value_minor bigint NOT NULL,
  currency char(3) NOT NULL,
  PRIMARY KEY (calculation_run_id, snapshot_date, instrument_id)
);

CREATE TABLE IF NOT EXISTS portfolio_snapshot (
  calculation_run_id uuid NOT NULL REFERENCES calculation_run(id),
  snapshot_date date NOT NULL,
  nav_minor bigint NOT NULL,
  cash_minor bigint NOT NULL,
  external_flow_minor bigint NOT NULL,
  investment_pnl_minor bigint NOT NULL,
  reconciliation_difference_minor bigint NOT NULL,
  currency char(3) NOT NULL,
  PRIMARY KEY (calculation_run_id, snapshot_date)
);

CREATE TABLE IF NOT EXISTS scheduled_job (
  id text PRIMARY KEY,
  handler text NOT NULL,
  interval_seconds integer NOT NULL CHECK (interval_seconds > 0),
  enabled boolean NOT NULL DEFAULT true,
  next_run_at timestamptz NOT NULL,
  last_started_at timestamptz,
  last_finished_at timestamptz,
  last_status text CHECK (last_status IN ('succeeded', 'failed', 'skipped')),
  last_error text,
  updated_at timestamptz NOT NULL DEFAULT now()
);
