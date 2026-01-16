import { type App, TFile, type Vault } from "obsidian";
import { convertLocalPathsToRemoteUrls, convertRemoteUrlsToLocalPaths } from "./attachment-url";
import type { BaseContentStore } from "./base-content-store";
import type { ConflictResolver } from "./conflict-resolver";
import type { MetadataManager } from "./metadata-manager";
import { type RetryOptions, retryFetch } from "./retry-fetch";
import { docIdToPath, pathToDocId, updateFileContent } from "./sync-utils";
import type {
	BulkDocsResponse,
	ChangesResponse,
	DocumentInput,
	DocumentResponse,
	SyncSettings,
	SyncStats,
} from "./types";

export class DocumentSync {
	private app: App;
	private vault: Vault;
	private settings: SyncSettings;
	private metadataManager: MetadataManager;
	private baseContentStore: BaseContentStore;
	private conflictResolver: ConflictResolver;
	private retryOptions: RetryOptions;
	private onProgress?: (current: number, total: number) => void;

	constructor(
		app: App,
		vault: Vault,
		settings: SyncSettings,
		metadataManager: MetadataManager,
		baseContentStore: BaseContentStore,
		conflictResolver: ConflictResolver,
		retryOptions: RetryOptions,
	) {
		this.app = app;
		this.vault = vault;
		this.settings = settings;
		this.metadataManager = metadataManager;
		this.baseContentStore = baseContentStore;
		this.conflictResolver = conflictResolver;
		this.retryOptions = retryOptions;
	}

	setProgressCallback(callback: (current: number, total: number) => void): void {
		this.onProgress = callback;
	}

