CREATE TABLE IF NOT EXISTS playbook_revision (
  id uuid PRIMARY KEY,
  playbook_id uuid NOT NULL REFERENCES event_playbook(id),
  status text NOT NULL CHECK (status IN ('draft', 'ready')),
  summary text NOT NULL,
  as_of date NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS playbook_revision_latest_idx
  ON playbook_revision (playbook_id, as_of DESC, recorded_at DESC);

CREATE TABLE IF NOT EXISTS playbook_branch (
  id uuid PRIMARY KEY,
  revision_id uuid NOT NULL REFERENCES playbook_revision(id),
  scope text NOT NULL CHECK (scope IN ('instrument', 'theme')),
  scenario text NOT NULL,
  trigger text NOT NULL,
  action text NOT NULL,
  risk_direction text NOT NULL CHECK (risk_direction IN ('decrease', 'neutral', 'increase'))
);

CREATE TABLE IF NOT EXISTS exception_record (
  id uuid PRIMARY KEY,
  event_id uuid NOT NULL REFERENCES investment_event(id),
  playbook_revision_id uuid REFERENCES playbook_revision(id),
  uncovered_reason text NOT NULL,
  logic_change text NOT NULL,
  action text NOT NULL,
  decided_at timestamptz NOT NULL,
  execute_after timestamptz NOT NULL,
  delay_waiver_reason text,
  review_status text NOT NULL DEFAULT 'pending' CHECK (review_status IN ('pending', 'absorbed', 'valid_exception')),
  recorded_at timestamptz NOT NULL DEFAULT now()
);
