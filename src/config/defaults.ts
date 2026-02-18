import type { AgentConfig } from "./schema.js";

/**
 * Defaults for every optional configuration field.
 */
export const defaultConfig: Omit<AgentConfig, "model"> = {
	compaction: {
		enabled: true,
		keepRecentTokens: 20_000,
		reserveTokens: 16_384,
	},
	logging: {
		file: "~/.agent/logs/agent.log",
		level: "info",
		rotation: {
			maxDays: 30,
			maxSizeMb: 100,
		},
		stdout: true,
	},
	retry: {
		baseDelayMs: 1000,
		maxDelayMs: 30_000,
		maxRetries: 3,
		retryableStatuses: [429, 500, 502, 503, 529],
	},
	security: {
		allowedEnv: ["PATH", "HOME", "USER", "LANG", "LC_ALL", "TERM", "SHELL", "TMPDIR", "TZ"],
		allowedPaths: ["~/.agent/workspace", "/tmp/agent"],
		allowedUsers: [],
		blockedCommands: [],
		deniedPaths: ["~/.ssh", "~/.gnupg", "/etc/shadow", "/etc/passwd"],
	},
	server: {
		host: "127.0.0.1",
		port: 8080,
	},
	systemPrompt: {
		identityFile: "~/.agent/system-prompt.md",
	},
	tools: {
		maxIterations: 20,
		outputLimit: 200_000,
		timeout: 120,
	},
};
