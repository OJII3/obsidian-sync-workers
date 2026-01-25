import { Elysia } from "elysia";
import { Database } from "../db/queries";
import type { AttachmentChangesResponse, Env } from "../types";
import {
	generateAttachmentId,
	generateHash,
	generateR2Key,
	MAX_ATTACHMENT_SIZE,
	validateAttachmentPath,
} from "../utils/attachments";

export const attachmentsRoutes = (env: Env) =>
	new Elysia({ prefix: "/attachments" })
		.get("/changes", async ({ query }) => {
			const since = Number.parseInt(query.since || "0", 10);
			const limit = Number.parseInt(query.limit || "100", 10);
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

			// Get attachment details for each change, filtering out missing attachments
			const resultsWithNulls = await Promise.all(
				changesList.map(async (change) => {
					const attachment = await db.getAttachment(change.attachment_id, vaultId);
					if (!attachment) {
						console.warn(`Attachment metadata missing for id: ${change.attachment_id}`);
						return null;
					}
					return {
						seq: change.seq,
						id: change.attachment_id,
						path: attachment.path,
						hash: change.hash,
						deleted: change.deleted === 1 ? true : undefined,
					};
				}),
			);
			const results = resultsWithNulls.filter((r): r is NonNullable<typeof r> => r !== null);

			const response: AttachmentChangesResponse = {
				results,
				last_seq: lastSeq,
			};

			return response;
		})
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
		.get("/:id/content", async ({ params, query, set }) => {
			const id = decodeURIComponent(params.id);
			const vaultId = query.vault_id || "default";

			// Security: Verify that the attachment ID belongs to the requested vault
			// ID format is "vaultId:path", so we check that the ID starts with the correct vault prefix
			const expectedPrefix = `${vaultId}:`;
			if (!id.startsWith(expectedPrefix)) {
				set.status = 403;
				return { error: "Access denied: vault mismatch" };
			}

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
		.put("/:path", async ({ params, query, request, set }) => {
			const path = decodeURIComponent(params.path);
			const vaultId = query.vault_id || "default";
			// Prefer X-Content-Hash header (more secure), fallback to query param for backward compatibility
			const clientHash = request.headers.get("X-Content-Hash") || query.hash;
			const clientContentLength = request.headers.get("X-Content-Length");

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

			// Validate file size
			if (size > MAX_ATTACHMENT_SIZE) {
				set.status = 413;
				return {
					error: "File too large",
					message: `Maximum file size is ${MAX_ATTACHMENT_SIZE / 1024 / 1024}MB`,
					max_size: MAX_ATTACHMENT_SIZE,
					actual_size: size,
				};
			}

			// Verify content length if provided
			if (clientContentLength) {
				const expectedLength = Number.parseInt(clientContentLength, 10);
				if (!Number.isNaN(expectedLength) && expectedLength !== size) {
					set.status = 400;
					return {
						error: "Content length mismatch",
						expected: expectedLength,
						actual: size,
					};
				}
			}

			// Generate hash
			const hash = await generateHash(data);

			// Verify hash if provided (use 409 Conflict for hash mismatch to indicate data integrity issue)
			if (clientHash && clientHash !== hash) {
				set.status = 409;
				return {
					error: "Hash mismatch - file may have been corrupted during transfer",
					expected: clientHash,
					actual: hash,
				};
			}

			const db = new Database(env.DB);
			// Use content-addressable ID based on hash
			const id = generateAttachmentId(vaultId, hash, path);
			const r2Key = generateR2Key(vaultId, hash, path);

			// Check if attachment with same hash already exists (content-addressable)
			const existing = await db.getAttachment(id, vaultId);
			if (existing && existing.deleted === 0) {
				// Same content already exists, no need to upload
				return {
					ok: true,
					id,
					hash,
					size,
					content_type: contentType,
					unchanged: true,
				};
			}

			// Upload to R2
			await env.ATTACHMENTS.put(r2Key, data, {
				httpMetadata: {
					contentType,
				},
				customMetadata: {
					vaultId,
					hash,
				},
			});

			// Save metadata to database (path is kept for reference/debugging)
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
				hash,
				size,
				content_type: contentType,
			};
		})
		.delete("/:id", async ({ params, query, set }) => {
			const id = decodeURIComponent(params.id);
			const vaultId = query.vault_id || "default";

			// Verify the attachment ID belongs to the requested vault
			const expectedPrefix = `${vaultId}:`;
			if (!id.startsWith(expectedPrefix)) {
				set.status = 403;
				return { error: "Access denied: vault mismatch" };
			}

			const db = new Database(env.DB);
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
		});
