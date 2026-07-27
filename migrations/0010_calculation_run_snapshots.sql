ALTER TABLE calculation_run
  ADD COLUMN IF NOT EXISTS contract_version text,
  ADD COLUMN IF NOT EXISTS input_payload jsonb,
  ADD COLUMN IF NOT EXISTS engine_version text,
  ADD COLUMN IF NOT EXISTS model_version text,
  ADD COLUMN IF NOT EXISTS diagnostics jsonb,
  ADD COLUMN IF NOT EXISTS warnings jsonb,
  ADD COLUMN IF NOT EXISTS duration_ms integer;

ALTER TABLE calculation_run
  ADD CONSTRAINT calculation_run_input_hash_check
    CHECK (input_hash ~ '^[a-f0-9]{64}$') NOT VALID,
  ADD CONSTRAINT calculation_run_duration_check
    CHECK (duration_ms IS NULL OR duration_ms >= 0) NOT VALID,
  ADD CONSTRAINT calculation_run_warnings_array_check
    CHECK (warnings IS NULL OR jsonb_typeof(warnings) = 'array') NOT VALID;

CREATE INDEX IF NOT EXISTS calculation_run_latest_idx
  ON calculation_run (calculation_type, as_of DESC, finished_at DESC)
  WHERE status IN ('succeeded', 'degraded');
