-- API keys table: stores a single hashed API key for auth
-- CHECK(id = 1) ensures only one row can exist (single-key mode)
CREATE TABLE IF NOT EXISTS api_keys (
  id INTEGER PRIMARY KEY CHECK(id = 1),
  key_hash TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
