import { Hono } from "hono";
import type { ServerAppContext } from "../types.js";

/**
 * Cron management REST routes.
 */
export function createCronRoutes(): Hono<{ Variables: ServerAppContext }> {
	const app = new Hono<{ Variables: ServerAppContext }>();

	app.get("/", (context) => {
		const cronService = context.var.deps.cronService;
		if (cronService === undefined) {
			return context.json([], 200);
		}
		return context.json(cronService.getStatus());
	});

	app.post("/:id/pause", (context) => {
		const cronService = context.var.deps.cronService;
		if (cronService === undefined) {
			return context.json({ error: "Cron service unavailable" }, 503);
		}
		const id = context.req.param("id");
		if (!cronService.pause(id)) {
			return context.json({ error: "Cron job not found" }, 404);
		}
		return context.json({ ok: true });
	});

	app.post("/:id/resume", (context) => {
		const cronService = context.var.deps.cronService;
		if (cronService === undefined) {
			return context.json({ error: "Cron service unavailable" }, 503);
		}
		const id = context.req.param("id");
		if (!cronService.resume(id)) {
			return context.json({ error: "Cron job not found" }, 404);
		}
		return context.json({ ok: true });
	});

	return app;
}
