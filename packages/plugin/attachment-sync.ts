import { TFile, type Vault } from "obsidian";
import type { MetadataManager } from "./metadata-manager";
import { type RetryOptions, retryFetch } from "./retry-fetch";
import type {
	AttachmentChangesResponse,
	AttachmentUploadResponse,
	SyncSettings,
	SyncStats,
} from "./types";
import { getContentType, isAttachmentFile } from "./types";

export class AttachmentSync {
	private vault: Vault;
	private settings: SyncSettings;
	private metadataManager: MetadataManager;
	private retryOptions: RetryOptions;
	private onProgress?: (current: number, total: number) => void;

	// Number of concurrent uploads (like s3-image-uploader uses Promise.all for parallel uploads)
	private static readonly UPLOAD_CONCURRENCY = 3;
	// Maximum attachment size (100MB)
	private static readonly MAX_ATTACHMENT_SIZE = 100 * 1024 * 1024;

	constructor(
		vault: Vault,
		settings: SyncSettings,
		metadataManager: MetadataManager,
		retryOptions: RetryOptions,
	) {
		this.vault = vault;
		this.settings = settings;
		this.metadataManager = metadataManager;
		this.retryOptions = retryOptions;
	}

	setProgressCallback(callback: (current: number, total: number) => void): void {
		this.onProgress = callback;
	}

	async pullAttachmentChanges(syncStats: SyncStats): Promise<void> {
		const BATCH_SIZE = 100;
		let since = this.settings.lastAttachmentSeq;
		let hasMore = true;
		let totalProcessed = 0;

		while (hasMore) {
			const url = `${this.settings.serverUrl}/api/attachments/changes?since=${since}&limit=${BATCH_SIZE}&vault_id=${this.settings.vaultId}`;

			const response = await retryFetch(url, undefined, this.retryOptions);
			if (!response.ok) {
				throw new Error(`Failed to fetch attachment changes: ${response.statusText}`);
			}

			const data: AttachmentChangesResponse = await response.json();

			// Process changes in this batch
			for (let i = 0; i < data.results.length; i++) {
				const change = data.results[i];
				totalProcessed++;
				this.onProgress?.(totalProcessed, totalProcessed);

				try {
					if (change.deleted) {
						await this.deleteLocalAttachment(change.path);
					} else {
						await this.pullAttachment(change.id, change.path, change.hash);
					}
					syncStats.attachmentsPulled++;
				} catch (error) {
					console.error(`Error processing attachment change for ${change.path}:`, error);
					syncStats.errors++;
				}
			}

			// Update last sequence for this batch
			if (data.last_seq > since) {
				since = data.last_seq;
				this.settings.lastAttachmentSeq = data.last_seq;
			}

			// Check if there are more changes to fetch
			hasMore = data.results.length === BATCH_SIZE;
		}

		// Persist the updated lastAttachmentSeq to prevent re-fetching on reload
		await this.metadataManager.persistCache();
	}

	async pushAttachmentChanges(syncStats: SyncStats): Promise<void> {
		const files = this.vault.getFiles();
		const attachmentFiles = files.filter((file) => isAttachmentFile(file.path));
		const currentAttachmentPaths = new Set<string>();
		const attachmentCache = this.metadataManager.getAttachmentCache();

		const attachmentsToUpload: TFile[] = [];

		// Check for new or modified attachments
		for (const file of attachmentFiles) {
			currentAttachmentPaths.add(file.path);
			const metadata = attachmentCache.get(file.path);
			const fileModTime = file.stat.mtime;

			// Check if file has been modified since last sync
			if (!metadata || fileModTime > metadata.lastModified) {
				attachmentsToUpload.push(file);
			}
		}

		// Check for deleted attachments
		const deletedAttachments: string[] = [];
		for (const [path] of attachmentCache.entries()) {
			if (isAttachmentFile(path) && !currentAttachmentPaths.has(path)) {
				deletedAttachments.push(path);
			}
		}

		const total = attachmentsToUpload.length + deletedAttachments.length;
		if (total === 0) {
			return;
		}

		let completed = 0;

		// Upload new/modified attachments in parallel with concurrency limit
		// This is inspired by s3-image-uploader's Promise.all pattern for parallel uploads
		for (let i = 0; i < attachmentsToUpload.length; i += AttachmentSync.UPLOAD_CONCURRENCY) {
			const chunk = attachmentsToUpload.slice(i, i + AttachmentSync.UPLOAD_CONCURRENCY);

			const uploadResults = await Promise.allSettled(
				chunk.map(async (file) => {
					await this.uploadAttachment(file);
					return file.path;
				}),
			);

			// Process results - use index to track which file corresponds to each result
			for (let j = 0; j < uploadResults.length; j++) {
				const result = uploadResults[j];
				const file = chunk[j];
				completed++;
				this.onProgress?.(completed, total);

				if (result.status === "fulfilled") {
					syncStats.attachmentsPushed++;
				} else {
					console.error(`Failed to upload attachment ${file.path}:`, result.reason);
					syncStats.errors++;
				}
			}
		}

		// Delete remote attachments (sequential to avoid race conditions)
		for (const path of deletedAttachments) {
			completed++;
			this.onProgress?.(completed, total);

			try {
				await this.deleteRemoteAttachment(path);
				attachmentCache.delete(path);
				syncStats.attachmentsPushed++;
			} catch (error) {
				console.error(`Failed to delete remote attachment ${path}:`, error);
				syncStats.errors++;
			}
		}

		await this.metadataManager.persistCache();
	}

