/**
 * BaseContentStore - Stores baseContent in IndexedDB to prevent memory bloat
 *
 * Problem: Storing full file content in memory for every document causes
 * memory issues in large vaults (1000+ files).
 *
 * Solution: Store baseContent in IndexedDB with an LRU cache for recent access.
 */

const DB_NAME = "obsidian-sync-base-content";
const DB_VERSION = 1;
const STORE_NAME = "base_content";
const LRU_CACHE_SIZE = 100;

interface BaseContentEntry {
	path: string;
	content: string;
	accessedAt: number;
}

export class BaseContentStore {
	private db: IDBDatabase | null = null;
	private lruCache: Map<string, string> = new Map();
	private initPromise: Promise<void> | null = null;

	/**
	 * Initialize the IndexedDB database
	 */
	async init(): Promise<void> {
		if (this.db) return;
		if (this.initPromise) return this.initPromise;

		this.initPromise = new Promise((resolve) => {
			const request = indexedDB.open(DB_NAME, DB_VERSION);

			request.onerror = () => {
				console.error("Failed to open IndexedDB:", request.error);
				// Fall back to memory-only mode
				this.db = null;
				resolve();
			};

			request.onsuccess = () => {
				this.db = request.result;
				resolve();
			};

			request.onupgradeneeded = (event) => {
				const db = (event.target as IDBOpenDBRequest).result;

				// Create object store with path as key
				if (!db.objectStoreNames.contains(STORE_NAME)) {
					const store = db.createObjectStore(STORE_NAME, { keyPath: "path" });
					store.createIndex("accessedAt", "accessedAt", { unique: false });
				}
			};
		});

		return this.initPromise;
	}

	/**
	 * Get baseContent for a document
	 */
	async get(path: string): Promise<string | undefined> {
		// Check LRU cache first
		const cached = this.lruCache.get(path);
		if (cached !== undefined) {
			// Move to end (most recently used)
			this.lruCache.delete(path);
			this.lruCache.set(path, cached);
			return cached;
		}

		// Fall back to IndexedDB
		await this.init();
		const db = this.db;
		if (!db) return undefined;

		return new Promise((resolve) => {
			const transaction = db.transaction(STORE_NAME, "readonly");
			const store = transaction.objectStore(STORE_NAME);
			const request = store.get(path);

			request.onsuccess = () => {
				const result = request.result as BaseContentEntry | undefined;
				if (result) {
					// Add to LRU cache
					this.addToLruCache(path, result.content);
					// Update access time in background
					this.updateAccessTime(path);
					resolve(result.content);
				} else {
					resolve(undefined);
				}
			};

			request.onerror = () => {
				console.error("Failed to get baseContent:", request.error);
				resolve(undefined);
			};
		});
	}

	/**
	 * Set baseContent for a document
	 */
	async set(path: string, content: string): Promise<void> {
		// Update LRU cache
		this.addToLruCache(path, content);

		// Store in IndexedDB
		await this.init();
		const db = this.db;
		if (!db) return;

		return new Promise((resolve) => {
			const transaction = db.transaction(STORE_NAME, "readwrite");
			const store = transaction.objectStore(STORE_NAME);

			const entry: BaseContentEntry = {
				path,
				content,
				accessedAt: Date.now(),
			};

			const request = store.put(entry);

			request.onsuccess = () => resolve();
			request.onerror = () => {
				console.error("Failed to set baseContent:", request.error);
				resolve(); // Don't fail the sync
			};
		});
	}

	/**
	 * Delete baseContent for a document
	 */
	async delete(path: string): Promise<void> {
		// Remove from LRU cache
		this.lruCache.delete(path);

		// Remove from IndexedDB
		await this.init();
		const db = this.db;
		if (!db) return;

		return new Promise((resolve) => {
			const transaction = db.transaction(STORE_NAME, "readwrite");
			const store = transaction.objectStore(STORE_NAME);
			const request = store.delete(path);

			request.onsuccess = () => resolve();
			request.onerror = () => {
				console.error("Failed to delete baseContent:", request.error);
				resolve();
			};
		});
	}

	/**
	 * Check if baseContent exists for a document (without loading full content)
	 */
	async has(path: string): Promise<boolean> {
		if (this.lruCache.has(path)) return true;

		await this.init();
		const db = this.db;
		if (!db) return false;

		return new Promise((resolve) => {
			const transaction = db.transaction(STORE_NAME, "readonly");
			const store = transaction.objectStore(STORE_NAME);
			const request = store.count(IDBKeyRange.only(path));

			request.onsuccess = () => resolve(request.result > 0);
			request.onerror = () => resolve(false);
		});
	}

