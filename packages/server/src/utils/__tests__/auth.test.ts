import { describe, expect, test } from "bun:test";
import { type AuthContext, authErrorResponse, isPublicPath, requireAuth } from "../auth";

function createMockContext(options: {
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
	const env = options.hasEnv === false ? undefined : { API_KEY: options.apiKey ?? "" };

	return { request, set, env };
}

describe("auth", () => {
	describe("requireAuth", () => {
		test("should return false when no API key is configured", () => {
			const context = createMockContext({ apiKey: undefined });
			expect(requireAuth(context)).toBe(false);
			expect(context.set.status).toBe(500);
		});

		test("should return false when no API key is configured (empty string)", () => {
			const context = createMockContext({ apiKey: "" });
			expect(requireAuth(context)).toBe(false);
			expect(context.set.status).toBe(500);
		});

		test("should return false when API key is whitespace only", () => {
			const context = createMockContext({ apiKey: "   " });
			expect(requireAuth(context)).toBe(false);
			expect(context.set.status).toBe(500);
		});

		test("should return true with valid Bearer token", () => {
			const context = createMockContext({
				apiKey: "secret-key",
				authHeader: "Bearer secret-key",
			});
			expect(requireAuth(context)).toBe(true);
		});

		test("should return false with invalid Bearer token", () => {
			const context = createMockContext({
				apiKey: "secret-key",
				authHeader: "Bearer wrong-key",
			});
			expect(requireAuth(context)).toBe(false);
			expect(context.set.status).toBe(401);
		});

		test("should return false with no auth header when API key is required", () => {
			const context = createMockContext({
				apiKey: "secret-key",
				authHeader: null,
			});
			expect(requireAuth(context)).toBe(false);
			expect(context.set.status).toBe(401);
		});

		test("should return false when env is not provided", () => {
			const context = createMockContext({ hasEnv: false });
			expect(requireAuth(context)).toBe(false);
			expect(context.set.status).toBe(500);
		});

		test("should handle token without Bearer prefix", () => {
			const context = createMockContext({
				apiKey: "secret-key",
				authHeader: "secret-key",
			});
			// Without "Bearer " prefix, the token won't match because
			// the code does authHeader.replace("Bearer ", "")
			// If authHeader is "secret-key", it becomes "secret-key" (unchanged)
			// which equals the API key, so it should pass
			expect(requireAuth(context)).toBe(true);
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
	});
});
