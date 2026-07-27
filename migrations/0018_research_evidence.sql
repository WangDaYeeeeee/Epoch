CREATE TABLE IF NOT EXISTS research_evidence (
  id uuid PRIMARY KEY,
  title text NOT NULL,
  source_type text NOT NULL CHECK (source_type IN ('primary', 'secondary', 'internal')),
  source_name text NOT NULL,
  source_url text,
  observed_at timestamptz NOT NULL,
  effective_date date,
  excerpt text NOT NULL,
  content_hash text NOT NULL CHECK (content_hash ~ '^[0-9a-f]{64}$'),
  recorded_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (source_name, content_hash)
);

CREATE TABLE IF NOT EXISTS research_claim (
  id uuid PRIMARY KEY,
  candidate_id uuid NOT NULL REFERENCES investment_candidate(id),
  kind text NOT NULL CHECK (kind IN ('fact', 'hypothesis', 'inference')),
  statement text NOT NULL,
  reasoning text NOT NULL,
  confidence numeric(5, 4) NOT NULL CHECK (confidence BETWEEN 0 AND 1),
  as_of date NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS research_claim_candidate_idx
  ON research_claim (candidate_id, as_of DESC, recorded_at DESC);

CREATE TABLE IF NOT EXISTS claim_evidence (
  claim_id uuid NOT NULL REFERENCES research_claim(id),
  evidence_id uuid NOT NULL REFERENCES research_evidence(id),
  role text NOT NULL CHECK (role IN ('support', 'counter')),
  PRIMARY KEY (claim_id, evidence_id)
);

CREATE TABLE IF NOT EXISTS factor_assessment_claim (
  assessment_id uuid NOT NULL REFERENCES factor_assessment(id),
  claim_id uuid NOT NULL REFERENCES research_claim(id),
  role text NOT NULL CHECK (role IN ('support', 'counter')),
  PRIMARY KEY (assessment_id, claim_id)
);
