import { serve, type ServerType } from "@hono/node-server";
import type { AgentConfig } from "../config/index.js";
import { createApp } from "./app.js";
import type { ServerDependencies } from "./types.js";
import { WsRuntime } from "./ws.js";

export interface RunningServer {
	app: ReturnType<typeof createApp>;
	close: () => Promise<void>;
	httpServer: ServerType;
	ws: WsRuntime;
}

/**
 * Starts HTTP and WebSocket services on the configured host/port.
 */
export async function startServer(
	config: AgentConfig,
	deps: ServerDependencies,
): Promise<RunningServer> {
	const app = createApp(config, deps);
	const ws = new WsRuntime(deps, {
		maxIterations: config.tools.maxIterations,
		retry: config.retry,
	});

	let httpServer!: ServerType;
	await new Promise<void>((resolve) => {
		httpServer = serve(
			{
				fetch: app.fetch,
				hostname: config.server.host,
				port: config.server.port,
			},
			() => resolve(),
		);
	});

	httpServer.on("upgrade", (request, socket) => {
		if (!ws.attachUpgradeHandler(request, socket)) {
			socket.destroy();
		}
	});

	let closed = false;
	const close = async (): Promise<void> => {
		if (closed) {
			return;
		}
		closed = true;
		await ws.close();
		await new Promise<void>((resolve, reject) => {
			httpServer.close((error) => {
				if (error !== undefined) {
					reject(error);
					return;
				}
				resolve();
			});
		});
	};

	const shutdown = (): void => {
		void close();
	};

	process.on("SIGINT", shutdown);
	process.on("SIGTERM", shutdown);

	deps.logger.info("server_started", {
		host: config.server.host,
		port: config.server.port,
	});

	return {
		app,
		close: async () => {
			process.off("SIGINT", shutdown);
			process.off("SIGTERM", shutdown);
			await close();
		},
		httpServer,
		ws,
	};
}
