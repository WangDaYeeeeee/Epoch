ALTER TABLE risk_drift_anchor_instrument
  ADD COLUMN IF NOT EXISTS risk_contribution numeric(18, 12);
