ALTER TABLE cash_flow
ADD COLUMN IF NOT EXISTS fx_rate_to_base numeric(30, 12);
