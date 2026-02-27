import { mkdirSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { agentLoop, type AgentEvent } from "../../agent/index.js";
import { assistantText, toSessionAppendInput } from "../../sessions/index.js";
import { ConversationMappingStore } from "../mapping-store.js";
import { ConversationRouter } from "../router.js";
import type {
	ChannelRuntime,
	ChannelRuntimeDependencies,
	ChannelRuntimeHooks,
	DeliveryResult,
	InboundEnvelope,
	OutboundEnvelope,
} from "../types.js";
import {
	createTurnStreamState,
	deliverTelegramFinalText,
	emitTelegramStatus,
	handleTelegramStreamDelta,
} from "./delivery.js";
import { normalizeTelegramUpdate } from "./normalize.js";
import { evaluateTelegramPolicy, type ActivationMode } from "./policy.js";
import { runTelegramPollingLoop } from "./polling.js";
import type { TelegramGetMeResult, TelegramResponse, TelegramUpdate } from "./types.js";
import { TelegramWebhookServer, type TelegramWebhookResult } from "./webhook.js";

interface TelegramRuntimeOptions {
	hooks?: ChannelRuntimeHooks;
	mappingStorePath: string;
	stateFilePath: string;
}

interface TelegramApiError extends Error {
	code?: number;
	retryAfterSeconds?: number;
}

interface TelegramRuntimeState {
	updatedAt: string;
	updateOffset: number;
}

interface TurnStreamState {
	sessionId: string;
	stream: ReturnType<typeof createTurnStreamState>;
	streamStarted: boolean;
}

type EnqueueResult = "conversation_queue_full" | "enqueued" | "global_queue_full";

class DeliverySuppressedError extends Error {
	public constructor() {
		super("Telegram delivery suppressed for this run.");
		this.name = "DeliverySuppressedError";
	}
}

function randomJitter(baseDelayMs: number, jitterFraction: number): number {
	const jitter = baseDelayMs * jitterFraction;
	return Math.max(0, Math.floor(baseDelayMs + (Math.random() * 2 - 1) * jitter));
}

function formatTelegramError(
	method: string,
	response: TelegramResponse<unknown>,
): TelegramApiError {
	const error = new Error(
		`Telegram API ${method} failed: ${response.error_code ?? "unknown"} ${response.description ?? ""}`,
	) as TelegramApiError;
	if (response.error_code !== undefined) {
		error.code = response.error_code;
	}
	if (response.parameters?.retry_after !== undefined) {
		error.retryAfterSeconds = response.parameters.retry_after;
	}
	return error;
}

function isThreadRoutingError(error: unknown): boolean {
	if (!(error instanceof Error)) {
		return false;
	}
	return error.message.toLowerCase().includes("thread");
}

function isParseError(error: unknown): boolean {
	if (!(error instanceof Error)) {
		return false;
	}
	return error.message.toLowerCase().includes("parse");
}

function isValidPositiveInteger(value: unknown): value is number {
	return typeof value === "number" && Number.isInteger(value) && value > 0;
}

function expandHomePath(path: string): string {
	if (path === "~") {
		return homedir();
	}
	if (path.startsWith("~/")) {
		return join(homedir(), path.slice(2));
	}
	return path;
}

function parseActivationMode(text: string): ActivationMode | undefined {
	const normalized = text.trim().toLowerCase();
	if (normalized === "/activation mention") {
		return "mention";
	}
	if (normalized === "/activation always") {
		return "always";
	}
	return undefined;
}

function createOutboundEnvelope(input: {
	envelope: InboundEnvelope;
	runId: string;
}): OutboundEnvelope {
	return {
		accountId: input.envelope.accountId,
		channel: "telegram",
		conversationKey: input.envelope.conversationKey,
		parts: [],
		runId: input.runId,
		...(input.envelope.meta.threadKey === undefined
			? {}
			: { threadKey: input.envelope.meta.threadKey }),
		transport: input.envelope.transport,
	};
}

export class TelegramRuntime implements ChannelRuntime {
	readonly #config: ChannelRuntimeDependencies["config"]["channels"]["telegram"];
	readonly #deps: ChannelRuntimeDependencies;
	readonly #hooks: ChannelRuntimeHooks | undefined;
	readonly #mappingStore: ConversationMappingStore;
	readonly #router: ConversationRouter;
	readonly #sessionQueues = new Map<string, Promise<void>>();
	readonly #sessionQueueDepth = new Map<string, number>();
	readonly #seenUpdates = new Map<number, number>();
	readonly #stateFilePath: string;
	readonly #activationModes = new Map<string, ActivationMode>();
	readonly #suppressedRuns = new Set<string>();
	#abortController: AbortController | undefined;
	#botId: number | undefined;
	#botUsername: string | undefined;
	#intakePauseUntilMs = 0;
	#lastStatePersistMs = 0;
	#pollingTask: Promise<void> | undefined;
	#running = false;
	#updateOffset = 0;
	#webhookServer: TelegramWebhookServer | undefined;

	public constructor(deps: ChannelRuntimeDependencies, options: TelegramRuntimeOptions) {
		this.#deps = deps;
		this.#config = deps.config.channels.telegram;
		this.#hooks = options.hooks;
		this.#mappingStore = new ConversationMappingStore({
			filePath: options.mappingStorePath,
			logger: deps.logger,
		});
		this.#router = new ConversationRouter({
			mappingStore: this.#mappingStore,
			sessionManager: deps.sessionManager,
		});
		this.#stateFilePath = expandHomePath(options.stateFilePath);
		mkdirSync(dirname(this.#stateFilePath), { recursive: true });
	}

	public async send(event: OutboundEnvelope): Promise<DeliveryResult> {
		if (!this.#running) {
			return {
				error: "Telegram runtime is not running.",
				messageIds: [],
				ok: false,
			};
		}

		const messageIds: Array<number> = [];
		try {
			for (const part of event.parts) {
				if (part.type === "stream_delta") {
					if (part.messageId !== undefined) {
						await this.#editText(
							event.transport.chatId,
							{
								messageId: part.messageId,
								text: part.text,
							},
							event.runId,
						);
						messageIds.push(part.messageId);
					} else {
						const messageId = await this.#sendText(
							event.transport.chatId,
							{
								...(event.transport.replyToMessageId === undefined
									? {}
									: { replyToMessageId: event.transport.replyToMessageId }),
								text: part.text,
								...(event.transport.messageThreadId === undefined
									? {}
									: { threadId: event.transport.messageThreadId }),
							},
							event.runId,
						);
						messageIds.push(messageId);
					}
					continue;
				}

				const messageId = await this.#sendText(
					event.transport.chatId,
					{
						...(event.transport.replyToMessageId === undefined
							? {}
							: { replyToMessageId: event.transport.replyToMessageId }),
						text: part.text,
						...(event.transport.messageThreadId === undefined
							? {}
							: { threadId: event.transport.messageThreadId }),
					},
					event.runId,
				);
				messageIds.push(messageId);
			}
			return {
				messageIds,
				ok: true,
			};
		} catch (error: unknown) {
			return {
				error: error instanceof Error ? error.message : String(error),
				messageIds,
				ok: false,
			};
		}
	}

	public async start(signal?: AbortSignal): Promise<void> {
		if (this.#running || !this.#config.enabled) {
			return;
		}
		if (this.#config.botToken === undefined || this.#config.botToken.trim() === "") {
			throw new Error("channels.telegram.botToken is required when channels.telegram.enabled=true");
		}
		if (this.#config.mode === "webhook") {
			if (this.#config.webhookSecret === undefined || this.#config.webhookSecret.length < 16) {
				throw new Error(
					"channels.telegram.webhookSecret (min 16 chars) is required when mode=webhook.",
				);
			}
			if (this.#config.webhookUrl === undefined || this.#config.webhookUrl.trim() === "") {
				throw new Error("channels.telegram.webhookUrl is required when mode=webhook.");
			}
		}

		await this.#mappingStore.init();
		await this.#loadState();
		const me = await this.#callApi<TelegramGetMeResult>("getMe", {});
		this.#botId = me.id;
		this.#botUsername = me.username?.toLowerCase();

		this.#running = true;
		this.#abortController = new AbortController();
		if (signal !== undefined) {
			signal.addEventListener(
				"abort",
				() => {
					this.#abortController?.abort(signal.reason);
				},
				{ once: true },
			);
		}

		if (this.#config.mode === "polling") {
			this.#pollingTask = runTelegramPollingLoop({
				callGetUpdates: async (offset, timeoutSeconds) =>
					await this.#callApiWithRetry<Array<TelegramUpdate>>(
						"getUpdates",
						{
							allowed_updates: this.#config.inbound.allowedUpdates,
							offset,
							timeout: timeoutSeconds,
						},
						{},
					),
				getPauseDelayMs: () => Math.max(this.#intakePauseUntilMs - Date.now(), 0),
				getUpdateOffset: () => this.#updateOffset,
				isUpdateSeen: (updateId) => this.#isUpdateSeen(updateId),
				logger: this.#deps.logger,
				onUpdate: async (update) => {
					await this.#handleUpdate(update);
					await this.#persistStateIfNeeded(false);
				},
				setUpdateOffset: (nextOffset) => {
					this.#updateOffset = nextOffset;
				},
				signal: this.#abortController.signal,
				timeoutSeconds: this.#config.polling.timeoutSeconds,
			});
			return;
		}

		this.#webhookServer = new TelegramWebhookServer({
			host: this.#config.webhookHost,
			logger: this.#deps.logger,
			onUpdate: async (update) => await this.#handleUpdate(update),
			path: this.#config.webhookPath,
			port: this.#config.webhookPort,
			secret: this.#config.webhookSecret ?? "",
		});
		await this.#webhookServer.start(this.#abortController.signal);
		await this.#callApiWithRetry("deleteWebhook", { drop_pending_updates: false }, {});
		await this.#callApiWithRetry(
			"setWebhook",
			{
				allowed_updates: this.#config.inbound.allowedUpdates,
				secret_token: this.#config.webhookSecret,
				url: this.#config.webhookUrl,
			},
			{},
		);
	}

	public async stop(): Promise<void> {
		this.#running = false;
		this.#abortController?.abort(new Error("Telegram runtime stopped"));

		if (this.#pollingTask !== undefined) {
			await this.#pollingTask.catch(() => {
				return;
			});
		}
		if (this.#webhookServer !== undefined) {
			await this.#webhookServer.stop();
			this.#webhookServer = undefined;
			if (this.#config.mode === "webhook") {
				await this.#callApiWithRetry("deleteWebhook", { drop_pending_updates: false }, {}).catch(
					() => {
						return;
					},
				);
			}
		}

		await Promise.all(
			[...this.#sessionQueues.values()].map(async (operation) => {
				await operation.catch(() => {
					return;
				});
			}),
		);
		await this.#persistStateIfNeeded(true);
	}

	async #callApi<T>(method: string, payload: Record<string, unknown>): Promise<T> {
		const token = this.#config.botToken;
		if (token === undefined) {
			throw new Error("Telegram bot token is missing");
		}

		const response = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
			body: JSON.stringify(payload),
			headers: {
				"content-type": "application/json",
			},
			method: "POST",
			...(this.#abortController === undefined ? {} : { signal: this.#abortController.signal }),
		});

		let parsedResponse: TelegramResponse<T>;
		try {
			parsedResponse = (await response.json()) as TelegramResponse<T>;
		} catch {
			throw new Error(`Telegram API ${method} failed with non-JSON response.`);
		}

		if (!response.ok || !parsedResponse.ok || parsedResponse.result === undefined) {
			throw formatTelegramError(method, parsedResponse as TelegramResponse<unknown>);
		}

		return parsedResponse.result;
	}

	async #callApiWithRetry<T>(
		method: string,
		payload: Record<string, unknown>,
		context: {
			accountId?: string;
			conversationKey?: string;
			runId?: string;
			sessionId?: string;
			telegramChatId?: number;
		},
	): Promise<T> {
		const attempts = this.#config.delivery.retry.attempts + 1;
		for (let attempt = 1; attempt <= attempts; attempt += 1) {
			try {
				return await this.#callApi<T>(method, payload);
			} catch (error: unknown) {
				const typedError = error as TelegramApiError;
				const isRateLimited = typedError.code === 429;
				const isTransient =
					typedError.code === undefined || typedError.code >= 500 || isRateLimited;
				if (!isTransient || attempt >= attempts) {
					throw error;
				}

				const retryAfterMs =
					typedError.retryAfterSeconds === undefined
						? undefined
						: typedError.retryAfterSeconds * 1000;
				const nextDelay =
					retryAfterMs ??
					randomJitter(
						Math.min(
							this.#config.delivery.retry.maxDelayMs,
							Math.max(
								this.#config.delivery.retry.minDelayMs,
								this.#config.delivery.retry.minDelayMs * 2 ** (attempt - 1),
							),
						),
						this.#config.delivery.retry.jitter,
					);

				this.#deps.logger.warn("telegram_delivery_retry", {
					accountId: context.accountId ?? "default",
					attempt,
					channel: "telegram",
					...(context.conversationKey === undefined
						? {}
						: { conversationKey: context.conversationKey }),
					delayMs: nextDelay,
					...(context.runId === undefined ? {} : { runId: context.runId }),
					...(context.sessionId === undefined ? {} : { sessionId: context.sessionId }),
					...(context.telegramChatId === undefined
						? {}
						: { telegramChatId: context.telegramChatId }),
				});
				await sleep(nextDelay);
			}
		}

		throw new Error(`Telegram API ${method} failed without returning a result.`);
	}

	#cleanupSeenUpdates(): void {
		const cutoff = Date.now() - this.#config.inbound.dedupeTtlSeconds * 1000;
		for (const [updateId, seenAt] of this.#seenUpdates.entries()) {
			if (seenAt < cutoff) {
				this.#seenUpdates.delete(updateId);
			}
		}
	}

	#isUpdateSeen(updateId: number): boolean {
		this.#cleanupSeenUpdates();
		if (this.#seenUpdates.has(updateId)) {
			return true;
		}
		this.#seenUpdates.set(updateId, Date.now());
		return false;
	}

	async #handleUpdate(update: TelegramUpdate): Promise<TelegramWebhookResult> {
		const normalized = normalizeTelegramUpdate(update, {
			ignoreBotMessages: this.#config.inbound.ignoreBotMessages,
		});
		if (normalized.kind === "edited_message") {
			this.#deps.logger.info("telegram_update_ignored", {
				channel: "telegram",
				rawUpdateId: normalized.updateId,
				reason: normalized.reason,
			});
			return "ignored";
		}
		if (normalized.kind === "ignored") {
			this.#deps.logger.debug("telegram_update_ignored", {
				channel: "telegram",
				rawUpdateId: normalized.updateId,
				reason: normalized.reason,
			});
			return "ignored";
		}

		const envelope = normalized.value;
		const rawUpdateFields =
			envelope.meta.rawUpdateId === undefined ? {} : { rawUpdateId: envelope.meta.rawUpdateId };
		this.#hooks?.onInbound?.(envelope);
		this.#deps.logger.info("telegram_inbound_received", {
			accountId: envelope.accountId,
			channel: "telegram",
			conversationKey: envelope.conversationKey,
			...rawUpdateFields,
			telegramChatId: envelope.transport.chatId,
		});

		const activationMode = this.#activationModes.get(envelope.conversationKey);
		const decision = evaluateTelegramPolicy(this.#config, envelope, {
			...(activationMode === undefined ? {} : { activationMode }),
			...(this.#botId === undefined ? {} : { botId: this.#botId }),
			...(this.#botUsername === undefined ? {} : { botUsername: this.#botUsername }),
		});
		if (!decision.allowed) {
			this.#deps.logger.info("telegram_inbound_rejected", {
				accountId: envelope.accountId,
				channel: "telegram",
				conversationKey: envelope.conversationKey,
				...rawUpdateFields,
				reason: decision.reason,
				telegramChatId: envelope.transport.chatId,
			});
			if (decision.pairingNotice !== undefined) {
				await this.#sendText(envelope.transport.chatId, {
					...(envelope.transport.replyToMessageId === undefined
						? {}
						: { replyToMessageId: envelope.transport.replyToMessageId }),
					text: decision.pairingNotice,
					...(envelope.transport.messageThreadId === undefined
						? {}
						: { threadId: envelope.transport.messageThreadId }),
				}).catch(() => {
					return;
				});
			}
			return "ignored";
		}

		const enqueueResult = this.#enqueue(envelope.conversationKey, () =>
			this.#processInbound(envelope),
		);
		if (enqueueResult === "conversation_queue_full") {
			this.#deps.logger.warn("telegram_queue_full", {
				accountId: envelope.accountId,
				channel: "telegram",
				conversationKey: envelope.conversationKey,
				...rawUpdateFields,
				telegramChatId: envelope.transport.chatId,
			});
			return "conversation_queue_full";
		}
		if (enqueueResult === "global_queue_full") {
			this.#intakePauseUntilMs = Date.now() + 1000;
			this.#deps.logger.warn("telegram_global_queue_full", {
				accountId: envelope.accountId,
				channel: "telegram",
				conversationKey: envelope.conversationKey,
				...rawUpdateFields,
				telegramChatId: envelope.transport.chatId,
			});
			return "global_queue_full";
		}

		return "accepted";
	}

	#enqueue(conversationKey: string, operation: () => Promise<void>): EnqueueResult {
		const queueDepth = this.#sessionQueueDepth.get(conversationKey) ?? 0;
		const globalQueueDepth = [...this.#sessionQueueDepth.values()].reduce(
			(total, value) => total + value,
			0,
		);
		if (queueDepth >= this.#config.queue.maxPendingUpdatesPerConversation) {
			return "conversation_queue_full";
		}
		if (globalQueueDepth >= this.#config.queue.maxPendingUpdatesGlobal) {
			return "global_queue_full";
		}

		this.#sessionQueueDepth.set(conversationKey, queueDepth + 1);
		const prior = this.#sessionQueues.get(conversationKey) ?? Promise.resolve();
		const next = prior
			.catch(() => {
				return;
			})
			.then(async () => {
				await operation();
			})
			.catch((error: unknown) => {
				this.#deps.logger.error("telegram_queue_operation_failed", {
					channel: "telegram",
					conversationKey,
					error: error instanceof Error ? error.message : String(error),
				});
			});
		this.#sessionQueues.set(conversationKey, next);
		next.finally(() => {
			const remaining = Math.max((this.#sessionQueueDepth.get(conversationKey) ?? 1) - 1, 0);
			if (remaining === 0) {
				this.#sessionQueueDepth.delete(conversationKey);
			} else {
				this.#sessionQueueDepth.set(conversationKey, remaining);
			}
			if (this.#sessionQueues.get(conversationKey) === next) {
				this.#sessionQueues.delete(conversationKey);
			}
		});
		return "enqueued";
	}

	async #processInbound(envelope: InboundEnvelope): Promise<void> {
		const rawUpdateFields =
			envelope.meta.rawUpdateId === undefined ? {} : { rawUpdateId: envelope.meta.rawUpdateId };
		const routed = await this.#router.resolve({
			channel: "telegram",
			chatId: envelope.transport.chatId,
			conversationKey: envelope.conversationKey,
			...(envelope.transport.messageThreadId === undefined
				? {}
				: { threadId: envelope.transport.messageThreadId }),
		});
		this.#deps.logger.info("telegram_session_resolved", {
			accountId: envelope.accountId,
			channel: "telegram",
			conversationKey: envelope.conversationKey,
			...rawUpdateFields,
			sessionId: routed.sessionId,
			telegramChatId: envelope.transport.chatId,
		});

		const activationMode = parseActivationMode(envelope.content.text);
		if (activationMode !== undefined && !envelope.conversationKey.startsWith("telegram:dm:")) {
			this.#activationModes.set(envelope.conversationKey, activationMode);
			await this.#sendText(envelope.transport.chatId, {
				...(envelope.transport.replyToMessageId === undefined
					? {}
					: { replyToMessageId: envelope.transport.replyToMessageId }),
				text: `Activation mode set to ${activationMode}.`,
				...(envelope.transport.messageThreadId === undefined
					? {}
					: { threadId: envelope.transport.messageThreadId }),
			});
			return;
		}

		const runId = this.#generateRunId();
		this.#suppressedRuns.delete(runId);
		const streamState: TurnStreamState = {
			sessionId: routed.sessionId,
			stream: createTurnStreamState(),
			streamStarted: false,
		};

		let finalText: string | undefined;
		try {
			finalText = await this.#runTurn(routed.sessionId, runId, envelope.content.text, {
				onEvent: async (event) => {
					await this.#handleTurnEvent(envelope, runId, streamState, event);
				},
			});
		} catch (error: unknown) {
			this.#deps.logger.error("telegram_turn_failed", {
				accountId: envelope.accountId,
				channel: "telegram",
				conversationKey: envelope.conversationKey,
				error: error instanceof Error ? error.message : String(error),
				...rawUpdateFields,
				runId,
				sessionId: streamState.sessionId,
				telegramChatId: envelope.transport.chatId,
			});
			if (!this.#suppressedRuns.has(runId)) {
				await this.#sendText(
					envelope.transport.chatId,
					{
						...(envelope.transport.replyToMessageId === undefined
							? {}
							: { replyToMessageId: envelope.transport.replyToMessageId }),
						text: "Failed to process message. Please retry.",
						...(envelope.transport.messageThreadId === undefined
							? {}
							: { threadId: envelope.transport.messageThreadId }),
					},
					runId,
				).catch(() => {
					return;
				});
			}
			return;
		}

		if (finalText === undefined || this.#suppressedRuns.has(runId)) {
			return;
		}

		const outboundEnvelope = createOutboundEnvelope({ envelope, runId });
		const messageIds = await deliverTelegramFinalText(
			{
				delivery: {
					textChunkLimit: this.#config.delivery.textChunkLimit,
				},
				streaming: this.#config.streaming,
			},
			{
				editText: async (chatId, options) => {
					await this.#editText(chatId, options, runId, {
						accountId: envelope.accountId,
						conversationKey: envelope.conversationKey,
						runId,
						sessionId: streamState.sessionId,
						telegramChatId: envelope.transport.chatId,
					});
				},
				sendText: async (chatId, options) =>
					await this.#sendText(chatId, options, runId, {
						accountId: envelope.accountId,
						conversationKey: envelope.conversationKey,
						runId,
						sessionId: streamState.sessionId,
						telegramChatId: envelope.transport.chatId,
					}),
			},
			outboundEnvelope,
			streamState.stream,
			finalText,
		).catch(async (error: unknown) => {
			if (!(error instanceof DeliverySuppressedError)) {
				throw error;
			}
			return [];
		});

		this.#hooks?.onOutbound?.({
			...outboundEnvelope,
			parts: [{ text: finalText, type: "text" }],
		});
		this.#deps.logger.info("telegram_delivery_completed", {
			accountId: envelope.accountId,
			channel: "telegram",
			conversationKey: envelope.conversationKey,
			...rawUpdateFields,
			runId,
			sessionId: streamState.sessionId,
			telegramChatId: envelope.transport.chatId,
		});

		if (messageIds.length === 0 && this.#suppressedRuns.has(runId)) {
			this.#deps.logger.warn("telegram_delivery_suppressed", {
				accountId: envelope.accountId,
				channel: "telegram",
				conversationKey: envelope.conversationKey,
				...rawUpdateFields,
				runId,
				sessionId: streamState.sessionId,
				telegramChatId: envelope.transport.chatId,
			});
		}
	}

	async #runTurn(
		sessionId: string,
		runId: string,
		userText: string,
		options: {
			onEvent: (event: AgentEvent) => Promise<void>;
		},
	): Promise<string | undefined> {
		const metadata = await this.#deps.sessionManager.get(sessionId);
		await this.#deps.sessionManager.appendMessage(sessionId, {
			content: [{ text: userText, type: "text" }],
			role: "user",
		});
		const contextMessages = await this.#deps.sessionManager.buildContextForRun(sessionId);
		const previousLength = contextMessages.length;
		const systemPrompt = this.#deps.systemPromptBuilder(metadata, userText);
		const runAgentLoop = this.#deps.runAgentLoop ?? agentLoop;
		const finalMessages = await runAgentLoop(
			contextMessages,
			this.#deps.toolRegistry,
			systemPrompt,
			this.#deps.model,
			{
				...(this.#deps.apiKeyResolver === undefined
					? {}
					: { apiKeyResolver: this.#deps.apiKeyResolver }),
				logger: this.#deps.logger,
				maxIterations: this.#deps.config.tools.maxIterations,
				onStatus: (status) => {
					void options.onEvent({
						status,
						type: "status",
					});
				},
				onTurnComplete: (event) => {
					void this.#deps.sessionManager.recordTurnMetrics(sessionId, event).catch(() => {
						return;
					});
				},
				retry: this.#deps.config.retry,
				runId,
				sessionId,
			},
			this.#abortController?.signal,
			(event) => {
				void options.onEvent(event);
			},
		);
		for (const message of finalMessages.slice(previousLength)) {
			const appendInput = toSessionAppendInput(message);
			if (appendInput !== undefined) {
				await this.#deps.sessionManager.appendMessage(sessionId, appendInput);
			}
		}
		const finalAssistant = [...finalMessages]
			.reverse()
			.find(
				(message): message is Extract<(typeof finalMessages)[number], { role: "assistant" }> =>
					message.role === "assistant",
			);
		if (finalAssistant === undefined) {
			return undefined;
		}
		return assistantText(finalAssistant);
	}

	async #handleTurnEvent(
		envelope: InboundEnvelope,
		runId: string,
		streamState: TurnStreamState,
		event: AgentEvent,
	): Promise<void> {
		const rawUpdateFields =
			envelope.meta.rawUpdateId === undefined ? {} : { rawUpdateId: envelope.meta.rawUpdateId };
		if (this.#suppressedRuns.has(runId)) {
			return;
		}
		const outboundEnvelope = createOutboundEnvelope({ envelope, runId });

		if (event.type === "stream") {
			if (event.event.type === "text_delta") {
				if (!streamState.streamStarted) {
					streamState.streamStarted = true;
					this.#deps.logger.info("telegram_stream_started", {
						accountId: envelope.accountId,
						channel: "telegram",
						conversationKey: envelope.conversationKey,
						...rawUpdateFields,
						runId,
						sessionId: streamState.sessionId,
						telegramChatId: envelope.transport.chatId,
					});
				}
				const messageId = await handleTelegramStreamDelta(
					{
						delivery: {
							textChunkLimit: this.#config.delivery.textChunkLimit,
						},
						streaming: this.#config.streaming,
					},
					{
						editText: async (chatId, options) => {
							await this.#editText(chatId, options, runId, {
								accountId: envelope.accountId,
								conversationKey: envelope.conversationKey,
								runId,
								sessionId: streamState.sessionId,
								telegramChatId: envelope.transport.chatId,
							});
						},
						sendText: async (chatId, options) =>
							await this.#sendText(chatId, options, runId, {
								accountId: envelope.accountId,
								conversationKey: envelope.conversationKey,
								runId,
								sessionId: streamState.sessionId,
								telegramChatId: envelope.transport.chatId,
							}),
					},
					outboundEnvelope,
					streamState.stream,
					event.event.delta,
				);
				if (messageId !== undefined) {
					this.#hooks?.onOutbound?.({
						...outboundEnvelope,
						parts: [{ messageId, text: streamState.stream.previewText, type: "stream_delta" }],
					});
					this.#deps.logger.info("telegram_stream_chunk_sent", {
						accountId: envelope.accountId,
						channel: "telegram",
						conversationKey: envelope.conversationKey,
						...rawUpdateFields,
						runId,
						sessionId: streamState.sessionId,
						telegramChatId: envelope.transport.chatId,
					});
				}
			}
			if (event.event.type === "toolcall_end") {
				const text = `Tool ${event.event.toolCall.name} completed.`;
				await this.#emitToolEvent(outboundEnvelope, streamState.sessionId, text);
			}
			return;
		}

		if (event.type === "toolResult") {
			const text = `Tool ${event.toolResult.toolName ?? "tool"} returned.`;
			await this.#emitToolEvent(outboundEnvelope, streamState.sessionId, text);
			return;
		}

		if (event.type === "status") {
			if (event.status.message === "") {
				return;
			}
			await this.#emitStatus(outboundEnvelope, streamState.sessionId, event.status.message);
			return;
		}

		if (event.type === "error") {
			await this.#emitStatus(outboundEnvelope, streamState.sessionId, event.message);
		}
	}

	async #emitStatus(
		outboundEnvelope: OutboundEnvelope,
		sessionId: string,
		text: string,
	): Promise<void> {
		const messageId = await emitTelegramStatus(
			{
				delivery: {
					textChunkLimit: this.#config.delivery.textChunkLimit,
				},
				streaming: this.#config.streaming,
			},
			{
				editText: async (chatId, options) => {
					await this.#editText(chatId, options, outboundEnvelope.runId, {
						accountId: outboundEnvelope.accountId,
						conversationKey: outboundEnvelope.conversationKey,
						runId: outboundEnvelope.runId,
						sessionId,
						telegramChatId: outboundEnvelope.transport.chatId,
					});
				},
				sendText: async (chatId, options) =>
					await this.#sendText(chatId, options, outboundEnvelope.runId, {
						accountId: outboundEnvelope.accountId,
						conversationKey: outboundEnvelope.conversationKey,
						runId: outboundEnvelope.runId,
						sessionId,
						telegramChatId: outboundEnvelope.transport.chatId,
					}),
			},
			outboundEnvelope,
			text,
		).catch((error: unknown) => {
			if (error instanceof DeliverySuppressedError) {
				return -1;
			}
			throw error;
		});
		if (messageId < 0) {
			return;
		}
		this.#hooks?.onOutbound?.({
			...outboundEnvelope,
			parts: [{ text, type: "status" }],
		});
	}

	async #emitToolEvent(
		outboundEnvelope: OutboundEnvelope,
		sessionId: string,
		text: string,
	): Promise<void> {
		if (this.#config.streaming.mode === "off") {
			return;
		}
		await this.#sendText(
			outboundEnvelope.transport.chatId,
			{
				...(outboundEnvelope.transport.replyToMessageId === undefined
					? {}
					: { replyToMessageId: outboundEnvelope.transport.replyToMessageId }),
				text,
				...(outboundEnvelope.transport.messageThreadId === undefined
					? {}
					: { threadId: outboundEnvelope.transport.messageThreadId }),
			},
			outboundEnvelope.runId,
			{
				accountId: outboundEnvelope.accountId,
				conversationKey: outboundEnvelope.conversationKey,
				runId: outboundEnvelope.runId,
				sessionId,
				telegramChatId: outboundEnvelope.transport.chatId,
			},
		).catch((error: unknown) => {
			if (error instanceof DeliverySuppressedError) {
				return;
			}
			throw error;
		});
		if (this.#suppressedRuns.has(outboundEnvelope.runId)) {
			return;
		}
		this.#hooks?.onOutbound?.({
			...outboundEnvelope,
			parts: [{ text, type: "tool_event" }],
		});
	}

	async #sendText(
		chatId: number,
		options: {
			replyToMessageId?: number;
			text: string;
			threadId?: number;
		},
		runId?: string,
		context: {
			accountId?: string;
			conversationKey?: string;
			runId?: string;
			sessionId?: string;
			telegramChatId?: number;
		} = {},
	): Promise<number> {
		const payload: Record<string, unknown> = {
			chat_id: chatId,
			text: options.text,
		};
		if (this.#config.delivery.parseMode === "html") {
			payload["parse_mode"] = "HTML";
		}
		if (this.#config.delivery.linkPreview === false) {
			payload["link_preview_options"] = { is_disabled: true };
		}
		if (options.replyToMessageId !== undefined) {
			payload["reply_parameters"] = {
				message_id: options.replyToMessageId,
			};
		}
		if (isValidPositiveInteger(options.threadId)) {
			payload["message_thread_id"] = options.threadId;
		}

		try {
			const result = await this.#callApiWithRetry<{ message_id: number }>("sendMessage", payload, {
				...context,
				telegramChatId: chatId,
			});
			return result.message_id;
		} catch (error: unknown) {
			if ((error as TelegramApiError).code === 403 && runId !== undefined) {
				this.#suppressedRuns.add(runId);
				throw new DeliverySuppressedError();
			}

			if (isParseError(error) && this.#config.delivery.parseMode === "html") {
				delete payload["parse_mode"];
				const fallback = await this.#callApiWithRetry<{ message_id: number }>(
					"sendMessage",
					payload,
					{
						...context,
						telegramChatId: chatId,
					},
				);
				return fallback.message_id;
			}

			if (isThreadRoutingError(error) && payload["message_thread_id"] !== undefined) {
				delete payload["message_thread_id"];
				const fallback = await this.#callApiWithRetry<{ message_id: number }>(
					"sendMessage",
					payload,
					{
						...context,
						telegramChatId: chatId,
					},
				);
				return fallback.message_id;
			}

			throw error;
		}
	}

	async #editText(
		chatId: number,
		options: {
			messageId: number;
			text: string;
		},
		runId?: string,
		context: {
			accountId?: string;
			conversationKey?: string;
			runId?: string;
			sessionId?: string;
			telegramChatId?: number;
		} = {},
	): Promise<void> {
		const payload: Record<string, unknown> = {
			chat_id: chatId,
			message_id: options.messageId,
			text: options.text,
		};
		if (this.#config.delivery.parseMode === "html") {
			payload["parse_mode"] = "HTML";
		}
		try {
			await this.#callApiWithRetry("editMessageText", payload, {
				...context,
				telegramChatId: chatId,
			});
		} catch (error: unknown) {
			if ((error as TelegramApiError).code === 403 && runId !== undefined) {
				this.#suppressedRuns.add(runId);
				throw new DeliverySuppressedError();
			}
			if (isParseError(error) && this.#config.delivery.parseMode === "html") {
				delete payload["parse_mode"];
				await this.#callApiWithRetry("editMessageText", payload, {
					...context,
					telegramChatId: chatId,
				});
				return;
			}
			throw error;
		}
	}

	#generateRunId(now: number = Date.now()): string {
		const alphabet = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
		let timestamp = now;
		let timePart = "";
		for (let index = 0; index < 10; index += 1) {
			timePart = alphabet[timestamp % 32] + timePart;
			timestamp = Math.floor(timestamp / 32);
		}
		let randomPart = "";
		for (let index = 0; index < 16; index += 1) {
			randomPart += alphabet[Math.floor(Math.random() * alphabet.length)];
		}
		return `${timePart}${randomPart}`;
	}

	async #loadState(): Promise<void> {
		try {
			const raw = await readFile(this.#stateFilePath, "utf8");
			const parsed = JSON.parse(raw) as Partial<TelegramRuntimeState>;
			if (typeof parsed.updateOffset === "number" && Number.isInteger(parsed.updateOffset)) {
				this.#updateOffset = Math.max(parsed.updateOffset, 0);
			}
		} catch {
			this.#updateOffset = 0;
		}
	}

	async #persistStateIfNeeded(force: boolean): Promise<void> {
		const nowMs = Date.now();
		if (!force && nowMs - this.#lastStatePersistMs < 1000) {
			return;
		}
		this.#lastStatePersistMs = nowMs;
		const state: TelegramRuntimeState = {
			updatedAt: new Date(nowMs).toISOString(),
			updateOffset: this.#updateOffset,
		};
		await writeFile(this.#stateFilePath, `${JSON.stringify(state)}\n`, "utf8");
	}
}
