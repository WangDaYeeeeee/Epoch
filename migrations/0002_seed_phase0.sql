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
  '{"theta":0.5,"portfolio_volatility_limit":0.45,"stress_week_loss_limit":-0.12,"drawdown_risk_only_threshold":-0.25,"near_event_trading_days":10,"rc_warning_multiplier":1.2,"rc_trigger_multiplier":1.3,"calibration_required":true}'::jsonb,
  'caab0d337d5ff9380ce871cc5786a2572916955a882d67b1d42a006602444a3a'
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
