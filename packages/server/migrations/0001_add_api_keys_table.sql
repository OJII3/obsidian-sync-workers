-- Migration: Add api_keys table for database-backed authentication
-- This table stores a single hashed API key (single-key mode)
-- CHECK(id = 1) constraint ensures only one row can exist

CREATE TABLE IF NOT EXISTS api_keys (
  id INTEGER PRIMARY KEY CHECK(id = 1),
  key_hash TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
