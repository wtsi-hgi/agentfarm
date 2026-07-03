-- Source of truth for the SQLite schema (spec: "SQLite schema").
--
-- Applied idempotently at startup via db/migrate.py (CREATE TABLE IF NOT
-- EXISTS makes re-application a no-op). All ids are text UUIDv4. Timestamps are
-- ISO-8601 UTC strings (YYYY-MM-DDTHH:MM:SS.ffffffZ) so lexical sort equals
-- chronological sort. Booleans are integers 0/1.
--
-- The ON DELETE CASCADE clauses below only take effect when the connection has
-- PRAGMA foreign_keys = ON (SQLite defaults this OFF). db/connection.py enables
-- it on every connection.

CREATE TABLE IF NOT EXISTS items (
  id              TEXT PRIMARY KEY,
  title           TEXT NOT NULL,
  slug            TEXT NOT NULL UNIQUE,
  parent_id       TEXT REFERENCES items(id) ON DELETE CASCADE,
  sort_order      REAL NOT NULL,          -- order among siblings
  state           TEXT NOT NULL DEFAULT 'not-started',
  mode            TEXT NOT NULL DEFAULT 'prompt-agent',
  effort          TEXT NOT NULL DEFAULT 'medium',
  blocked_external      INTEGER NOT NULL DEFAULT 0,
  blocked_note          TEXT,
  blocked_followup_date TEXT,             -- ISO date or NULL
  description     TEXT NOT NULL DEFAULT '',
  repo_url        TEXT,
  usage           TEXT NOT NULL DEFAULT '',
  created_by      TEXT NOT NULL,
  updated_by      TEXT NOT NULL,
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL,
  state_changed_at TEXT NOT NULL,
  completed_at    TEXT                    -- set when state done/abandoned
);

CREATE TABLE IF NOT EXISTS dependencies (
  id          TEXT PRIMARY KEY,
  from_id     TEXT NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  to_id       TEXT NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  kind        TEXT NOT NULL,              -- 'explicit' in v1; 'implicit' legacy
  automatic_chain INTEGER NOT NULL DEFAULT 0,
  UNIQUE (from_id, to_id)
);  -- edge means: from_id depends on (needs) to_id

CREATE TABLE IF NOT EXISTS schema_migrations (
  id          TEXT PRIMARY KEY
);

CREATE TABLE IF NOT EXISTS comments (
  id          TEXT PRIMARY KEY,
  item_id     TEXT NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  author      TEXT NOT NULL,
  body        TEXT NOT NULL,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS item_notes (
  id          TEXT PRIMARY KEY,
  item_id     TEXT NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  created_by  TEXT NOT NULL,
  body        TEXT NOT NULL,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS prompt_response_entries (
  id          TEXT PRIMARY KEY,
  item_id     TEXT NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  kind        TEXT NOT NULL CHECK (kind IN ('prompt', 'response')),
  created_by  TEXT NOT NULL,
  body        TEXT NOT NULL,
  created_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS scratchpad (
  id          TEXT PRIMARY KEY CHECK (id = 'primary'),
  body        TEXT NOT NULL DEFAULT '',
  height      INTEGER NOT NULL DEFAULT 220,
  minimized   INTEGER NOT NULL DEFAULT 1,
  updated_by  TEXT,
  updated_at  TEXT
);

CREATE TABLE IF NOT EXISTS item_state_changes (
  id          TEXT PRIMARY KEY,
  item_id     TEXT NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  actor       TEXT NOT NULL,
  from_state  TEXT NOT NULL,
  to_state    TEXT NOT NULL,
  created_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS markers (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  at          TEXT NOT NULL,              -- the named point in time
  created_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS runs (         -- v2 seam, unused in v1 logic
  id          TEXT PRIMARY KEY,
  item_id     TEXT NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  status      TEXT NOT NULL DEFAULT 'pending',
  created_at  TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_items_parent_sort
  ON items(parent_id, sort_order, id);

CREATE INDEX IF NOT EXISTS idx_dependencies_from
  ON dependencies(from_id);

CREATE INDEX IF NOT EXISTS idx_dependencies_to
  ON dependencies(to_id);

CREATE INDEX IF NOT EXISTS idx_dependencies_kind_from
  ON dependencies(kind, from_id);

CREATE INDEX IF NOT EXISTS idx_dependencies_auto_chain_from
  ON dependencies(automatic_chain, from_id);

CREATE INDEX IF NOT EXISTS idx_item_notes_item_created
  ON item_notes(item_id, created_at, id);

CREATE INDEX IF NOT EXISTS idx_prompt_response_entries_item_created
  ON prompt_response_entries(item_id, created_at, id);
