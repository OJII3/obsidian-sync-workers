export interface Env {
	DB: D1Database;
	API_KEY?: string;
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
