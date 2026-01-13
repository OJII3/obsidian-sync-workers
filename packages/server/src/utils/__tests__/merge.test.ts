import { describe, expect, test } from "bun:test";
import { threeWayMerge } from "../merge";

describe("threeWayMerge", () => {
	describe("simple cases", () => {
		test("should return local when local and remote are identical", () => {
			const base = "line1\nline2\nline3";
			const local = "line1\nmodified\nline3";
			const remote = "line1\nmodified\nline3";

			const result = threeWayMerge(base, local, remote);
			expect(result.success).toBe(true);
			expect(result.content).toBe(local);
		});

		test("should return remote when local unchanged", () => {
			const base = "line1\nline2\nline3";
			const local = "line1\nline2\nline3";
			const remote = "line1\nmodified\nline3";

			const result = threeWayMerge(base, local, remote);
			expect(result.success).toBe(true);
			expect(result.content).toBe(remote);
		});

		test("should return local when remote unchanged", () => {
			const base = "line1\nline2\nline3";
			const local = "line1\nmodified\nline3";
			const remote = "line1\nline2\nline3";

			const result = threeWayMerge(base, local, remote);
			expect(result.success).toBe(true);
			expect(result.content).toBe(local);
		});
	});

	describe("non-conflicting changes", () => {
		test("should merge changes at different locations", () => {
			const base = "line1\nline2\nline3\nline4\nline5";
			const local = "line1\nlocal-change\nline3\nline4\nline5";
			const remote = "line1\nline2\nline3\nremote-change\nline5";

			const result = threeWayMerge(base, local, remote);
			expect(result.success).toBe(true);
			expect(result.content).toBe("line1\nlocal-change\nline3\nremote-change\nline5");
		});

		test("should handle additions in local", () => {
			const base = "line1\nline2";
			const local = "line1\nline2\nline3";
			const remote = "line1\nline2";

			const result = threeWayMerge(base, local, remote);
			expect(result.success).toBe(true);
			expect(result.content).toBe(local);
		});

		test("should handle additions in remote", () => {
			const base = "line1\nline2";
			const local = "line1\nline2";
			const remote = "line1\nline2\nline3";

			const result = threeWayMerge(base, local, remote);
			expect(result.success).toBe(true);
			expect(result.content).toBe(remote);
		});

		test("should handle deletions in local", () => {
			const base = "line1\nline2\nline3";
			const local = "line1\nline3";
			const remote = "line1\nline2\nline3";

			const result = threeWayMerge(base, local, remote);
			expect(result.success).toBe(true);
			expect(result.content).toBe(local);
		});

		test("should handle deletions in remote", () => {
			const base = "line1\nline2\nline3";
			const local = "line1\nline2\nline3";
			const remote = "line1\nline3";

			const result = threeWayMerge(base, local, remote);
			expect(result.success).toBe(true);
			expect(result.content).toBe(remote);
		});
	});

	describe("identical changes (no conflict)", () => {
		test("should accept when both made the same change", () => {
			const base = "line1\noriginal\nline3";
			const local = "line1\nchanged\nline3";
			const remote = "line1\nchanged\nline3";

			const result = threeWayMerge(base, local, remote);
			expect(result.success).toBe(true);
			expect(result.content).toBe("line1\nchanged\nline3");
		});
	});

	describe("conflicting changes", () => {
		test("should detect conflict when same line changed differently", () => {
			const base = "line1\noriginal\nline3";
			const local = "line1\nlocal-change\nline3";
			const remote = "line1\nremote-change\nline3";

			const result = threeWayMerge(base, local, remote);
			expect(result.success).toBe(false);
			expect(result.conflicts).toBeDefined();
			expect(result.conflicts?.length).toBeGreaterThan(0);
		});

		test("should provide conflict details", () => {
			const base = "line1\noriginal\nline3";
			const local = "line1\nlocal-change\nline3";
			const remote = "line1\nremote-change\nline3";

			const result = threeWayMerge(base, local, remote);
			expect(result.success).toBe(false);
			expect(result.conflicts).toBeDefined();

			const conflict = result.conflicts?.[0];
			expect(conflict?.local).toContain("local-change");
			expect(conflict?.remote).toContain("remote-change");
		});
	});

	describe("empty content handling", () => {
		test("should handle empty base", () => {
			const base = "";
			const local = "new content";
			const remote = "";

			const result = threeWayMerge(base, local, remote);
			expect(result.success).toBe(true);
			expect(result.content).toBe(local);
		});

		test("should handle all empty content", () => {
			const result = threeWayMerge("", "", "");
			expect(result.success).toBe(true);
			expect(result.content).toBe("");
		});
	});

	describe("security limits", () => {
		test("should reject content exceeding size limit", () => {
			const hugeContent = "a".repeat(11 * 1024 * 1024); // 11MB

			const result = threeWayMerge(hugeContent, "", "");
			expect(result.success).toBe(false);
			expect(result.error).toContain("exceeds maximum size limit");
		});

		test("should reject content exceeding line count limit", () => {
			const manyLines = Array(10001).fill("line").join("\n"); // 10001 lines

			const result = threeWayMerge(manyLines, "", "");
			expect(result.success).toBe(false);
			expect(result.error).toContain("exceeds maximum line count");
		});

		test("should accept content within limits", () => {
			const validContent = Array(100).fill("line").join("\n");

			const result = threeWayMerge(validContent, validContent, validContent);
			expect(result.success).toBe(true);
		});
	});

	describe("multiline changes", () => {
		test("should handle multiple line additions", () => {
			const base = "header\nfooter";
			const local = "header\nfooter";
			const remote = "header\nnew line 1\nnew line 2\nfooter";

			const result = threeWayMerge(base, local, remote);
			expect(result.success).toBe(true);
			expect(result.content).toBe(remote);
		});

		test("should handle multiple line deletions", () => {
			const base = "header\nline1\nline2\nline3\nfooter";
			const local = "header\nfooter";
			const remote = "header\nline1\nline2\nline3\nfooter";

			const result = threeWayMerge(base, local, remote);
			expect(result.success).toBe(true);
			expect(result.content).toBe(local);
		});
	});
});
