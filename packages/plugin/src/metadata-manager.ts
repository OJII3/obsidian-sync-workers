import type { AttachmentMetadata, DocMetadata, SyncSettings } from "./types";

export class MetadataManager {
	private metadataCache: Map<string, DocMetadata> = new Map();
	private attachmentCache: Map<string, AttachmentMetadata> = new Map();
	private settings: SyncSettings;
	private saveSettings: () => Promise<void>;

	constructor(settings: SyncSettings, saveSettings: () => Promise<void>) {
		this.settings = settings;
		this.saveSettings = saveSettings;

		// Initialize metadata cache from persisted settings
		if (settings.metadataCache) {
			for (const [path, metadata] of Object.entries(settings.metadataCache)) {
				this.metadataCache.set(path, metadata);
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

	/**
	 * Clear all in-memory caches.
	 * Used for full reset operations to ensure both in-memory and persisted state are cleared.
	 */
	clearAll(): void {
		this.metadataCache.clear();
		this.attachmentCache.clear();
	}
}
