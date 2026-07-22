ALTER TABLE reported_position_snapshot
  ADD COLUMN IF NOT EXISTS base_currency char(3),
  ADD COLUMN IF NOT EXISTS fx_to_base numeric(30, 12),
  ADD COLUMN IF NOT EXISTS market_value_base numeric(30, 10);

ALTER TABLE reported_position_snapshot
  ADD CONSTRAINT reported_position_snapshot_base_valuation_check CHECK (
    (base_currency IS NULL AND fx_to_base IS NULL AND market_value_base IS NULL)
    OR (
      base_currency IS NOT NULL
      AND fx_to_base IS NOT NULL
      AND market_value_base IS NOT NULL
      AND fx_to_base > 0
    )
  );
