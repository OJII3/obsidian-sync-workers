import type { App, Vault } from "obsidian";
import { AttachmentSync } from "./attachment-sync";
import { type BaseContentStore, getBaseContentStore } from "./base-content-store";
import { ConflictResolver } from "./conflict-resolver";
import { DocumentSync } from "./document-sync";
import { MetadataManager } from "./metadata-manager";
import { type RetryOptions, retryFetch } from "./retry-fetch";
import type { StatusResponse, SyncSettings, SyncStats } from "./types";
import { isAttachmentFile } from "./types";

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
	stats?: SyncStats;
}

export class SyncService {
	private vault: Vault;
	private settings: SyncSettings;
	private syncInProgress = false;
	private baseContentStore: BaseContentStore;
	private metadataManager: MetadataManager;
	private conflictResolver: ConflictResolver;
	private documentSync: DocumentSync;
	private attachmentSync: AttachmentSync;
	private onStatusChange: (status: SyncStatus) => void;
	private baseContentMigration: Promise<void>;
	private syncStats: SyncStats = {
		pulled: 0,
		pushed: 0,
		conflicts: 0,
		errors: 0,
		attachmentsPulled: 0,
		attachmentsPushed: 0,
	};
	private retryOptions: RetryOptions;

	constructor(
		app: App,
		vault: Vault,
		settings: SyncSettings,
		saveSettings: () => Promise<void>,
		onStatusChange: (status: SyncStatus) => void,
	) {
		this.vault = vault;
		this.settings = settings;
		this.onStatusChange = onStatusChange;
		this.baseContentStore = getBaseContentStore();

		// Configure retry options with exponential backoff
		this.retryOptions = {
			maxRetries: 4,
			initialDelayMs: 2000, // 2s, 4s, 8s, 16s
			maxDelayMs: 16000,
		};

		// Initialize managers and sync modules
		this.metadataManager = new MetadataManager(settings, this.baseContentStore, saveSettings);

		this.conflictResolver = new ConflictResolver(
			app,
			vault,
			settings,
			this.metadataManager,
			this.baseContentStore,
			this.retryOptions,
		);

		this.documentSync = new DocumentSync(
			app,
			vault,
			settings,
			this.metadataManager,
			this.baseContentStore,
			this.conflictResolver,
			this.retryOptions,
		);

		this.attachmentSync = new AttachmentSync(
			vault,
			settings,
			this.metadataManager,
			this.retryOptions,
		);

		// Migrate existing baseContent to IndexedDB in background
		this.baseContentMigration = this.metadataManager.migrateBaseContentToIndexedDB();
	}

	updateSettings(settings: SyncSettings) {
		this.settings = settings;
		this.metadataManager.updateSettings(settings);
		this.conflictResolver.updateSettings(settings);
		this.documentSync.updateSettings(settings);
		this.attachmentSync.updateSettings(settings);
	}

	async performSync(): Promise<void> {
		if (this.syncInProgress) {
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

		try {
			await this.baseContentMigration;

			// Step 0: Quick status check to avoid unnecessary full sync
			const status = await this.checkStatus();
			const hasLocalChanges = this.hasLocalChanges();

			// Check if there are any server changes
			const hasServerDocChanges = status ? status.last_seq > this.settings.lastSeq : true;
			const hasServerAttachmentChanges =
				this.settings.syncAttachments && status
					? status.last_attachment_seq > this.settings.lastAttachmentSeq
					: this.settings.syncAttachments;

			// Skip sync if no changes on either side
			if (!hasLocalChanges && !hasServerDocChanges && !hasServerAttachmentChanges) {
				this.settings.lastSync = Date.now();
				this.onStatusChange({
					status: "success",
					duration: `${((Date.now() - startTime) / 1000).toFixed(1)}s`,
					message: "No changes",
					stats: this.syncStats,
				});
				this.syncInProgress = false;
				return;
			}

			this.onStatusChange({ status: "syncing", stats: this.syncStats });

			// Step 1: Pull document changes from server (only if server has changes)
			if (hasServerDocChanges) {
				this.documentSync.setProgressCallback((current, total) => {
					this.onStatusChange({
						status: "syncing",
						progress: { phase: "pull", current, total },
						stats: this.syncStats,
					});
				});
				await this.documentSync.pullChanges(this.syncStats);
			}

			// Step 2: Push local document changes (only if we have local changes)
			if (hasLocalChanges) {
				this.documentSync.setProgressCallback((current, total) => {
					this.onStatusChange({
						status: "syncing",
						progress: { phase: "push", current, total },
						stats: this.syncStats,
					});
				});
				await this.documentSync.pushChanges(this.syncStats);
			}

			// Step 3: Sync attachments if enabled
			if (this.settings.syncAttachments) {
				if (hasServerAttachmentChanges) {
					this.attachmentSync.setProgressCallback((current, total) => {
						this.onStatusChange({
							status: "syncing",
							progress: { phase: "pull-attachments", current, total },
							stats: this.syncStats,
						});
					});
					await this.attachmentSync.pullAttachmentChanges(this.syncStats);
				}

				if (hasLocalChanges) {
					this.attachmentSync.setProgressCallback((current, total) => {
						this.onStatusChange({
							status: "syncing",
							progress: { phase: "push-attachments", current, total },
							stats: this.syncStats,
						});
					});
					await this.attachmentSync.pushAttachmentChanges(this.syncStats);
				}
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

	async testConnection(): Promise<boolean> {
		try {
			const response = await retryFetch(this.settings.serverUrl, undefined, this.retryOptions);
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

	/**
	 * Check server status (lightweight call to get latest seq numbers)
	 * This is optimized for frequent polling - only returns seq numbers
	 */
	async checkStatus(): Promise<StatusResponse | null> {
		try {
			const url = `${this.settings.serverUrl}/api/status?vault_id=${this.settings.vaultId}`;
			const response = await retryFetch(url, undefined, this.retryOptions);
			if (!response.ok) {
				return null;
			}
			return await response.json();
		} catch (error) {
			console.error("Status check failed:", error);
			return null;
		}
	}

	/**
	 * Check if there are any local changes that need to be pushed
	 */
	private hasLocalChanges(): boolean {
		const files = this.vault.getMarkdownFiles();
		const currentFilePaths = new Set<string>();
		const metadataCache = this.metadataManager.getMetadataCache();
		const attachmentCache = this.metadataManager.getAttachmentCache();

		// Check for modified markdown files
		for (const file of files) {
			currentFilePaths.add(file.path);
			const metadata = metadataCache.get(file.path);
			const fileModTime = file.stat.mtime;

			if (!metadata || fileModTime > metadata.lastModified) {
				return true;
			}
		}

		// Check for deleted files
		for (const [path] of metadataCache.entries()) {
			if (!currentFilePaths.has(path)) {
				return true;
			}
		}

		// Check attachments if enabled
		if (this.settings.syncAttachments) {
			const allFiles = this.vault.getFiles();
			const attachmentFiles = allFiles.filter((file) => isAttachmentFile(file.path));
			const currentAttachmentPaths = new Set<string>();

			for (const file of attachmentFiles) {
				currentAttachmentPaths.add(file.path);
				const metadata = attachmentCache.get(file.path);
				const fileModTime = file.stat.mtime;

				if (!metadata || fileModTime > metadata.lastModified) {
					return true;
				}
			}

			// Check for deleted attachments
			for (const [path] of attachmentCache.entries()) {
				if (isAttachmentFile(path) && !currentAttachmentPaths.has(path)) {
					return true;
				}
			}
		}

		return false;
	}
}
