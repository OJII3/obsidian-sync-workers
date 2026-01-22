import { describe, expect, test } from "bun:test";
import { getContentType, isAttachmentFile } from "../types";

describe("types helpers", () => {
	test("isAttachmentFile should detect known extensions", () => {
		expect(isAttachmentFile("image.PNG")).toBe(true);
		expect(isAttachmentFile("archive.zip")).toBe(true);
		expect(isAttachmentFile("note.md")).toBe(false);
	});

	test("getContentType should map known extensions", () => {
		expect(getContentType("song.MP3")).toBe("audio/mpeg");
		expect(getContentType("font.ttf")).toBe("font/ttf");
		expect(getContentType("unknown.bin")).toBe("application/octet-stream");
	});
});
