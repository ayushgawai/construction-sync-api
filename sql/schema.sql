-- Unified store (PostgreSQL). The app runs on an in-memory store without
-- DATABASE_URL; with it, src/store.ts mirrors records into this table.
CREATE TABLE IF NOT EXISTS unified_records (
  id TEXT PRIMARY KEY, source TEXT NOT NULL, type TEXT NOT NULL,
  external_id TEXT NOT NULL, updated_at TIMESTAMPTZ NOT NULL,
  status TEXT NOT NULL, project_id TEXT, name TEXT NOT NULL,
  amount_cents BIGINT, currency TEXT NOT NULL DEFAULT 'USD',
  data JSONB NOT NULL DEFAULT '{}'
);
CREATE INDEX IF NOT EXISTS idx_records_type_source ON unified_records(type, source);
CREATE INDEX IF NOT EXISTS idx_records_project ON unified_records(project_id);
CREATE TABLE IF NOT EXISTS sync_runs (
  id BIGSERIAL PRIMARY KEY, source TEXT NOT NULL, started_at TIMESTAMPTZ DEFAULT now(),
  finished_at TIMESTAMPTZ, ok INT DEFAULT 0, failed INT DEFAULT 0, error TEXT
);
CREATE TABLE IF NOT EXISTS webhook_events (
  id BIGSERIAL PRIMARY KEY, event TEXT NOT NULL, record_id TEXT NOT NULL,
  hash TEXT NOT NULL, created_at TIMESTAMPTZ DEFAULT now()
);
