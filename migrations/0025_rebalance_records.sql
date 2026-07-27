CREATE TABLE IF NOT EXISTS rebalance_record (
  decision_id uuid PRIMARY KEY REFERENCES investment_decision(id),
  trigger_type text NOT NULL,
  volatility_snapshot jsonb NOT NULL,
  portfolio_risk_snapshot jsonb NOT NULL,
  weight_tier_snapshot jsonb NOT NULL,
  target_weight_snapshot jsonb NOT NULL,
  monitoring_exceptions text NOT NULL,
  action_plan text NOT NULL,
  watchlist text NOT NULL,
  strategy_version_id text NOT NULL REFERENCES strategy_version(id),
  parameter_set_id text REFERENCES parameter_set(id),
  calculation_run_id uuid NOT NULL REFERENCES calculation_run(id),
  recorded_at timestamptz NOT NULL DEFAULT now()
);
