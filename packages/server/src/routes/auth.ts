import { Database } from "../db/queries";
import type { Env } from "../types";
import { hashApiKey } from "../utils/auth";

function generateApiKeyHex(byteLength = 32): string {
	const bytes = new Uint8Array(byteLength);
	crypto.getRandomValues(bytes);
	return Array.from(bytes)
		.map((b) => b.toString(16).padStart(2, "0"))
		.join("");
}

export function authNewHandler(env: Env) {
	return async ({ set }: { set: { status?: number } }) => {
		const db = new Database(env.DB);
		const alreadyInitialized = await db.hasApiKey();
		if (alreadyInitialized) {
			set.status = 409;
			return { error: "API key already initialized" };
		}

		const apiKey = generateApiKeyHex();
		const keyHash = await hashApiKey(apiKey);

		try {
			await db.insertApiKeyHash(keyHash);
		} catch {
			set.status = 409;
			return { error: "API key already initialized" };
		}

		return { apiKey };
	};
}
