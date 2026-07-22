CREATE TABLE IF NOT EXISTS normalized_ledger_event (
  raw_import_id uuid NOT NULL REFERENCES raw_import(id),
  transaction_id text NOT NULL,
  effective_date date NOT NULL,
  account_id text NOT NULL REFERENCES account(id),
  instrument_id text,
  action text NOT NULL CHECK (action IN (
    'buy', 'sell', 'deposit', 'withdrawal', 'dividend', 'fee', 'interest',
    'tax', 'transfer_in', 'transfer_out', 'fx_buy', 'fx_sell', 'other'
  )),
  quantity numeric(30, 10),
  price numeric(30, 10),
  currency char(3) NOT NULL,
  fees numeric(30, 10),
  tax numeric(30, 10),
  cash_amount numeric(30, 10),
  external_flow boolean NOT NULL,
  source text NOT NULL,
  note text,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (raw_import_id, transaction_id)
);

CREATE INDEX IF NOT EXISTS normalized_ledger_event_account_date_idx
  ON normalized_ledger_event (account_id, effective_date);

CREATE TABLE IF NOT EXISTS reported_position_snapshot (
  raw_import_id uuid NOT NULL REFERENCES raw_import(id),
  snapshot_date date NOT NULL,
  account_id text NOT NULL REFERENCES account(id),
  instrument_id text NOT NULL,
  ticker text NOT NULL,
  name text NOT NULL,
  category text NOT NULL,
  quantity numeric(30, 10) NOT NULL,
  price numeric(30, 10) NOT NULL,
  market_value numeric(30, 10) NOT NULL,
  currency char(3) NOT NULL,
  cost_basis numeric(30, 10),
  fx_to_cny numeric(30, 10),
  market_value_cny numeric(30, 10),
  source text NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (raw_import_id, snapshot_date, account_id, instrument_id)
);

CREATE INDEX IF NOT EXISTS reported_position_snapshot_date_idx
  ON reported_position_snapshot (snapshot_date, account_id);

CREATE TABLE IF NOT EXISTS reported_performance_snapshot (
  raw_import_id uuid NOT NULL REFERENCES raw_import(id),
  snapshot_date date NOT NULL,
  portfolio_id text NOT NULL,
  total_assets numeric(30, 10) NOT NULL,
  cash numeric(30, 10) NOT NULL,
  net_external_flow numeric(30, 10) NOT NULL,
  currency char(3) NOT NULL,
  nav numeric(30, 12) NOT NULL,
  period_return numeric(30, 12),
  benchmark text NOT NULL,
  benchmark_return numeric(30, 12),
  source text NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (raw_import_id, snapshot_date, portfolio_id)
);

CREATE INDEX IF NOT EXISTS reported_performance_snapshot_date_idx
  ON reported_performance_snapshot (portfolio_id, snapshot_date);
