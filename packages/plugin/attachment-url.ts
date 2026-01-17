import { ATTACHMENT_EXTENSIONS } from "./types";

/**
 * Build regex pattern for attachment extensions
 */
function buildExtensionPattern(): string {
	// Escape dots and join with |
	return ATTACHMENT_EXTENSIONS.map((ext) => ext.replace(".", "\\.")).join("|");
}

const EXTENSION_PATTERN = buildExtensionPattern();

/**
 * Regex to match Obsidian Wikilinks image embeds: ![[image.jpg]] or ![[image.jpg|alt]]
 * Based on Obsidian's internal link syntax: ![[path]] or ![[path|display]]
 */
export const WIKILINK_IMAGE_REGEX = new RegExp(
	`!\\[\\[([^|\\]]+(?:${EXTENSION_PATTERN}))(?:\\|([^\\]]+))?\\]\\]`,
	"gi",
);

/**
 * Regex to match Markdown image embeds with R2 URLs: ![alt](https://server/api/attachments/...)
 * Captures: alt text, full URL, encoded attachment ID
 */
export const R2_URL_IMAGE_REGEX =
	/!\[([^\]]*)\]\((https?:\/\/[^)]+\/api\/attachments\/([^/]+)\/content[^)]*)\)/g;

/**
 * Generate the R2 attachment URL from an attachment ID
 * ID format: {vaultId}:{hash}.{ext}
 */
export function generateAttachmentUrlFromId(
	attachmentId: string,
	serverUrl: string,
	vaultId: string,
): string {
	const encodedId = encodeURIComponent(attachmentId);
	return `${serverUrl}/api/attachments/${encodedId}/content?vault_id=${encodeURIComponent(vaultId)}`;
}

/**
 * Extract file extension from path
 */
export function getExtension(path: string): string {
	const lastDot = path.lastIndexOf(".");
	if (lastDot === -1) return "";
	return path.slice(lastDot).toLowerCase();
}

/**
 * Generate content-addressable attachment ID from hash and path
 * Format: {vaultId}:{hash}{extension}
 */
export function generateAttachmentId(vaultId: string, hash: string, path: string): string {
	const ext = getExtension(path);
	return `${vaultId}:${hash}${ext}`;
}

/**
 * Extract attachment ID from an R2 attachment URL
 */
export function extractIdFromUrl(url: string): string | null {
	// Match pattern: /api/attachments/{encodedId}/content
	const match = url.match(/\/api\/attachments\/([^/]+)\/content/);
	if (!match) return null;

	return decodeURIComponent(match[1]);
}
