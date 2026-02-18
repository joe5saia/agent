import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Api, Model } from "@mariozechner/pi-ai";
import type { AgentConfig } from "../../src/config/index.js";
import type { Logger } from "../../src/logging/index.js";
import { SessionManager } from "../../src/sessions/index.js";
import { ToolRegistry } from "../../src/tools/index.js";

const tempDirectories: Array<string> = [];

export function cleanupTempDirs(): void {
	for (const directory of tempDirectories.splice(0)) {
		rmSync(directory, { force: true, recursive: true });
	}
}

export function createTempSessionsDir(): string {
	const directory = mkdtempSync(join(tmpdir(), "agent-server-test-"));
	tempDirectories.push(directory);
	return directory;
}

export function createConfig(overrides?: Partial<AgentConfig>): AgentConfig {
	const base: AgentConfig = {
		compaction: {
			enabled: true,
			keepRecentTokens: 20_000,
			reserveTokens: 16_384,
		},
		logging: {
			file: join(tmpdir(), "agent-server.log"),
			level: "info",
			rotation: { maxDays: 30, maxSizeMb: 100 },
			stdout: false,
		},
		model: {
			name: "gpt-test",
			provider: "openai",
		},
		retry: {
			baseDelayMs: 10,
			maxDelayMs: 50,
			maxRetries: 2,
			retryableStatuses: [429, 500],
		},
		security: {
			allowedEnv: ["PATH"],
			allowedPaths: [tmpdir()],
			allowedUsers: [],
			blockedCommands: [],
			deniedPaths: [],
		},
		server: {
			host: "127.0.0.1",
			port: 0,
		},
		systemPrompt: {
			identityFile: "~/.agent/system-prompt.md",
		},
		tools: {
			maxIterations: 3,
			outputLimit: 1000,
			timeout: 2,
		},
	};
	return { ...base, ...overrides };
}

export function createModel(): Model<Api> {
	return {
		api: "openai-completions",
		baseUrl: "https://example.com",
		contextWindow: 128_000,
		cost: { cacheRead: 0, cacheWrite: 0, input: 0, output: 0 },
		headers: {},
		id: "gpt-test",
		input: ["text"],
		maxTokens: 2048,
		name: "gpt-test",
		provider: "openai",
		reasoning: false,
	};
}

export function createLoggerSink(
	events: Array<{ event: string; fields?: Record<string, unknown> }>,
): Logger {
	const write = (event: string, fields?: Record<string, unknown>): void => {
		events.push({ event, fields });
	};
	return {
		debug(event, fields) {
			write(event, fields as Record<string, unknown> | undefined);
		},
		error(event, fields) {
			write(event, fields as Record<string, unknown> | undefined);
		},
		info(event, fields) {
			write(event, fields as Record<string, unknown> | undefined);
		},
		warn(event, fields) {
			write(event, fields as Record<string, unknown> | undefined);
		},
	};
}

export function createServerDeps(
	events: Array<{ event: string; fields?: Record<string, unknown> }>,
) {
	const sessionManager = new SessionManager({
		defaultModel: "gpt-test",
		sessionsDir: createTempSessionsDir(),
	});
	return {
		logger: createLoggerSink(events),
		model: createModel(),
		sessionManager,
		systemPromptBuilder: () => "system",
		toolRegistry: new ToolRegistry(),
	};
}
