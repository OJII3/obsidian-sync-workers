import { env } from "cloudflare:workers";
import { Elysia } from "elysia";
import { Database } from "./db/queries";
import type {
	AttachmentChangesResponse,
	BulkDocsRequest,
	ChangesResponse,
	DocumentInput,
} from "./types";
import { authErrorResponse, requireAuth } from "./utils/auth";
import { threeWayMerge } from "./utils/merge";
import { generateRevision } from "./utils/revision";

/**
 * Generate SHA-256 hash from ArrayBuffer
 */
async function generateHash(data: ArrayBuffer): Promise<string> {
	const hashBuffer = await crypto.subtle.digest("SHA-256", data);
	const hashArray = Array.from(new Uint8Array(hashBuffer));
	return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Validate attachment path to prevent directory traversal attacks
 */
function validateAttachmentPath(path: string): boolean {
	// Reject empty paths
	if (!path || path.trim() === "") {
		return false;
	}

	// Reject absolute paths
	if (path.startsWith("/") || path.startsWith("\\")) {
		return false;
	}

	// Reject paths containing ".." (directory traversal)
	if (path.includes("..")) {
		return false;
	}

	// Reject paths containing null bytes
	if (path.includes("\0")) {
		return false;
	}

	// Reject paths with suspicious patterns
	const suspiciousPatterns = [
		/^\.\./, // starts with ..
		/\/\.\./, // contains /..
		/\\\.\./, // contains \..
	];

	for (const pattern of suspiciousPatterns) {
		if (pattern.test(path)) {
			return false;
		}
	}

	return true;
}

/**
 * Generate attachment ID from vault ID and path
 */
function generateAttachmentId(vaultId: string, path: string): string {
	return `${vaultId}:${path}`;
}

/**
 * Generate R2 key for attachment storage
 */
function generateR2Key(vaultId: string, path: string, hash: string): string {
	return `${vaultId}/${hash}/${path}`;
}

/**
 * Shared bulk docs handler to avoid code duplication
 */
async function handleBulkDocs(request: BulkDocsRequest, vaultId: string) {
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
						} else {
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
					} else {
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

const app = new Elysia({ aot: false })
	// CORS middleware - configurable via CORS_ORIGIN env var
	.onRequest(({ set }) => {
		const allowedOrigin = env.CORS_ORIGIN || "*";
		set.headers = {
			"Access-Control-Allow-Origin": allowedOrigin,
			"Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
			"Access-Control-Allow-Headers": "Content-Type, Authorization",
		};
	})
	// Authentication middleware - applies to all /api/* routes
	.onBeforeHandle(({ request, set, path }) => {
		// Skip auth for health check endpoint and OPTIONS requests
		if (path === "/" || request.method === "OPTIONS") {
			return;
		}

		// Apply auth to all API routes
		if (path.startsWith("/api")) {
			const isAuthorized = requireAuth({ request, set, env });
			if (!isAuthorized) {
				return authErrorResponse();
			}
		}
	})
	// Handle OPTIONS requests for CORS preflight
	.options("/*", () => {
		return new Response(null, { status: 204 });
	})
	// Health check endpoint
	.get("/", () => ({
		name: "Obsidian Sync Workers",
		version: "0.1.0",
		status: "ok",
	}))
	// Changes feed routes
	.group("/api/changes", (app) =>
		app
			.get("/", async ({ query }) => {
				const since = parseInt(query.since || "0", 10);
				const limit = parseInt(query.limit || "100", 10);
				const vaultId = query.vault_id || "default";

				// Validate parameters
				if (Number.isNaN(since) || since < 0) {
					return {
						error: "Invalid since parameter",
						status: 400,
					};
				}

				if (Number.isNaN(limit) || limit < 1 || limit > 1000) {
					return {
						error: "Invalid limit parameter (1-1000)",
						status: 400,
					};
				}

				const db = new Database(env.DB);
				const { changes: changesList, lastSeq } = await db.getChanges(vaultId, since, limit);

				// Format response in CouchDB-like format
				const response: ChangesResponse = {
					results: changesList.map((change) => ({
						seq: change.seq,
						id: change.doc_id,
						changes: [{ rev: change.rev }],
						deleted: change.deleted === 1 ? true : undefined,
					})),
					last_seq: lastSeq,
				};

				return response;
			})
			.get("/continuous", () => ({
				error: "Not implemented",
				message: "Continuous changes feed requires WebSocket support",
				status: 501,
			})),
	)
	// Document routes
	.group("/api/docs", (app) =>
		app
			// Get a single document
			.get("/:id", async ({ params, query, set }) => {
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
			})
			// Create or update a document
			.put("/:id", async ({ params, query, body, set }) => {
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
			})
			// Delete a document
			.delete("/:id", async ({ params, query, set }) => {
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
			})
			// Bulk document operations
			.post("/bulk_docs", async ({ query, body }) => {
				const vaultId = query.vault_id || "default";
				const request = body as BulkDocsRequest;
				return handleBulkDocs(request, vaultId);
			}),
	)
	// Alternative bulk docs path
	.post("/api/_bulk_docs", async ({ query, body }) => {
		const vaultId = query.vault_id || "default";
		const request = body as BulkDocsRequest;
		return handleBulkDocs(request, vaultId);
	})
	// Attachment changes feed
	.group("/api/attachments", (app) =>
		app
			// Get attachment changes
			.get("/changes", async ({ query }) => {
				const since = parseInt(query.since || "0", 10);
				const limit = parseInt(query.limit || "100", 10);
				const vaultId = query.vault_id || "default";

				if (Number.isNaN(since) || since < 0) {
					return { error: "Invalid since parameter", status: 400 };
				}

				if (Number.isNaN(limit) || limit < 1 || limit > 1000) {
					return { error: "Invalid limit parameter (1-1000)", status: 400 };
				}

				const db = new Database(env.DB);
				const { changes: changesList, lastSeq } = await db.getAttachmentChanges(
					vaultId,
					since,
					limit,
				);

				// Get attachment details for each change
				const results = await Promise.all(
					changesList.map(async (change) => {
						const attachment = await db.getAttachment(change.attachment_id, vaultId);
						return {
							seq: change.seq,
							id: change.attachment_id,
							path: attachment?.path || "",
							hash: change.hash,
							deleted: change.deleted === 1 ? true : undefined,
						};
					}),
				);

				const response: AttachmentChangesResponse = {
					results,
					last_seq: lastSeq,
				};

				return response;
			})
			// Get attachment metadata by ID
			.get("/:id", async ({ params, query, set }) => {
				const id = decodeURIComponent(params.id);
				const vaultId = query.vault_id || "default";

				const db = new Database(env.DB);
				const attachment = await db.getAttachment(id, vaultId);

				if (!attachment || attachment.deleted === 1) {
					set.status = 404;
					return { error: "Attachment not found" };
				}

				return {
					id: attachment.id,
					path: attachment.path,
					content_type: attachment.content_type,
					size: attachment.size,
					hash: attachment.hash,
					deleted: attachment.deleted === 1,
				};
			})
			// Download attachment content
			.get("/:id/content", async ({ params, query, set }) => {
				const id = decodeURIComponent(params.id);
				const vaultId = query.vault_id || "default";

				const db = new Database(env.DB);
				const attachment = await db.getAttachment(id, vaultId);

				if (!attachment || attachment.deleted === 1) {
					set.status = 404;
					return { error: "Attachment not found" };
				}

				// Get from R2
				const object = await env.ATTACHMENTS.get(attachment.r2_key);

				if (!object) {
					set.status = 404;
					return { error: "Attachment content not found in storage" };
				}

				// Return binary content
				set.headers = {
					"Content-Type": attachment.content_type,
					"Content-Length": object.size.toString(),
					"X-Attachment-Hash": attachment.hash,
				};

				return new Response(object.body, {
					headers: {
						"Content-Type": attachment.content_type,
						"Content-Length": object.size.toString(),
						"X-Attachment-Hash": attachment.hash,
					},
				});
			})
			// Upload attachment
			.put("/:path", async ({ params, query, request, set }) => {
				const path = decodeURIComponent(params.path);
				const vaultId = query.vault_id || "default";
				const clientHash = query.hash;

				// Validate path to prevent directory traversal attacks
				if (!validateAttachmentPath(path)) {
					set.status = 400;
					return {
						error: "Invalid path: must be relative and not contain directory traversal patterns",
					};
				}

				// Get content type from header
				const contentType = request.headers.get("Content-Type") || "application/octet-stream";

				// Read body as ArrayBuffer
				const data = await request.arrayBuffer();
				const size = data.byteLength;

				// Generate hash
				const hash = await generateHash(data);

				// Verify hash if provided
				if (clientHash && clientHash !== hash) {
					set.status = 400;
					return {
						error: "Hash mismatch",
						expected: clientHash,
						actual: hash,
					};
				}

				const db = new Database(env.DB);
				const id = generateAttachmentId(vaultId, path);

				// Check if attachment with same hash already exists
				const existing = await db.getAttachment(id, vaultId);
				if (existing && existing.hash === hash && existing.deleted === 0) {
					// Same content, no need to upload
					return {
						ok: true,
						id,
						path,
						hash,
						size,
						content_type: contentType,
						unchanged: true,
					};
				}

				// Generate R2 key and upload
				const r2Key = generateR2Key(vaultId, path, hash);
				await env.ATTACHMENTS.put(r2Key, data, {
					httpMetadata: {
						contentType,
					},
					customMetadata: {
						vaultId,
						path,
						hash,
					},
				});

				// Save metadata to database
				await db.upsertAttachment({
					id,
					vaultId,
					path,
					contentType,
					size,
					hash,
					r2Key,
					deleted: 0,
				});

				return {
					ok: true,
					id,
					path,
					hash,
					size,
					content_type: contentType,
				};
			})
			// Delete attachment
			.delete("/:path", async ({ params, query, set }) => {
				const path = decodeURIComponent(params.path);
				const vaultId = query.vault_id || "default";

				// Validate path to prevent directory traversal attacks
				if (!validateAttachmentPath(path)) {
					set.status = 400;
					return {
						error: "Invalid path: must be relative and not contain directory traversal patterns",
					};
				}

				const db = new Database(env.DB);
				const id = generateAttachmentId(vaultId, path);
				const existing = await db.getAttachment(id, vaultId);

				if (!existing) {
					set.status = 404;
					return { error: "Attachment not found" };
				}

				// Soft delete (keep R2 object for potential recovery)
				await db.deleteAttachment(id, vaultId);

				return {
					ok: true,
					id,
					deleted: true,
				};
			}),
	)
	// 404 handler
	.onError(({ code, error, set }) => {
		if (code === "NOT_FOUND") {
			set.status = 404;
			return { error: "Not found" };
		}

		console.error("Error:", error);
		set.status = 500;
		return {
			error: "Internal server error",
			message: error.message,
		};
	})
	.compile();

export default app;
