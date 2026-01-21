import { describe, expect, test } from "bun:test";
import {
	type AuthContext,
	authErrorResponse,
	hashApiKey,
	isPublicPath,
	requireAuth,
	timingSafeEqual,
} from "../auth";

function createMockContext(options: {
	authHeader?: string | null;
	apiKey?: string | null;
	hasEnv?: boolean;
}): AuthContext {
	const headers = new Headers();
	if (options.authHeader) {
		headers.set("Authorization", options.authHeader);
	}

	const request = new Request("http://localhost/test", { headers });
	const set: { status: number | string } = { status: 200 };
	const env =
		options.hasEnv === false ? undefined : options.apiKey ? { API_KEY: options.apiKey } : undefined;

	return { request, set, env };
}

describe("auth", () => {
	describe("requireAuth", () => {
		test("should return false when no API key is configured", async () => {
			const context = createMockContext({ apiKey: null });
			expect(await requireAuth(context)).toBe(false);
			expect(context.set.status).toBe(500);
		});

		test("should return true with valid Bearer token", async () => {
			const apiKey = "secret-key";
			const context = createMockContext({
				apiKey,
				authHeader: `Bearer ${apiKey}`,
			});
			expect(await requireAuth(context)).toBe(true);
		});

		test("should return false with invalid Bearer token", async () => {
			const context = createMockContext({
				apiKey: "secret-key",
				authHeader: "Bearer wrong-key",
			});
			expect(await requireAuth(context)).toBe(false);
			expect(context.set.status).toBe(401);
		});

		test("should return false with no auth header when API key is required", async () => {
			const context = createMockContext({
				apiKey: "secret-key",
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
			const apiKey = "secret-key";
			const context = createMockContext({
				apiKey,
				authHeader: apiKey,
			});
			// Without "Bearer " prefix, the token won't match because
			// the code does authHeader.replace("Bearer ", "")
			// If authHeader is "secret-key", it becomes "secret-key" (unchanged)
			// which equals the API key, so it should pass
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
			expect(response.message).toContain("API_KEY");
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

		test("should return false for auth path (removed)", () => {
			expect(isPublicPath("/api/auth/new")).toBe(false);
		});
	});

	describe("timingSafeEqual", () => {
		test("should return true for identical strings", () => {
			expect(timingSafeEqual("test", "test")).toBe(true);
		});

		test("should return false for different strings", () => {
			expect(timingSafeEqual("test", "different")).toBe(false);
		});

		test("should return false for strings with different lengths", () => {
			expect(timingSafeEqual("short", "longer-string")).toBe(false);
		});

		test("should return true for empty strings", () => {
			expect(timingSafeEqual("", "")).toBe(true);
		});

		test("should return false for one empty and one non-empty string", () => {
			expect(timingSafeEqual("", "non-empty")).toBe(false);
		});

		test("should handle long strings", () => {
			const long1 = "a".repeat(1000);
			const long2 = "a".repeat(1000);
			const long3 = `${"a".repeat(999)}b`;
			expect(timingSafeEqual(long1, long2)).toBe(true);
			expect(timingSafeEqual(long1, long3)).toBe(false);
		});
	});

	describe("hashApiKey", () => {
		test("should produce consistent hash for same input", async () => {
			const input = "test-api-key";
			const hash1 = await hashApiKey(input);
			const hash2 = await hashApiKey(input);
			expect(hash1).toBe(hash2);
		});

		test("should produce different hash for different input", async () => {
			const hash1 = await hashApiKey("key1");
			const hash2 = await hashApiKey("key2");
			expect(hash1).not.toBe(hash2);
		});

		test("should produce 64-character hex string for SHA-256", async () => {
			const hash = await hashApiKey("any-input");
			expect(hash).toMatch(/^[a-f0-9]{64}$/);
		});

		test("should handle empty string", async () => {
			const hash = await hashApiKey("");
			expect(hash).toMatch(/^[a-f0-9]{64}$/);
		});

		test("should handle unicode characters", async () => {
			const hash = await hashApiKey("こんにちは🔐");
			expect(hash).toMatch(/^[a-f0-9]{64}$/);
		});
	});
});
