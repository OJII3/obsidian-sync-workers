import { type App, TFile, type Vault } from "obsidian";
import { buildAuthHeaders } from "./auth";
import type { BaseContentStore } from "./base-content-store";
import { ConflictResolution, ConflictResolutionModal } from "./conflict-modal";
import type { MetadataManager } from "./metadata-manager";
import { type RetryOptions, retryFetch } from "./retry-fetch";
import { docIdToPath, getFileMtime, updateFileContent } from "./sync-utils";
import type { BulkDocsResponse, SyncSettings } from "./types";

export class ConflictResolver {
	private app: App;
	private vault: Vault;
	private settings: SyncSettings;
	private metadataManager: MetadataManager;
	private baseContentStore: BaseContentStore;
	private retryOptions: RetryOptions;

	constructor(
		app: App,
		vault: Vault,
		settings: SyncSettings,
		metadataManager: MetadataManager,
		baseContentStore: BaseContentStore,
		retryOptions: RetryOptions,
	) {
		this.app = app;
		this.vault = vault;
		this.settings = settings;
		this.metadataManager = metadataManager;
		this.baseContentStore = baseContentStore;
		this.retryOptions = retryOptions;
	}

	async handleConflict(result: BulkDocsResponse): Promise<ConflictResolution> {
		const path = docIdToPath(result.id);
		const file = this.vault.getAbstractFileByPath(path);

		if (!(file instanceof TFile)) {
			console.error(`Cannot resolve conflict: file not found ${path}`);
			return ConflictResolution.Cancel;
		}

		const localContent = await this.vault.read(file);
		const remoteContent = result.current_content || "";
		const remoteDeleted = result.current_deleted === true;

		// Show conflict resolution modal
		const modal = new ConflictResolutionModal(
			this.app,
			path,
			localContent,
			remoteContent,
			remoteDeleted,
		);
		modal.open();

		const resolution = await modal.waitForResult();

		if (resolution === ConflictResolution.UseLocal) {
			// Force push local version
			try {
				const content = await this.vault.read(file);
				await this.forcePushDocument(result.id, content, result.current_rev);
			} catch (error) {
				console.error(`Failed to force push ${path}:`, error);
			}
		} else if (resolution === ConflictResolution.UseRemote) {
			// Accept remote version (or deletion)
			try {
				if (remoteDeleted) {
					await this.vault.delete(file);
					this.metadataManager.getMetadataCache().delete(path);
					await this.baseContentStore.delete(path);
					await this.metadataManager.persistCache();
				} else {
					await updateFileContent(this.app, this.vault, file, remoteContent);
					// Get actual mtime after file update (critical for correct change detection)
					const actualMtime = await getFileMtime(this.vault, path);
					this.metadataManager.getMetadataCache().set(path, {
						path,
						rev: result.current_rev || "",
						lastModified: actualMtime,
					});
					await this.baseContentStore.set(path, remoteContent);
					await this.metadataManager.persistCache();
				}
			} catch (error) {
				console.error(`Failed to apply remote version ${path}:`, error);
			}
		} else {
			// Cancel - keep local but don't sync
		}
		return resolution;
	}

	async forcePushDocument(docId: string, content: string, currentRev?: string): Promise<void> {
		// Force push by using the server's current revision
		const url = `${this.settings.serverUrl}/api/docs/${encodeURIComponent(
			docId,
		)}?vault_id=${this.settings.vaultId}`;

		const response = await retryFetch(
			url,
			{
				method: "PUT",
				headers: buildAuthHeaders(this.settings, {
					"Content-Type": "application/json",
				}),
				body: JSON.stringify({
					_id: docId,
					_rev: currentRev,
					content,
				}),
			},
			this.retryOptions,
		);

		if (!response.ok) {
			throw new Error(`Failed to force push document: ${response.statusText}`);
		}

		const result = await response.json();
		if (result.ok && result.rev) {
			const path = docIdToPath(docId);
			// Get actual mtime from the file (it wasn't modified, we just pushed it)
			const actualMtime = await getFileMtime(this.vault, path);
			this.metadataManager.getMetadataCache().set(path, {
				path,
				rev: result.rev,
				lastModified: actualMtime,
			});
			await this.baseContentStore.set(path, content);
			await this.metadataManager.persistCache();
		}
	}

	updateSettings(settings: SyncSettings): void {
		this.settings = settings;
	}
}
