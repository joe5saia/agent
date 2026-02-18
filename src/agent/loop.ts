import { streamSimple } from "@mariozechner/pi-ai";
import type { Api, Message, Model } from "@mariozechner/pi-ai";
import { executeTool } from "../tools/index.js";
import type { ToolRegistry } from "../tools/index.js";
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
		const apiKey = await config.apiKeyResolver?.(model.provider);
		const streamOptions: { apiKey?: string; signal?: AbortSignal } = {};
		if (apiKey !== undefined) {
			streamOptions.apiKey = apiKey;
		}
		if (signal !== undefined) {
			streamOptions.signal = signal;
		}

		const response = streamFactory(
			model,
			{
				messages,
				systemPrompt,
				tools: tools.toToolSchemas(),
			},
			Object.keys(streamOptions).length > 0 ? streamOptions : undefined,
		);

		for await (const event of response) {
			onEvent?.({ event, type: "stream" });
		}

		const assistantMessage = await response.result();
		messages.push(assistantMessage);

		if (assistantMessage.stopReason !== "toolUse") {
			return messages;
		}

		for (const block of assistantMessage.content) {
			if (block.type !== "toolCall") {
				continue;
			}
			signal?.throwIfAborted();

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
		}
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
	return messages;
}
