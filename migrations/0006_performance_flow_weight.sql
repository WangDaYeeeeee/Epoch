ALTER TABLE reported_performance_snapshot
  ADD COLUMN IF NOT EXISTS external_flow_weight numeric(8, 7)
  CHECK (external_flow_weight >= 0 AND external_flow_weight <= 1);
