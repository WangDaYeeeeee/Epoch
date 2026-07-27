CREATE TABLE IF NOT EXISTS intraday_semivariance_daily (
  instrument_id text NOT NULL,
  trading_date date NOT NULL,
  provider text NOT NULL,
  positive_semivariance double precision NOT NULL CHECK (positive_semivariance >= 0),
  negative_semivariance double precision NOT NULL CHECK (negative_semivariance >= 0),
  signed_jump double precision NOT NULL,
  return_observations integer NOT NULL CHECK (return_observations > 0),
  calculated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (instrument_id, trading_date, provider)
);

CREATE INDEX IF NOT EXISTS intraday_semivariance_daily_lookup_idx
  ON intraday_semivariance_daily (instrument_id, trading_date DESC);
