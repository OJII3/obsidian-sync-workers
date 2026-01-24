import { type App, TFile, type Vault } from "obsidian";
import { buildAuthHeaders } from "./auth";
import type { BaseContentStore } from "./base-content-store";
import { ConflictResolution } from "./conflict-modal";
import type { ConflictResolver } from "./conflict-resolver";
import { computeCommonBase, threeWayMerge } from "./merge";
import type { MetadataManager } from "./metadata-manager";
import { type RetryOptions, retryFetch } from "./retry-fetch";
import { docIdToPath, getFileMtime, pathToDocId, updateFileContent } from "./sync-utils";
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
		let lastAppliedSeq = since;

		while (hasMore) {
			const url = `${this.settings.serverUrl}/api/changes?since=${since}&limit=${BATCH_SIZE}&vault_id=${this.settings.vaultId}`;

			const response = await retryFetch(
				url,
				{ headers: buildAuthHeaders(this.settings) },
				this.retryOptions,
			);
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
					let applied = false;
					if (change.deleted) {
						const remoteRev = change.changes?.[0]?.rev;
						applied = await this.deleteLocalFile(change.id, remoteRev);
					} else {
						applied = await this.pullDocument(change.id);
					}
					if (applied) {
						syncStats.pulled++;
						lastAppliedSeq = change.seq;
					} else {
						syncStats.conflicts++;
						hasMore = false;
						break;
					}
				} catch (error) {
					console.error(`Error processing change for ${change.id}:`, error);
					syncStats.errors++;
					hasMore = false;
					break;
				}
			}

			// Update last sequence for this batch
			if (lastAppliedSeq > since) {
				since = lastAppliedSeq;
				this.settings.lastSeq = lastAppliedSeq;
			}

			// Check if there are more changes to fetch
			hasMore = hasMore && data.results.length === BATCH_SIZE;
		}
	}

	async pushChanges(syncStats: SyncStats): Promise<void> {
		const files = this.vault.getMarkdownFiles();
		const docsToUpdate: DocumentInput[] = [];
		const currentFilePaths = new Set<string>();
		const metadataCache = this.metadataManager.getMetadataCache();
		// Track file mtime at push time to detect interim edits when pulling merged content
		const pushTimeMtimes = new Map<string, number>();

		// Check for modified files
		// Use in-memory stat for initial check to avoid disk I/O for unchanged files
		for (const file of files) {
			currentFilePaths.add(file.path);
			const metadata = metadataCache.get(file.path);

			// Quick check using in-memory mtime to avoid disk I/O for unchanged files
			if (metadata && file.stat.mtime <= metadata.lastModified) {
				continue;
			}

			// File appears modified - get accurate mtime from disk for the push
			const fileModTime = await getFileMtime(this.vault, file.path);

			// Double-check with accurate disk mtime (in-memory might be slightly off)
			if (metadata && fileModTime <= metadata.lastModified) {
				continue;
			}

			const content = await this.vault.read(file);
			const docId = pathToDocId(file.path);

			// Get baseContent from IndexedDB for 3-way merge
			const baseContent = await this.baseContentStore.get(file.path);

			// Store mtime at push time to verify file hasn't changed when pulling merged content
			pushTimeMtimes.set(docId, fileModTime);

			docsToUpdate.push({
				_id: docId,
				_rev: metadata?.rev,
				content,
				_base_content: baseContent,
			});
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
				headers: buildAuthHeaders(this.settings, {
					"Content-Type": "application/json",
				}),
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
					// Automatic merge was performed on the server
					// Pull the merged content, but only skip conflict check if file hasn't changed since push
					const expectedMtime = pushTimeMtimes.get(result.id);
					try {
						await this.pullDocument(result.id, expectedMtime);
						syncStats.pushed++;
					} catch (error) {
						console.error(`Failed to pull merged content for ${path}:`, error);
						syncStats.errors++;
					}
				} else if (file instanceof TFile) {
					// Normal update - update metadata with actual file mtime
					const content = await this.vault.read(file);
					const actualMtime = await getFileMtime(this.vault, path);
					metadataCache.set(path, {
						path,
						rev: result.rev,
						lastModified: actualMtime,
					});
					// Store baseContent in IndexedDB (the content we just pushed is now the base)
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

	/**
	 * Pull a document from the server and update the local file.
	 * @param docId - The document ID to pull
	 * @param expectedMtime - If provided, only skip conflict check if current file mtime <= expectedMtime
	 *                        (used to safely pull merged content without overwriting interim edits)
	 * @returns true if successful or conflict resolved, false if cancelled
	 */
	private async pullDocument(docId: string, expectedMtime?: number): Promise<boolean> {
		const url = `${this.settings.serverUrl}/api/docs/${encodeURIComponent(
			docId,
		)}?vault_id=${this.settings.vaultId}`;

		const response = await retryFetch(
			url,
			{ headers: buildAuthHeaders(this.settings) },
			this.retryOptions,
		);
		if (!response.ok) {
			if (response.status === 404) {
				return true;
			}
			throw new Error(`Failed to fetch document: ${response.statusText}`);
		}

		const doc: DocumentResponse = await response.json();
		const remoteContent = doc.content;

		// Check if local file exists
		const path = docIdToPath(doc._id);
		const file = this.vault.getAbstractFileByPath(path);
		const metadataCache = this.metadataManager.getMetadataCache();

		if (file instanceof TFile) {
			const localMeta = metadataCache.get(path);
			// Check if we need to update (skip if rev already matches)
			if (localMeta && localMeta.rev === doc._rev) {
				return true;
			}

			// Get current file mtime from disk for accurate comparison
			const currentMtime = await getFileMtime(this.vault, path);

			// Determine if we should check for conflicts
			// If expectedMtime is provided, only skip conflict check if file hasn't changed since push
			const shouldSkipConflictCheck = expectedMtime !== undefined && currentMtime <= expectedMtime;

			// Check for local modifications using fresh disk mtime (not stale file.stat.mtime)
			const isModified = !localMeta || currentMtime > localMeta.lastModified;
			if (!shouldSkipConflictCheck && isModified) {
				// Local file has been modified - try to merge (Git-style client-side merge)
				const localContent = await this.vault.read(file);
				const baseContent = await this.baseContentStore.get(path);

				if (baseContent !== undefined) {
					// We have a base content, attempt 3-way merge
					const mergeResult = threeWayMerge(baseContent, localContent, remoteContent);

					if (mergeResult.success && mergeResult.content !== undefined) {
						// Merge succeeded - apply the merged content
						await updateFileContent(this.app, this.vault, file, mergeResult.content);

						// IMPORTANT: Don't update lastModified so push phase will detect this as changed.
						// Set baseContent to remoteContent (not merged content) so push sends the diff.
						// The merged content contains local changes that need to be pushed to server.
						await this.baseContentStore.set(path, remoteContent);
						// Update rev to prevent re-pulling the same change
						if (localMeta) {
							metadataCache.set(path, {
								...localMeta,
								rev: doc._rev,
								// Keep original lastModified so file appears "modified" to push phase
							});
							await this.metadataManager.persistCache();
						}
						return true;
					}

					// Merge failed - show conflict resolution with merge conflict info
					const resolution = await this.conflictResolver.handleConflict({
						id: doc._id,
						current_content: remoteContent,
						current_rev: doc._rev,
						conflicts: mergeResult.conflicts,
						reason: mergeResult.error, // Pass merge error for logging/display
					});
					return resolution !== ConflictResolution.Cancel;
				}

				// No base content available - compute common base from LCS of local and remote
				// This allows merging non-overlapping changes even without a saved base
				const computedBase = computeCommonBase(localContent, remoteContent);
				const mergeResult = threeWayMerge(computedBase, localContent, remoteContent);

				if (mergeResult.success && mergeResult.content !== undefined) {
					// Auto-merge succeeded using computed base
					await updateFileContent(this.app, this.vault, file, mergeResult.content);

					// Set baseContent to remoteContent so push sends the diff
					await this.baseContentStore.set(path, remoteContent);
					// Update rev to prevent re-pulling the same change
					if (localMeta) {
						metadataCache.set(path, {
							...localMeta,
							rev: doc._rev,
							// Keep original lastModified so file appears "modified" to push phase
						});
						await this.metadataManager.persistCache();
					}
					return true;
				}

				// Merge failed - show conflict resolution
				const resolution = await this.conflictResolver.handleConflict({
					id: doc._id,
					current_content: remoteContent,
					current_rev: doc._rev,
					conflicts: mergeResult.conflicts,
					reason: mergeResult.error,
				});
				return resolution !== ConflictResolution.Cancel;
			}

			// No local modifications - safe to apply remote content
			await updateFileContent(this.app, this.vault, file, remoteContent);
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
			await this.vault.create(path, remoteContent);
		}

		// Get the actual file mtime after writing (critical for correct change detection)
		const actualMtime = await getFileMtime(this.vault, path);

		// Update metadata cache with actual mtime (without baseContent - it's now in IndexedDB)
		metadataCache.set(path, {
			path,
			rev: doc._rev,
			lastModified: actualMtime,
		});

		// Store baseContent in IndexedDB for future 3-way merges
		await this.baseContentStore.set(path, remoteContent);

		await this.metadataManager.persistCache();
		return true;
	}

	private async deleteLocalFile(docId: string, remoteRev?: string): Promise<boolean> {
		const path = docIdToPath(docId);
		const file = this.vault.getAbstractFileByPath(path);
		const metadataCache = this.metadataManager.getMetadataCache();

		if (file instanceof TFile) {
			const localMeta = metadataCache.get(path);
			if (this.isLocalModified(file, localMeta)) {
				const resolution = await this.conflictResolver.handleConflict({
					id: docId,
					current_content: "",
					current_rev: remoteRev,
					current_deleted: true,
				});
				return resolution !== ConflictResolution.Cancel;
			}
			await this.vault.delete(file);
			metadataCache.delete(path);
			await this.baseContentStore.delete(path);
			await this.metadataManager.persistCache();
			return true;
		}
		return true;
	}

	updateSettings(settings: SyncSettings): void {
		this.settings = settings;
	}

	private isLocalModified(file: TFile, metadata: { lastModified: number } | undefined): boolean {
		if (!metadata) {
			return true;
		}
		return file.stat.mtime > metadata.lastModified;
	}
}
