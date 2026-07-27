CREATE TABLE IF NOT EXISTS agent_run_materialization (
  agent_run_id uuid PRIMARY KEY REFERENCES agent_run(id),
  object_type text NOT NULL CHECK (object_type IN (
    'candidate_research_draft', 'playbook_draft', 'review_draft'
  )),
  object_ids jsonb NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT now()
);
