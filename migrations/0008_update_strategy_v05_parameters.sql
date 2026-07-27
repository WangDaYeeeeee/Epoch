UPDATE parameter_set
SET parameters = '{"calibration_required":true,"portfolio_volatility_limit":0.45,"correlation_window_trading_days":250,"stress_correlation":0.9,"volatility_drift_highlight_multiplier":1.5,"volatility_drift_strong_multiplier":2,"risk_capital_ratio_highlight_multiplier":1.5,"position_weight_min":0.1,"position_weight_max":0.4,"weight_tier_ladder":[0.4,0.35,0.3,0.25,0.2,0.15,0.1],"near_event_trading_days":10,"refill_batch_ratio":[1,1,1],"refill_batch2_clear_trading_days":5,"refill_deadline_trading_days":10,"exit_repurchase_restriction_days":90,"calm_period_trading_days":20}'::jsonb,
    content_hash = '3ea6f3ccc5b52daf717facfcf0213626e7cd3c7484a66de0f7afd50fe151c8b5'
WHERE id = 'default-draft-v0.1.0';
