import { type App, TFile, type Vault } from "obsidian";
import { type BaseContentStore, getBaseContentStore } from "./base-content-store";
import { ConflictResolution, ConflictResolutionModal } from "./conflict-modal";
import { type RetryOptions, retryFetch } from "./retry-fetch";
import type {
	AttachmentChangesResponse,
	AttachmentMetadata,
	AttachmentUploadResponse,
	BulkDocsResponse,
	ChangesResponse,
	DocMetadata,
	DocumentInput,
	DocumentResponse,
	SyncSettings,
} from "./types";
import { getContentType, isAttachmentFile } from "./types";

export type SyncStatusType = "idle" | "syncing" | "success" | "error" | "paused";

export interface SyncStatus {
	status: SyncStatusType;
	message?: string;
	duration?: string;
	progress?: {
		phase: "pull" | "push" | "pull-attachments" | "push-attachments";
		current: number;
		total: number;
	};
	stats?: {
		pulled: number;
		pushed: number;
		conflicts: number;
		errors: number;
		attachmentsPulled: number;
		attachmentsPushed: number;
	};
}

export class SyncService {
	private app: App;
	private vault: Vault;
	private settings: SyncSettings;
	private syncInProgress = false;
	private metadataCache: Map<string, DocMetadata> = new Map();
	private attachmentCache: Map<string, AttachmentMetadata> = new Map();
	private baseContentStore: BaseContentStore;
	private saveSettings: () => Promise<void>;
	private onStatusChange: (status: SyncStatus) => void;
	private syncStats = {
		pulled: 0,
		pushed: 0,
		conflicts: 0,
		errors: 0,
		attachmentsPulled: 0,
		attachmentsPushed: 0,
	};
	private migrationDone = false;
	private retryOptions: RetryOptions;

	constructor(
		app: App,
		vault: Vault,
		settings: SyncSettings,
		saveSettings: () => Promise<void>,
		onStatusChange: (status: SyncStatus) => void,
	) {
		this.app = app;
		this.vault = vault;
		this.settings = settings;
		this.saveSettings = saveSettings;
		this.onStatusChange = onStatusChange;
		this.baseContentStore = getBaseContentStore();

		// Configure retry options with exponential backoff
		this.retryOptions = {
			maxRetries: 4,
			initialDelayMs: 2000, // 2s, 4s, 8s, 16s
			maxDelayMs: 16000,
			onRetry: (attempt, error, delayMs) => {
				const errorMsg =
					error instanceof Response ? `HTTP ${error.status}` : (error as Error).message;
				console.log(`Retry attempt ${attempt} after ${delayMs}ms (${errorMsg})`);
			},
		};

		// Initialize metadata cache from persisted settings
		if (settings.metadataCache) {
			for (const [path, metadata] of Object.entries(settings.metadataCache)) {
				// Don't copy baseContent to memory - it's now in IndexedDB
				const { baseContent, ...metaWithoutBase } = metadata;
				this.metadataCache.set(path, metaWithoutBase);
			}
		}

		// Initialize attachment cache from persisted settings
		if (settings.attachmentCache) {
			for (const [path, metadata] of Object.entries(settings.attachmentCache)) {
				this.attachmentCache.set(path, metadata);
			}
		}

		// Migrate existing baseContent to IndexedDB in background
		this.migrateBaseContentToIndexedDB();
	}

	/**
	 * Migrate existing baseContent from settings to IndexedDB
	 */
	private async migrateBaseContentToIndexedDB(): Promise<void> {
		if (this.migrationDone) return;

		try {
			await this.baseContentStore.init();

			// Check if there's baseContent in the old format
			if (this.settings.metadataCache) {
				let hasBaseContent = false;
				for (const metadata of Object.values(this.settings.metadataCache)) {
					if (metadata.baseContent) {
						hasBaseContent = true;
						break;
					}
				}

				if (hasBaseContent) {
					console.log("Migrating baseContent to IndexedDB...");
					const count = await this.baseContentStore.migrateFromSettings(
						this.settings.metadataCache,
					);

					// Remove baseContent from settings to save space
					if (count > 0) {
						for (const metadata of Object.values(this.settings.metadataCache)) {
							delete metadata.baseContent;
						}
						await this.saveSettings();
						console.log(`Migration complete: ${count} entries moved to IndexedDB`);
					}
				}
			}

			// Run cleanup to remove old entries (older than 90 days)
			await this.baseContentStore.cleanup();

			this.migrationDone = true;
		} catch (error) {
			console.error("Failed to migrate baseContent:", error);
		}
	}

