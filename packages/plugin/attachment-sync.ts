import { TFile, type Vault } from "obsidian";
import { generateAttachmentUrlFromId, WIKILINK_IMAGE_REGEX } from "./attachment-url";
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
		const attachmentCache = this.metadataManager.getAttachmentCache();

		const attachmentsToUpload: TFile[] = [];

		// Check for new or modified attachments
		for (const file of attachmentFiles) {
			const metadata = attachmentCache.get(file.path);
			const fileModTime = file.stat.mtime;

			// Check if file has been modified since last sync or doesn't have attachment ID yet
			if (!metadata || fileModTime > metadata.lastModified || !metadata.attachmentId) {
				attachmentsToUpload.push(file);
			}
		}

		const total = attachmentsToUpload.length;
		if (total === 0) {
			return;
		}

		let completed = 0;

		// Collect successful uploads for batch processing
		const uploadedAttachments: Array<{
			file: TFile;
			id: string;
			hash: string;
			url: string;
		}> = [];

		// Upload new/modified attachments in parallel with concurrency limit
		for (let i = 0; i < attachmentsToUpload.length; i += AttachmentSync.UPLOAD_CONCURRENCY) {
			const chunk = attachmentsToUpload.slice(i, i + AttachmentSync.UPLOAD_CONCURRENCY);

			const uploadResults = await Promise.allSettled(
				chunk.map(async (file) => {
					const result = await this.uploadAttachment(file);
					return { file, result };
				}),
			);

			// Process results
			for (let j = 0; j < uploadResults.length; j++) {
				const result = uploadResults[j];
				const file = chunk[j];
				completed++;
				this.onProgress?.(completed, total);

				if (result.status === "fulfilled" && result.value.result) {
					uploadedAttachments.push({
						file,
						...result.value.result,
					});
					syncStats.attachmentsPushed++;
				} else if (result.status === "rejected") {
					console.error(`Failed to upload attachment ${file.path}:`, result.reason);
					syncStats.errors++;
				}
			}
		}

		// After all uploads, update markdown references and delete local files
		if (uploadedAttachments.length > 0) {
			await this.updateMarkdownReferencesAndCleanup(uploadedAttachments);
		}

		await this.metadataManager.persistCache();
	}

	/**
	 * Update markdown files to replace local image references with R2 URLs,
	 * then delete the local attachment files
	 */
	private async updateMarkdownReferencesAndCleanup(
		uploadedAttachments: Array<{
			file: TFile;
			id: string;
			hash: string;
			url: string;
		}>,
	): Promise<void> {
		const markdownFiles = this.vault.getMarkdownFiles();
		const attachmentCache = this.metadataManager.getAttachmentCache();

		// Build a map of path -> url for quick lookup
		const pathToUrlMap = new Map<string, string>();
		for (const attachment of uploadedAttachments) {
			pathToUrlMap.set(attachment.file.path, attachment.url);
			// Also add the filename without path for wikilinks like ![[image.jpg]]
			const fileName = attachment.file.name;
			if (!pathToUrlMap.has(fileName)) {
				pathToUrlMap.set(fileName, attachment.url);
			}
		}

		// Update each markdown file that references uploaded attachments
		for (const mdFile of markdownFiles) {
			let content = await this.vault.read(mdFile);
			let modified = false;

			// Replace wikilink image references: ![[path]] or ![[path|alt]]
			// Reset lastIndex since regex has global flag
			WIKILINK_IMAGE_REGEX.lastIndex = 0;
			content = content.replace(WIKILINK_IMAGE_REGEX, (match, path, altText) => {
				const url = pathToUrlMap.get(path);
				if (url) {
					modified = true;
					const displayText = altText || path;
					return `![${displayText}](${url})`;
				}
				return match;
			});

			if (modified) {
				await this.vault.modify(mdFile, content);
			}
		}

		// Delete local attachment files after updating references
		for (const attachment of uploadedAttachments) {
			try {
				const file = this.vault.getAbstractFileByPath(attachment.file.path);
				if (file instanceof TFile) {
					await this.vault.delete(file);
					// Remove from cache since file is deleted
					attachmentCache.delete(attachment.file.path);
				}
			} catch (error) {
				console.error(`Failed to delete local attachment ${attachment.file.path}:`, error);
			}
		}
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

	/**
	 * Upload attachment and return the result with attachment ID and URL
	 */
	private async uploadAttachment(
		file: TFile,
	): Promise<{ id: string; hash: string; url: string } | null> {
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

		// Check if already uploaded with same hash - return existing info
		const metadata = attachmentCache.get(file.path);
		if (metadata && metadata.hash === hash && metadata.attachmentId) {
			const url = generateAttachmentUrlFromId(
				metadata.attachmentId,
				this.settings.serverUrl,
				this.settings.vaultId,
			);
			return { id: metadata.attachmentId, hash, url };
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
			const attachmentId = result.id;
			const attachmentUrl = generateAttachmentUrlFromId(
				attachmentId,
				this.settings.serverUrl,
				this.settings.vaultId,
			);

			// Update cache with attachment ID
			attachmentCache.set(file.path, {
				path: file.path,
				hash: result.hash,
				size: result.size,
				contentType: result.content_type,
				lastModified: file.stat.mtime,
				attachmentId,
			});

			return { id: attachmentId, hash: result.hash, url: attachmentUrl };
		}

		return null;
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