	private async pullAttachment(id: string, path: string, serverHash: string): Promise<void> {
		// Validate path to prevent file creation errors
		if (!path || path.trim() === "") {
			throw new Error(`Cannot download attachment: empty path for id ${id}`);
		}

		const attachmentCache = this.metadataManager.getAttachmentCache();

		// Check if local file exists with same hash
		const localMeta = attachmentCache.get(path);
		if (localMeta && localMeta.hash === serverHash) {
			return;
		}

		// Download attachment content
		const url = `${this.settings.serverUrl}/api/attachments/${encodeURIComponent(id)}/content?vault_id=${this.settings.vaultId}`;

		const response = await retryFetch(url, undefined, this.retryOptions);
		if (!response.ok) {
			if (response.status === 404) {
				return;
			}
			throw new Error(`Failed to fetch attachment: ${response.statusText}`);
		}

		const data = await response.arrayBuffer();
		const contentType = response.headers.get("Content-Type") || "application/octet-stream";
		const hash = response.headers.get("X-Attachment-Hash") || serverHash;

		// Ensure parent folders exist
		const lastSlashIndex = path.lastIndexOf("/");
		if (lastSlashIndex !== -1) {
			const folderPath = path.substring(0, lastSlashIndex);
			if (folderPath) {
				const existingFolder = this.vault.getAbstractFileByPath(folderPath);
				if (!existingFolder) {
					const segments = folderPath.split("/");
					let currentPath = "";
					for (const segment of segments) {
						if (!segment) continue;
						currentPath = currentPath ? `${currentPath}/${segment}` : segment;
						if (!this.vault.getAbstractFileByPath(currentPath)) {
							await this.vault.createFolder(currentPath);
						}
					}
				}
			}
		}

		// Write file
		const file = this.vault.getAbstractFileByPath(path);
		if (file instanceof TFile) {
			await this.vault.modifyBinary(file, data);
		} else {
			await this.vault.createBinary(path, data);
		}

		// Update cache
		attachmentCache.set(path, {
			path,
			hash,
			size: data.byteLength,
			contentType,
			lastModified: Date.now(),
		});
		await this.metadataManager.persistCache();
	}

	private async deleteLocalAttachment(path: string): Promise<void> {
		const file = this.vault.getAbstractFileByPath(path);
		const attachmentCache = this.metadataManager.getAttachmentCache();

		if (file instanceof TFile) {
			await this.vault.delete(file);
			attachmentCache.delete(path);
			await this.metadataManager.persistCache();
		}
	}

	private async uploadAttachment(file: TFile): Promise<void> {
		const data = await this.vault.readBinary(file);

		// Validate file size
		if (data.byteLength > AttachmentSync.MAX_ATTACHMENT_SIZE) {
			throw new Error(
				`File ${file.path} is too large (${(data.byteLength / 1024 / 1024).toFixed(1)}MB). Maximum size is ${AttachmentSync.MAX_ATTACHMENT_SIZE / 1024 / 1024}MB.`,
			);
		}

		const hash = await this.generateHash(data);
		const contentType = getContentType(file.path);
		const attachmentCache = this.metadataManager.getAttachmentCache();

		// Check if server already has this exact file
		const metadata = attachmentCache.get(file.path);
		if (metadata && metadata.hash === hash) {
			return;
		}

		const url = `${this.settings.serverUrl}/api/attachments/${encodeURIComponent(file.path)}?vault_id=${this.settings.vaultId}`;

		const response = await retryFetch(
			url,
			{
				method: "PUT",
				headers: {
					"Content-Type": contentType,
					"X-Content-Hash": hash,
					"X-Content-Length": data.byteLength.toString(),
				},
				body: data,
			},
			this.retryOptions,
		);

		if (!response.ok) {
			// Handle specific error codes
			if (response.status === 413) {
				throw new Error(`File ${file.path} is too large for the server.`);
			}
			if (response.status === 400) {
				const errorBody = await response.json().catch(() => ({}));
				throw new Error(
					`Invalid upload for ${file.path}: ${errorBody.error || response.statusText}`,
				);
			}
			if (response.status === 409) {
				throw new Error(
					`Hash mismatch for ${file.path}. File may have been corrupted during transfer.`,
				);
			}
			throw new Error(`Failed to upload attachment ${file.path}: ${response.statusText}`);
		}

		const result: AttachmentUploadResponse = await response.json();

		if (result.ok) {
			attachmentCache.set(file.path, {
				path: file.path,
				hash: result.hash,
				size: result.size,
				contentType: result.content_type,
				lastModified: file.stat.mtime,
			});
		}
	}

	private async deleteRemoteAttachment(path: string): Promise<void> {
		const url = `${this.settings.serverUrl}/api/attachments/${encodeURIComponent(path)}?vault_id=${this.settings.vaultId}`;

		const response = await retryFetch(
			url,
			{
				method: "DELETE",
			},
			this.retryOptions,
		);

		if (!response.ok && response.status !== 404) {
			throw new Error(`Failed to delete remote attachment: ${response.statusText}`);
		}
	}

	private async generateHash(data: ArrayBuffer): Promise<string> {
		const hashBuffer = await crypto.subtle.digest("SHA-256", data);
		const hashArray = Array.from(new Uint8Array(hashBuffer));
		return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
	}

	updateSettings(settings: SyncSettings): void {
		this.settings = settings;
	}
}
