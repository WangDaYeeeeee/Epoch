CREATE TABLE IF NOT EXISTS investment_candidate (
  id uuid PRIMARY KEY,
  instrument_id text NOT NULL UNIQUE,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived')),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS factor_assessment (
  id uuid PRIMARY KEY,
  candidate_id uuid NOT NULL REFERENCES investment_candidate(id),
  as_of date NOT NULL,
  summary text NOT NULL,
  ranking_reason text NOT NULL,
  status text NOT NULL CHECK (status IN ('draft', 'confirmed')),
  recorded_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS factor_assessment_candidate_idx
  ON factor_assessment (candidate_id, as_of DESC, recorded_at DESC);

CREATE TABLE IF NOT EXISTS factor_assessment_item (
  assessment_id uuid NOT NULL REFERENCES factor_assessment(id),
  factor text NOT NULL CHECK (factor IN (
    'momentum', 'certainty', 'moat', 'earnings_quality', 'earnings_revision', 'valuation'
  )),
  conclusion text NOT NULL CHECK (conclusion IN ('strong', 'neutral', 'weak', 'insufficient')),
  confidence numeric(5, 4) NOT NULL CHECK (confidence BETWEEN 0 AND 1),
  evidence text NOT NULL,
  counter_evidence text NOT NULL,
  direction text NOT NULL CHECK (direction IN ('improving', 'stable', 'deteriorating', 'unknown')),
  impact text NOT NULL,
  PRIMARY KEY (assessment_id, factor)
);

CREATE TABLE IF NOT EXISTS weight_tier (
  id uuid PRIMARY KEY,
  candidate_id uuid NOT NULL REFERENCES investment_candidate(id),
  factor_assessment_id uuid NOT NULL REFERENCES factor_assessment(id),
  as_of date NOT NULL,
  weight_percent integer NOT NULL CHECK (weight_percent IN (10, 15, 20, 25, 30, 35, 40)),
  earnings_expectation text NOT NULL,
  primary_risk text NOT NULL,
  invalidation_condition text NOT NULL,
  why_this_tier text NOT NULL,
  status text NOT NULL CHECK (status IN ('proposed', 'confirmed')),
  recorded_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS weight_tier_candidate_idx
  ON weight_tier (candidate_id, as_of DESC, recorded_at DESC);
