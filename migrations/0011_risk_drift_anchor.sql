CREATE TABLE IF NOT EXISTS risk_drift_anchor (
  id uuid PRIMARY KEY,
  calculation_run_id uuid NOT NULL REFERENCES calculation_run(id) ON DELETE RESTRICT,
  effective_at timestamptz NOT NULL,
  portfolio_volatility_annualized numeric(18, 12) NOT NULL CHECK (portfolio_volatility_annualized >= 0),
  note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (calculation_run_id)
);

CREATE INDEX IF NOT EXISTS risk_drift_anchor_latest_idx
  ON risk_drift_anchor (effective_at DESC, created_at DESC);

CREATE TABLE IF NOT EXISTS risk_drift_anchor_instrument (
  anchor_id uuid NOT NULL REFERENCES risk_drift_anchor(id) ON DELETE RESTRICT,
  instrument_id text NOT NULL CHECK (position(':' in instrument_id) > 1),
  weight numeric(18, 12) NOT NULL,
  volatility_annualized numeric(18, 12) NOT NULL CHECK (volatility_annualized >= 0),
  PRIMARY KEY (anchor_id, instrument_id)
);
