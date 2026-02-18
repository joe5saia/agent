import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { getModels, getProviders, type Api, type Message, type Model } from "@mariozechner/pi-ai";
import { agentLoop, buildSystemPrompt } from "./agent/index.js";
import { loadConfig } from "./config/index.js";
import { createLogger } from "./logging/index.js";
import { SessionManager } from "./sessions/index.js";
import { loadCliTools, registerBuiltinTools, ToolRegistry } from "./tools/index.js";

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
 * Extracts prompt text from stdin.
 */
function readPromptFromStdin(): string {
	const prompt = readFileSync(0, "utf8").trim();
	if (prompt === "") {
		throw new Error("No prompt provided on stdin.");
	}
	return prompt;
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
 * CLI entrypoint.
 */
export async function main(): Promise<void> {
	const configPath = expandHomePath(process.env["AGENT_CONFIG_PATH"] ?? "~/.agent/config.yaml");
	const toolsPath = expandHomePath("~/.agent/tools.yaml");
	const config = loadConfig(configPath);
	const logger = createLogger("cli", config.logging);

	const registry = new ToolRegistry();
	registerBuiltinTools(registry, config);
	for (const cliTool of loadCliTools(toolsPath, { allowedEnv: config.security.allowedEnv })) {
		registry.register(cliTool);
	}

	const sessionManager = new SessionManager({
		defaultModel: config.model.name,
		sessionsDir: "~/.agent/sessions",
	});
	const session = await sessionManager.create();
	const prompt = readPromptFromStdin();
	await sessionManager.appendMessage(session.id, {
		content: [{ text: prompt, type: "text" }],
		role: "user",
	});

	const contextMessages = await sessionManager.buildContext(session.id);
	const systemPrompt = buildSystemPrompt(session, registry.list(), [], config);
	const model = resolveModel(config.model.provider, config.model.name);

	const beforeLength = contextMessages.length;
	const finalMessages = await agentLoop(contextMessages, registry, systemPrompt, model, {
		maxIterations: config.tools.maxIterations,
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

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
	try {
		await main();
	} catch (error: unknown) {
		const message = error instanceof Error ? error.message : String(error);
		process.stderr.write(`Error: ${message}\n`);
		process.exitCode = 1;
	}
}
