import { env as cfEnv } from "cloudflare:workers";
import { Elysia } from "elysia";
import { adminRoutes } from "./routes/admin";
import { attachmentsRoutes } from "./routes/attachments";
import { changesRoutes } from "./routes/changes";
import { bulkDocsRoute, docsRoutes } from "./routes/docs";
import { healthHandler } from "./routes/health";
import { statusHandler } from "./routes/status";
import type { Env } from "./types";
import { authErrorResponse, isPublicPath, requireAuth } from "./utils/auth";

const env = cfEnv as Env;

const app = new Elysia({ aot: false })
	// CORS middleware - configurable via CORS_ORIGIN env var
	.onRequest(({ set }) => {
		const allowedOrigin = env.CORS_ORIGIN || "*";
		set.headers = {
			"Access-Control-Allow-Origin": allowedOrigin,
			"Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
			"Access-Control-Allow-Headers":
				"Content-Type, Authorization, X-Content-Hash, X-Content-Length",
			"Access-Control-Expose-Headers":
				"Content-Type, X-Content-Hash, X-Content-Length, X-Attachment-Hash",
		};
	})
	// Authentication middleware - applies to all /api/* routes
	.onBeforeHandle(({ request, set, path }) => {
		// Skip auth for health check endpoint and OPTIONS requests
		if (path === "/" || request.method === "OPTIONS") {
			return;
		}

		// Skip auth for public paths (e.g., attachment content for direct browser access)
		if (isPublicPath(path)) {
			return;
		}

		// Apply auth to all API routes
		if (path.startsWith("/api")) {
			const isAuthorized = requireAuth({ request, set, env });
			if (!isAuthorized) {
				return authErrorResponse(set.status);
			}
		}
	})
	// Handle OPTIONS requests for CORS preflight
	.options("/*", () => new Response(null, { status: 204 }))
	// Health check
	.get("/", healthHandler())
	// Lightweight status endpoint for efficient polling
	.get("/api/status", statusHandler(env))
	// API routes using plugins
	.group("/api", (app) =>
		app
			.use(changesRoutes(env))
			.use(docsRoutes(env))
			.use(attachmentsRoutes(env))
			.use(adminRoutes(env)),
	)
	// Alternative bulk docs path
	.use(bulkDocsRoute(env))
	// 404 handler
	.onError(({ code, error, set }) => {
		if (code === "NOT_FOUND") {
			set.status = 404;
			return { error: "Not found" };
		}

		console.error("Error:", error);
		set.status = 500;
		return {
			error: "Internal server error",
			message: error instanceof Error ? error.message : "Unknown error",
		};
	})
	.compile();

export default app;
