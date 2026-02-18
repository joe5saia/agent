import { streamSimple } from "@mariozechner/pi-ai";
import type { Api, Message, Model } from "@mariozechner/pi-ai";
import { executeTool } from "../tools/index.js";
import type { ToolRegistry } from "../tools/index.js";
import { withRetry } from "./retry.js";
import type { AgentEvent, AgentLoopConfig } from "./types.js";

/**
 * Runs the stream->tool->stream loop until completion or cancellation.
 */
export async function agentLoop(
	messages: Array<Message>,
	tools: ToolRegistry,
	systemPrompt: string,
	model: Model<Api>,
	config: AgentLoopConfig,
	signal?: AbortSignal,
	onEvent?: (event: AgentEvent) => void,
): Promise<Array<Message>> {
	const streamFactory =
		config.streamFactory ??
		((streamModel, context, options) =>
			streamSimple(streamModel, context, options as Record<string, never>));

	let iterations = 0;
	while (iterations < config.maxIterations) {
		signal?.throwIfAborted();
		iterations += 1;
		const turnStart = Date.now();
		config.logger?.info("turn_start", {
			iteration: iterations,
			model: model.id,
			runId: config.runId,
			sessionId: config.sessionId,
		});
		const apiKey = await config.apiKeyResolver?.(model.provider);
		const streamOptions: { apiKey?: string; signal?: AbortSignal } = {};
		if (apiKey !== undefined) {
			streamOptions.apiKey = apiKey;
		}
		if (signal !== undefined) {
			streamOptions.signal = signal;
		}

		const responseFactory = async (): Promise<
			ReturnType<NonNullable<AgentLoopConfig["streamFactory"]>>
		> =>
			streamFactory(
				model,
				{
					messages,
					systemPrompt,
					tools: tools.toToolSchemas(),
				},
				Object.keys(streamOptions).length > 0 ? streamOptions : undefined,
			);
		const response =
			config.retry === undefined
				? await responseFactory()
				: await withRetry(responseFactory, config.retry, signal, (status) => {
						config.onStatus?.(status);
						onEvent?.({ status, type: "status" });
						config.logger?.info("provider_retry", {
							attempt: status.attempt,
							delayMs: status.delayMs,
							model: model.id,
							runId: config.runId,
							sessionId: config.sessionId,
							status: status.status,
						});
					});

		for await (const event of response) {
			onEvent?.({ event, type: "stream" });
		}

		const assistantMessage = await response.result();
		messages.push(assistantMessage);
		const turnDurationMs = Date.now() - turnStart;
		const toolCallCount = assistantMessage.content.filter(
			(entry) => entry.type === "toolCall",
		).length;
		const turnMetrics = {
			durationMs: turnDurationMs,
			inputTokens: assistantMessage.usage.input,
			outputTokens: assistantMessage.usage.output,
			toolCalls: toolCallCount,
			totalTokens: assistantMessage.usage.totalTokens,
		};

		if (assistantMessage.stopReason !== "toolUse") {
			config.logger?.info("turn_end", {
				durationMs: turnDurationMs,
				inputTokens: assistantMessage.usage.input,
				iteration: iterations,
				model: model.id,
				outputTokens: assistantMessage.usage.output,
				runId: config.runId,
				sessionId: config.sessionId,
				stopReason: assistantMessage.stopReason,
				toolCalls: toolCallCount,
				totalTokens: assistantMessage.usage.totalTokens,
			});
			config.onTurnComplete?.(turnMetrics);
			return messages;
		}

		for (const block of assistantMessage.content) {
			if (block.type !== "toolCall") {
				continue;
			}
			signal?.throwIfAborted();
			const toolStart = Date.now();

			config.logger?.info("tool_call", {
				args: block.arguments,
				runId: config.runId,
				sessionId: config.sessionId,
				toolName: block.name,
			});
			let executionResult = await executeTool(tools, block.name, block.arguments, signal);
			if (executionResult.isError === false) {
				executionResult = {
					content: executionResult.content,
					isError: false,
				};
			}

			const toolResultMessage: Extract<Message, { role: "toolResult" }> = {
				content: [{ text: executionResult.content, type: "text" }],
				isError: executionResult.isError,
				role: "toolResult",
				timestamp: Date.now(),
				toolCallId: block.id,
				toolName: block.name,
			};
			messages.push(toolResultMessage);
			onEvent?.({ toolResult: toolResultMessage, type: "toolResult" });
			const durationMs = Date.now() - toolStart;
			if (executionResult.content.includes("[output truncated]")) {
				config.logger?.warn("tool_output_truncated", {
					durationMs,
					runId: config.runId,
					sessionId: config.sessionId,
					toolName: block.name,
				});
			}
			if (executionResult.isError && /blocked/i.test(executionResult.content)) {
				config.logger?.warn("tool_blocked", {
					durationMs,
					reason: executionResult.content,
					runId: config.runId,
					sessionId: config.sessionId,
					toolName: block.name,
				});
			}
			if (executionResult.isError && /timed out/i.test(executionResult.content)) {
				config.logger?.warn("tool_timeout", {
					durationMs,
					runId: config.runId,
					sessionId: config.sessionId,
					toolName: block.name,
				});
			}
			config.logger?.info("tool_result", {
				durationMs,
				isError: executionResult.isError,
				runId: config.runId,
				sessionId: config.sessionId,
				toolName: block.name,
			});
		}
		config.logger?.info("turn_end", {
			durationMs: turnDurationMs,
			inputTokens: assistantMessage.usage.input,
			iteration: iterations,
			model: model.id,
			outputTokens: assistantMessage.usage.output,
			runId: config.runId,
			sessionId: config.sessionId,
			stopReason: assistantMessage.stopReason,
			toolCalls: toolCallCount,
			totalTokens: assistantMessage.usage.totalTokens,
		});
		config.onTurnComplete?.(turnMetrics);
	}

	messages.push({
		api: model.api,
		content: [{ text: "Stopped: maximum iteration limit reached.", type: "text" }],
		model: model.id,
		provider: model.provider,
		role: "assistant",
		stopReason: "stop",
		timestamp: Date.now(),
		usage: {
			cacheRead: 0,
			cacheWrite: 0,
			cost: {
				cacheRead: 0,
				cacheWrite: 0,
				input: 0,
				output: 0,
				total: 0,
			},
			input: 0,
			output: 0,
			totalTokens: 0,
		},
	});
	onEvent?.({ message: "Maximum iteration limit reached", type: "error" });
	config.logger?.warn("turn_end", {
		iteration: iterations,
		message: "Maximum iteration limit reached",
		model: model.id,
		runId: config.runId,
		sessionId: config.sessionId,
	});
	return messages;
}
