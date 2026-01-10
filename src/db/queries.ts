import { Document, Revision, Change } from '../types';

export class Database {
  constructor(private db: D1Database) {}

  /**
   * Get a document by ID
   */
  async getDocument(id: string, vaultId: string = 'default'): Promise<Document | null> {
    const result = await this.db
      .prepare('SELECT * FROM documents WHERE id = ? AND vault_id = ?')
      .bind(id, vaultId)
      .first<Document>();

    return result || null;
  }

  /**
   * Create or update a document
   */
  async upsertDocument(doc: {
    id: string;
    vaultId: string;
    content: string | null;
    rev: string;
    deleted: number;
  }): Promise<void> {
    const now = Date.now();
    const existing = await this.getDocument(doc.id, doc.vaultId);

    if (existing) {
      // Update existing document
      await this.db
        .prepare(
          'UPDATE documents SET content = ?, rev = ?, deleted = ?, updated_at = ? WHERE id = ? AND vault_id = ?'
        )
        .bind(doc.content, doc.rev, doc.deleted, now, doc.id, doc.vaultId)
        .run();
    } else {
      // Insert new document
      await this.db
        .prepare(
          'INSERT INTO documents (id, vault_id, content, rev, deleted, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
        )
        .bind(doc.id, doc.vaultId, doc.content, doc.rev, doc.deleted, now, now)
        .run();
    }

    // Save revision
    await this.saveRevision({
      doc_id: doc.id,
      rev: doc.rev,
      content: doc.content,
      deleted: doc.deleted,
    });

    // Add to changes feed
    await this.addChange({
      doc_id: doc.id,
      rev: doc.rev,
      deleted: doc.deleted,
      vault_id: doc.vaultId,
    });
  }

  /**
   * Save a revision
   */
  async saveRevision(revision: {
    doc_id: string;
    rev: string;
    content: string | null;
    deleted: number;
  }): Promise<void> {
    const now = Date.now();
    await this.db
      .prepare(
        'INSERT INTO revisions (doc_id, rev, content, deleted, created_at) VALUES (?, ?, ?, ?, ?)'
      )
      .bind(revision.doc_id, revision.rev, revision.content, revision.deleted, now)
      .run();
  }

  /**
   * Get revisions for a document
   */
  async getRevisions(docId: string, limit: number = 10): Promise<Revision[]> {
    const result = await this.db
      .prepare(
        'SELECT * FROM revisions WHERE doc_id = ? ORDER BY created_at DESC LIMIT ?'
      )
      .bind(docId, limit)
      .all<Revision>();

    return result.results || [];
  }

  /**
   * Add a change to the changes feed
   */
  async addChange(change: {
    doc_id: string;
    rev: string;
    deleted: number;
    vault_id: string;
  }): Promise<void> {
    const now = Date.now();
    await this.db
      .prepare(
        'INSERT INTO changes (doc_id, rev, deleted, vault_id, created_at) VALUES (?, ?, ?, ?, ?)'
      )
      .bind(change.doc_id, change.rev, change.deleted, change.vault_id, now)
      .run();
  }

  /**
   * Get changes since a sequence number
   */
  async getChanges(
    vaultId: string = 'default',
    since: number = 0,
    limit: number = 100
  ): Promise<{ changes: Change[]; lastSeq: number }> {
    const result = await this.db
      .prepare(
        'SELECT * FROM changes WHERE vault_id = ? AND seq > ? ORDER BY seq ASC LIMIT ?'
      )
      .bind(vaultId, since, limit)
      .all<Change>();

    const changes = result.results || [];
    const lastSeq = changes.length > 0 ? changes[changes.length - 1].seq : since;

    return { changes, lastSeq };
  }

  /**
   * Get all documents for a vault (for debugging)
   */
  async getAllDocuments(vaultId: string = 'default', limit: number = 100): Promise<Document[]> {
    const result = await this.db
      .prepare('SELECT * FROM documents WHERE vault_id = ? LIMIT ?')
      .bind(vaultId, limit)
      .all<Document>();

    return result.results || [];
  }

  /**
   * Delete a document (soft delete)
   */
  async deleteDocument(id: string, vaultId: string, rev: string): Promise<void> {
    await this.upsertDocument({
      id,
      vaultId,
      content: null,
      rev,
      deleted: 1,
    });
  }
}
