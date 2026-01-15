import { Database } from "../db/queries";
import type { BulkDocsRequest, DocumentInput, Env } from "../types";
import { threeWayMerge } from "../utils/merge";
import { generateRevision } from "../utils/revision";

/**
 * Shared bulk docs handler to avoid code duplication
 */
async function handleBulkDocs(request: BulkDocsRequest, vaultId: string, env: Env) {
	if (!request.docs || !Array.isArray(request.docs)) {
		return { error: "Invalid request: docs array required", status: 400 };
	}

	const db = new Database(env.DB);
	const results = [];

	for (const doc of request.docs) {
		try {
			const existing = await db.getDocument(doc._id, vaultId);
			let newRev: string;
			let finalContent = doc.content || null;

			if (existing) {
				// Check revision if provided
				if (doc._rev && doc._rev !== existing.rev) {
					// Revision conflict detected
					// Try three-way merge if base content is provided
					if (doc._base_content && doc.content && existing.content) {
						const mergeResult = threeWayMerge(doc._base_content, existing.content, doc.content);

						if (mergeResult.success && mergeResult.content) {
							// Merge succeeded, use merged content
							finalContent = mergeResult.content;
							newRev = generateRevision(existing.rev);

							await db.upsertDocument({
								id: doc._id,
								vaultId,
								content: finalContent,
								rev: newRev,
								deleted: doc._deleted ? 1 : 0,
							});

							results.push({
								ok: true,
								id: doc._id,
								rev: newRev,
								merged: true,
							});
							continue;
						}
						// Merge failed, return conflict with both versions
						results.push({
							id: doc._id,
							error: "conflict",
							reason: "Document update conflict - manual resolution required",
							current_content: existing.content,
							current_rev: existing.rev,
							conflicts: mergeResult.conflicts,
						});
						continue;
					}
					// No base content provided, cannot merge
					results.push({
						id: doc._id,
						error: "conflict",
						reason: "Document update conflict",
						current_content: existing.content,
						current_rev: existing.rev,
					});
					continue;
				}
				newRev = generateRevision(existing.rev);
			} else {
				newRev = generateRevision();
			}

			await db.upsertDocument({
				id: doc._id,
				vaultId,
				content: finalContent,
				rev: newRev,
				deleted: doc._deleted ? 1 : 0,
			});

			results.push({
				ok: true,
				id: doc._id,
				rev: newRev,
			});
		} catch (e) {
			results.push({
				id: doc._id,
				error: "internal_error",
				reason: (e as Error).message,
			});
		}
	}

	return results;
}

export function getDocHandler(env: Env) {
	return async (context: any) => {
		const { params, query, set } = context;
		const id = params.id;
		const vaultId = query.vault_id || "default";

		const db = new Database(env.DB);
		const doc = await db.getDocument(id, vaultId);

		if (!doc) {
			set.status = 404;
			return { error: "Document not found" };
		}

		// Return in CouchDB-like format
		return {
			_id: doc.id,
			_rev: doc.rev,
			content: doc.content,
			_deleted: doc.deleted === 1,
		};
	};
}

export function putDocHandler(env: Env) {
	return async (context: any) => {
		const { params, query, body, set } = context;
		const id = params.id;
		const vaultId = query.vault_id || "default";
		const input = body as DocumentInput;

		const db = new Database(env.DB);
		const existing = await db.getDocument(id, vaultId);

		// Generate new revision
		let newRev: string;

		if (existing) {
			// Check for conflicts
			if (input._rev && input._rev !== existing.rev) {
				set.status = 409;
				return {
					error: "Document update conflict",
					reason: "Revision mismatch",
					current_rev: existing.rev,
					provided_rev: input._rev,
				};
			}

			newRev = generateRevision(existing.rev);
		} else {
			newRev = generateRevision();
		}

		// Upsert document
		await db.upsertDocument({
			id,
			vaultId,
			content: input.content || null,
			rev: newRev,
			deleted: input._deleted ? 1 : 0,
		});

		return {
			ok: true,
			id,
			rev: newRev,
		};
	};
}

export function deleteDocHandler(env: Env) {
	return async (context: any) => {
		const { params, query, set } = context;
		const id = params.id;
		const vaultId = query.vault_id || "default";
		const rev = query.rev;

		if (!rev) {
			set.status = 400;
			return { error: "Revision required for deletion" };
		}

		const db = new Database(env.DB);
		const existing = await db.getDocument(id, vaultId);

		if (!existing) {
			set.status = 404;
			return { error: "Document not found" };
		}

		if (existing.rev !== rev) {
			set.status = 409;
			return {
				error: "Document deletion conflict",
				reason: "Revision mismatch",
			};
		}

		const newRev = generateRevision(existing.rev);
		await db.deleteDocument(id, vaultId, newRev);

		return {
			ok: true,
			id,
			rev: newRev,
		};
	};
}

export function bulkDocsHandler(env: Env) {
	return async (context: any) => {
		const { query, body } = context;
		const vaultId = query.vault_id || "default";
		const request = body as BulkDocsRequest;
		return handleBulkDocs(request, vaultId, env);
	};
}
