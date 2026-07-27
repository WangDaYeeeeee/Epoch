CREATE TABLE IF NOT EXISTS agent_run (
  id uuid PRIMARY KEY,
  task_type text NOT NULL CHECK (task_type IN (
    'research_candidate', 'review_position', 'review_portfolio',
    'prepare_event', 'assess_event', 'propose_rebalance', 'run_review'
  )),
  status text NOT NULL CHECK (status IN ('running', 'completed', 'failed')),
  model text NOT NULL,
  prompt_version text NOT NULL,
  strategy_version_id text NOT NULL REFERENCES strategy_version(id),
  parameter_set_id text NOT NULL REFERENCES parameter_set(id),
  output_schema_version text NOT NULL,
  input_payload jsonb NOT NULL,
  data_snapshot jsonb NOT NULL,
  calculation_run_ids uuid[] NOT NULL DEFAULT '{}',
  citations jsonb NOT NULL DEFAULT '[]',
  output_payload jsonb,
  limitations jsonb NOT NULL DEFAULT '[]',
  failure_reason text,
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz
);

CREATE INDEX IF NOT EXISTS agent_run_latest_idx
  ON agent_run (task_type, started_at DESC);

CREATE TABLE IF NOT EXISTS agent_run_feedback (
  id uuid PRIMARY KEY,
  agent_run_id uuid NOT NULL REFERENCES agent_run(id),
  disposition text NOT NULL CHECK (disposition IN ('accepted', 'modified', 'rejected')),
  comment text NOT NULL,
  corrected_output jsonb,
  recorded_at timestamptz NOT NULL DEFAULT now()
);