	updateSettings(settings: SyncSettings) {
		this.settings = settings;
	}

	/**
	 * Fetch with automatic retry on network errors
	 */
	private async fetchWithRetry(url: string | URL, init?: RequestInit): Promise<Response> {
		return retryFetch(url, init, this.retryOptions);
	}

	private async persistMetadataCache(): Promise<void> {
		// Convert Map to plain object for persistence
		const cacheObj: Record<string, DocMetadata> = {};
		for (const [path, metadata] of this.metadataCache.entries()) {
			cacheObj[path] = metadata;
		}
		this.settings.metadataCache = cacheObj;

		// Also persist attachment cache
		const attachmentCacheObj: Record<string, AttachmentMetadata> = {};
		for (const [path, metadata] of this.attachmentCache.entries()) {
			attachmentCacheObj[path] = metadata;
		}
		this.settings.attachmentCache = attachmentCacheObj;

		await this.saveSettings();
	}

	async performSync(): Promise<void> {
		if (this.syncInProgress) {
			console.log("Sync already in progress, skipping");
			return;
		}

		this.syncInProgress = true;
		const startTime = Date.now();
		// Reset stats for this sync
		this.syncStats = {
			pulled: 0,
			pushed: 0,
			conflicts: 0,
			errors: 0,
			attachmentsPulled: 0,
			attachmentsPushed: 0,
		};
		this.onStatusChange({ status: "syncing", stats: this.syncStats });

		try {
			// Step 1: Pull document changes from server
			await this.pullChanges();

			// Step 2: Push local document changes
			await this.pushChanges();

			// Step 3: Sync attachments if enabled
			if (this.settings.syncAttachments) {
				await this.pullAttachmentChanges();
				await this.pushAttachmentChanges();
			}

			this.settings.lastSync = Date.now();
			const duration = `${((Date.now() - startTime) / 1000).toFixed(1)}s`;
			this.onStatusChange({
				status: "success",
				duration,
				stats: this.syncStats,
			});
		} catch (error) {
			console.error("Sync error:", error);
			const message =
				error instanceof Error
					? error.message
					: error !== null && error !== undefined
						? String(error)
						: "Unknown error";
			this.syncStats.errors++;
			this.onStatusChange({
				status: "error",
				message,
				stats: this.syncStats,
			});
		} finally {
			this.syncInProgress = false;
		}
	}

	private async pullChanges(): Promise<void> {
		const BATCH_SIZE = 100;
		let since = this.settings.lastSeq;
		let hasMore = true;
		let totalProcessed = 0;

		while (hasMore) {
			const url = `${this.settings.serverUrl}/api/changes?since=${since}&limit=${BATCH_SIZE}&vault_id=${this.settings.vaultId}`;

			const response = await this.fetchWithRetry(url);
			if (!response.ok) {
				throw new Error(`Failed to fetch changes: ${response.statusText}`);
			}

			const data: ChangesResponse = await response.json();

			console.log(`Received ${data.results.length} changes from server (since: ${since})`);

			// Process changes in this batch
			for (let i = 0; i < data.results.length; i++) {
				const change = data.results[i];
				totalProcessed++;
				this.onStatusChange({
					status: "syncing",
					progress: { phase: "pull", current: totalProcessed, total: totalProcessed },
					stats: this.syncStats,
				});

				try {
					if (change.deleted) {
						await this.deleteLocalFile(change.id);
					} else {
						await this.pullDocument(change.id);
					}
					this.syncStats.pulled++;
				} catch (error) {
					console.error(`Error processing change for ${change.id}:`, error);
					this.syncStats.errors++;
				}
			}

			// Update last sequence for this batch
			if (data.last_seq > since) {
				since = data.last_seq;
				this.settings.lastSeq = data.last_seq;
			}

			// Check if there are more changes to fetch
			hasMore = data.results.length === BATCH_SIZE;
		}

		console.log(`Pull complete: ${totalProcessed} changes processed`);
	}

