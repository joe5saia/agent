import type { AgentConfig } from "./schema.js";

/**
 * Defaults for every optional configuration field.
 */
export const defaultConfig: Omit<AgentConfig, "model"> = {
	channels: {
		telegram: {
			allowFrom: [],
			delivery: {
				linkPreview: true,
				mediaMaxMb: 5,
				parseMode: "html",
				retry: {
					attempts: 3,
					jitter: 0.2,
					maxDelayMs: 5000,
					minDelayMs: 500,
				},
				textChunkLimit: 4000,
			},
			dmPolicy: "pairing",
			enabled: false,
			groupAllowFrom: [],
			groupPolicy: "allowlist",
			groups: {},
			inbound: {
				allowedUpdates: ["message", "edited_message", "callback_query"],
				dedupeTtlSeconds: 900,
				ignoreBotMessages: true,
			},
			mode: "polling",
			polling: {
				timeoutSeconds: 30,
			},
			queue: {
				maxPendingUpdatesGlobal: 5000,
				maxPendingUpdatesPerConversation: 32,
			},
			streaming: {
				mode: "off",
				statusDebounceMs: 1000,
			},
			webhookHost: "127.0.0.1",
			webhookPath: "/agent_telegram_webhook",
			webhookPort: 8787,
		},
	},
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
		interactive: {
			uiEnabled: false,
			wsEnabled: false,
		},
		port: 8080,
	},
	systemPrompt: {
		soulFile: "~/.agent/soul.md",
		strictPromptFiles: true,
		systemFile: "~/.agent/system.md",
	},
	tools: {
		maxIterations: 20,
		outputLimit: 200_000,
		timeout: 120,
	},
};
