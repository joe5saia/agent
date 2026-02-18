import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";
import type { Message } from "@mariozechner/pi-ai";
import { WebSocket, WebSocketServer, type RawData } from "ws";
import { agentLoop } from "../agent/index.js";
import type { RetryStatusEvent } from "../agent/index.js";
import { isValidSessionId, type SessionMetadata } from "../sessions/index.js";
import type { ServerDependencies } from "./types.js";

interface SendMessagePayload {
	content: string;
	sessionId: string;
	type: "send_message";
}

interface CancelPayload {
	runId: string;
	sessionId: string;
	type: "cancel";
}

type ClientPayload = CancelPayload | SendMessagePayload;

interface ActiveRun {
	controller: AbortController;
	runId: string;
	sessionId: string;
}

interface WsRuntimeOptions {
	maxIterations: number;
	retry: {
		baseDelayMs: number;
		maxDelayMs: number;
		maxRetries: number;
		retryableStatuses: Array<number>;
	};
}

interface ConnectionState {
	clientId: string;
	sessions: Set<string>;
	socket: WebSocket;
}

function generateId(now: number = Date.now()): string {
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

function assistantText(message: Extract<Message, { role: "assistant" }>): string {
	return message.content
		.filter((entry) => entry.type === "text")
		.map((entry) => entry.text)
		.join("\n")
		.trim();
}

/**
 * Handles WebSocket connections and per-session run orchestration.
 */
export class WsRuntime {
	readonly #activeRuns = new Map<string, ActiveRun>();
	readonly #clients = new Set<ConnectionState>();
	readonly #deps: ServerDependencies;
	readonly #options: WsRuntimeOptions;
	readonly #sessionClients = new Map<string, Set<ConnectionState>>();
	readonly #sessionQueues = new Map<string, Promise<void>>();
	readonly #server = new WebSocketServer({ noServer: true });

	public constructor(deps: ServerDependencies, options: WsRuntimeOptions) {
		this.#deps = deps;
		this.#options = options;

		this.#server.on("connection", (socket: WebSocket, request: IncomingMessage) => {
			const connection: ConnectionState = {
				clientId: generateId(),
				sessions: new Set<string>(),
				socket,
			};
			this.#clients.add(connection);
			this.#deps.logger.info("ws_connect", { clientId: connection.clientId });

			socket.on("message", async (payload: RawData) => {
				await this.#onMessage(connection, payload.toString("utf8"));
			});
			socket.on("close", () => {
				this.#clients.delete(connection);
				for (const sessionId of connection.sessions) {
					this.#sessionClients.get(sessionId)?.delete(connection);
				}
				this.#deps.logger.info("ws_disconnect", { clientId: connection.clientId });
			});
			socket.on("error", (error: Error) => {
				this.#deps.logger.warn("ws_error", {
					clientId: connection.clientId,
					error: error.message,
				});
			});

			this.#attachInitialSession(connection, request);
		});
	}

	public attachUpgradeHandler(request: IncomingMessage, socket: Duplex): boolean {
		const host = request.headers.host ?? "127.0.0.1";
		const url = new URL(request.url ?? "/", `http://${host}`);
		if (url.pathname !== "/ws") {
			return false;
		}

		this.#server.handleUpgrade(request, socket, Buffer.alloc(0), (webSocket: WebSocket) => {
			this.#server.emit("connection", webSocket, request);
		});
		return true;
	}

	public async close(): Promise<void> {
		for (const run of this.#activeRuns.values()) {
			run.controller.abort(new Error("Server shutting down"));
		}
		for (const connection of this.#clients) {
			connection.socket.close(1001, "Server shutting down");
		}

		await new Promise<void>((resolve) => {
			this.#server.close(() => resolve());
		});
	}

	#attachInitialSession(connection: ConnectionState, request: IncomingMessage): void {
		const host = request.headers.host ?? "127.0.0.1";
		const url = new URL(request.url ?? "/", `http://${host}`);
		const sessionId = url.searchParams.get("sessionId");
		if (sessionId === null || !isValidSessionId(sessionId)) {
			return;
		}
		this.#subscribe(connection, sessionId);
	}

	#broadcast(sessionId: string, payload: Record<string, unknown>): void {
		const clients = this.#sessionClients.get(sessionId);
		if (clients === undefined) {
			return;
		}
		const serialized = JSON.stringify(payload);
		for (const connection of clients) {
			if (connection.socket.readyState === WebSocket.OPEN) {
				connection.socket.send(serialized);
			}
		}
	}

	#enqueue(sessionId: string, operation: () => Promise<void>): void {
		const prior = this.#sessionQueues.get(sessionId) ?? Promise.resolve();
		const next = prior
			.catch(() => {
				return;
			})
			.then(async () => {
				await operation();
			});
		this.#sessionQueues.set(sessionId, next);
		next.finally(() => {
			if (this.#sessionQueues.get(sessionId) === next) {
				this.#sessionQueues.delete(sessionId);
			}
		});
	}

	#emit(
		sessionId: string,
		runId: string,
		type:
			| "error"
			| "message_complete"
			| "run_start"
			| "session_renamed"
			| "status"
			| "stream_delta"
			| "tool_result"
			| "tool_start",
		payload: Record<string, unknown>,
	): void {
		this.#broadcast(sessionId, { ...payload, runId, sessionId, type });
	}

	async #handleCancel(connection: ConnectionState, payload: CancelPayload): Promise<void> {
		if (!isValidSessionId(payload.sessionId)) {
			this.#sendError(connection, "Invalid session ID", payload.sessionId);
			return;
		}
		this.#subscribe(connection, payload.sessionId);
		const key = `${payload.sessionId}:${payload.runId}`;
		const activeRun = this.#activeRuns.get(key);
		if (activeRun !== undefined) {
			activeRun.controller.abort(new Error("Cancelled by client"));
		}
	}

	async #handleSendMessage(
		connection: ConnectionState,
		payload: SendMessagePayload,
	): Promise<void> {
		if (!isValidSessionId(payload.sessionId)) {
			this.#sendError(connection, "Invalid session ID", payload.sessionId);
			return;
		}

		this.#subscribe(connection, payload.sessionId);
		const runId = generateId();
		this.#enqueue(payload.sessionId, async () => {
			await this.#runTurn(payload.sessionId, runId, payload.content);
		});
	}

	async #onMessage(connection: ConnectionState, message: string): Promise<void> {
		let payload: unknown;
		try {
			payload = JSON.parse(message) as unknown;
		} catch {
			this.#sendError(connection, "Invalid JSON payload");
			return;
		}

		if (typeof payload !== "object" || payload === null || !("type" in payload)) {
			this.#sendError(connection, "Invalid message payload");
			return;
		}

		const typed = payload as Partial<ClientPayload>;
		if (typed.type === "send_message") {
			if (typeof typed.content !== "string" || typeof typed.sessionId !== "string") {
				this.#sendError(connection, "Invalid send_message payload");
				return;
			}
			await this.#handleSendMessage(connection, {
				content: typed.content,
				sessionId: typed.sessionId,
				type: "send_message",
			});
			return;
		}

		if (typed.type === "cancel") {
			if (typeof typed.runId !== "string" || typeof typed.sessionId !== "string") {
				this.#sendError(connection, "Invalid cancel payload");
				return;
			}
			await this.#handleCancel(connection, {
				runId: typed.runId,
				sessionId: typed.sessionId,
				type: "cancel",
			});
			return;
		}

		this.#sendError(connection, "Unsupported message type");
	}

	async #runTurn(sessionId: string, runId: string, userText: string): Promise<void> {
		let metadata: SessionMetadata;
		try {
			metadata = await this.#deps.sessionManager.get(sessionId);
		} catch {
			this.#emit(sessionId, runId, "error", { error: "Session not found" });
			return;
		}

		const controller = new AbortController();
		this.#activeRuns.set(`${sessionId}:${runId}`, {
			controller,
			runId,
			sessionId,
		});

		this.#emit(sessionId, runId, "run_start", { startedAt: new Date().toISOString() });
		await this.#deps.sessionManager.appendMessage(sessionId, {
			content: [{ text: userText, type: "text" }],
			role: "user",
		});
		const postUserMetadata = await this.#deps.sessionManager.get(sessionId);
		const shouldGenerateTitle =
			postUserMetadata.name === "New Session" && postUserMetadata.messageCount === 1;

		try {
			const contextMessages = await this.#deps.sessionManager.buildContext(sessionId);
			const systemPrompt = this.#deps.systemPromptBuilder(postUserMetadata);
			const previousLength = contextMessages.length;

			const runAgentLoop = this.#deps.runAgentLoop ?? agentLoop;
			const loopConfig = {
				logger: this.#deps.logger,
				maxIterations: this.#options.maxIterations,
				onStatus: (status: RetryStatusEvent) => {
					this.#emit(sessionId, runId, "status", {
						attempt: status.attempt,
						delayMs: status.delayMs,
						message: status.message,
						status: status.status,
					});
				},
				retry: this.#options.retry,
				runId,
				sessionId,
				...(this.#deps.apiKeyResolver !== undefined
					? { apiKeyResolver: this.#deps.apiKeyResolver }
					: {}),
			};
			const finalMessages = await runAgentLoop(
				contextMessages,
				this.#deps.toolRegistry,
				systemPrompt,
				this.#deps.model,
				loopConfig,
				controller.signal,
				(event) => {
					if (event.type === "stream") {
						if (event.event.type === "text_delta") {
							this.#emit(sessionId, runId, "stream_delta", { delta: event.event.delta });
						}
						if (event.event.type === "toolcall_end") {
							this.#emit(sessionId, runId, "tool_start", {
								arguments: event.event.toolCall.arguments,
								id: event.event.toolCall.id,
								name: event.event.toolCall.name,
							});
						}
						return;
					}
					if (event.type === "toolResult") {
						this.#emit(sessionId, runId, "tool_result", {
							content: event.toolResult.content,
							isError: event.toolResult.isError,
							toolCallId: event.toolResult.toolCallId,
							toolName: event.toolResult.toolName,
						});
						return;
					}
					if (event.type === "status") {
						this.#emit(sessionId, runId, "status", {
							attempt: event.status.attempt,
							delayMs: event.status.delayMs,
							message: event.status.message,
							status: event.status.status,
						});
						return;
					}
					if (event.type === "error") {
						this.#emit(sessionId, runId, "error", { error: event.message });
					}
				},
			);

			const newMessages = finalMessages.slice(previousLength);
			for (const message of newMessages) {
				const appendInput = toSessionAppendInput(message);
				if (appendInput !== undefined) {
					await this.#deps.sessionManager.appendMessage(sessionId, appendInput);
				}
			}

			const finalAssistant = [...finalMessages]
				.reverse()
				.find(
					(message): message is Extract<Message, { role: "assistant" }> =>
						message.role === "assistant",
				);

			if (finalAssistant !== undefined) {
				const assistantOutput = assistantText(finalAssistant);
				this.#emit(sessionId, runId, "message_complete", {
					content: assistantOutput,
				});

				if (shouldGenerateTitle) {
					void this.#deps.sessionManager
						.generateTitle(sessionId, {
							assistantText: assistantOutput,
							userText,
						})
						.then((name) => {
							this.#emit(sessionId, runId, "session_renamed", { name });
						})
						.catch(() => {
							return;
						});
				}
			}
		} catch (error: unknown) {
			const message = error instanceof Error ? error.message : String(error);
			this.#emit(sessionId, runId, "error", { error: message });
		} finally {
			this.#activeRuns.delete(`${sessionId}:${runId}`);
		}
	}

	#sendError(connection: ConnectionState, message: string, sessionId: string = ""): void {
		if (connection.socket.readyState !== WebSocket.OPEN) {
			return;
		}
		connection.socket.send(
			JSON.stringify({
				error: message,
				runId: "",
				sessionId,
				type: "error",
			}),
		);
	}

	#subscribe(connection: ConnectionState, sessionId: string): void {
		connection.sessions.add(sessionId);
		const clients = this.#sessionClients.get(sessionId) ?? new Set<ConnectionState>();
		clients.add(connection);
		this.#sessionClients.set(sessionId, clients);
	}
}
