import { Elysia } from "elysia";
import { Database } from "../db/queries";
import type { ChangesResponse, Env } from "../types";

export const changesRoutes = (env: Env) =>
	new Elysia({ prefix: "/changes" })
		.get("/", async ({ query }) => {
			const since = Number.parseInt(query.since || "0", 10);
			const limit = Number.parseInt(query.limit || "100", 10);
			const vaultId = query.vault_id || "default";

			// Validate parameters
			if (Number.isNaN(since) || since < 0) {
				return {
					error: "Invalid since parameter",
					status: 400,
				};
			}

			if (Number.isNaN(limit) || limit < 1 || limit > 1000) {
				return {
					error: "Invalid limit parameter (1-1000)",
					status: 400,
				};
			}

			const db = new Database(env.DB);
			const { changes: changesList, lastSeq } = await db.getChanges(vaultId, since, limit);

			// Format response in CouchDB-like format
			const response: ChangesResponse = {
				results: changesList.map((change) => ({
					seq: change.seq,
					id: change.doc_id,
					changes: [{ rev: change.rev }],
					deleted: change.deleted === 1 ? true : undefined,
				})),
				last_seq: lastSeq,
			};

			return response;
		})
		.get("/continuous", () => ({
			error: "Not implemented",
			message: "Continuous changes feed requires WebSocket support",
			status: 501,
		}));
