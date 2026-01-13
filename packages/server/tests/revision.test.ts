import { describe, expect, test } from "bun:test";
import { generateRevision, isNewerRevision } from "../src/utils/revision";

describe("revision utils (server/tests)", () => {
	test("increments generation when given the same previous revision", () => {
		const previous = "3-abc123";
		const next = generateRevision(previous);
		expect(next).toMatch(/^4-[a-z0-9]+$/);
	});

	test("treats same-generation revisions as not newer (conflict scenario)", () => {
		const local = "5-localhash";
		const remote = "5-remotehash";
		expect(isNewerRevision(remote, local)).toBe(false);
	});
});
