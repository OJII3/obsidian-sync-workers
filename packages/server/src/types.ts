export interface Env {
	DB: D1Database;
	ATTACHMENTS: R2Bucket;
	CORS_ORIGIN?: string;
}

export interface Document {
	id: string;
	vault_id: string;
	content: string | null;
	rev: string;
	deleted: number;
	created_at: number;
	updated_at: number;
}

export interface Revision {
	id: number;
	doc_id: string;
	rev: string;
	content: string | null;
	deleted: number;
	created_at: number;
}

export interface Change {
	seq: number;
	doc_id: string;
	rev: string;
	deleted: number;
	vault_id: string;
	created_at: number;
}

export interface DocumentInput {
	_id: string;
	_rev?: string;
	content?: string;
	_deleted?: boolean;
	_base_content?: string; // For three-way merge: last synced content
}

export interface BulkDocsRequest {
	docs: DocumentInput[];
}

export interface ChangesResponse {
	results: Array<{
		seq: number;
		id: string;
		changes: Array<{ rev: string }>;
		deleted?: boolean;
	}>;
	last_seq: number;
}

// Attachment types for R2 storage
export interface Attachment {
	id: string;
	vault_id: string;
	path: string;
	content_type: string;
	size: number;
	hash: string;
	r2_key: string;
	deleted: number;
	created_at: number;
	updated_at: number;
}

export interface AttachmentMetadata {
	id: string;
	path: string;
	content_type: string;
	size: number;
	hash: string;
	deleted?: boolean;
}

export interface AttachmentChange {
	seq: number;
	attachment_id: string;
	hash: string;
	deleted: number;
	vault_id: string;
	created_at: number;
}

export interface AttachmentChangesResponse {
	results: Array<{
		seq: number;
		id: string;
		path: string;
		hash: string;
		deleted?: boolean;
	}>;
	last_seq: number;
}
