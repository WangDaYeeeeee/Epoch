CREATE TABLE IF NOT EXISTS forecast_evaluation (
  id uuid PRIMARY KEY,
  calculation_run_id uuid NOT NULL REFERENCES calculation_run(id),
  instrument_id text NOT NULL,
  forecast_as_of date NOT NULL,
  realized_as_of date NOT NULL,
  horizon_trading_days integer NOT NULL CHECK (horizon_trading_days = 1),
  predicted_variance numeric NOT NULL CHECK (predicted_variance >= 0),
  realized_return numeric NOT NULL,
  realized_variance numeric NOT NULL CHECK (realized_variance >= 0),
  error numeric NOT NULL,
  absolute_error numeric NOT NULL CHECK (absolute_error >= 0),
  squared_error numeric NOT NULL CHECK (squared_error >= 0),
  market_source text NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (calculation_run_id, instrument_id, horizon_trading_days)
);

CREATE INDEX IF NOT EXISTS forecast_evaluation_time_idx
  ON forecast_evaluation (realized_as_of DESC, instrument_id);

CREATE TABLE IF NOT EXISTS claim_outcome (
  id uuid PRIMARY KEY,
  claim_id uuid NOT NULL REFERENCES research_claim(id),
  outcome text NOT NULL CHECK (outcome IN ('verified_true', 'verified_false', 'indeterminate')),
  evaluated_as_of date NOT NULL,
  rationale text NOT NULL,
  evidence_id uuid REFERENCES research_evidence(id),
  recorded_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (claim_id, evaluated_as_of)
);

CREATE INDEX IF NOT EXISTS claim_outcome_calibration_idx
  ON claim_outcome (evaluated_as_of DESC, outcome);
