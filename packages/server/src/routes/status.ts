import { Database } from "../db/queries";
import type { Env } from "../types";

export function statusHandler(env: Env) {
	return async ({ query }: { query: { vault_id?: string } }) => {
		const vaultId = query.vault_id || "default";
		const db = new Database(env.DB);
		const seqs = await db.getLatestSeqs(vaultId);

		return {
			ok: true,
			vault_id: vaultId,
			last_seq: seqs.lastSeq,
			last_attachment_seq: seqs.lastAttachmentSeq,
		};
	};
}
