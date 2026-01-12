export interface SyncSettings {
	serverUrl: string;
	vaultId: string;
	syncInterval: number; // in seconds
	autoSync: boolean;
	lastSync: number; // timestamp
	lastSeq: number; // last sequence number from changes feed
	metadataCache: Record<string, DocMetadata>; // persistent metadata cache
}

export const DEFAULT_SETTINGS: SyncSettings = {
	serverUrl: "http://localhost:8787",
	vaultId: "default",
	syncInterval: 30, // 30 seconds default
	autoSync: true,
	lastSync: 0,
	lastSeq: 0,
	metadataCache: {},
};

// API response types
export interface DocumentResponse {
	_id: string;
	_rev: string;
	content: string;
	_deleted?: boolean;
}

export interface DocumentInput {
	_id: string;
	_rev?: string;
	content?: string;
	_deleted?: boolean;
	_base_content?: string; // For three-way merge: last synced content
}

export interface ChangeResult {
	seq: number;
	id: string;
	changes: Array<{ rev: string }>;
	deleted?: boolean;
}

export interface ChangesResponse {
	results: ChangeResult[];
	last_seq: number;
}

export interface BulkDocsResponse {
	ok?: boolean;
	id: string;
	rev?: string;
	error?: string;
	reason?: string;
	merged?: boolean; // Indicates automatic merge was performed
	current_content?: string; // Server's current content (for conflicts)
	current_rev?: string; // Server's current revision (for conflicts)
	conflicts?: ConflictRegion[]; // Conflict details
}

export interface ConflictRegion {
	base: string[];
	local: string[];
	remote: string[];
	startLine: number;
}

// Local document metadata
export interface DocMetadata {
	path: string;
	rev: string;
	lastModified: number;
	baseContent?: string; // Content at last successful sync (for 3-way merge)
}
