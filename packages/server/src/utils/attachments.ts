/**
 * Generate SHA-256 hash from ArrayBuffer
 */
export async function generateHash(data: ArrayBuffer): Promise<string> {
	const hashBuffer = await crypto.subtle.digest("SHA-256", data);
	const hashArray = Array.from(new Uint8Array(hashBuffer));
	return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Validate attachment path to prevent directory traversal attacks
 */
export function validateAttachmentPath(path: string): boolean {
	// Reject empty paths
	if (!path || path.trim() === "") {
		return false;
	}

	// Reject absolute paths
	if (path.startsWith("/") || path.startsWith("\\")) {
		return false;
	}

	// Reject paths containing ".." (directory traversal)
	if (path.includes("..")) {
		return false;
	}

	// Reject paths containing null bytes
	if (path.includes("\0")) {
		return false;
	}

	// Reject paths with suspicious patterns
	const suspiciousPatterns = [
		/^\.\./, // starts with ..
		/\/\.\./, // contains /..
		/\\\.\./, // contains \..
	];

	for (const pattern of suspiciousPatterns) {
		if (pattern.test(path)) {
			return false;
		}
	}

	return true;
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
 * Generate attachment ID from vault ID and hash (content-addressable)
 * Format: {vaultId}:{hash}{extension}
 * Example: myvault:a1b2c3d4e5f6.jpg
 */
export function generateAttachmentId(vaultId: string, hash: string, path: string): string {
	const ext = getExtension(path);
	return `${vaultId}:${hash}${ext}`;
}

/**
 * Generate R2 key for attachment storage (content-addressable)
 * Format: {vaultId}/{hash}{extension}
 * Example: myvault/a1b2c3d4e5f6.jpg
 */
export function generateR2Key(vaultId: string, hash: string, path: string): string {
	const ext = getExtension(path);
	return `${vaultId}/${hash}${ext}`;
}

/**
 * Parse attachment ID to extract vault ID and hash+extension
 * Returns null if invalid format
 */
export function parseAttachmentId(id: string): { vaultId: string; hashWithExt: string } | null {
	const colonIndex = id.indexOf(":");
	if (colonIndex === -1) return null;
	return {
		vaultId: id.slice(0, colonIndex),
		hashWithExt: id.slice(colonIndex + 1),
	};
}

/**
 * Maximum attachment size (100MB)
 */
export const MAX_ATTACHMENT_SIZE = 100 * 1024 * 1024;
