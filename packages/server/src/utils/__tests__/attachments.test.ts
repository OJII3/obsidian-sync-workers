import { describe, expect, test } from "bun:test";
import {
	generateAttachmentId,
	generateHash,
	generateR2Key,
	getExtension,
	parseAttachmentId,
	validateAttachmentPath,
} from "../attachments";

describe("attachments utils", () => {
	test("generateHash should return SHA-256 hex", async () => {
		const data = new TextEncoder().encode("hello").buffer;
		const hash = await generateHash(data);
		expect(hash).toBe("2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824");
	});

	test("validateAttachmentPath should accept safe relative paths", () => {
		const valid = ["images/photo.png", "docs/report.pdf", "assets/icons/icon-1.svg"];
		for (const path of valid) {
			expect(validateAttachmentPath(path)).toBe(true);
		}
	});

	test("validateAttachmentPath should reject traversal and absolute paths", () => {
		const invalid = ["", "   ", "/etc/passwd", "\\windows\\system32", "../secret.txt", "a/../b"];
		for (const path of invalid) {
			expect(validateAttachmentPath(path)).toBe(false);
		}
	});

	test("getExtension should return lowercase extension", () => {
		expect(getExtension("archive.tar.gz")).toBe(".gz");
		expect(getExtension("photo.JPG")).toBe(".jpg");
		expect(getExtension("README")).toBe("");
	});

	test("generateAttachmentId and generateR2Key should include normalized extension", () => {
		const id = generateAttachmentId("vault1", "abc123", "IMG.PNG");
		const key = generateR2Key("vault1", "abc123", "IMG.PNG");
		expect(id).toBe("vault1:abc123.png");
		expect(key).toBe("vault1/abc123.png");
	});

	test("parseAttachmentId should extract vault and hash+ext", () => {
		expect(parseAttachmentId("vault1:hash.png")).toEqual({
			vaultId: "vault1",
			hashWithExt: "hash.png",
		});
		expect(parseAttachmentId("invalid")).toBeNull();
	});
});