	private async pullDocument(docId: string): Promise<void> {
		const url = `${this.settings.serverUrl}/api/docs/${encodeURIComponent(
			docId,
		)}?vault_id=${this.settings.vaultId}`;

		const response = await this.fetchWithRetry(url);
		if (!response.ok) {
			if (response.status === 404) {
				console.log(`Document ${docId} not found on server`);
				return;
			}
			throw new Error(`Failed to fetch document: ${response.statusText}`);
		}

		const doc: DocumentResponse = await response.json();

		// Check if local file exists
		const path = this.docIdToPath(doc._id);
		const file = this.vault.getAbstractFileByPath(path);

		if (file instanceof TFile) {
			// Check if we need to update
			const localMeta = this.metadataCache.get(path);
			if (localMeta && localMeta.rev === doc._rev) {
				console.log(`Document ${docId} is up to date`);
				return;
			}

			// Update file
			await this.vault.modify(file, doc.content);
			console.log(`Updated ${path}`);
		} else {
			// Create new file, ensuring parent folders exist
			const lastSlashIndex = path.lastIndexOf("/");
			if (lastSlashIndex !== -1) {
				const folderPath = path.substring(0, lastSlashIndex);
				if (folderPath) {
					const existingFolder = this.vault.getAbstractFileByPath(folderPath);
					if (!existingFolder) {
						// Create all parent folders
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
			await this.vault.create(path, doc.content);
			console.log(`Created ${path}`);
		}

		// Update metadata cache (without baseContent - it's now in IndexedDB)
		this.metadataCache.set(path, {
			path,
			rev: doc._rev,
			lastModified: Date.now(),
		});

		// Store baseContent in IndexedDB for future 3-way merges
		await this.baseContentStore.set(path, doc.content);

		await this.persistMetadataCache();
	}

	private async deleteLocalFile(docId: string): Promise<void> {
		const path = this.docIdToPath(docId);
		const file = this.vault.getAbstractFileByPath(path);

		if (file instanceof TFile) {
			await this.vault.delete(file);
			this.metadataCache.delete(path);
			await this.baseContentStore.delete(path);
			await this.persistMetadataCache();
			console.log(`Deleted ${path}`);
		}
	}

	private async pushChanges(): Promise<void> {
		const files = this.vault.getMarkdownFiles();
		const docsToUpdate: DocumentInput[] = [];
		const currentFilePaths = new Set<string>();

		// Check for modified files
		for (const file of files) {
			currentFilePaths.add(file.path);
			const metadata = this.metadataCache.get(file.path);
			const fileModTime = file.stat.mtime;

			// Check if file has been modified since last sync
			if (!metadata || fileModTime > metadata.lastModified) {
				const content = await this.vault.read(file);
				const docId = this.pathToDocId(file.path);

				// Get baseContent from IndexedDB for 3-way merge
				const baseContent = await this.baseContentStore.get(file.path);

				docsToUpdate.push({
					_id: docId,
					_rev: metadata?.rev,
					content,
					_base_content: baseContent, // Send base content for 3-way merge
				});
			}
		}

		// Check for deleted files
		for (const [path, metadata] of this.metadataCache.entries()) {
			if (!currentFilePaths.has(path)) {
				// File was deleted locally, push deletion to server
				const docId = this.pathToDocId(path);
				docsToUpdate.push({
					_id: docId,
					_rev: metadata.rev,
					_deleted: true,
				});
			}
		}

		if (docsToUpdate.length === 0) {
			console.log("No local changes to push");
			return;
		}

		const total = docsToUpdate.length;
		console.log(`Pushing ${total} documents to server`);

		// Update status with push phase
		this.onStatusChange({
			status: "syncing",
			progress: { phase: "push", current: 0, total },
			stats: this.syncStats,
		});

		// Use bulk docs endpoint for efficiency
		const url = `${this.settings.serverUrl}/api/docs/bulk_docs?vault_id=${this.settings.vaultId}`;

		const response = await this.fetchWithRetry(url, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
			},
			body: JSON.stringify({
				docs: docsToUpdate,
			}),
		});

		if (!response.ok) {
			throw new Error(`Failed to push changes: ${response.statusText}`);
		}

		const results: BulkDocsResponse[] = await response.json();

		// Update metadata cache with new revisions and handle conflicts
		let current = 0;
		for (const result of results) {
			current++;
			this.onStatusChange({
				status: "syncing",
				progress: { phase: "push", current, total },
				stats: this.syncStats,
			});

			if (result.ok && result.rev) {
				const path = this.docIdToPath(result.id);
				const file = this.vault.getAbstractFileByPath(path);

				if (result.merged) {
					// Automatic merge was performed
					// Pull the merged content first to avoid race conditions
					try {
						await this.pullDocument(result.id);
						console.log(`File automatically merged: ${path}`);
						this.syncStats.pushed++;
					} catch (error) {
						console.error(`Failed to pull merged content for ${path}:`, error);
						this.syncStats.errors++;
					}
				} else if (file instanceof TFile) {
					// Normal update - update metadata
					const content = await this.vault.read(file);
					this.metadataCache.set(path, {
						path,
						rev: result.rev,
						lastModified: file.stat.mtime,
					});
					// Store baseContent in IndexedDB
					await this.baseContentStore.set(path, content);
					this.syncStats.pushed++;
				} else {
					// File doesn't exist (was deleted), remove from cache
					this.metadataCache.delete(path);
					await this.baseContentStore.delete(path);
					this.syncStats.pushed++;
				}
			} else if (result.error === "conflict") {
				// Conflict detected - handle with user choice
				this.syncStats.conflicts++;
				await this.handleConflict(result);
			} else if (result.error) {
				console.error(`Failed to update ${result.id}: ${result.error} - ${result.reason || ""}`);
				this.syncStats.errors++;
			}
		}
		await this.persistMetadataCache();
	}

	private async handleConflict(result: BulkDocsResponse): Promise<void> {
		const path = this.docIdToPath(result.id);
		const file = this.vault.getAbstractFileByPath(path);

		if (!(file instanceof TFile)) {
			console.error(`Cannot resolve conflict: file not found ${path}`);
			return;
		}

		const localContent = await this.vault.read(file);
		const remoteContent = result.current_content || "";

		// Show conflict resolution modal
		const modal = new ConflictResolutionModal(this.app, path, localContent, remoteContent);
		modal.open();

		const resolution = await modal.waitForResult();

		if (resolution === ConflictResolution.UseLocal) {
			// Force push local version
			try {
				const content = await this.vault.read(file);
				await this.forcePushDocument(result.id, content, result.current_rev);
				console.log(`Using local version: ${path}`);
			} catch (error) {
				console.error(`Failed to force push ${path}:`, error);
			}
		} else if (resolution === ConflictResolution.UseRemote) {
			// Accept remote version
			try {
				await this.vault.modify(file, remoteContent);
				this.metadataCache.set(path, {
					path,
					rev: result.current_rev || "",
					lastModified: file.stat.mtime,
				});
				await this.baseContentStore.set(path, remoteContent);
				await this.persistMetadataCache();
				console.log(`Using remote version: ${path}`);
			} catch (error) {
				console.error(`Failed to apply remote version ${path}:`, error);
			}
		} else {
			// Cancel - keep local but don't sync
			console.log(`Sync cancelled: ${path}`);
		}
	}

	private async forcePushDocument(
		docId: string,
		content: string,
		currentRev?: string,
	): Promise<void> {
		// Force push by using the server's current revision
		const url = `${this.settings.serverUrl}/api/docs/${encodeURIComponent(
			docId,
		)}?vault_id=${this.settings.vaultId}`;

		const response = await this.fetchWithRetry(url, {
			method: "PUT",
			headers: {
				"Content-Type": "application/json",
			},
			body: JSON.stringify({
				_id: docId,
				_rev: currentRev,
				content,
			}),
		});

		if (!response.ok) {
			throw new Error(`Failed to force push document: ${response.statusText}`);
		}

		const result = await response.json();
		if (result.ok && result.rev) {
			const path = this.docIdToPath(docId);
			this.metadataCache.set(path, {
				path,
				rev: result.rev,
				lastModified: Date.now(),
			});
			await this.baseContentStore.set(path, content);
			await this.persistMetadataCache();
		}
	}

	private pathToDocId(path: string): string {
		// Convert file path to document ID
		// Remove .md extension and use forward slashes
		return path.replace(/\.md$/, "").replace(/\\/g, "/");
	}

	private docIdToPath(docId: string): string {
		// Convert document ID to file path
		// Add .md extension
		return `${docId}.md`;
	}

	async testConnection(): Promise<boolean> {
		try {
			const response = await this.fetchWithRetry(this.settings.serverUrl);
			if (!response.ok) {
				return false;
			}
			const data = await response.json();
			return data.status === "ok";
		} catch (error) {
			console.error("Connection test failed:", error);
			return false;
		}
	}

	// =====================================
	// Attachment Sync Methods
	// =====================================

	private async pullAttachmentChanges(): Promise<void> {
		const BATCH_SIZE = 100;
		let since = this.settings.lastAttachmentSeq;
		let hasMore = true;
		let totalProcessed = 0;

		while (hasMore) {
			const url = `${this.settings.serverUrl}/api/attachments/changes?since=${since}&limit=${BATCH_SIZE}&vault_id=${this.settings.vaultId}`;

			const response = await this.fetchWithRetry(url);
			if (!response.ok) {
				throw new Error(`Failed to fetch attachment changes: ${response.statusText}`);
			}

			const data: AttachmentChangesResponse = await response.json();

			console.log(
				`Received ${data.results.length} attachment changes from server (since: ${since})`,
			);

			// Process changes in this batch
			for (let i = 0; i < data.results.length; i++) {
				const change = data.results[i];
				totalProcessed++;
				this.onStatusChange({
					status: "syncing",
					progress: { phase: "pull-attachments", current: totalProcessed, total: totalProcessed },
					stats: this.syncStats,
				});

				try {
					if (change.deleted) {
						await this.deleteLocalAttachment(change.path);
					} else {
						await this.pullAttachment(change.id, change.path, change.hash);
					}
					this.syncStats.attachmentsPulled++;
				} catch (error) {
					console.error(`Error processing attachment change for ${change.path}:`, error);
					this.syncStats.errors++;
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

		console.log(`Attachment pull complete: ${totalProcessed} changes processed`);
	}

	private async pullAttachment(id: string, path: string, serverHash: string): Promise<void> {
		// Check if local file exists with same hash
		const localMeta = this.attachmentCache.get(path);
		if (localMeta && localMeta.hash === serverHash) {
			console.log(`Attachment ${path} is up to date`);
			return;
		}

		// Download attachment content
		const url = `${this.settings.serverUrl}/api/attachments/${encodeURIComponent(id)}/content?vault_id=${this.settings.vaultId}`;

		const response = await this.fetchWithRetry(url);
		if (!response.ok) {
			if (response.status === 404) {
				console.log(`Attachment ${path} not found on server`);
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
			console.log(`Updated attachment ${path}`);
		} else {
			await this.vault.createBinary(path, data);
			console.log(`Created attachment ${path}`);
		}

		// Update cache
		this.attachmentCache.set(path, {
			path,
			hash,
			size: data.byteLength,
			contentType,
			lastModified: Date.now(),
		});
		await this.persistMetadataCache();
	}

	private async deleteLocalAttachment(path: string): Promise<void> {
		const file = this.vault.getAbstractFileByPath(path);

		if (file instanceof TFile) {
			await this.vault.delete(file);
			this.attachmentCache.delete(path);
			await this.persistMetadataCache();
			console.log(`Deleted attachment ${path}`);
		}
	}

	// Number of concurrent uploads (like s3-image-uploader uses Promise.all for parallel uploads)
	private static readonly UPLOAD_CONCURRENCY = 3;

	private async pushAttachmentChanges(): Promise<void> {
		const files = this.vault.getFiles();
		const attachmentFiles = files.filter((file) => isAttachmentFile(file.path));
		const currentAttachmentPaths = new Set<string>();

		const attachmentsToUpload: TFile[] = [];

		// Check for new or modified attachments
		for (const file of attachmentFiles) {
			currentAttachmentPaths.add(file.path);
			const metadata = this.attachmentCache.get(file.path);
			const fileModTime = file.stat.mtime;

			// Check if file has been modified since last sync
			if (!metadata || fileModTime > metadata.lastModified) {
				attachmentsToUpload.push(file);
			}
		}

		// Check for deleted attachments
		const deletedAttachments: string[] = [];
		for (const [path] of this.attachmentCache.entries()) {
			if (isAttachmentFile(path) && !currentAttachmentPaths.has(path)) {
				deletedAttachments.push(path);
			}
		}

		const total = attachmentsToUpload.length + deletedAttachments.length;
		if (total === 0) {
			console.log("No attachment changes to push");
			return;
		}

		console.log(
			`Pushing ${attachmentsToUpload.length} attachments (${SyncService.UPLOAD_CONCURRENCY} concurrent), deleting ${deletedAttachments.length}`,
		);

		let completed = 0;

		// Upload new/modified attachments in parallel with concurrency limit
		// This is inspired by s3-image-uploader's Promise.all pattern for parallel uploads
		for (let i = 0; i < attachmentsToUpload.length; i += SyncService.UPLOAD_CONCURRENCY) {
			const chunk = attachmentsToUpload.slice(i, i + SyncService.UPLOAD_CONCURRENCY);

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
				this.onStatusChange({
					status: "syncing",
					progress: { phase: "push-attachments", current: completed, total },
					stats: this.syncStats,
				});

				if (result.status === "fulfilled") {
					this.syncStats.attachmentsPushed++;
				} else {
					console.error(`Failed to upload attachment ${file.path}:`, result.reason);
					this.syncStats.errors++;
				}
			}
		}

		// Delete remote attachments (sequential to avoid race conditions)
		for (const path of deletedAttachments) {
			completed++;
			this.onStatusChange({
				status: "syncing",
				progress: { phase: "push-attachments", current: completed, total },
				stats: this.syncStats,
			});

			try {
				await this.deleteRemoteAttachment(path);
				this.attachmentCache.delete(path);
				this.syncStats.attachmentsPushed++;
			} catch (error) {
				console.error(`Failed to delete remote attachment ${path}:`, error);
				this.syncStats.errors++;
			}
		}

		await this.persistMetadataCache();
	}

	// Maximum attachment size (100MB)
	private static readonly MAX_ATTACHMENT_SIZE = 100 * 1024 * 1024;

	private async uploadAttachment(file: TFile): Promise<void> {
		const data = await this.vault.readBinary(file);

		// Validate file size
		if (data.byteLength > SyncService.MAX_ATTACHMENT_SIZE) {
			throw new Error(
				`File ${file.path} is too large (${(data.byteLength / 1024 / 1024).toFixed(1)}MB). Maximum size is ${SyncService.MAX_ATTACHMENT_SIZE / 1024 / 1024}MB.`,
			);
		}

		const hash = await this.generateHash(data);
		const contentType = getContentType(file.path);

		// Check if server already has this exact file
		const metadata = this.attachmentCache.get(file.path);
		if (metadata && metadata.hash === hash) {
			console.log(`Attachment ${file.path} unchanged, skipping upload`);
			return;
		}

		const url = `${this.settings.serverUrl}/api/attachments/${encodeURIComponent(file.path)}?vault_id=${this.settings.vaultId}`;

		const response = await this.fetchWithRetry(url, {
			method: "PUT",
			headers: {
				"Content-Type": contentType,
				"X-Content-Hash": hash,
				"X-Content-Length": data.byteLength.toString(),
			},
			body: data,
		});

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
			this.attachmentCache.set(file.path, {
				path: file.path,
				hash: result.hash,
				size: result.size,
				contentType: result.content_type,
				lastModified: file.stat.mtime,
			});
			console.log(`Uploaded attachment ${file.path}${result.unchanged ? " (unchanged)" : ""}`);
		}
	}

	private async deleteRemoteAttachment(path: string): Promise<void> {
		const url = `${this.settings.serverUrl}/api/attachments/${encodeURIComponent(path)}?vault_id=${this.settings.vaultId}`;

		const response = await this.fetchWithRetry(url, {
			method: "DELETE",
		});

		if (!response.ok && response.status !== 404) {
			throw new Error(`Failed to delete remote attachment: ${response.statusText}`);
		}

		console.log(`Deleted remote attachment ${path}`);
	}

	private async generateHash(data: ArrayBuffer): Promise<string> {
		const hashBuffer = await crypto.subtle.digest("SHA-256", data);
		const hashArray = Array.from(new Uint8Array(hashBuffer));
		return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
	}
}
