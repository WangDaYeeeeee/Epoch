CREATE TABLE IF NOT EXISTS data_source_definition (
  id text PRIMARY KEY,
  capability text NOT NULL,
  provider text NOT NULL,
  status text NOT NULL CHECK (status IN ('active', 'unavailable', 'planned')),
  required boolean NOT NULL,
  maximum_age_hours integer CHECK (maximum_age_hours > 0),
  fallback_source_id text REFERENCES data_source_definition(id),
  note text NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS data_source_observation (
  id uuid PRIMARY KEY,
  source_id text NOT NULL REFERENCES data_source_definition(id),
  status text NOT NULL CHECK (status IN ('success', 'degraded', 'failure')),
  effective_at timestamptz,
  observed_at timestamptz NOT NULL,
  detail text NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS data_source_observation_latest_idx
  ON data_source_observation (source_id, observed_at DESC, recorded_at DESC);

INSERT INTO data_source_definition (
  id, capability, provider, status, required, maximum_age_hours, note
) VALUES
  ('daily-market-bars', 'daily_ohlcv', 'normalized-market-data', 'active', true, 120, 'Required risk and valuation input'),
  ('fund-holdings', 'etf_lookthrough', 'configured-provider-chain', 'active', false, 2160, 'Required only for currently held funds'),
  ('intraday-returns', 'strict_signed_semivariance', 'unselected', 'unavailable', false, NULL, 'Phase 6 source selection pending'),
  ('options-iv', 'iv_and_put_skew', 'unselected', 'unavailable', false, NULL, 'Must not require a persistent broker session'),
  ('market-microstructure', 'gex_leverage_crowding', 'unselected', 'planned', false, NULL, 'Optional qualitative evidence only')
ON CONFLICT (id) DO UPDATE SET
  capability = EXCLUDED.capability,
  provider = EXCLUDED.provider,
  status = EXCLUDED.status,
  required = EXCLUDED.required,
  maximum_age_hours = EXCLUDED.maximum_age_hours,
  note = EXCLUDED.note;
