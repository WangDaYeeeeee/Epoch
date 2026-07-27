CREATE TABLE IF NOT EXISTS intraday_bar_observation (
  instrument_id text NOT NULL,
  observed_timestamp timestamptz NOT NULL,
  provider text NOT NULL,
  open double precision NOT NULL CHECK (open > 0),
  high double precision NOT NULL CHECK (high > 0),
  low double precision NOT NULL CHECK (low > 0),
  close double precision NOT NULL CHECK (close > 0),
  volume double precision NOT NULL CHECK (volume >= 0),
  observed_at timestamptz NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (instrument_id, observed_timestamp, provider)
);

CREATE INDEX IF NOT EXISTS intraday_bar_observation_lookup_idx
  ON intraday_bar_observation (instrument_id, observed_timestamp DESC);

CREATE TABLE IF NOT EXISTS option_signal_observation (
  instrument_id text NOT NULL,
  as_of timestamptz NOT NULL,
  provider text NOT NULL,
  iv30 double precision CHECK (iv30 >= 0 AND iv30 <= 10),
  put_skew_25d_30 double precision CHECK (abs(put_skew_25d_30) <= 10),
  quality text NOT NULL CHECK (quality IN ('indicative', 'consolidated', 'derived')),
  observed_at timestamptz NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  CHECK (iv30 IS NOT NULL OR put_skew_25d_30 IS NOT NULL),
  PRIMARY KEY (instrument_id, as_of, provider)
);

CREATE INDEX IF NOT EXISTS option_signal_observation_lookup_idx
  ON option_signal_observation (instrument_id, as_of DESC);
