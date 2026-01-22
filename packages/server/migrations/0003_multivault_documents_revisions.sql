-- Add composite PK to documents and add vault_id to revisions
PRAGMA foreign_keys=OFF;

BEGIN TRANSACTION;

CREATE TABLE IF NOT EXISTS documents_new (
  id TEXT NOT NULL,
  vault_id TEXT NOT NULL DEFAULT 'default',
  content TEXT,
  rev TEXT NOT NULL,
  deleted INTEGER DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (id, vault_id)
);

INSERT INTO documents_new (id, vault_id, content, rev, deleted, created_at, updated_at)
  SELECT id, vault_id, content, rev, deleted, created_at, updated_at FROM documents;

DROP TABLE documents;
ALTER TABLE documents_new RENAME TO documents;

CREATE INDEX IF NOT EXISTS idx_documents_vault_id ON documents(vault_id);
CREATE INDEX IF NOT EXISTS idx_documents_updated_at ON documents(updated_at);
CREATE INDEX IF NOT EXISTS idx_documents_deleted ON documents(deleted);

CREATE TABLE IF NOT EXISTS revisions_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  doc_id TEXT NOT NULL,
  vault_id TEXT NOT NULL DEFAULT 'default',
  rev TEXT NOT NULL,
  content TEXT,
  deleted INTEGER DEFAULT 0,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (doc_id, vault_id) REFERENCES documents(id, vault_id) ON DELETE CASCADE
);

INSERT INTO revisions_new (id, doc_id, vault_id, rev, content, deleted, created_at)
  SELECT r.id,
         r.doc_id,
         COALESCE(d.vault_id, 'default'),
         r.rev,
         r.content,
         r.deleted,
         r.created_at
    FROM revisions r
    LEFT JOIN documents d ON d.id = r.doc_id;

DROP TABLE revisions;
ALTER TABLE revisions_new RENAME TO revisions;

CREATE INDEX IF NOT EXISTS idx_revisions_doc_id ON revisions(vault_id, doc_id);
CREATE INDEX IF NOT EXISTS idx_revisions_rev ON revisions(rev);

COMMIT;

PRAGMA foreign_keys=ON;
