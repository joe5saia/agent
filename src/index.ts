import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { getModels, getProviders, type Api, type Message, type Model } from "@mariozechner/pi-ai";
import { agentLoop, buildSystemPrompt } from "./agent/index.js";
import { resolveApiKey } from "./auth/index.js";
import { loadConfig, watchConfig, type AgentConfig } from "./config/index.js";
import { loadCronJobs, CronService } from "./cron/index.js";
import { createLogger } from "./logging/index.js";
import { startServer } from "./server/index.js";
import { SessionManager } from "./sessions/index.js";
import { loadCliTools, registerBuiltinTools, ToolRegistry } from "./tools/index.js";
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
 * Converts an in-memory pi-ai message to a session append payload.
 */
function toSessionAppendInput(message: Message):
	| {
			content: Array<
				| { text: string; type: "text" }
				| { arguments: Record<string, unknown>; id: string; name: string; type: "toolCall" }
			>;
			isError?: boolean;
			role: "assistant" | "toolResult" | "user";
			toolCallId?: string;
	  }
	| undefined {
	if (message.role === "user") {
		const blocks = (
			Array.isArray(message.content)
				? message.content
				: [{ text: message.content, type: "text" as const }]
		)
			.filter((entry) => entry.type === "text")
			.map((entry) => ({ text: entry.text, type: "text" as const }));
		return { content: blocks, role: "user" };
	}

	if (message.role === "assistant") {
		const blocks = message.content
			.filter(
				(entry) => entry.type === "text" || entry.type === "toolCall" || entry.type === "thinking",
			)
			.map((entry) => {
				if (entry.type === "toolCall") {
					return {
						arguments: entry.arguments,
						id: entry.id,
						name: entry.name,
						type: "toolCall" as const,
					};
				}
				if (entry.type === "thinking") {
					return { text: entry.thinking, type: "text" as const };
				}
				return { text: entry.text, type: "text" as const };
			});
		return { content: blocks, role: "assistant" };
	}

	if (message.role === "toolResult") {
		const blocks = message.content
			.filter((entry) => entry.type === "text")
			.map((entry) => ({ text: entry.text, type: "text" as const }));
		return {
			content: blocks,
			isError: message.isError,
			role: "toolResult",
			toolCallId: message.toolCallId,
		};
	}

	return undefined;
}

/**
 * Renders assistant text content for CLI output.
 */
function assistantText(message: Extract<Message, { role: "assistant" }>): string {
	return message.content
		.filter((entry) => entry.type === "text")
		.map((entry) => entry.text)
		.join("\n")
		.trim();
}

/**
 * Applies built-in, CLI, and workflow-backed tools to the active registry.
 */
function reloadRegistry(
	registry: ToolRegistry,
	state: RuntimeState,
	paths: Paths,
	workflowEngine: WorkflowEngine,
): number {
	const stagedRegistry = new ToolRegistry();
	registerBuiltinTools(stagedRegistry, state.config);
	for (const cliTool of loadCliTools(paths.toolsPath, {
		allowedEnv: state.config.security.allowedEnv,
	})) {
		stagedRegistry.register(cliTool);
	}
	stagedRegistry.registerWorkflowTools(workflowEngine.toTools());
	registry.replaceAll(stagedRegistry.list());
	return registry.list().length;
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

	const contextMessages = await sessionManager.buildContext(session.id);
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

	const deps = {
		apiKeyResolver: resolveApiKey,
		cronService,
		logger,
		model: state.model,
		sessionManager,
		systemPromptBuilder: (session: Awaited<ReturnType<SessionManager["get"]>>) =>
			buildSystemPrompt(
				session,
				registry.list(),
				deps.workflowEngine === undefined ? [] : deps.workflowEngine.list(),
				state.config,
			),
		toolRegistry: registry,
		workflowEngine,
	};

	const applyFromDisk = (reason: string): boolean => {
		try {
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

			const nextCronService = new CronService({
				apiKeyResolver: resolveApiKey,
				defaultMaxIterations: nextConfig.tools.maxIterations,
				logger,
				model: nextModel,
				sessionManager,
				systemPromptBuilder: () => "You are running a scheduled cron job.",
				toolRegistry: registry,
			});

			reloadRegistry(registry, { config: nextConfig, model: nextModel }, paths, nextWorkflowEngine);
			nextCronService.start(loadCronJobs(paths.cronJobsPath));

			deps.cronService?.stop();
			state.config = nextConfig;
			state.model = nextModel;
			workflowEngine = nextWorkflowEngine;
			cronService = nextCronService;
			deps.cronService = nextCronService;
			deps.model = nextModel;
			deps.workflowEngine = nextWorkflowEngine;

			logger.info("config_reloaded", {
				reason,
				sections: ["config", "tools", "cron", "workflows"],
				toolCount: registry.list().length,
				workflowCount: nextWorkflowEngine.list().length,
			});
			return true;
		} catch (error: unknown) {
			logger.error("config_reload_failed", {
				error: error instanceof Error ? error.message : String(error),
				reason,
			});
			return false;
		}
	};

	if (!applyFromDisk("startup")) {
		throw new Error("Failed to load runtime configuration.");
	}

	await startServer(state.config, deps);

	const watchRoots = [paths.agentDir, paths.cronDir, paths.workflowsDir].filter((path) =>
		existsSync(path),
	);
	let reloadTimer: ReturnType<typeof setTimeout> | undefined;
	const watcher = watchConfig(watchRoots, ({ path, type }) => {
		if (reloadTimer !== undefined) {
			clearTimeout(reloadTimer);
		}
		reloadTimer = setTimeout(() => {
			applyFromDisk(`${type}:${path}`);
		}, 120);
	});

	const shutdown = (): void => {
		if (reloadTimer !== undefined) {
			clearTimeout(reloadTimer);
		}
		watcher.close();
	};
	process.on("SIGINT", shutdown);
	process.on("SIGTERM", shutdown);
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
