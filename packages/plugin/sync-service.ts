import { Notice, TFile, type Vault } from "obsidian";
import type {
	BulkDocsResponse,
	ChangesResponse,
	DocMetadata,
	DocumentInput,
	DocumentResponse,
	SyncSettings,
} from "./types";

export class SyncService {
	private vault: Vault;
	private settings: SyncSettings;
	private syncInProgress = false;
	private metadataCache: Map<string, DocMetadata> = new Map();
	private saveSettings: () => Promise<void>;

	constructor(vault: Vault, settings: SyncSettings, saveSettings: () => Promise<void>) {
		this.vault = vault;
		this.settings = settings;
		this.saveSettings = saveSettings;

		// Initialize metadata cache from persisted settings
		if (settings.metadataCache) {
			for (const [path, metadata] of Object.entries(settings.metadataCache)) {
				this.metadataCache.set(path, metadata);
			}
		}
	}

	updateSettings(settings: SyncSettings) {
		this.settings = settings;
	}

	private async persistMetadataCache(): Promise<void> {
		// Convert Map to plain object for persistence
		const cacheObj: Record<string, DocMetadata> = {};
		for (const [path, metadata] of this.metadataCache.entries()) {
			cacheObj[path] = metadata;
		}
		this.settings.metadataCache = cacheObj;
		await this.saveSettings();
	}

	async performSync(): Promise<void> {
		if (this.syncInProgress) {
			console.log("Sync already in progress, skipping");
			return;
		}

		this.syncInProgress = true;
		const startTime = Date.now();

		try {
			new Notice("Starting sync...");

			// Step 1: Pull changes from server
			await this.pullChanges();

			// Step 2: Push local changes
			await this.pushChanges();

			this.settings.lastSync = Date.now();
			new Notice(`Sync completed in ${((Date.now() - startTime) / 1000).toFixed(1)}s`);
		} catch (error) {
			console.error("Sync error:", error);
			const message =
				error instanceof Error
					? error.message
					: error !== null && error !== undefined
						? String(error)
						: "Unknown error";
			new Notice(`Sync failed: ${message}`);
		} finally {
			this.syncInProgress = false;
		}
	}

	private async pullChanges(): Promise<void> {
		const url = `${this.settings.serverUrl}/api/changes?since=${this.settings.lastSeq}&limit=100&vault_id=${this.settings.vaultId}`;

		const response = await fetch(url);
		if (!response.ok) {
			throw new Error(`Failed to fetch changes: ${response.statusText}`);
		}

		const data: ChangesResponse = await response.json();

		console.log(`Received ${data.results.length} changes from server`);

		for (const change of data.results) {
			try {
				if (change.deleted) {
					await this.deleteLocalFile(change.id);
				} else {
					await this.pullDocument(change.id);
				}
			} catch (error) {
				console.error(`Error processing change for ${change.id}:`, error);
			}
		}

		// Update last sequence
		if (data.last_seq > this.settings.lastSeq) {
			this.settings.lastSeq = data.last_seq;
		}
	}

	private async pullDocument(docId: string): Promise<void> {
		const url = `${this.settings.serverUrl}/api/docs/${encodeURIComponent(
			docId,
		)}?vault_id=${this.settings.vaultId}`;

		const response = await fetch(url);
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

		// Update metadata cache
		this.metadataCache.set(path, {
			path,
			rev: doc._rev,
			lastModified: Date.now(),
		});
		await this.persistMetadataCache();
	}

	private async deleteLocalFile(docId: string): Promise<void> {
		const path = this.docIdToPath(docId);
		const file = this.vault.getAbstractFileByPath(path);

		if (file instanceof TFile) {
			await this.vault.delete(file);
			this.metadataCache.delete(path);
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

				docsToUpdate.push({
					_id: docId,
					_rev: metadata?.rev,
					content,
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

		console.log(`Pushing ${docsToUpdate.length} documents to server`);

		// Use bulk docs endpoint for efficiency
		const url = `${this.settings.serverUrl}/api/docs/bulk_docs?vault_id=${this.settings.vaultId}`;

		const response = await fetch(url, {
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

		// Update metadata cache with new revisions
		for (const result of results) {
			if (result.ok && result.rev) {
				const path = this.docIdToPath(result.id);
				const file = this.vault.getAbstractFileByPath(path);
				if (file instanceof TFile) {
					// File exists, update metadata
					this.metadataCache.set(path, {
						path,
						rev: result.rev,
						lastModified: file.stat.mtime,
					});
				} else {
					// File doesn't exist (was deleted), remove from cache
					this.metadataCache.delete(path);
				}
			} else if (result.error) {
				console.error(`Failed to update ${result.id}: ${result.error}`);
			}
		}
		await this.persistMetadataCache();
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
			const response = await fetch(this.settings.serverUrl);
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
}
