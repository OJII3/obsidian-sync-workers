import { describe, expect, test } from "bun:test";
import { type AuthContext, requireAuth } from "../src/utils/auth";

function createContext(options: {
	authHeader?: string | null;
	apiKey?: string;
	hasEnv?: boolean;
}): AuthContext {
	const headers = new Headers();
	if (options.authHeader) {
		headers.set("Authorization", options.authHeader);
	}

	const request = new Request("http://localhost/test", { headers });
	const set: { status: number | string } = { status: 200 };
	const env = options.hasEnv === false ? undefined : { API_KEY: options.apiKey };

	return { request, set, env };
}

describe("auth helpers (server/tests)", () => {
	test("allows requests when no API key is configured", () => {
		const context = createContext({ apiKey: undefined });
		expect(requireAuth(context)).toBe(true);
	});

	test("rejects requests with invalid API key", () => {
		const context = createContext({
			apiKey: "secret-key",
			authHeader: "Bearer wrong-key",
		});
		expect(requireAuth(context)).toBe(false);
		expect(context.set.status).toBe(401);
	});

	test("rejects requests missing Authorization header when API key is required", () => {
		const context = createContext({ apiKey: "secret-key", authHeader: null });
		expect(requireAuth(context)).toBe(false);
		expect(context.set.status).toBe(401);
	});
});
