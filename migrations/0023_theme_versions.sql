CREATE TABLE IF NOT EXISTS investment_theme (
  id uuid PRIMARY KEY,
  name text NOT NULL UNIQUE,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived')),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS theme_version (
  id uuid PRIMARY KEY,
  theme_id uuid NOT NULL REFERENCES investment_theme(id),
  as_of date NOT NULL,
  phase text NOT NULL CHECK (phase IN ('installation', 'deployment')),
  thesis text NOT NULL,
  profit_path text NOT NULL,
  invalidation_condition text NOT NULL,
  status text NOT NULL CHECK (status IN ('draft', 'confirmed')),
  recorded_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS theme_version_latest_idx
  ON theme_version (theme_id, as_of DESC, recorded_at DESC);

CREATE TABLE IF NOT EXISTS theme_candidate (
  theme_id uuid NOT NULL REFERENCES investment_theme(id),
  candidate_id uuid NOT NULL REFERENCES investment_candidate(id),
  role text NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (theme_id, candidate_id)
);

CREATE TABLE IF NOT EXISTS theme_version_evidence (
  theme_version_id uuid NOT NULL REFERENCES theme_version(id),
  evidence_id uuid NOT NULL REFERENCES research_evidence(id),
  role text NOT NULL CHECK (role IN ('support', 'counter')),
  PRIMARY KEY (theme_version_id, evidence_id)
);
