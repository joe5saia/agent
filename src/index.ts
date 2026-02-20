import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { getModels, getProviders, type Api, type Message, type Model } from "@mariozechner/pi-ai";
import {
	agentLoop,
	buildSystemPrompt,
	buildSystemPromptFromPrepared,
	prepareSystemPrompt,
	type PreparedSystemPrompt,
} from "./agent/index.js";
import { resolveApiKey } from "./auth/index.js";
import { loadConfig, watchConfig, type AgentConfig } from "./config/index.js";
import { loadCronJobs, CronService, type CronJobConfig } from "./cron/index.js";
import { createLogger } from "./logging/index.js";
import { RuntimeConfigProvider } from "./runtime/config-provider.js";
import { startServer, type RunningServer } from "./server/index.js";
import { assistantText, SessionManager, toSessionAppendInput } from "./sessions/index.js";
import { loadCliTools, registerBuiltinTools, ToolRegistry, type AgentTool } from "./tools/index.js";
import { WorkflowEngine, loadWorkflows } from "./workflows/index.js";

interface Paths {
	agentDir: string;
	configPath: string;
	cronDir: string;
	cronJobsPath: string;
	toolsPath: string;
	workflowsDir: string;
}

interface RuntimeState {
	config: AgentConfig;
	model: Model<Api>;
}

/**
 * Expands a path that starts with ~/.
 */
function expandHomePath(path: string): string {
	if (path === "~") {
		return homedir();
	}
	if (path.startsWith("~/")) {
		return join(homedir(), path.slice(2));
	}
	return path;
}

/**
 * Resolves file-system paths used by the runtime.
 */
function resolvePaths(): Paths {
	const agentDir = expandHomePath("~/.agent");
	const configPath = expandHomePath(process.env["AGENT_CONFIG_PATH"] ?? "~/.agent/config.yaml");
	const toolsPath = join(agentDir, "tools.yaml");
	const cronDir = join(agentDir, "cron");
	const cronJobsPath = join(cronDir, "jobs.yaml");
	const workflowsDir = join(agentDir, "workflows");
	return { agentDir, configPath, cronDir, cronJobsPath, toolsPath, workflowsDir };
}

/**
 * Resolves a configured provider/model name to a concrete pi-ai model.
 */
function resolveModel(providerName: string, modelName: string): Model<Api> {
	const providers = getProviders();
	if (!providers.includes(providerName as (typeof providers)[number])) {
		throw new Error(`Unknown model provider: ${providerName}`);
	}

	const provider = providerName as (typeof providers)[number];
	const model = getModels(provider).find(
		(candidate) => candidate.id === modelName || candidate.name === modelName,
	);
	if (model === undefined) {
		throw new Error(`Model not found for provider ${providerName}: ${modelName}`);
	}
	return model;
}

/**
 * Reads a required prompt from stdin.
 */
function readPromptFromStdin(): string {
	const prompt = readFileSync(0, "utf8").trim();
	if (prompt === "") {
		throw new Error("No prompt provided on stdin.");
	}
	return prompt;
}

/**
 * Reads stdin only when piped input is available.
 */
function readOptionalPromptFromStdin(): string | undefined {
	if (process.stdin.isTTY) {
		return undefined;
	}

	const prompt = readFileSync(0, "utf8").trim();
	return prompt === "" ? undefined : prompt;
}

/**
 * Builds the full runtime tool set from built-in, CLI, and workflow-backed tools.
 */
function buildRuntimeTools(
	config: AgentConfig,
	paths: Paths,
	workflowEngine: WorkflowEngine,
): Array<AgentTool> {
	const stagedRegistry = new ToolRegistry();
	registerBuiltinTools(stagedRegistry, config);
	for (const cliTool of loadCliTools(paths.toolsPath, {
		allowedEnv: config.security.allowedEnv,
	})) {
		stagedRegistry.register(cliTool);
	}
	stagedRegistry.registerWorkflowTools(workflowEngine.toTools());
	return stagedRegistry.list();
}

/**
 * Runs a single prompt turn from stdin and exits.
 */
