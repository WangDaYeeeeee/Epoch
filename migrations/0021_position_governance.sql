CREATE TABLE IF NOT EXISTS candidate_catalyst (
  id uuid PRIMARY KEY,
  candidate_id uuid NOT NULL REFERENCES investment_candidate(id),
  title text NOT NULL,
  expected_date date NOT NULL,
  valid_through date NOT NULL,
  status text NOT NULL CHECK (status IN ('planned', 'realized', 'invalidated', 'expired')),
  observable_outcome text NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  CHECK (valid_through >= expected_date)
);

CREATE INDEX IF NOT EXISTS candidate_catalyst_idx
  ON candidate_catalyst (candidate_id, expected_date DESC, recorded_at DESC);

CREATE TABLE IF NOT EXISTS invalidation_condition (
  id uuid PRIMARY KEY,
  candidate_id uuid NOT NULL REFERENCES investment_candidate(id),
  statement text NOT NULL,
  observable_metric text NOT NULL,
  trigger text NOT NULL,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'triggered', 'retired')),
  recorded_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS invalidation_condition_candidate_idx
  ON invalidation_condition (candidate_id, recorded_at DESC);

CREATE TABLE IF NOT EXISTS exit_restriction (
  id uuid PRIMARY KEY,
  candidate_id uuid NOT NULL REFERENCES investment_candidate(id),
  exit_type text NOT NULL CHECK (exit_type = 'active_exit'),
  exit_date date NOT NULL,
  restricted_until date NOT NULL,
  execution_record_id uuid REFERENCES execution_record(id),
  recorded_at timestamptz NOT NULL DEFAULT now(),
  CHECK (restricted_until = exit_date + 90)
);

CREATE INDEX IF NOT EXISTS exit_restriction_active_idx
  ON exit_restriction (candidate_id, restricted_until DESC);
