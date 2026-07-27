CREATE TABLE IF NOT EXISTS investment_review (
  id uuid PRIMARY KEY,
  cadence text NOT NULL CHECK (cadence IN ('daily', 'weekly', 'monthly', 'quarterly', 'post_exit')),
  scope text NOT NULL CHECK (scope IN ('portfolio', 'position')),
  as_of date NOT NULL,
  candidate_id uuid REFERENCES investment_candidate(id),
  calculation_run_id uuid REFERENCES calculation_run(id),
  strategy_version_id text NOT NULL REFERENCES strategy_version(id),
  parameter_set_id text NOT NULL REFERENCES parameter_set(id),
  summary text NOT NULL,
  what_worked text NOT NULL,
  what_failed text NOT NULL,
  follow_up text NOT NULL,
  status text NOT NULL CHECK (status IN ('draft', 'confirmed')),
  recorded_at timestamptz NOT NULL DEFAULT now(),
  CHECK (
    (scope = 'position' AND candidate_id IS NOT NULL)
    OR (scope = 'portfolio' AND candidate_id IS NULL)
  )
);

CREATE INDEX IF NOT EXISTS investment_review_due_idx
  ON investment_review (cadence, scope, as_of DESC, recorded_at DESC);

CREATE TABLE IF NOT EXISTS review_absorption (
  review_id uuid NOT NULL REFERENCES investment_review(id),
  source_type text NOT NULL CHECK (source_type IN ('exception', 'refill_not_executed')),
  source_id uuid NOT NULL,
  disposition text NOT NULL CHECK (disposition IN ('absorbed', 'valid_exception', 'no_change')),
  rationale text NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (review_id, source_type, source_id)
);
