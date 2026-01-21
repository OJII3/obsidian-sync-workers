import { env as cfEnv } from "cloudflare:workers";
import { Elysia } from "elysia";
import { adminCleanupHandler, adminStatsHandler } from "./routes/admin";
import {
	attachmentChangesHandler,
	attachmentContentHandler,
	attachmentMetaHandler,
	deleteAttachmentHandler,
	uploadAttachmentHandler,
} from "./routes/attachments";
import { authNewHandler } from "./routes/auth";
import { changesHandler, continuousChangesHandler } from "./routes/changes";
import { bulkDocsHandler, deleteDocHandler, getDocHandler, putDocHandler } from "./routes/docs";
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
	.onBeforeHandle(async ({ request, set, path }) => {
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
			const isAuthorized = await requireAuth({ request, set, env });
			if (!isAuthorized) {
				return authErrorResponse(set.status);
			}
		}
	})
	// Handle OPTIONS requests for CORS preflight
	.options("/*", () => {
		return new Response(null, { status: 204 });
	});

app.get("/", healthHandler());

// Lightweight status endpoint for efficient polling
app.get("/api/status", statusHandler(env));

// API key initialization (protected by Cloudflare Access)
app.post("/api/auth/new", authNewHandler(env));

app.group("/api/changes", (app) =>
	app.get("/", changesHandler(env)).get("/continuous", continuousChangesHandler()),
);

app.group("/api/docs", (app) =>
	app
		// Get a single document
		.get("/:id", getDocHandler(env))
		// Create or update a document
		.put("/:id", putDocHandler(env))
		// Delete a document
		.delete("/:id", deleteDocHandler(env))
		// Bulk document operations
		.post("/bulk_docs", bulkDocsHandler(env)),
);

// Alternative bulk docs path
app.post("/api/_bulk_docs", bulkDocsHandler(env));

app.group("/api/attachments", (app) =>
	app
		// Get attachment changes
		.get("/changes", attachmentChangesHandler(env))
		// Get attachment metadata by ID
		.get("/:id", attachmentMetaHandler(env))
		// Download attachment content
		.get("/:id/content", attachmentContentHandler(env))
		// Upload attachment (path is the original file path for reference)
		.put("/:path", uploadAttachmentHandler(env))
		// Delete attachment by ID (content-addressable ID format: vaultId:hash.ext)
		.delete("/:id", deleteAttachmentHandler(env)),
);

app.group("/api/admin", (app) =>
	app
		// Get database statistics
		.get("/stats", adminStatsHandler(env))
		// Cleanup old data
		.post("/cleanup", adminCleanupHandler(env)),
);

app
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
