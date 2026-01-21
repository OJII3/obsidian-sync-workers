export interface AuthContext {
	request: Request;
	set: { status?: number | string };
	env?: { API_KEY?: string };
}

/**
 * Simple API key authentication middleware for Elysia
 * Checks for API key in Authorization header only
 * Query parameter API keys are NOT allowed for security reasons
 */
export async function requireAuth(context: AuthContext): Promise<boolean> {
	const { request, set, env } = context;

	const expectedKey = env?.API_KEY;
	if (!expectedKey) {
		set.status = 500;
		return false;
	}

	// Check Authorization header only
	const authHeader = request.headers.get("Authorization");
	if (authHeader) {
		const token = authHeader.replace("Bearer ", "");
		// Use constant-time comparison to prevent timing attacks
		if (timingSafeEqual(token, expectedKey)) {
			return true;
		}
	}

	// Unauthorized
	set.status = 401;
	return false;
}

/**
 * Helper to create an auth error response
 */
export function authErrorResponse(status?: number | string) {
	if (Number(status) === 500) {
		return {
			error: "Server misconfiguration",
			message: "API_KEY environment variable is not configured.",
		};
	}
	return { error: "Unauthorized", message: "Valid API key required in Authorization header" };
}

/**
 * Check if a path should skip authentication.
 * Public paths include:
 * - /api/attachments/:id/content - Attachment content for direct browser access
 *
 * Security considerations:
 * - Attachment content is publicly accessible to allow browsers/markdown renderers
 *   to load images without Authorization headers
 * - Attachment IDs are predictable (vaultId:path format), so URLs can be guessed
 *   if the vault ID and file path are known
 * - Cross-vault access is prevented by validating that the ID's vault prefix
 *   matches the vault_id query parameter in attachmentContentHandler
 * - For sensitive content, consider implementing signed URLs with expiration
 */
export function isPublicPath(path: string): boolean {
	// Attachment content endpoints are public (accessed directly by browsers/markdown renderers)
	if (/^\/api\/attachments\/[^/]+\/content$/.test(path)) {
		return true;
	}
	return false;
}

/**
 * Constant-time string comparison to prevent timing attacks.
 * Uses XOR-based comparison to ensure comparison time is independent of content.
 */
export function timingSafeEqual(a: string, b: string): boolean {
	const encoder = new TextEncoder();
	const aBytes = encoder.encode(a);
	const bBytes = encoder.encode(b);

	if (aBytes.length !== bBytes.length) {
		return false;
	}

	let result = 0;
	for (let i = 0; i < aBytes.length; i++) {
		result |= aBytes[i] ^ bBytes[i];
	}
	return result === 0;
}
