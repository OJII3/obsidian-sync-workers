import type { Env } from "../types";

/**
 * Simple API key authentication middleware for Elysia
 * Checks for API key in Authorization header only
 * Query parameter API keys are NOT allowed for security reasons
 */
export function requireAuth(context: { request: Request; set: any; env?: Env }): boolean {
	const { request, set, env } = context;

	if (!env) {
		set.status = 500;
		return false;
	}

	const apiKey = env.API_KEY;

	// If no API key is configured, allow all requests
	if (!apiKey) {
		return true;
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
export function authErrorResponse() {
	return { error: "Unauthorized", message: "Valid API key required in Authorization header" };
}
