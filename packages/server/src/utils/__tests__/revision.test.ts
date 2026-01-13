import { describe, expect, test } from "bun:test";
import { generateRevision, isNewerRevision, isValidRevision } from "../revision";

describe("revision", () => {
	describe("generateRevision", () => {
		test("should generate first revision when no previous revision", () => {
			const rev = generateRevision();
			expect(rev).toMatch(/^1-[a-z0-9]+$/);
		});

		test("should increment generation from previous revision", () => {
			const rev = generateRevision("1-abc123");
			expect(rev).toMatch(/^2-[a-z0-9]+$/);
		});

		test("should correctly increment multi-digit generations", () => {
			const rev = generateRevision("99-xyz789");
			expect(rev).toMatch(/^100-[a-z0-9]+$/);
		});

		test("should generate unique revisions", () => {
			const rev1 = generateRevision();
			const rev2 = generateRevision();
			expect(rev1).not.toBe(rev2);
		});
	});

	describe("isNewerRevision", () => {
		test("should return true when rev1 has higher generation", () => {
			expect(isNewerRevision("2-abc", "1-def")).toBe(true);
		});

		test("should return false when rev1 has lower generation", () => {
			expect(isNewerRevision("1-abc", "2-def")).toBe(false);
		});

		test("should return false when generations are equal", () => {
			expect(isNewerRevision("1-abc", "1-def")).toBe(false);
		});

		test("should handle large generation numbers", () => {
			expect(isNewerRevision("1000-abc", "999-def")).toBe(true);
		});
	});

	describe("isValidRevision", () => {
		test("should return true for valid revision format", () => {
			expect(isValidRevision("1-abc123")).toBe(true);
			expect(isValidRevision("99-xyz789abc")).toBe(true);
			expect(isValidRevision("1-a")).toBe(true);
		});

		test("should return false for invalid formats", () => {
			expect(isValidRevision("abc")).toBe(false);
			expect(isValidRevision("1")).toBe(false);
			expect(isValidRevision("-abc")).toBe(false);
			expect(isValidRevision("1-")).toBe(false);
			expect(isValidRevision("1-ABC")).toBe(false); // uppercase not allowed
			expect(isValidRevision("")).toBe(false);
		});

		test("should reject revision with special characters", () => {
			expect(isValidRevision("1-abc@123")).toBe(false);
			expect(isValidRevision("1-abc 123")).toBe(false);
		});
	});
});