async function runPromptMode(state: RuntimeState, paths: Paths, prompt: string): Promise<void> {
	const logger = createLogger("cli", state.config.logging);
	const registry = new ToolRegistry();
	registerBuiltinTools(registry, state.config);
	for (const cliTool of loadCliTools(paths.toolsPath, {
		allowedEnv: state.config.security.allowedEnv,
	})) {
		registry.register(cliTool);
	}

	const sessionManager = new SessionManager({
		compaction: state.config.compaction,
		contextWindow: state.model.contextWindow,
		defaultModel: state.config.model.name,
		sessionsDir: "~/.agent/sessions",
	});
	const session = await sessionManager.create();
	await sessionManager.appendMessage(session.id, {
		content: [{ text: prompt, type: "text" }],
		role: "user",
	});

	const contextMessages = await sessionManager.buildContextForRun(session.id);
	const systemPrompt = buildSystemPrompt(session, registry.list(), [], state.config);

	const beforeLength = contextMessages.length;
	const finalMessages = await agentLoop(contextMessages, registry, systemPrompt, state.model, {
		apiKeyResolver: resolveApiKey,
		logger,
		maxIterations: state.config.tools.maxIterations,
		onTurnComplete: (event) => {
			void sessionManager.recordTurnMetrics(session.id, event).catch(() => {
				return;
			});
		},
		sessionId: session.id,
	});
	for (const message of finalMessages.slice(beforeLength)) {
		const appendInput = toSessionAppendInput(message);
		if (appendInput !== undefined) {
			await sessionManager.appendMessage(session.id, appendInput);
		}
	}

	const finalAssistant = [...finalMessages]
		.reverse()
		.find(
			(message): message is Extract<Message, { role: "assistant" }> => message.role === "assistant",
		);
	if (finalAssistant !== undefined) {
		process.stdout.write(`${assistantText(finalAssistant)}\n`);
	}

	logger.info("cli_run_complete", { sessionId: session.id });
}

/**
 * Starts the long-running server runtime and wires hot-reload handlers.
 */
