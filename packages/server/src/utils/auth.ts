export interface AuthContext {
	request: Request;
	set: { status?: number | string };
	env?: { API_KEY: string };
}

/**
 * Simple API key authentication middleware for Elysia
 * Checks for API key in Authorization header only
 * Query parameter API keys are NOT allowed for security reasons
 */
export function requireAuth(context: AuthContext): boolean {
	const { request, set, env } = context;

	if (!env) {
		set.status = 500;
		return false;
	}

	const apiKey = env.API_KEY?.trim();
	if (!apiKey) {
		set.status = 500;
		return false;
	}

	// Check Authorization header only
	const authHeader = request.headers.get("Authorization");
	if (authHeader) {
		const token = authHeader.replace("Bearer ", "");
		if (token === apiKey) {
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
			message: "API_KEY is required. Set API_KEY in the environment variables.",
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
