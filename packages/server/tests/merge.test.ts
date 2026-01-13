import { describe, expect, test } from "bun:test";
import { threeWayMerge } from "../src/utils/merge";

describe("threeWayMerge (server/tests)", () => {
	test("accepts identical changes on both sides", () => {
		const base = "line1\nline2";
		const local = "line1\nline2-updated";
		const remote = "line1\nline2-updated";

		const result = threeWayMerge(base, local, remote);
		expect(result.success).toBe(true);
		expect(result.content).toBe(local);
	});

	test("accepts a single-sided change", () => {
		const base = "line1\nline2";
		const local = "line1\nline2";
		const remote = "line1\nline2-remote";

		const result = threeWayMerge(base, local, remote);
		expect(result.success).toBe(true);
		expect(result.content).toBe(remote);
	});

	test("detects conflicting changes", () => {
		const base = "line1\nline2";
		const local = "line1\nline2-local";
		const remote = "line1\nline2-remote";

		const result = threeWayMerge(base, local, remote);
		expect(result.success).toBe(false);
		expect(result.conflicts?.length).toBeGreaterThan(0);
	});
});
