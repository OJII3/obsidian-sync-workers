/**
 * AuthContext for the authentication middleware.
 * Note: env and API_KEY are optional here because:
 * - env may be undefined in test environments or when middleware is called without proper context
 * - This is separate from the main Env interface in types.ts where API_KEY is required for the worker
 */
export interface AuthContext {
	request: Request;
	set: { status?: number | string };
	env?: { API_KEY?: string };
}

/**
 * Simple API key authentication middleware for Elysia
 * Checks for API key in Authorization header only
 * Query parameter API keys are NOT allowed for security reasons
 *
 * Security: Both the received token and the expected key are hashed before comparison
 * to avoid plain-text comparison of secrets in memory.
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
		// Hash both values before comparison to avoid plain-text comparison in memory
		const tokenHash = await hashApiKey(token);
		const expectedHash = await hashApiKey(expectedKey);
		// Use constant-time comparison to prevent timing attacks
		if (timingSafeEqual(tokenHash, expectedHash)) {
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
 * Hash an API key using SHA-256.
 * Used to avoid plain-text comparison of secrets.
 */
export async function hashApiKey(key: string): Promise<string> {
	const data = new TextEncoder().encode(key);
	const digest = await crypto.subtle.digest("SHA-256", data);
	return Array.from(new Uint8Array(digest))
		.map((b) => b.toString(16).padStart(2, "0"))
		.join("");
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
