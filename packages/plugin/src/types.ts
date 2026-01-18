export interface SyncSettings {
	serverUrl: string;
	vaultId: string;
	syncInterval: number; // in seconds
	autoSync: boolean;
	syncOnStartup: boolean;
	syncOnSave: boolean;
	syncAttachments: boolean; // sync binary files (images, PDFs, etc.)
	lastSync: number; // timestamp
	lastSeq: number; // last sequence number from changes feed
	lastAttachmentSeq: number; // last sequence number from attachment changes feed
	metadataCache: Record<string, DocMetadata>; // persistent metadata cache
	attachmentCache: Record<string, AttachmentMetadata>; // persistent attachment cache
}

export const DEFAULT_SETTINGS: SyncSettings = {
	serverUrl: "http://localhost:8787",
	vaultId: "default",
	syncInterval: 30, // 30 seconds default
	autoSync: true,
	syncOnStartup: true,
	syncOnSave: true,
	syncAttachments: true, // sync attachments by default
	lastSync: 0,
	lastSeq: 0,
	lastAttachmentSeq: 0,
	metadataCache: {},
	attachmentCache: {},
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
	merged?: boolean; // true if server performed 3-way merge
	current_content?: string; // current server content for conflict resolution
	current_rev?: string; // current server revision for conflict resolution
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
	baseContent?: string; // For three-way merge: last synced content (migrated to IndexedDB)
}

// Attachment types
export interface AttachmentMetadata {
	path: string;
	hash: string; // SHA-256 hash
	size: number;
	contentType: string;
	lastModified: number;
	attachmentId?: string; // Content-addressable ID (vaultId:hash.ext)
}

export interface AttachmentChangeResult {
	seq: number;
	id: string;
	path: string;
	hash: string;
	deleted?: boolean;
}

export interface AttachmentChangesResponse {
	results: AttachmentChangeResult[];
	last_seq: number;
}

export interface AttachmentUploadResponse {
	ok: boolean;
	id: string; // Content-addressable ID (vaultId:hash.ext)
	hash: string;
	size: number;
	content_type: string;
	unchanged?: boolean; // true if the server already has identical content
}

export interface SyncStats {
	pulled: number;
	pushed: number;
	conflicts: number;
	errors: number;
	attachmentsPushed: number;
}

// Lightweight status response for efficient polling
export interface StatusResponse {
	ok: boolean;
	vault_id: string;
	last_seq: number;
	last_attachment_seq: number;
}

// Common image and binary file extensions
export const ATTACHMENT_EXTENSIONS = [
	// Images
	".png",
	".jpg",
	".jpeg",
	".gif",
	".bmp",
	".svg",
	".webp",
	".ico",
	".avif",
	// Documents
	".pdf",
	// Audio
	".mp3",
	".wav",
	".ogg",
	".m4a",
	".flac",
	// Video
	".mp4",
	".webm",
	".mov",
	".avi",
	// Archives
	".zip",
	".tar",
	".gz",
	".7z",
	// Other
	".ttf",
	".otf",
	".woff",
	".woff2",
];

export function isAttachmentFile(path: string): boolean {
	const lowerPath = path.toLowerCase();
	return ATTACHMENT_EXTENSIONS.some((ext) => lowerPath.endsWith(ext));
}

export function getContentType(path: string): string {
	const ext = path.toLowerCase().split(".").pop() || "";
	const contentTypes: Record<string, string> = {
		png: "image/png",
		jpg: "image/jpeg",
		jpeg: "image/jpeg",
		gif: "image/gif",
		bmp: "image/bmp",
		svg: "image/svg+xml",
		webp: "image/webp",
		ico: "image/x-icon",
		avif: "image/avif",
		pdf: "application/pdf",
		mp3: "audio/mpeg",
		wav: "audio/wav",
		ogg: "audio/ogg",
		m4a: "audio/mp4",
		flac: "audio/flac",
		mp4: "video/mp4",
		webm: "video/webm",
		mov: "video/quicktime",
		avi: "video/x-msvideo",
		zip: "application/zip",
		tar: "application/x-tar",
		gz: "application/gzip",
		"7z": "application/x-7z-compressed",
		ttf: "font/ttf",
		otf: "font/otf",
		woff: "font/woff",
		woff2: "font/woff2",
	};
	return contentTypes[ext] || "application/octet-stream";
}
