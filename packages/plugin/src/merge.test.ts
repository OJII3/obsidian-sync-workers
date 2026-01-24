import { describe, expect, test } from "bun:test";
import { threeWayMerge } from "./merge";

describe("threeWayMerge", () => {
	describe("trivial cases", () => {
		test("returns local when local equals remote", () => {
			const base = "line1\nline2";
			const local = "line1\nline2\nline3";
			const remote = "line1\nline2\nline3";

			const result = threeWayMerge(base, local, remote);
			expect(result.success).toBe(true);
			expect(result.content).toBe(local);
		});

		test("returns remote when local equals base (no local changes)", () => {
			const base = "line1\nline2";
			const local = "line1\nline2";
			const remote = "line1\nline2\nline3";

			const result = threeWayMerge(base, local, remote);
			expect(result.success).toBe(true);
			expect(result.content).toBe(remote);
		});

		test("returns local when remote equals base (no remote changes)", () => {
			const base = "line1\nline2";
			const local = "line1\nline2\nline3";
			const remote = "line1\nline2";

			const result = threeWayMerge(base, local, remote);
			expect(result.success).toBe(true);
			expect(result.content).toBe(local);
		});
	});

	describe("non-overlapping changes", () => {
		test("merges changes at different lines", () => {
			const base = "line1\nline2\nline3";
			const local = "lineA\nline2\nline3"; // changed line 1
			const remote = "line1\nline2\nlineC"; // changed line 3

			const result = threeWayMerge(base, local, remote);
			expect(result.success).toBe(true);
			expect(result.content).toBe("lineA\nline2\nlineC");
		});

		test("merges insertions at different positions", () => {
			const base = "line1\nline2\nline3";
			const local = "line0\nline1\nline2\nline3"; // added at beginning
			const remote = "line1\nline2\nline3\nline4"; // added at end

			const result = threeWayMerge(base, local, remote);
			expect(result.success).toBe(true);
			expect(result.content).toBe("line0\nline1\nline2\nline3\nline4");
		});

		test("merges deletion and modification at different lines", () => {
			const base = "line1\nline2\nline3\nline4";
			const local = "line1\nline3\nline4"; // deleted line 2
			const remote = "line1\nline2\nline3\nlineD"; // changed line 4

			const result = threeWayMerge(base, local, remote);
			expect(result.success).toBe(true);
			expect(result.content).toBe("line1\nline3\nlineD");
		});
	});

	describe("overlapping changes (conflicts)", () => {
		test("detects conflict when same line changed differently", () => {
			const base = "line1\nline2\nline3";
			const local = "lineA\nline2\nline3"; // changed line 1 to A
			const remote = "lineB\nline2\nline3"; // changed line 1 to B

			const result = threeWayMerge(base, local, remote);
			expect(result.success).toBe(false);
			expect(result.conflicts).toBeDefined();
			expect(result.conflicts?.length).toBeGreaterThan(0);
		});

		test("detects conflict when overlapping ranges changed", () => {
			const base = "line1\nline2\nline3\nline4\nline5";
			const local = "lineA\nlineB\nline3\nline4\nline5"; // changed lines 1-2
			const remote = "line1\nlineC\nlineD\nline4\nline5"; // changed lines 2-3

			const result = threeWayMerge(base, local, remote);
			expect(result.success).toBe(false);
			expect(result.conflicts).toBeDefined();
		});

		test("accepts identical changes (no conflict)", () => {
			const base = "line1\nline2\nline3";
			const local = "lineA\nline2\nline3"; // changed line 1 to A
			const remote = "lineA\nline2\nline3"; // also changed line 1 to A

			const result = threeWayMerge(base, local, remote);
			expect(result.success).toBe(true);
			expect(result.content).toBe("lineA\nline2\nline3");
		});
	});

	describe("edge cases", () => {
		test("handles empty base", () => {
			const base = "";
			const local = "new content";
			const remote = "";

			const result = threeWayMerge(base, local, remote);
			expect(result.success).toBe(true);
			expect(result.content).toBe("new content");
		});

		test("handles empty local and remote", () => {
			const base = "content";
			const local = "";
			const remote = "";

			const result = threeWayMerge(base, local, remote);
			expect(result.success).toBe(true);
			expect(result.content).toBe("");
		});

		test("handles single line files", () => {
			const base = "single";
			const local = "modified";
			const remote = "single";

			const result = threeWayMerge(base, local, remote);
			expect(result.success).toBe(true);
			expect(result.content).toBe("modified");
		});
	});

	describe("security limits", () => {
		test("rejects content exceeding size limit", () => {
			const hugeContent = "x".repeat(11 * 1024 * 1024); // 11MB
			const result = threeWayMerge(hugeContent, "small", "small");

			expect(result.success).toBe(false);
			expect(result.error).toContain("size limit");
		});

		test("rejects content exceeding line limit", () => {
			const manyLines = Array(2500).fill("line").join("\n"); // 2500 lines
			const result = threeWayMerge(manyLines, "small", "small");

			expect(result.success).toBe(false);
			expect(result.error).toContain("line count");
		});
	});

	describe("content preservation", () => {
		test("preserves leading content before changes", () => {
			const base = "header\n\nline1\nline2\nfooter";
			const local = "header\n\nlineA\nline2\nfooter"; // changed line1
			const remote = "header\n\nline1\nlineB\nfooter"; // changed line2

			const result = threeWayMerge(base, local, remote);
			expect(result.success).toBe(true);
			expect(result.content).toBe("header\n\nlineA\nlineB\nfooter");
		});

		test("preserves content between changes", () => {
			const base = "a\nb\nc\nd\ne\nf\ng";
			const local = "A\nb\nc\nd\ne\nf\ng"; // changed first line
			const remote = "a\nb\nc\nd\ne\nf\nG"; // changed last line

			const result = threeWayMerge(base, local, remote);
			expect(result.success).toBe(true);
			expect(result.content).toBe("A\nb\nc\nd\ne\nf\nG");
		});

		test("preserves trailing content after changes", () => {
			const base = "start\nchange-me\nend1\nend2";
			const local = "start\nchanged\nend1\nend2";
			const remote = "start\nchange-me\nend1\nend2";

			const result = threeWayMerge(base, local, remote);
			expect(result.success).toBe(true);
			expect(result.content).toBe("start\nchanged\nend1\nend2");
		});
	});
});
