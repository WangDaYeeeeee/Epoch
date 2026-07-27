CREATE TABLE IF NOT EXISTS refill_plan (
  id uuid PRIMARY KEY,
  risk_reduction_decision_id uuid NOT NULL UNIQUE REFERENCES investment_decision(id),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'completed', 'cancelled')),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS refill_batch (
  id uuid PRIMARY KEY,
  plan_id uuid NOT NULL REFERENCES refill_plan(id),
  batch_number integer NOT NULL CHECK (batch_number IN (1, 2, 3)),
  portion numeric(8, 7) NOT NULL CHECK (portion > 0 AND portion <= 1),
  trigger_description text NOT NULL,
  UNIQUE (plan_id, batch_number)
);

CREATE TABLE IF NOT EXISTS refill_batch_transition (
  id uuid PRIMARY KEY,
  batch_id uuid NOT NULL REFERENCES refill_batch(id),
  from_state text NOT NULL CHECK (from_state IN ('pending', 'eligible', 'blocked', 'executed', 'not_executed')),
  to_state text NOT NULL CHECK (to_state IN ('pending', 'eligible', 'blocked', 'executed', 'not_executed')),
  reason text NOT NULL,
  evidence jsonb NOT NULL,
  target_weights jsonb,
  calculation_run_id uuid REFERENCES calculation_run(id),
  recorded_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS refill_batch_transition_latest_idx
  ON refill_batch_transition (batch_id, recorded_at DESC, id DESC);
