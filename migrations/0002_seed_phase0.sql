INSERT INTO strategy_version (id, version, status, schema_version, content_hash)
VALUES ('epoch-satellite-v0.1.0', '0.1.0', 'draft', '1.0.0', 'a4bb2b11e1e640c94a1cbf4227d2170b086e7a7f214ccec394231acdaed1f2e9')
ON CONFLICT (id) DO UPDATE SET
  version = EXCLUDED.version,
  status = EXCLUDED.status,
  schema_version = EXCLUDED.schema_version,
  content_hash = EXCLUDED.content_hash;

INSERT INTO parameter_set (id, strategy_version_id, version, status, parameters, content_hash)
VALUES (
  'default-draft-v0.1.0',
  'epoch-satellite-v0.1.0',
  '0.1.0',
  'draft',
  '{"calibration_required":true,"portfolio_volatility_limit":0.45,"correlation_window_trading_days":250,"stress_correlation":0.9,"volatility_drift_highlight_multiplier":1.5,"volatility_drift_strong_multiplier":2,"risk_capital_ratio_highlight_multiplier":1.5,"position_weight_min":0.1,"position_weight_max":0.4,"weight_tier_ladder":[0.4,0.35,0.3,0.25,0.2,0.15,0.1],"near_event_trading_days":10,"refill_batch_ratio":[1,1,1],"refill_batch2_clear_trading_days":5,"refill_deadline_trading_days":10,"exit_repurchase_restriction_days":90,"calm_period_trading_days":20}'::jsonb,
  '3ea6f3ccc5b52daf717facfcf0213626e7cd3c7484a66de0f7afd50fe151c8b5'
)
ON CONFLICT (id) DO UPDATE SET
  version = EXCLUDED.version,
  status = EXCLUDED.status,
  parameters = EXCLUDED.parameters,
  content_hash = EXCLUDED.content_hash;

INSERT INTO account (id, portfolio_id, provider, base_currency, is_read_only)
VALUES
  ('futu_2189', 'satellite', 'futu', 'USD', true),
  ('ibkr_8602', 'satellite', 'ibkr', 'USD', true),
  ('demo_satellite', 'demo-satellite', 'synthetic', 'USD', true)
ON CONFLICT (id) DO NOTHING;

INSERT INTO scheduled_job (id, handler, interval_seconds, next_run_at)
VALUES ('demo-ledger-recalculation', 'demo-ledger-recalculation', 86400, now())
ON CONFLICT (id) DO NOTHING;
