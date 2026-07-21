CREATE TABLE strategy_version (
  id text PRIMARY KEY,
  version text NOT NULL UNIQUE,
  status text NOT NULL CHECK (status IN ('draft', 'active', 'retired')),
  schema_version text NOT NULL,
  content_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE parameter_set (
  id text PRIMARY KEY,
  strategy_version_id text NOT NULL REFERENCES strategy_version(id),
  version text NOT NULL,
  status text NOT NULL CHECK (status IN ('draft', 'active', 'retired')),
  parameters jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (strategy_version_id, version)
);

CREATE TABLE raw_import (
  id uuid PRIMARY KEY,
  source text NOT NULL,
  source_id text NOT NULL,
  content_hash text NOT NULL,
  observed_at timestamptz NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  object_path text NOT NULL,
  UNIQUE (source, source_id, content_hash)
);
