import { type App, Notice, TFile, type Vault } from "obsidian";
import { buildAuthHeaders } from "./auth";
import { ConflictResolution, ConflictResolutionModal } from "./conflict-modal";
import { FullSyncRequiredModal, FullSyncResolution } from "./full-sync-modal";
import type { MetadataManager } from "./metadata-manager";
import { type RetryOptions, retryFetch } from "./retry-fetch";
import { docIdToPath, getFileMtime, updateFileContent } from "./sync-utils";
import type { BulkDocsResponse, SyncSettings } from "./types";

export class ConflictResolver {
	private app: App;
	private vault: Vault;
	private settings: SyncSettings;
	private metadataManager: MetadataManager;
	private retryOptions: RetryOptions;
	private onFullResetRequested?: () => Promise<void>;

	constructor(
		app: App,
		vault: Vault,
		settings: SyncSettings,
		metadataManager: MetadataManager,
		retryOptions: RetryOptions,
	) {
		this.app = app;
		this.vault = vault;
		this.settings = settings;
		this.metadataManager = metadataManager;
		this.retryOptions = retryOptions;
	}

	setFullResetCallback(callback: () => Promise<void>): void {
		this.onFullResetRequested = callback;
	}

	async handleConflict(result: BulkDocsResponse): Promise<ConflictResolution> {
		const path = docIdToPath(result.id);
		const file = this.vault.getAbstractFileByPath(path);

		if (!(file instanceof TFile)) {
			new Notice(`File not found for conflict resolution: ${path}.`);
			return ConflictResolution.Cancel;
		}

		// Check if full sync is required (base revision not found)
		if (result.requires_full_sync) {
			const fullSyncModal = new FullSyncRequiredModal(this.app, path, result.reason || "unknown");
			fullSyncModal.open();
			const fullSyncResolution = await fullSyncModal.waitForResult();

			if (fullSyncResolution === FullSyncResolution.FullReset) {
				// Trigger full reset callback and cancel current sync
				if (this.onFullResetRequested) {
					await this.onFullResetRequested();
				}
				return ConflictResolution.Cancel;
			}
			if (fullSyncResolution === FullSyncResolution.Cancel) {
				return ConflictResolution.Cancel;
			}
			// ManualResolve - fall through to normal conflict resolution
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
			} catch {
				new Notice(`Failed to force push ${path}.`);
			}
		} else if (resolution === ConflictResolution.UseRemote) {
			// Accept remote version (or deletion)
			try {
				if (remoteDeleted) {
					await this.app.fileManager.trashFile(file);
					this.metadataManager.getMetadataCache().delete(path);
					await this.metadataManager.persistCache();
				} else {
					await updateFileContent(this.app, this.vault, file, remoteContent);
					// Get actual mtime after file update (critical for correct change detection)
					const actualMtime = getFileMtime(this.vault, path);
					this.metadataManager.getMetadataCache().set(path, {
						path,
						rev: result.current_rev || "",
						lastModified: actualMtime,
					});
					await this.metadataManager.persistCache();
				}
			} catch {
				new Notice(`Failed to apply remote version for ${path}.`);
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

		const result = (await response.json()) as { ok?: boolean; rev?: string };
		if (result.ok && result.rev) {
			const path = docIdToPath(docId);
			// Get actual mtime from the file (it wasn't modified, we just pushed it)
			const actualMtime = getFileMtime(this.vault, path);
			this.metadataManager.getMetadataCache().set(path, {
				path,
				rev: result.rev,
				lastModified: actualMtime,
			});
			await this.metadataManager.persistCache();
		}
	}

	updateSettings(settings: SyncSettings): void {
		this.settings = settings;
	}
}
