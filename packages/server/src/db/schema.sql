-- Documents table: stores the current state of each document
CREATE TABLE IF NOT EXISTS documents (
  id TEXT PRIMARY KEY,
  vault_id TEXT NOT NULL DEFAULT 'default',
  content TEXT,
  rev TEXT NOT NULL,
  deleted INTEGER DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_documents_vault_id ON documents(vault_id);
CREATE INDEX IF NOT EXISTS idx_documents_updated_at ON documents(updated_at);
CREATE INDEX IF NOT EXISTS idx_documents_deleted ON documents(deleted);

-- Revisions table: stores the history of document changes
CREATE TABLE IF NOT EXISTS revisions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  doc_id TEXT NOT NULL,
  rev TEXT NOT NULL,
  content TEXT,
  deleted INTEGER DEFAULT 0,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (doc_id) REFERENCES documents(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_revisions_doc_id ON revisions(doc_id);
CREATE INDEX IF NOT EXISTS idx_revisions_rev ON revisions(rev);

-- Changes feed: tracks the sequence of changes for sync
CREATE TABLE IF NOT EXISTS changes (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  doc_id TEXT NOT NULL,
  rev TEXT NOT NULL,
  deleted INTEGER DEFAULT 0,
  vault_id TEXT NOT NULL DEFAULT 'default',
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_changes_vault_id ON changes(vault_id);
CREATE INDEX IF NOT EXISTS idx_changes_seq ON changes(seq);

-- API keys table: stores a single hashed API key for auth
CREATE TABLE IF NOT EXISTS api_keys (
  id INTEGER PRIMARY KEY,
  key_hash TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

-- Attachments table: stores metadata for binary files in R2
CREATE TABLE IF NOT EXISTS attachments (
  id TEXT PRIMARY KEY,
  vault_id TEXT NOT NULL DEFAULT 'default',
  path TEXT NOT NULL,
  content_type TEXT NOT NULL,
  size INTEGER NOT NULL,
  hash TEXT NOT NULL,
  r2_key TEXT NOT NULL,
  deleted INTEGER DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_attachments_vault_id ON attachments(vault_id);
CREATE INDEX IF NOT EXISTS idx_attachments_path ON attachments(vault_id, path);
CREATE INDEX IF NOT EXISTS idx_attachments_hash ON attachments(hash);
CREATE INDEX IF NOT EXISTS idx_attachments_deleted ON attachments(deleted);

-- Attachment changes feed: tracks the sequence of attachment changes for sync
CREATE TABLE IF NOT EXISTS attachment_changes (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  attachment_id TEXT NOT NULL,
  hash TEXT NOT NULL,
  deleted INTEGER DEFAULT 0,
  vault_id TEXT NOT NULL DEFAULT 'default',
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_attachment_changes_vault_id ON attachment_changes(vault_id);
CREATE INDEX IF NOT EXISTS idx_attachment_changes_seq ON attachment_changes(seq);
