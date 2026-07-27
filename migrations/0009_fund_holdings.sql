CREATE TABLE IF NOT EXISTS fund_holdings_snapshot (
  id uuid PRIMARY KEY,
  fund_instrument_id text NOT NULL CHECK (position(':' in fund_instrument_id) > 1),
  as_of date NOT NULL,
  observed_at timestamptz NOT NULL,
  provider text NOT NULL,
  source_hash text NOT NULL,
  raw_import_id uuid REFERENCES raw_import(id),
  holding_count integer NOT NULL CHECK (holding_count >= 0),
  covered_weight numeric(18, 12) NOT NULL CHECK (covered_weight >= 0 AND covered_weight <= 1.000001),
  recorded_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (fund_instrument_id, as_of, provider, source_hash)
);

CREATE INDEX IF NOT EXISTS fund_holdings_snapshot_lookup_idx
  ON fund_holdings_snapshot (fund_instrument_id, as_of DESC, observed_at DESC);

CREATE TABLE IF NOT EXISTS fund_holding (
  snapshot_id uuid NOT NULL REFERENCES fund_holdings_snapshot(id) ON DELETE RESTRICT,
  constituent_instrument_id text NOT NULL CHECK (position(':' in constituent_instrument_id) > 1),
  name text NOT NULL,
  weight numeric(18, 12) NOT NULL CHECK (weight > 0 AND weight <= 1),
  shares numeric(30, 10),
  market_value numeric(30, 10),
  PRIMARY KEY (snapshot_id, constituent_instrument_id)
);
