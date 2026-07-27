CREATE TABLE IF NOT EXISTS investment_decision (
  id uuid PRIMARY KEY,
  calculation_run_id uuid NOT NULL REFERENCES calculation_run(id),
  trigger_type text NOT NULL CHECK (trigger_type IN ('risk', 'temporary', 'exception', 'routine')),
  outcome text NOT NULL CHECK (outcome IN ('confirmed', 'modified', 'rejected')),
  rationale text NOT NULL,
  monitoring_notes text NOT NULL,
  decided_at timestamptz NOT NULL,
  strategy_version_id text NOT NULL REFERENCES strategy_version(id),
  recorded_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (calculation_run_id, decided_at)
);

CREATE INDEX IF NOT EXISTS investment_decision_time_idx
  ON investment_decision (decided_at DESC, recorded_at DESC);

CREATE TABLE IF NOT EXISTS execution_record (
  id uuid PRIMARY KEY,
  decision_id uuid NOT NULL UNIQUE REFERENCES investment_decision(id),
  executed_at timestamptz NOT NULL,
  broker_reference text NOT NULL,
  actual_weights jsonb NOT NULL,
  note text NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT now()
);
