import { describe, expect, test } from "bun:test";
import { buildAuthHeaders } from "../auth";
import { DEFAULT_SETTINGS } from "../types";

describe("buildAuthHeaders", () => {
	test("should set Authorization header with trimmed API key", () => {
		const headers = buildAuthHeaders({ ...DEFAULT_SETTINGS, apiKey: "  test-key  " });
		expect(headers.get("Authorization")).toBe("Bearer test-key");
	});

	test("should preserve extra headers", () => {
		const headers = buildAuthHeaders(
			{ ...DEFAULT_SETTINGS, apiKey: "key" },
			{ "X-Extra": "1", Authorization: "Bearer old" },
		);
		expect(headers.get("X-Extra")).toBe("1");
		expect(headers.get("Authorization")).toBe("Bearer key");
	});

	test("should throw when API key is empty", () => {
		expect(() => buildAuthHeaders({ ...DEFAULT_SETTINGS, apiKey: "   " })).toThrow(
			"API key is required",
		);
	});
});
