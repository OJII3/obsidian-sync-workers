export interface SyncSettings {
	serverUrl: string;
	vaultId: string;
	syncInterval: number; // in minutes
	autoSync: boolean;
	lastSync: number; // timestamp
	lastSeq: number; // last sequence number from changes feed
	metadataCache: Record<string, DocMetadata>; // persistent metadata cache
}

export const DEFAULT_SETTINGS: SyncSettings = {
	serverUrl: "http://localhost:8787",
	vaultId: "default",
	syncInterval: 5,
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
}

// Local document metadata
export interface DocMetadata {
	path: string;
	rev: string;
	lastModified: number;
}
