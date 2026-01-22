import { describe, expect, test } from "bun:test";
import {
	extractIdFromUrl,
	generateAttachmentId,
	generateAttachmentUrlFromId,
	getExtension,
	R2_URL_IMAGE_REGEX,
	WIKILINK_IMAGE_REGEX,
} from "../attachment-url";

describe("attachment-url", () => {
	test("WIKILINK_IMAGE_REGEX should match attachment wikilinks", () => {
		const text = "![[images/photo.jpg]] and ![[docs/manual.pdf|Manual]] and ![[note.md]]";
		const matches = [...text.matchAll(WIKILINK_IMAGE_REGEX)];
		expect(matches.length).toBe(2);
		expect(matches[0]?.[1]).toBe("images/photo.jpg");
		expect(matches[0]?.[2]).toBeUndefined();
		expect(matches[1]?.[1]).toBe("docs/manual.pdf");
		expect(matches[1]?.[2]).toBe("Manual");
	});

	test("WIKILINK_IMAGE_REGEX should be case-insensitive for extensions", () => {
		const text = "![[IMG.PNG]]";
		const matches = [...text.matchAll(WIKILINK_IMAGE_REGEX)];
		expect(matches.length).toBe(1);
		expect(matches[0]?.[1]).toBe("IMG.PNG");
	});

	test("R2_URL_IMAGE_REGEX should capture URL and encoded id", () => {
		const url = "https://example.com/api/attachments/vault%3Ahash.png/content?vault_id=default";
		const text = `![Alt](${url})`;
		const matches = [...text.matchAll(R2_URL_IMAGE_REGEX)];
		expect(matches.length).toBe(1);
		expect(matches[0]?.[1]).toBe("Alt");
		expect(matches[0]?.[2]).toBe(url);
		expect(matches[0]?.[3]).toBe("vault%3Ahash.png");
	});

	test("generateAttachmentUrlFromId should encode id and vault", () => {
		const url = generateAttachmentUrlFromId(
			"vault:hash+1.png",
			"https://example.com",
			"default vault",
		);
		expect(url).toBe(
			"https://example.com/api/attachments/vault%3Ahash%2B1.png/content?vault_id=default%20vault",
		);
	});

	test("extractIdFromUrl should decode attachment id", () => {
		const url = generateAttachmentUrlFromId("vault:hash+1.png", "https://example.com", "default");
		expect(extractIdFromUrl(url)).toBe("vault:hash+1.png");
		expect(extractIdFromUrl("https://example.com/other/path")).toBeNull();
	});

	test("getExtension and generateAttachmentId should normalize extension", () => {
		expect(getExtension("PHOTO.JPEG")).toBe(".jpeg");
		expect(generateAttachmentId("vault", "abc", "PHOTO.JPEG")).toBe("vault:abc.jpeg");
	});
});
