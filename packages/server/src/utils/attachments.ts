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
 * Generate attachment ID from vault ID and path
 */
export function generateAttachmentId(vaultId: string, path: string): string {
	return `${vaultId}:${path}`;
}

/**
 * Generate R2 key for attachment storage
 */
export function generateR2Key(vaultId: string, path: string, hash: string): string {
	return `${vaultId}/${hash}/${path}`;
}

/**
 * Maximum attachment size (100MB)
 */
export const MAX_ATTACHMENT_SIZE = 100 * 1024 * 1024;
