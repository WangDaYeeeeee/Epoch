CREATE TABLE IF NOT EXISTS investment_event (
  id uuid PRIMARY KEY,
  title text NOT NULL CHECK (length(trim(title)) BETWEEN 1 AND 200),
  instrument_id text,
  event_type text NOT NULL CHECK (event_type IN (
    'earnings', 'product', 'regulatory', 'macro', 'capital_allocation', 'other'
  )),
  scheduled_date date NOT NULL,
  source text NOT NULL,
  status text NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled', 'completed', 'cancelled')),
  observed_at timestamptz NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS investment_event_schedule_idx
  ON investment_event (status, scheduled_date, id);

CREATE TABLE IF NOT EXISTS event_playbook (
  id uuid PRIMARY KEY,
  event_id uuid NOT NULL UNIQUE REFERENCES investment_event(id),
  status text NOT NULL CHECK (status IN ('draft', 'ready')),
  summary text NOT NULL CHECK (length(trim(summary)) > 0),
  as_of date NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