async function runServerMode(initialState: RuntimeState, paths: Paths): Promise<void> {
	const logger = createLogger("runtime", initialState.config.logging);
	const registry = new ToolRegistry();
	const sessionManager = new SessionManager({
		compaction: initialState.config.compaction,
		contextWindow: initialState.model.contextWindow,
		defaultModel: initialState.config.model.name,
		logger,
		sessionsDir: "~/.agent/sessions",
	});
	const state: RuntimeState = {
		config: initialState.config,
		model: initialState.model,
	};
	const configProvider = new RuntimeConfigProvider<AgentConfig>(initialState.config);

	mkdirSync(paths.agentDir, { recursive: true });
	mkdirSync(paths.cronDir, { recursive: true });
	mkdirSync(paths.workflowsDir, { recursive: true });

	let workflowEngine = new WorkflowEngine({
		apiKeyResolver: resolveApiKey,
		defaultMaxIterations: state.config.tools.maxIterations,
		logger,
		model: state.model,
		sessionManager,
		systemPromptBuilder: () => "You are executing a structured workflow.",
		toolRegistry: registry,
	});

	let cronService = new CronService({
		apiKeyResolver: resolveApiKey,
		defaultMaxIterations: state.config.tools.maxIterations,
		logger,
		model: state.model,
		sessionManager,
		systemPromptBuilder: () => "You are running a scheduled cron job.",
		toolRegistry: registry,
	});
	let preparedPrompt: PreparedSystemPrompt = prepareSystemPrompt([], [], state.config);
	let runningServer: RunningServer | undefined;
	let activeCronJobs: Array<CronJobConfig> = [];

	const deps = {
		apiKeyResolver: resolveApiKey,
		cronService,
		logger,
		model: state.model,
		sessionManager,
		systemPromptBuilder: (session: Awaited<ReturnType<SessionManager["get"]>>) =>
			buildSystemPromptFromPrepared(session, preparedPrompt),
		toolRegistry: registry,
		workflowEngine,
	};

	const restartServerWithFallback = async (
		currentServer: RunningServer,
		priorConfig: AgentConfig,
		nextConfig: AgentConfig,
		reason: string,
	): Promise<{ applied: boolean; server: RunningServer }> => {
		let candidateServer: RunningServer | undefined;
		try {
			candidateServer = await startServer(nextConfig, deps, { configProvider });
		} catch (error: unknown) {
			logger.warn("server_restart_prebind_failed", {
				error: error instanceof Error ? error.message : String(error),
				host: nextConfig.server.host,
				port: nextConfig.server.port,
				reason,
			});
		}

		if (candidateServer !== undefined) {
			try {
				await currentServer.close();
				return { applied: true, server: candidateServer };
			} catch (error: unknown) {
				await candidateServer.close().catch(() => {
					return;
				});
				throw new Error(
					`Failed to close previous server after prebinding replacement listener: ${
						error instanceof Error ? error.message : String(error)
					}`,
				);
			}
		}

		await currentServer.close();
		try {
			const restarted = await startServer(nextConfig, deps, { configProvider });
			return { applied: true, server: restarted };
		} catch (error: unknown) {
			try {
				const restored = await startServer(priorConfig, deps, { configProvider });
				logger.error("server_restart_rolled_back", {
					error: error instanceof Error ? error.message : String(error),
					host: nextConfig.server.host,
					port: nextConfig.server.port,
					reason,
				});
				return { applied: false, server: restored };
			} catch (restoreError: unknown) {
				throw new Error(
					[
						`Failed to bind new server listener: ${
							error instanceof Error ? error.message : String(error)
						}`,
						`Failed to restore prior listener: ${
							restoreError instanceof Error ? restoreError.message : String(restoreError)
						}`,
					].join("; "),
				);
			}
		}
	};

	const applyFromDisk = async (reason: string): Promise<boolean> => {
		let nextCronService: CronService | undefined;
		let cronSwitched = false;
		let serverSwitched = false;
		let priorConfigForRollback: AgentConfig | undefined;
		let priorCronServiceForRollback: CronService | undefined;
		let priorCronJobsForRollback: Array<CronJobConfig> | undefined;
		try {
			const priorConfig = state.config;
			const priorCronService = cronService;
			const priorCronJobs = activeCronJobs;
			priorConfigForRollback = priorConfig;
			priorCronServiceForRollback = priorCronService;
			priorCronJobsForRollback = priorCronJobs;
			const nextConfig = loadConfig(paths.configPath);
			const nextModel = resolveModel(nextConfig.model.provider, nextConfig.model.name);
			const nextWorkflowEngine = new WorkflowEngine({
				apiKeyResolver: resolveApiKey,
				defaultMaxIterations: nextConfig.tools.maxIterations,
				logger,
				model: nextModel,
				sessionManager,
				systemPromptBuilder: () => "You are executing a structured workflow.",
				toolRegistry: registry,
			});
			nextWorkflowEngine.setDefinitions(loadWorkflows(paths.workflowsDir));

			const nextTools = buildRuntimeTools(nextConfig, paths, nextWorkflowEngine);
			const nextPrompt = prepareSystemPrompt(nextTools, nextWorkflowEngine.list(), nextConfig);
			const nextCronJobs = loadCronJobs(paths.cronJobsPath);

			nextCronService = new CronService({
				apiKeyResolver: resolveApiKey,
				defaultMaxIterations: nextConfig.tools.maxIterations,
				logger,
				model: nextModel,
				sessionManager,
				systemPromptBuilder: () => "You are running a scheduled cron job.",
				toolRegistry: registry,
			});

			const hostChanged =
				priorConfig.server.host !== nextConfig.server.host ||
				priorConfig.server.port !== nextConfig.server.port;
			priorCronService.stop();
			cronSwitched = true;
			try {
				nextCronService.start(nextCronJobs);
			} catch (error: unknown) {
				throw new Error(
					`Failed to apply updated cron jobs: ${
						error instanceof Error ? error.message : String(error)
					}`,
				);
			}

			if (hostChanged && runningServer !== undefined) {
				// Known accepted behavior: after listener restart there can be a brief window where
				// the newly bound server serves with pre-commit runtime dependencies. We tolerate this
				// for now to keep reload rollback semantics simple and availability-first.
				const restartResult = await restartServerWithFallback(
					runningServer,
					priorConfig,
					nextConfig,
					reason,
				);
				runningServer = restartResult.server;
				if (!restartResult.applied) {
					throw new Error("Failed to apply updated server listener");
				}
				serverSwitched = true;
				logger.info("server_restarted", {
					host: nextConfig.server.host,
					port: nextConfig.server.port,
					reason,
				});
			}

			registry.replaceAll(nextTools);
			activeCronJobs = nextCronJobs;
			state.config = nextConfig;
			state.model = nextModel;
			configProvider.set(nextConfig);
			workflowEngine = nextWorkflowEngine;
			cronService = nextCronService;
			preparedPrompt = nextPrompt;
			deps.cronService = nextCronService;
			deps.model = nextModel;
			deps.workflowEngine = nextWorkflowEngine;

			logger.info("config_reloaded", {
				reason,
				sections: ["config", "tools", "cron", "workflows"],
				toolCount: nextTools.length,
				workflowCount: nextWorkflowEngine.list().length,
			});
			return true;
		} catch (error: unknown) {
			nextCronService?.stop();
			if (serverSwitched && priorConfigForRollback !== undefined && runningServer !== undefined) {
				try {
					await runningServer.close();
					runningServer = await startServer(priorConfigForRollback, deps, { configProvider });
					logger.warn("server_reload_rolled_back", {
						host: priorConfigForRollback.server.host,
						port: priorConfigForRollback.server.port,
						reason,
					});
				} catch (rollbackError: unknown) {
					logger.error("server_reload_rollback_failed", {
						error: rollbackError instanceof Error ? rollbackError.message : String(rollbackError),
						reason,
					});
				}
			}
			if (
				cronSwitched &&
				priorCronServiceForRollback !== undefined &&
				priorCronJobsForRollback !== undefined
			) {
				try {
					priorCronServiceForRollback.start(priorCronJobsForRollback);
				} catch (rollbackError: unknown) {
					logger.error("cron_reload_rollback_failed", {
						error: rollbackError instanceof Error ? rollbackError.message : String(rollbackError),
						reason,
					});
				}
			}
			logger.error("config_reload_failed", {
				error: error instanceof Error ? error.message : String(error),
				reason,
			});
			return false;
		}
	};

	if (!(await applyFromDisk("startup"))) {
		throw new Error("Failed to load runtime configuration.");
	}

	runningServer = await startServer(state.config, deps, { configProvider });

	const watchRoots = [paths.agentDir, paths.cronDir, paths.workflowsDir].filter((path) =>
		existsSync(path),
	);
	let reloadTimer: ReturnType<typeof setTimeout> | undefined;
	let reloadChain: Promise<void> = Promise.resolve();
	const watcher = watchConfig(watchRoots, ({ path, type }) => {
		if (reloadTimer !== undefined) {
			clearTimeout(reloadTimer);
		}
		reloadTimer = setTimeout(() => {
			reloadChain = reloadChain
				.then(async () => {
					await applyFromDisk(`${type}:${path}`);
				})
				.catch(() => {
					return;
				});
		}, 120);
	});

	const shutdown = async (): Promise<void> => {
		if (reloadTimer !== undefined) {
			clearTimeout(reloadTimer);
		}
		watcher.close();
		await reloadChain.catch(() => {
			return;
		});
		deps.cronService?.stop();
		if (runningServer !== undefined) {
			await runningServer.close();
			runningServer = undefined;
		}
	};
	const handleSignal = (): void => {
		void shutdown();
	};
	process.on("SIGINT", handleSignal);
	process.on("SIGTERM", handleSignal);
}

/**
 * CLI and daemon entrypoint.
 */
export async function main(): Promise<void> {
	const paths = resolvePaths();
	const config = loadConfig(paths.configPath);
	const model = resolveModel(config.model.provider, config.model.name);
	const state: RuntimeState = { config, model };

	const forcedPromptMode = process.argv.includes("--prompt");
	const prompt = forcedPromptMode ? readPromptFromStdin() : readOptionalPromptFromStdin();
	if (prompt !== undefined) {
		await runPromptMode(state, paths, prompt);
		return;
	}

	await runServerMode(state, paths);
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
	try {
		await main();
	} catch (error: unknown) {
		const message = error instanceof Error ? error.message : String(error);
		process.stderr.write(`Error: ${message}\n`);
		process.exitCode = 1;
	}
}
