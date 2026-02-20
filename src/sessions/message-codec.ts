import type { Api, Message } from "@mariozechner/pi-ai";
import type { ContentBlock, SessionRecord } from "./types.js";

export interface AppendMessageInput {
	content: Array<ContentBlock>;
	isError?: boolean;
	role: "assistant" | "toolResult" | "user";
	toolCallId?: string;
	toolName?: string;
}

/**
 * Session records do not persist provider API metadata, so reconstructed assistant
 * messages use a stable synthetic provider/api pair.
 */
const persistedAssistantApi: Api = "openai-responses";
const persistedAssistantProvider = "session";

function textBlocksFromMessage(message: Message): Array<{ text: string; type: "text" }> {
	return (
		Array.isArray(message.content)
			? message.content
			: [{ text: message.content, type: "text" as const }]
	)
		.filter((entry) => entry.type === "text")
		.map((entry) => ({ text: entry.text, type: "text" as const }));
}

/**
 * Converts a runtime message into a persistable session append payload.
 */
export function toSessionAppendInput(message: Message): AppendMessageInput | undefined {
	if (message.role === "user") {
		return { content: textBlocksFromMessage(message), role: "user" };
	}

	if (message.role === "assistant") {
		const blocks = message.content
			.filter((entry) => entry.type === "text" || entry.type === "toolCall")
			.map((entry) => {
				if (entry.type === "toolCall") {
					return {
						arguments: entry.arguments,
						id: entry.id,
						name: entry.name,
						type: "toolCall" as const,
					};
				}
				return { text: entry.text, type: "text" as const };
			});
		return { content: blocks, role: "assistant" };
	}

	if (message.role === "toolResult") {
		return {
			content: textBlocksFromMessage(message),
			isError: message.isError,
			role: "toolResult",
			toolCallId: message.toolCallId,
			...(message.toolName === undefined ? {} : { toolName: message.toolName }),
		};
	}

	return undefined;
}

/**
 * Renders assistant text blocks to a printable string.
 */
export function assistantText(message: Extract<Message, { role: "assistant" }>): string {
	return message.content
		.filter((entry) => entry.type === "text")
		.map((entry) => entry.text)
		.join("\n")
		.trim();
}

/**
 * Converts a persisted session record into a runtime model message.
 */
export function recordToMessage(
	record: Extract<SessionRecord, { recordType: "message" }>,
	defaultModel: string,
): Message {
	const asTextContent = record.content
		.filter((entry): entry is Extract<ContentBlock, { type: "text" }> => entry.type === "text")
		.map((entry) => ({ text: entry.text, type: "text" as const }));

	if (record.role === "toolResult") {
		return {
			content: asTextContent,
			isError: record.isError ?? false,
			role: "toolResult",
			timestamp: Date.parse(record.timestamp),
			toolCallId: record.toolCallId ?? "",
			toolName: record.toolName ?? "tool",
		};
	}

	if (record.role === "user") {
		return {
			content: asTextContent,
			role: "user",
			timestamp: Date.parse(record.timestamp),
		};
	}

	const assistantContent = record.content.map((entry) => {
		if (entry.type === "text") {
			return { text: entry.text, type: "text" as const };
		}
		return {
			arguments: entry.arguments,
			id: entry.id,
			name: entry.name,
			type: "toolCall" as const,
		};
	});

	return {
		api: persistedAssistantApi,
		content: assistantContent,
		model: defaultModel,
		provider: persistedAssistantProvider,
		role: "assistant",
		stopReason: "stop",
		timestamp: Date.parse(record.timestamp),
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
	};
}
