import { serveStatic } from "@hono/node-server/serve-static";
import { Hono } from "hono";
import type { AgentConfig } from "../config/index.js";
import { identityMiddleware } from "./middleware/identity.js";
import { createSessionsRoutes } from "./routes/sessions.js";
import type { ServerAppContext, ServerDependencies } from "./types.js";

/**
 * Builds the Hono app without binding a network port.
 */
export function createApp(
	config: AgentConfig,
	deps: ServerDependencies,
): Hono<{ Variables: ServerAppContext & { identity: { login?: string; name?: string } } }> {
	const app = new Hono<{
		Variables: ServerAppContext & { identity: { login?: string; name?: string } };
	}>();

	app.use("*", async (context, next) => {
		context.set("config", config);
		context.set("deps", deps);
		const startedAt = Date.now();
		await next();
		deps.logger.info("http_request", {
			durationMs: Date.now() - startedAt,
			method: context.req.method,
			path: context.req.path,
			status: context.res.status,
		});
	});

	app.use("*", identityMiddleware);
	app.get("/health", (context) => context.json({ ok: true }));

	app.get("/ui", (context) => context.redirect("/ui/"));
	app.use(
		"/ui/*",
		serveStatic({
			rewriteRequestPath: (path) => path.replace(/^\/ui\//, ""),
			root: "./public",
		}),
	);

	app.route("/api/sessions", createSessionsRoutes());

	return app;
}