	/**
	 * Clear all stored baseContent (useful for reset/cleanup)
	 */
	async clear(): Promise<void> {
		this.lruCache.clear();

		await this.init();
		const db = this.db;
		if (!db) return;

		return new Promise((resolve) => {
			const transaction = db.transaction(STORE_NAME, "readwrite");
			const store = transaction.objectStore(STORE_NAME);
			const request = store.clear();

			request.onsuccess = () => resolve();
			request.onerror = () => {
				console.error("Failed to clear baseContent store:", request.error);
				resolve();
			};
		});
	}

	/**
	 * Get statistics about stored content
	 */
	async getStats(): Promise<{ count: number; lruCacheSize: number }> {
		await this.init();
		const db = this.db;
		if (!db) {
			return { count: 0, lruCacheSize: this.lruCache.size };
		}

		return new Promise((resolve) => {
			const transaction = db.transaction(STORE_NAME, "readonly");
			const store = transaction.objectStore(STORE_NAME);
			const request = store.count();

			request.onsuccess = () => {
				resolve({
					count: request.result,
					lruCacheSize: this.lruCache.size,
				});
			};
			request.onerror = () => {
				resolve({ count: 0, lruCacheSize: this.lruCache.size });
			};
		});
	}

	/**
	 * Cleanup old entries that haven't been accessed in a while
	 * @param maxAge Maximum age in milliseconds (default: 90 days)
	 */
	async cleanup(maxAge: number = 90 * 24 * 60 * 60 * 1000): Promise<number> {
		await this.init();
		const db = this.db;
		if (!db) return 0;

		const cutoff = Date.now() - maxAge;
		let deletedCount = 0;

		return new Promise((resolve) => {
			const transaction = db.transaction(STORE_NAME, "readwrite");
			const store = transaction.objectStore(STORE_NAME);
			const index = store.index("accessedAt");

			// Find entries older than cutoff
			const range = IDBKeyRange.upperBound(cutoff);
			const request = index.openCursor(range);

			request.onsuccess = (event) => {
				const cursor = (event.target as IDBRequest<IDBCursorWithValue>).result;
				if (cursor) {
					// Remove from LRU cache if present
					const entry = cursor.value as BaseContentEntry;
					this.lruCache.delete(entry.path);

					// Delete from IndexedDB
					cursor.delete();
					deletedCount++;
					cursor.continue();
				} else {
					console.log(`Cleaned up ${deletedCount} old baseContent entries`);
					resolve(deletedCount);
				}
			};

			request.onerror = () => {
				console.error("Failed to cleanup baseContent:", request.error);
				resolve(deletedCount);
			};
		});
	}

	/**
	 * Migrate existing baseContent from settings to IndexedDB
	 */
	async migrateFromSettings(
		metadataCache: Record<string, { path: string; baseContent?: string }>,
	): Promise<number> {
		await this.init();
		if (!this.db) return 0;

		let migratedCount = 0;

		for (const [path, metadata] of Object.entries(metadataCache)) {
			if (metadata.baseContent) {
				await this.set(path, metadata.baseContent);
				migratedCount++;
			}
		}

		console.log(`Migrated ${migratedCount} baseContent entries to IndexedDB`);
		return migratedCount;
	}

	/**
	 * Close the database connection
	 */
	close(): void {
		if (this.db) {
			this.db.close();
			this.db = null;
		}
		this.initPromise = null;
	}

	// Private helper methods

	private addToLruCache(path: string, content: string): void {
		// If already exists, remove to update position
		if (this.lruCache.has(path)) {
			this.lruCache.delete(path);
		}

		// Add to end (most recently used)
		this.lruCache.set(path, content);

		// Evict oldest if over capacity
		if (this.lruCache.size > LRU_CACHE_SIZE) {
			const oldestKey = this.lruCache.keys().next().value;
			if (oldestKey) {
				this.lruCache.delete(oldestKey);
			}
		}
	}

	private updateAccessTime(path: string): void {
		if (!this.db) return;

		// Update in background, don't await
		const transaction = this.db.transaction(STORE_NAME, "readwrite");
		const store = transaction.objectStore(STORE_NAME);
		const request = store.get(path);

		request.onsuccess = () => {
			const entry = request.result as BaseContentEntry | undefined;
			if (entry) {
				entry.accessedAt = Date.now();
				store.put(entry);
			}
		};
	}
}

// Singleton instance
let storeInstance: BaseContentStore | null = null;

export function getBaseContentStore(): BaseContentStore {
	if (!storeInstance) {
		storeInstance = new BaseContentStore();
	}
	return storeInstance;
}
