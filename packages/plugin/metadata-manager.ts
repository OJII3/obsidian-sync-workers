import type { BaseContentStore } from "./base-content-store";
import type { AttachmentMetadata, DocMetadata, SyncSettings } from "./types";

export class MetadataManager {
	private metadataCache: Map<string, DocMetadata> = new Map();
	private attachmentCache: Map<string, AttachmentMetadata> = new Map();
	private baseContentStore: BaseContentStore;
	private settings: SyncSettings;
	private saveSettings: () => Promise<void>;
	private migrationDone = false;

	constructor(
		settings: SyncSettings,
		baseContentStore: BaseContentStore,
		saveSettings: () => Promise<void>,
	) {
		this.settings = settings;
		this.baseContentStore = baseContentStore;
		this.saveSettings = saveSettings;

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
	}

	getMetadataCache(): Map<string, DocMetadata> {
		return this.metadataCache;
	}

	getAttachmentCache(): Map<string, AttachmentMetadata> {
		return this.attachmentCache;
	}

	/**
	 * Migrate existing baseContent from settings to IndexedDB
	 */
	async migrateBaseContentToIndexedDB(): Promise<void> {
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
					const count = await this.baseContentStore.migrateFromSettings(
						this.settings.metadataCache,
					);

					// Remove baseContent from settings to save space
					if (count > 0) {
						for (const metadata of Object.values(this.settings.metadataCache)) {
							delete metadata.baseContent;
						}
						await this.saveSettings();
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

	async persistCache(): Promise<void> {
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

	updateSettings(settings: SyncSettings): void {
		this.settings = settings;
	}
}
