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
	interactive: Type.Object({
		uiEnabled: Type.Boolean({ default: false }),
		wsEnabled: Type.Boolean({ default: false }),
	}),
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
	identityFile: Type.Optional(Type.String()),
	soulFile: Type.String({ default: "~/.agent/soul.md" }),
	strictPromptFiles: Type.Boolean({ default: true }),
	systemFile: Type.String({ default: "~/.agent/system.md" }),
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
 * Channel queue settings.
 */
export const channelQueueConfigSchema = Type.Object({
	maxPendingUpdatesGlobal: Type.Number({ default: 5000, minimum: 1 }),
	maxPendingUpdatesPerConversation: Type.Number({ default: 32, minimum: 1 }),
});

/**
 * Telegram inbound handling config.
 */
export const telegramInboundConfigSchema = Type.Object({
	allowedUpdates: Type.Array(Type.String(), {
		default: ["message", "edited_message", "callback_query"],
	}),
	dedupeTtlSeconds: Type.Number({ default: 900, minimum: 60 }),
	ignoreBotMessages: Type.Boolean({ default: true }),
});

/**
 * Telegram transport mode config.
 */
export const telegramPollingConfigSchema = Type.Object({
	timeoutSeconds: Type.Number({ default: 30, maximum: 60, minimum: 1 }),
});

/**
 * Telegram delivery retry config.
 */
export const telegramDeliveryRetryConfigSchema = Type.Object({
	attempts: Type.Number({ default: 3, minimum: 0 }),
	jitter: Type.Number({ default: 0.2, maximum: 1, minimum: 0 }),
	maxDelayMs: Type.Number({ default: 5000, minimum: 100 }),
	minDelayMs: Type.Number({ default: 500, minimum: 0 }),
});

/**
 * Telegram delivery config.
 */
export const telegramDeliveryConfigSchema = Type.Object({
	linkPreview: Type.Boolean({ default: true }),
	mediaMaxMb: Type.Number({ default: 5, minimum: 1 }),
	parseMode: Type.Union([Type.Literal("html"), Type.Literal("plain")], { default: "html" }),
	retry: telegramDeliveryRetryConfigSchema,
	textChunkLimit: Type.Number({ default: 4000, minimum: 1 }),
});

/**
 * Telegram stream rendering config.
 */
export const telegramStreamingConfigSchema = Type.Object({
	mode: Type.Union(
		[Type.Literal("off"), Type.Literal("partial"), Type.Literal("block"), Type.Literal("progress")],
		{ default: "off" },
	),
	statusDebounceMs: Type.Number({ default: 1000, minimum: 0 }),
});

/**
 * Per-topic override config for Telegram groups.
 */
export const telegramTopicConfigSchema = Type.Object({
	groupPolicy: Type.Optional(
		Type.Union([Type.Literal("open"), Type.Literal("allowlist"), Type.Literal("disabled")]),
	),
	requireMention: Type.Optional(Type.Boolean()),
});

/**
 * Per-group override config for Telegram groups.
 */
export const telegramGroupConfigSchema = Type.Object({
	groupPolicy: Type.Optional(
		Type.Union([Type.Literal("open"), Type.Literal("allowlist"), Type.Literal("disabled")]),
	),
	requireMention: Type.Optional(Type.Boolean()),
	topics: Type.Optional(Type.Record(Type.String(), telegramTopicConfigSchema)),
});

/**
 * Telegram channel configuration.
 */
export const telegramChannelConfigSchema = Type.Object({
	allowFrom: Type.Array(Type.String(), { default: [] }),
	botToken: Type.Optional(Type.String()),
	delivery: telegramDeliveryConfigSchema,
	dmPolicy: Type.Union(
		[
			Type.Literal("pairing"),
			Type.Literal("allowlist"),
			Type.Literal("open"),
			Type.Literal("disabled"),
		],
		{ default: "pairing" },
	),
	enabled: Type.Boolean({ default: false }),
	groupAllowFrom: Type.Array(Type.String(), { default: [] }),
	groupPolicy: Type.Union(
		[Type.Literal("open"), Type.Literal("allowlist"), Type.Literal("disabled")],
		{ default: "allowlist" },
	),
	groups: Type.Record(Type.String(), telegramGroupConfigSchema, { default: {} }),
	inbound: telegramInboundConfigSchema,
	mode: Type.Union([Type.Literal("polling"), Type.Literal("webhook")], { default: "polling" }),
	polling: telegramPollingConfigSchema,
	queue: channelQueueConfigSchema,
	streaming: telegramStreamingConfigSchema,
	webhookHost: Type.String({ default: "127.0.0.1" }),
	webhookPath: Type.String({ default: "/agent_telegram_webhook" }),
	webhookPort: Type.Number({ default: 8787, maximum: 65_535, minimum: 1 }),
	webhookSecret: Type.Optional(Type.String({ minLength: 16 })),
	webhookUrl: Type.Optional(Type.String()),
});

/**
 * Channel configuration root.
 */
export const channelsConfigSchema = Type.Object({
	telegram: telegramChannelConfigSchema,
});

/**
 * Root agent configuration schema.
 */
export const agentConfigSchema = Type.Object({
	channels: channelsConfigSchema,
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
