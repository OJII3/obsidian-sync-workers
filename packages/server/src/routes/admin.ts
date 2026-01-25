import { Elysia } from "elysia";
import { Database } from "../db/queries";
import type { Env } from "../types";

export const adminRoutes = (env: Env) =>
	new Elysia({ prefix: "/admin" })
		.get("/stats", async () => {
			const db = new Database(env.DB);
			const stats = await db.getCleanupStats();
			return {
				ok: true,
				stats,
				timestamp: Date.now(),
			};
		})
		.post("/cleanup", async ({ query }) => {
			const maxAgeDays = Number.parseInt(query.max_age_days || "90", 10);

			if (Number.isNaN(maxAgeDays) || maxAgeDays < 1 || maxAgeDays > 365) {
				return {
					error: "Invalid max_age_days parameter (1-365)",
					status: 400,
				};
			}

			const db = new Database(env.DB);

			// Get stats before cleanup
			const statsBefore = await db.getCleanupStats();

			// Perform cleanup
			const result = await db.performFullCleanup(maxAgeDays);

			// Get stats after cleanup
			const statsAfter = await db.getCleanupStats();

			return {
				ok: true,
				cleanup: {
					maxAgeDays,
					deletedRevisions: result.deletedRevisions,
					deletedChanges: result.deletedChanges,
					deletedAttachmentChanges: result.deletedAttachmentChanges,
				},
				statsBefore,
				statsAfter,
				timestamp: Date.now(),
			};
		});
