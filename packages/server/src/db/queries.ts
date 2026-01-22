import type { Attachment, AttachmentChange, Change, Document, Revision } from "../types";

export class Database {
	constructor(private db: D1Database) {}

	/**
	 * Get a document by ID
	 */
	async getDocument(id: string, vaultId: string = "default"): Promise<Document | null> {
		const result = await this.db
			.prepare("SELECT * FROM documents WHERE id = ? AND vault_id = ?")
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
					"UPDATE documents SET content = ?, rev = ?, deleted = ?, updated_at = ? WHERE id = ? AND vault_id = ?",
				)
				.bind(doc.content, doc.rev, doc.deleted, now, doc.id, doc.vaultId)
				.run();
		} else {
			// Insert new document
			await this.db
				.prepare(
					"INSERT INTO documents (id, vault_id, content, rev, deleted, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
				)
				.bind(doc.id, doc.vaultId, doc.content, doc.rev, doc.deleted, now, now)
				.run();
		}

		// Save revision
		await this.saveRevision({
			doc_id: doc.id,
			vault_id: doc.vaultId,
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
		vault_id: string;
		rev: string;
		content: string | null;
		deleted: number;
	}): Promise<void> {
		const now = Date.now();
		await this.db
			.prepare(
				"INSERT INTO revisions (doc_id, vault_id, rev, content, deleted, created_at) VALUES (?, ?, ?, ?, ?, ?)",
			)
			.bind(
				revision.doc_id,
				revision.vault_id,
				revision.rev,
				revision.content,
				revision.deleted,
				now,
			)
			.run();
	}

	/**
	 * Get revisions for a document
	 */
	async getRevisions(
		docId: string,
		vaultId: string = "default",
		limit: number = 10,
	): Promise<Revision[]> {
		const result = await this.db
			.prepare(
				"SELECT * FROM revisions WHERE doc_id = ? AND vault_id = ? ORDER BY created_at DESC LIMIT ?",
			)
			.bind(docId, vaultId, limit)
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
				"INSERT INTO changes (doc_id, rev, deleted, vault_id, created_at) VALUES (?, ?, ?, ?, ?)",
			)
			.bind(change.doc_id, change.rev, change.deleted, change.vault_id, now)
			.run();
	}

	/**
	 * Get changes since a sequence number
	 */
	async getChanges(
		vaultId: string = "default",
		since: number = 0,
		limit: number = 100,
	): Promise<{ changes: Change[]; lastSeq: number }> {
		const result = await this.db
			.prepare("SELECT * FROM changes WHERE vault_id = ? AND seq > ? ORDER BY seq ASC LIMIT ?")
			.bind(vaultId, since, limit)
			.all<Change>();

		const changes = result.results || [];
		const lastSeq = changes.length > 0 ? changes[changes.length - 1].seq : since;

		return { changes, lastSeq };
	}

	/**
	 * Get all documents for a vault (for debugging)
	 */
	async getAllDocuments(vaultId: string = "default", limit: number = 100): Promise<Document[]> {
		const result = await this.db
			.prepare("SELECT * FROM documents WHERE vault_id = ? LIMIT ?")
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

	// =====================================
	// Attachment Methods (R2 Storage)
	// =====================================

	/**
	 * Get an attachment by ID
	 */
	async getAttachment(id: string, vaultId: string = "default"): Promise<Attachment | null> {
		const result = await this.db
			.prepare("SELECT * FROM attachments WHERE id = ? AND vault_id = ?")
			.bind(id, vaultId)
			.first<Attachment>();

		return result || null;
	}

	/**
	 * Get an attachment by path
	 */
	async getAttachmentByPath(path: string, vaultId: string = "default"): Promise<Attachment | null> {
		const result = await this.db
			.prepare("SELECT * FROM attachments WHERE path = ? AND vault_id = ? AND deleted = 0")
			.bind(path, vaultId)
			.first<Attachment>();

		return result || null;
	}

	/**
	 * Create or update an attachment
	 */
	async upsertAttachment(attachment: {
		id: string;
		vaultId: string;
		path: string;
		contentType: string;
		size: number;
		hash: string;
		r2Key: string;
		deleted?: number;
	}): Promise<void> {
		const now = Date.now();
		const existing = await this.getAttachment(attachment.id, attachment.vaultId);

		if (existing) {
			await this.db
				.prepare(
					"UPDATE attachments SET path = ?, content_type = ?, size = ?, hash = ?, r2_key = ?, deleted = ?, updated_at = ? WHERE id = ? AND vault_id = ?",
				)
				.bind(
					attachment.path,
					attachment.contentType,
					attachment.size,
					attachment.hash,
					attachment.r2Key,
					attachment.deleted || 0,
					now,
					attachment.id,
					attachment.vaultId,
				)
				.run();
		} else {
			await this.db
				.prepare(
					"INSERT INTO attachments (id, vault_id, path, content_type, size, hash, r2_key, deleted, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
				)
				.bind(
					attachment.id,
					attachment.vaultId,
					attachment.path,
					attachment.contentType,
					attachment.size,
					attachment.hash,
					attachment.r2Key,
					attachment.deleted || 0,
					now,
					now,
				)
				.run();
		}

		// Add to attachment changes feed
		await this.addAttachmentChange({
			attachment_id: attachment.id,
			hash: attachment.hash,
			deleted: attachment.deleted || 0,
			vault_id: attachment.vaultId,
		});
	}

	/**
	 * Add a change to the attachment changes feed
	 */
	async addAttachmentChange(change: {
		attachment_id: string;
		hash: string;
		deleted: number;
		vault_id: string;
	}): Promise<void> {
		const now = Date.now();
		await this.db
			.prepare(
				"INSERT INTO attachment_changes (attachment_id, hash, deleted, vault_id, created_at) VALUES (?, ?, ?, ?, ?)",
			)
			.bind(change.attachment_id, change.hash, change.deleted, change.vault_id, now)
			.run();
	}

	/**
	 * Get attachment changes since a sequence number
	 */
	async getAttachmentChanges(
		vaultId: string = "default",
		since: number = 0,
		limit: number = 100,
	): Promise<{ changes: AttachmentChange[]; lastSeq: number }> {
		const result = await this.db
			.prepare(
				"SELECT * FROM attachment_changes WHERE vault_id = ? AND seq > ? ORDER BY seq ASC LIMIT ?",
			)
			.bind(vaultId, since, limit)
			.all<AttachmentChange>();

		const changes = result.results || [];
		const lastSeq = changes.length > 0 ? changes[changes.length - 1].seq : since;

		return { changes, lastSeq };
	}

	/**
	 * Get all attachments for a vault
	 */
	async getAllAttachments(vaultId: string = "default", limit: number = 100): Promise<Attachment[]> {
		const result = await this.db
			.prepare("SELECT * FROM attachments WHERE vault_id = ? AND deleted = 0 LIMIT ?")
			.bind(vaultId, limit)
			.all<Attachment>();

		return result.results || [];
	}

	/**
	 * Delete an attachment (soft delete)
	 */
	async deleteAttachment(id: string, vaultId: string): Promise<void> {
		const existing = await this.getAttachment(id, vaultId);
		if (!existing) return;

		await this.upsertAttachment({
			id,
			vaultId,
			path: existing.path,
			contentType: existing.content_type,
			size: existing.size,
			hash: existing.hash,
			r2Key: existing.r2_key,
			deleted: 1,
		});
	}

	// =====================================
	// Cleanup Methods
	// =====================================

	/**
	 * Delete old revisions (older than specified days)
	 * Keeps the most recent revision for each document
	 * @param maxAgeDays Maximum age in days (default: 90)
	 * @returns Number of deleted revisions
	 */
	async cleanupOldRevisions(maxAgeDays: number = 90): Promise<number> {
		const cutoffTime = Date.now() - maxAgeDays * 24 * 60 * 60 * 1000;

		// Delete old revisions, but keep at least the most recent one for each doc
		// Using a subquery to find revisions that are not the latest
		const result = await this.db
			.prepare(
				`DELETE FROM revisions
				 WHERE created_at < ?
				 AND id NOT IN (
					 SELECT MAX(id) FROM revisions GROUP BY doc_id, vault_id
				 )`,
			)
			.bind(cutoffTime)
			.run();

		return result.meta.changes || 0;
	}

	/**
	 * Delete old change feed entries (older than specified days)
	 * Note: This doesn't affect sync functionality for active clients,
	 * but new clients won't see history older than the cutoff
	 * @param maxAgeDays Maximum age in days (default: 90)
	 * @returns Number of deleted changes
	 */
	async cleanupOldChanges(maxAgeDays: number = 90): Promise<number> {
		const cutoffTime = Date.now() - maxAgeDays * 24 * 60 * 60 * 1000;

		const result = await this.db
			.prepare("DELETE FROM changes WHERE created_at < ?")
			.bind(cutoffTime)
			.run();

		return result.meta.changes || 0;
	}

	/**
	 * Delete old attachment change feed entries
	 * @param maxAgeDays Maximum age in days (default: 90)
	 * @returns Number of deleted attachment changes
	 */
	async cleanupOldAttachmentChanges(maxAgeDays: number = 90): Promise<number> {
		const cutoffTime = Date.now() - maxAgeDays * 24 * 60 * 60 * 1000;

		const result = await this.db
			.prepare("DELETE FROM attachment_changes WHERE created_at < ?")
			.bind(cutoffTime)
			.run();

		return result.meta.changes || 0;
	}

	/**
	 * Get cleanup statistics
	 */
	async getCleanupStats(): Promise<{
		revisionCount: number;
		changeCount: number;
		attachmentChangeCount: number;
		documentCount: number;
		attachmentCount: number;
	}> {
		const [revisions, changes, attachmentChanges, documents, attachments] = await Promise.all([
			this.db.prepare("SELECT COUNT(*) as count FROM revisions").first<{ count: number }>(),
			this.db.prepare("SELECT COUNT(*) as count FROM changes").first<{ count: number }>(),
			this.db
				.prepare("SELECT COUNT(*) as count FROM attachment_changes")
				.first<{ count: number }>(),
			this.db
				.prepare("SELECT COUNT(*) as count FROM documents WHERE deleted = 0")
				.first<{ count: number }>(),
			this.db
				.prepare("SELECT COUNT(*) as count FROM attachments WHERE deleted = 0")
				.first<{ count: number }>(),
		]);

		return {
			revisionCount: revisions?.count || 0,
			changeCount: changes?.count || 0,
			attachmentChangeCount: attachmentChanges?.count || 0,
			documentCount: documents?.count || 0,
			attachmentCount: attachments?.count || 0,
		};
	}

	/**
	 * Perform full cleanup
	 * @param maxAgeDays Maximum age in days (default: 90)
	 */
	async performFullCleanup(maxAgeDays: number = 90): Promise<{
		deletedRevisions: number;
		deletedChanges: number;
		deletedAttachmentChanges: number;
	}> {
		const [deletedRevisions, deletedChanges, deletedAttachmentChanges] = await Promise.all([
			this.cleanupOldRevisions(maxAgeDays),
			this.cleanupOldChanges(maxAgeDays),
			this.cleanupOldAttachmentChanges(maxAgeDays),
		]);

		return {
			deletedRevisions,
			deletedChanges,
			deletedAttachmentChanges,
		};
	}

	/**
	 * Get the latest sequence numbers for a vault (lightweight status check)
	 * This is optimized for frequent polling - only returns max seq numbers
	 */
	async getLatestSeqs(vaultId: string = "default"): Promise<{
		lastSeq: number;
		lastAttachmentSeq: number;
	}> {
		const [docSeq, attachmentSeq] = await Promise.all([
			this.db
				.prepare("SELECT MAX(seq) as max_seq FROM changes WHERE vault_id = ?")
				.bind(vaultId)
				.first<{ max_seq: number | null }>(),
			this.db
				.prepare("SELECT MAX(seq) as max_seq FROM attachment_changes WHERE vault_id = ?")
				.bind(vaultId)
				.first<{ max_seq: number | null }>(),
		]);

		return {
			lastSeq: docSeq?.max_seq || 0,
			lastAttachmentSeq: attachmentSeq?.max_seq || 0,
		};
	}
}
