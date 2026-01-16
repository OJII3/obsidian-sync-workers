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
 * Captures: full match, path, optional alt text
 */
const WIKILINK_IMAGE_REGEX = new RegExp(
	`!\\[\\[([^\\]|]+(?:${EXTENSION_PATTERN}))(?:\\|([^\\]]+))?\\]\\]`,
	"gi",
);

/**
 * Regex to match Markdown image embeds with R2 URLs: ![alt](https://server/api/attachments/...)
 * Captures: alt text, full URL, encoded attachment ID
 */
const R2_URL_IMAGE_REGEX =
	/!\[([^\]]*)\]\((https?:\/\/[^)]+\/api\/attachments\/([^/]+)\/content[^)]*)\)/gi;

/**
 * Generate the R2 attachment URL for a given path
 */
export function generateAttachmentUrl(path: string, serverUrl: string, vaultId: string): string {
	const attachmentId = `${vaultId}:${path}`;
	const encodedId = encodeURIComponent(attachmentId);
	return `${serverUrl}/api/attachments/${encodedId}/content?vault_id=${encodeURIComponent(vaultId)}`;
}

/**
 * Extract the local path from an R2 attachment URL
 */
export function extractPathFromUrl(url: string, vaultId: string): string | null {
	// Match pattern: /api/attachments/{encodedId}/content
	const match = url.match(/\/api\/attachments\/([^/]+)\/content/);
	if (!match) return null;

	const encodedId = match[1];
	const attachmentId = decodeURIComponent(encodedId);

	// Remove vault prefix (vaultId:path -> path)
	const prefix = `${vaultId}:`;
	if (attachmentId.startsWith(prefix)) {
		return attachmentId.slice(prefix.length);
	}

	return attachmentId;
}

/**
 * Convert Obsidian Wikilinks image references to standard Markdown with R2 URLs
 * Used when pulling content from server (server → local)
 *
 * Example:
 *   ![[image.jpg]] → ![image.jpg](https://server/api/attachments/vaultId%3Aimage.jpg/content?vault_id=vaultId)
 *   ![[folder/image.jpg|alt text]] → ![alt text](https://server/api/attachments/vaultId%3Afolder%2Fimage.jpg/content?vault_id=vaultId)
 */
export function convertLocalPathsToRemoteUrls(
	content: string,
	serverUrl: string,
	vaultId: string,
): string {
	return content.replace(WIKILINK_IMAGE_REGEX, (match, path, altText) => {
		const url = generateAttachmentUrl(path, serverUrl, vaultId);
		const displayText = altText || path;
		return `![${displayText}](${url})`;
	});
}

/**
 * Convert standard Markdown image references with R2 URLs back to Obsidian Wikilinks
 * Used when pushing content to server (local → server)
 *
 * Example:
 *   ![image.jpg](https://server/api/attachments/vaultId%3Aimage.jpg/content?vault_id=vaultId) → ![[image.jpg]]
 *   ![alt text](https://server/api/attachments/vaultId%3Afolder%2Fimage.jpg/content?vault_id=vaultId) → ![[folder/image.jpg|alt text]]
 */
export function convertRemoteUrlsToLocalPaths(
	content: string,
	serverUrl: string,
	vaultId: string,
): string {
	return content.replace(R2_URL_IMAGE_REGEX, (match, altText, fullUrl, encodedId) => {
		// Only convert URLs that match our server
		if (!fullUrl.startsWith(serverUrl)) {
			return match;
		}

		const path = extractPathFromUrl(fullUrl, vaultId);
		if (!path) {
			return match;
		}

		// If alt text is different from path, include it
		if (altText && altText !== path) {
			return `![[${path}|${altText}]]`;
		}

		return `![[${path}]]`;
	});
}

/**
 * Check if content contains any Wikilinks image references that need conversion
 */
export function hasLocalImageReferences(content: string): boolean {
	WIKILINK_IMAGE_REGEX.lastIndex = 0; // Reset regex state
	return WIKILINK_IMAGE_REGEX.test(content);
}

/**
 * Check if content contains any R2 URL image references
 */
export function hasRemoteImageReferences(content: string, serverUrl: string): boolean {
	R2_URL_IMAGE_REGEX.lastIndex = 0; // Reset regex state
	const matches = content.match(R2_URL_IMAGE_REGEX);
	if (!matches) return false;

	// Check if any match is from our server
	return matches.some((m) => m.includes(serverUrl));
}
