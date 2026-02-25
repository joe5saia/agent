import { serveStatic } from "@hono/node-server/serve-static";
import { Hono } from "hono";
import type { AgentConfig } from "../config/index.js";
import { identityMiddleware } from "./middleware/identity.js";
import { agentApiPath, serverPaths } from "./paths.js";
import { createCronRoutes } from "./routes/cron.js";
import { createSessionsRoutes } from "./routes/sessions.js";
import { createWorkflowsRoutes } from "./routes/workflows.js";
import type { ServerAppContext, ServerDependencies } from "./types.js";

type ConfigProvider = AgentConfig | (() => AgentConfig);

function resolveConfig(provider: ConfigProvider): AgentConfig {
	return typeof provider === "function" ? provider() : provider;
}

/**
 * Builds the Hono app without binding a network port.
 */
export function createApp(
	configProvider: ConfigProvider,
	deps: ServerDependencies,
): Hono<{ Variables: ServerAppContext & { identity: { login?: string; name?: string } } }> {
	const app = new Hono<{
		Variables: ServerAppContext & { identity: { login?: string; name?: string } };
	}>();

	app.use("*", async (context, next) => {
		context.set("config", resolveConfig(configProvider));
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
	app.get(serverPaths.health, (context) => context.json({ ok: true }));

	app.get(serverPaths.ui, (context) => context.redirect(`${serverPaths.ui}/`));
	app.use(
		`${serverPaths.ui}/*`,
		serveStatic({
			rewriteRequestPath: (path) => path.replace(/^\/agent\//, ""),
			root: "./public",
		}),
	);

	app.route(agentApiPath("/sessions"), createSessionsRoutes());
	app.route(agentApiPath("/cron"), createCronRoutes());
	app.route(agentApiPath("/workflows"), createWorkflowsRoutes());

	return app;
}
