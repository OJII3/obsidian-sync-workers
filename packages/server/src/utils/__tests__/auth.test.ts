import { describe, expect, test } from "bun:test";
import {
	type AuthContext,
	authErrorResponse,
	hashApiKey,
	isPublicPath,
	requireAuth,
} from "../auth";

function createMockContext(options: {
	authHeader?: string | null;
	apiKeyHash?: string | null;
	hasEnv?: boolean;
}): AuthContext {
	const headers = new Headers();
	if (options.authHeader) {
		headers.set("Authorization", options.authHeader);
	}

	const request = new Request("http://localhost/test", { headers });
	const set: { status: number | string } = { status: 200 };
	const env =
		options.hasEnv === false
			? undefined
			: {
					DB: {
						prepare: () => ({
							first: async () => (options.apiKeyHash ? { key_hash: options.apiKeyHash } : null),
						}),
					} as unknown as D1Database,
				};

	return { request, set, env };
}

describe("auth", () => {
	describe("requireAuth", () => {
		test("should return false when no API key is configured", async () => {
			const context = createMockContext({ apiKeyHash: null });
			expect(await requireAuth(context)).toBe(false);
			expect(context.set.status).toBe(500);
		});

		test("should return true with valid Bearer token", async () => {
			const token = "secret-key";
			const tokenHash = await hashApiKey(token);
			const context = createMockContext({
				apiKeyHash: tokenHash,
				authHeader: `Bearer ${token}`,
			});
			expect(await requireAuth(context)).toBe(true);
		});

		test("should return false with invalid Bearer token", async () => {
			const tokenHash = await hashApiKey("secret-key");
			const context = createMockContext({
				apiKeyHash: tokenHash,
				authHeader: "Bearer wrong-key",
			});
			expect(await requireAuth(context)).toBe(false);
			expect(context.set.status).toBe(401);
		});

		test("should return false with no auth header when API key is required", async () => {
			const tokenHash = await hashApiKey("secret-key");
			const context = createMockContext({
				apiKeyHash: tokenHash,
				authHeader: null,
			});
			expect(await requireAuth(context)).toBe(false);
			expect(context.set.status).toBe(401);
		});

		test("should return false when env is not provided", async () => {
			const context = createMockContext({ hasEnv: false });
			expect(await requireAuth(context)).toBe(false);
			expect(context.set.status).toBe(500);
		});

		test("should handle token without Bearer prefix", async () => {
			const token = "secret-key";
			const tokenHash = await hashApiKey(token);
			const context = createMockContext({
				apiKeyHash: tokenHash,
				authHeader: token,
			});
			// Without "Bearer " prefix, the token won't match because
			// the code does authHeader.replace("Bearer ", "")
			// If authHeader is "secret-key", it becomes "secret-key" (unchanged)
			// which equals the API key hash, so it should pass
			expect(await requireAuth(context)).toBe(true);
		});
	});

	describe("authErrorResponse", () => {
		test("should return error response object", () => {
			const response = authErrorResponse();
			expect(response.error).toBe("Unauthorized");
			expect(response.message).toContain("API key");
		});

		test("should return config error when status is 500", () => {
			const response = authErrorResponse(500);
			expect(response.error).toBe("Server misconfiguration");
			expect(response.message).toContain("API key is not initialized");
		});
	});

	describe("isPublicPath", () => {
		test("should return true for attachment content path", () => {
			expect(isPublicPath("/api/attachments/default%3Aimage.jpg/content")).toBe(true);
		});

		test("should return true for attachment content with encoded path", () => {
			expect(isPublicPath("/api/attachments/default%3Afolder%2Fimage.png/content")).toBe(true);
		});

		test("should return false for attachment metadata path", () => {
			expect(isPublicPath("/api/attachments/default%3Aimage.jpg")).toBe(false);
		});

		test("should return false for attachment changes path", () => {
			expect(isPublicPath("/api/attachments/changes")).toBe(false);
		});

		test("should return false for docs path", () => {
			expect(isPublicPath("/api/docs/test-doc")).toBe(false);
		});

		test("should return false for content path with extra segments", () => {
			expect(isPublicPath("/api/attachments/id/content/extra")).toBe(false);
		});

		test("should return true for auth new path", () => {
			expect(isPublicPath("/api/auth/new")).toBe(true);
		});
	});
});