	async pullChanges(syncStats: SyncStats): Promise<void> {
		const BATCH_SIZE = 100;
		let since = this.settings.lastSeq;
		let hasMore = true;
		let totalProcessed = 0;

		while (hasMore) {
			const url = `${this.settings.serverUrl}/api/changes?since=${since}&limit=${BATCH_SIZE}&vault_id=${this.settings.vaultId}`;

			const response = await retryFetch(url, undefined, this.retryOptions);
			if (!response.ok) {
				throw new Error(`Failed to fetch changes: ${response.statusText}`);
			}

			const data: ChangesResponse = await response.json();

			// Process changes in this batch
			for (let i = 0; i < data.results.length; i++) {
				const change = data.results[i];
				totalProcessed++;
				this.onProgress?.(totalProcessed, totalProcessed);

				try {
					if (change.deleted) {
						await this.deleteLocalFile(change.id);
					} else {
						await this.pullDocument(change.id);
					}
					syncStats.pulled++;
				} catch (error) {
					console.error(`Error processing change for ${change.id}:`, error);
					syncStats.errors++;
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
	}

	async pushChanges(syncStats: SyncStats): Promise<void> {
		const files = this.vault.getMarkdownFiles();
		const docsToUpdate: DocumentInput[] = [];
		const currentFilePaths = new Set<string>();
		const metadataCache = this.metadataManager.getMetadataCache();

		// Check for modified files
		for (const file of files) {
			currentFilePaths.add(file.path);
			const metadata = metadataCache.get(file.path);
			const fileModTime = file.stat.mtime;

			// Check if file has been modified since last sync
			if (!metadata || fileModTime > metadata.lastModified) {
				const rawContent = await this.vault.read(file);
				const docId = pathToDocId(file.path);

				// Convert R2 URLs back to Wikilinks before sending to server.
				// This ensures the server stores portable Wikilinks format.
				// The conversion is idempotent: if content is already Wikilinks, it remains unchanged.
				// This handles both:
				//   - Files with R2 URLs (from previous pulls)
				//   - Newly created files with Wikilinks (user-written)
				const content = convertRemoteUrlsToLocalPaths(
					rawContent,
					this.settings.serverUrl,
					this.settings.vaultId,
				);

				// Get baseContent from IndexedDB for 3-way merge.
				// baseContent is stored in R2 URL format (matching local file after pull),
				// so we convert it to Wikilinks for consistent server-side comparison.
				// All three versions (base, local, remote) will be in Wikilinks format on server.
				const rawBaseContent = await this.baseContentStore.get(file.path);
				const baseContent = rawBaseContent
					? convertRemoteUrlsToLocalPaths(
							rawBaseContent,
							this.settings.serverUrl,
							this.settings.vaultId,
						)
					: undefined;

				docsToUpdate.push({
					_id: docId,
					_rev: metadata?.rev,
					content,
					_base_content: baseContent,
				});
			}
		}

		// Check for deleted files
		for (const [path, metadata] of metadataCache.entries()) {
			if (!currentFilePaths.has(path)) {
				// File was deleted locally, push deletion to server
				const docId = pathToDocId(path);
				docsToUpdate.push({
					_id: docId,
					_rev: metadata.rev,
					_deleted: true,
				});
			}
		}

		if (docsToUpdate.length === 0) {
			return;
		}

		const total = docsToUpdate.length;
		this.onProgress?.(0, total);

		// Use bulk docs endpoint for efficiency
		const url = `${this.settings.serverUrl}/api/docs/bulk_docs?vault_id=${this.settings.vaultId}`;

		const response = await retryFetch(
			url,
			{
				method: "POST",
				headers: {
					"Content-Type": "application/json",
				},
				body: JSON.stringify({
					docs: docsToUpdate,
				}),
			},
			this.retryOptions,
		);

		if (!response.ok) {
			throw new Error(`Failed to push changes: ${response.statusText}`);
		}

		const results: BulkDocsResponse[] = await response.json();

		// Update metadata cache with new revisions and handle conflicts
		let current = 0;
		for (const result of results) {
			current++;
			this.onProgress?.(current, total);

			if (result.ok && result.rev) {
				const path = docIdToPath(result.id);
				const file = this.vault.getAbstractFileByPath(path);

				if (result.merged) {
					// Automatic merge was performed
					// Pull the merged content first to avoid race conditions
					try {
						await this.pullDocument(result.id);
						syncStats.pushed++;
					} catch (error) {
						console.error(`Failed to pull merged content for ${path}:`, error);
						syncStats.errors++;
					}
				} else if (file instanceof TFile) {
					// Normal update - update metadata
					const content = await this.vault.read(file);
					metadataCache.set(path, {
						path,
						rev: result.rev,
						lastModified: file.stat.mtime,
					});
					// Store baseContent in IndexedDB
					await this.baseContentStore.set(path, content);
					syncStats.pushed++;
				} else {
					// File doesn't exist (was deleted), remove from cache
					metadataCache.delete(path);
					await this.baseContentStore.delete(path);
					syncStats.pushed++;
				}
			} else if (result.error === "conflict") {
				// Conflict detected - handle with user choice
				syncStats.conflicts++;
				await this.conflictResolver.handleConflict(result);
			} else if (result.error) {
				console.error(`Failed to update ${result.id}: ${result.error} - ${result.reason || ""}`);
				syncStats.errors++;
			}
		}
		await this.metadataManager.persistCache();
	}

	private async pullDocument(docId: string): Promise<void> {
		const url = `${this.settings.serverUrl}/api/docs/${encodeURIComponent(
			docId,
		)}?vault_id=${this.settings.vaultId}`;

		const response = await retryFetch(url, undefined, this.retryOptions);
		if (!response.ok) {
			if (response.status === 404) {
				return;
			}
			throw new Error(`Failed to fetch document: ${response.statusText}`);
		}

		const doc: DocumentResponse = await response.json();

		// Convert Wikilinks image references to R2 URLs for remote viewing
		const convertedContent = convertLocalPathsToRemoteUrls(
			doc.content,
			this.settings.serverUrl,
			this.settings.vaultId,
		);

		// Check if local file exists
		const path = docIdToPath(doc._id);
		const file = this.vault.getAbstractFileByPath(path);
		const metadataCache = this.metadataManager.getMetadataCache();

		if (file instanceof TFile) {
			// Check if we need to update
			const localMeta = metadataCache.get(path);
			if (localMeta && localMeta.rev === doc._rev) {
				return;
			}

			// Update file with converted content
			await updateFileContent(this.app, this.vault, file, convertedContent);
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
			await this.vault.create(path, convertedContent);
		}

		// Update metadata cache (without baseContent - it's now in IndexedDB)
		metadataCache.set(path, {
			path,
			rev: doc._rev,
			lastModified: Date.now(),
		});

		// Store baseContent in IndexedDB for future 3-way merges
		// Note: Store converted content so it matches local file
		await this.baseContentStore.set(path, convertedContent);

		await this.metadataManager.persistCache();
	}

	private async deleteLocalFile(docId: string): Promise<void> {
		const path = docIdToPath(docId);
		const file = this.vault.getAbstractFileByPath(path);
		const metadataCache = this.metadataManager.getMetadataCache();

		if (file instanceof TFile) {
			await this.vault.delete(file);
			metadataCache.delete(path);
			await this.baseContentStore.delete(path);
			await this.metadataManager.persistCache();
		}
	}

	updateSettings(settings: SyncSettings): void {
		this.settings = settings;
	}
}
