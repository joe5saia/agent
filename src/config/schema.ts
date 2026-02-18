import { Type, type Static } from "@sinclair/typebox";

/**
 * Model provider configuration.
 */
export const modelConfigSchema = Type.Object({
	name: Type.String(),
	provider: Type.String(),
});

/**
 * HTTP server configuration.
 */
export const serverConfigSchema = Type.Object({
	host: Type.String({ default: "127.0.0.1" }),
	port: Type.Number({ default: 8080, maximum: 65_535, minimum: 1 }),
});

/**
 * Tool execution limits.
 */
export const toolLimitsSchema = Type.Object({
	maxIterations: Type.Number({ default: 20, minimum: 1 }),
	outputLimit: Type.Number({ default: 200_000, minimum: 1024 }),
	timeout: Type.Number({ default: 120, minimum: 5 }),
});

/**
 * Logging configuration.
 */
export const loggingConfigSchema = Type.Object({
	file: Type.String({ default: "~/.agent/logs/agent.log" }),
	level: Type.Union(
		[Type.Literal("error"), Type.Literal("warn"), Type.Literal("info"), Type.Literal("debug")],
		{ default: "info" },
	),
	rotation: Type.Object({
		maxDays: Type.Number({ default: 30, minimum: 1 }),
		maxSizeMb: Type.Number({ default: 100, minimum: 1 }),
	}),
	stdout: Type.Boolean({ default: true }),
});

/**
 * Retry behavior for transient provider failures.
 */
export const retryConfigSchema = Type.Object({
	baseDelayMs: Type.Number({ default: 1000, minimum: 100 }),
	maxDelayMs: Type.Number({ default: 30_000, minimum: 1000 }),
	maxRetries: Type.Number({ default: 3, minimum: 0 }),
	retryableStatuses: Type.Array(Type.Number(), { default: [429, 500, 502, 503, 529] }),
});

/**
 * Security policy configuration.
 */
export const securityConfigSchema = Type.Object({
	allowedEnv: Type.Array(Type.String(), {
		default: ["PATH", "HOME", "USER", "LANG", "LC_ALL", "TERM", "SHELL", "TMPDIR", "TZ"],
	}),
	allowedPaths: Type.Array(Type.String(), { default: ["~/.agent/workspace", "/tmp/agent"] }),
	allowedUsers: Type.Array(Type.String(), { default: [] }),
	blockedCommands: Type.Array(Type.String()),
	deniedPaths: Type.Array(Type.String(), {
		default: ["~/.ssh", "~/.gnupg", "/etc/shadow", "/etc/passwd"],
	}),
});

/**
 * System prompt file configuration.
 */
export const systemPromptConfigSchema = Type.Object({
	customInstructionsFile: Type.Optional(Type.String()),
	identityFile: Type.String({ default: "~/.agent/system-prompt.md" }),
});

/**
 * Session compaction settings.
 */
export const compactionConfigSchema = Type.Object({
	enabled: Type.Boolean({ default: true }),
	keepRecentTokens: Type.Number({ default: 20_000, minimum: 1024 }),
	reserveTokens: Type.Number({ default: 16_384, minimum: 1024 }),
});

/**
 * Root agent configuration schema.
 */
export const agentConfigSchema = Type.Object({
	compaction: compactionConfigSchema,
	logging: loggingConfigSchema,
	model: modelConfigSchema,
	retry: retryConfigSchema,
	security: securityConfigSchema,
	server: serverConfigSchema,
	systemPrompt: systemPromptConfigSchema,
	tools: toolLimitsSchema,
});

/**
 * Fully validated agent configuration.
 */
export type AgentConfig = Static<typeof agentConfigSchema>;
