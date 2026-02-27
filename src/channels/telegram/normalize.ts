import type { InboundEnvelope } from "../types.js";
import type {
	TelegramCallbackQuery,
	TelegramMediaDescriptor,
	TelegramMessage,
	TelegramUpdate,
} from "./types.js";

/**
 * Result of normalizing a Telegram update.
 */
export type NormalizedTelegramUpdate =
	| {
			kind: "edited_message";
			reason: "edited_message";
			updateId: number;
	  }
	| {
			kind: "ignored";
			reason:
				| "bot_message"
				| "callback_query_without_message"
				| "empty_text"
				| "invalid_control_characters"
				| "unsupported_chat_type"
				| "unsupported_update";
			updateId: number;
	  }
	| {
			kind: "message";
			updateId: number;
			value: InboundEnvelope;
	  };

interface ConversationMapping {
	conversationKey: string;
	messageThreadId?: number;
}

function isValidPositiveInteger(value: unknown): value is number {
	return typeof value === "number" && Number.isInteger(value) && value > 0;
}

function hasInvalidControlCharacters(value: string): boolean {
	for (const character of value) {
		const code = character.charCodeAt(0);
		if (
			(code >= 0x00 && code <= 0x08) ||
			code === 0x0b ||
			code === 0x0c ||
			(code >= 0x0e && code <= 0x1f) ||
			code === 0x7f
		) {
			return true;
		}
	}
	return false;
}

function toMediaReference(
	type: "audio" | "document" | "image" | "video",
	source: TelegramMediaDescriptor | undefined,
): { type: "audio" | "document" | "image" | "video"; url: string } | undefined {
	if (source?.file_id === undefined) {
		return undefined;
	}
	return {
		type,
		url: `telegram:file:${source.file_id}`,
	};
}

function extractMedia(message: TelegramMessage): InboundEnvelope["content"]["media"] {
	const media: Array<{ type: "audio" | "document" | "image" | "video"; url: string }> = [];

	const image = message.photo?.at(-1);
	const imageReference = toMediaReference("image", image);
	if (imageReference !== undefined) {
		media.push(imageReference);
	}
	const audioReference = toMediaReference("audio", message.audio);
	if (audioReference !== undefined) {
		media.push(audioReference);
	}
	const documentReference = toMediaReference("document", message.document);
	if (documentReference !== undefined) {
		media.push(documentReference);
	}
	const videoReference = toMediaReference("video", message.video);
	if (videoReference !== undefined) {
		media.push(videoReference);
	}

	return media.length > 0 ? media : undefined;
}

function buildConversationKey(message: TelegramMessage): ConversationMapping | undefined {
	const chatId = message.chat.id;
	if (message.chat.type === "private") {
		const userId = String(message.from?.id ?? chatId);
		if (isValidPositiveInteger(message.message_thread_id)) {
			return {
				conversationKey: `telegram:dm:${userId}:thread:${message.message_thread_id}`,
				messageThreadId: message.message_thread_id,
			};
		}
		return { conversationKey: `telegram:dm:${userId}` };
	}

	if (message.chat.type === "group" || message.chat.type === "supergroup") {
		if (message.chat.is_forum) {
			const topicId = isValidPositiveInteger(message.message_thread_id)
				? message.message_thread_id
				: 1;
			return {
				conversationKey: `telegram:group:${chatId}:topic:${topicId}`,
				...(topicId === 1 ? {} : { messageThreadId: topicId }),
			};
		}
		return {
			conversationKey: `telegram:group:${chatId}`,
		};
	}

	return undefined;
}

function resolveMessage(update: TelegramUpdate): TelegramMessage | undefined {
	if (update.message !== undefined) {
		return update.message;
	}
	if (update.callback_query !== undefined) {
		return callbackQueryToMessage(update.callback_query);
	}
	return undefined;
}

function callbackQueryToMessage(query: TelegramCallbackQuery): TelegramMessage | undefined {
	if (query.message === undefined) {
		return undefined;
	}
	const callbackMessage: TelegramMessage = {
		...query.message,
		...(query.message.from === undefined ? {} : { from: query.message.from }),
		...(query.data === undefined ? {} : { text: query.data }),
	};
	return callbackMessage;
}

/**
 * Converts a Telegram update to the normalized inbound envelope format.
 */
export function normalizeTelegramUpdate(
	update: TelegramUpdate,
	options: {
		ignoreBotMessages: boolean;
	},
): NormalizedTelegramUpdate {
	if (update.edited_message !== undefined) {
		return { kind: "edited_message", reason: "edited_message", updateId: update.update_id };
	}

	const message = resolveMessage(update);
	if (message === undefined) {
		return { kind: "ignored", reason: "unsupported_update", updateId: update.update_id };
	}

	if (update.callback_query !== undefined && update.callback_query.message === undefined) {
		return {
			kind: "ignored",
			reason: "callback_query_without_message",
			updateId: update.update_id,
		};
	}

	if (options.ignoreBotMessages && message.from?.is_bot === true) {
		return { kind: "ignored", reason: "bot_message", updateId: update.update_id };
	}

	const mapping = buildConversationKey(message);
	if (mapping === undefined) {
		return { kind: "ignored", reason: "unsupported_chat_type", updateId: update.update_id };
	}

	const text = (message.text ?? message.caption ?? "").trim();
	if (text === "") {
		return { kind: "ignored", reason: "empty_text", updateId: update.update_id };
	}
	if (hasInvalidControlCharacters(text)) {
		return {
			kind: "ignored",
			reason: "invalid_control_characters",
			updateId: update.update_id,
		};
	}

	const displayName = [message.from?.first_name, message.from?.last_name]
		.filter((value): value is string => typeof value === "string" && value !== "")
		.join(" ")
		.trim();
	const media = extractMedia(message);

	const value: InboundEnvelope = {
		accountId: "default",
		channel: "telegram",
		content: {
			...(media === undefined ? {} : { media }),
			text,
		},
		conversationKey: mapping.conversationKey,
		messageId: String(message.message_id),
		meta: {
			rawUpdateId: update.update_id,
			receivedAt: new Date().toISOString(),
			...(mapping.messageThreadId === undefined
				? {}
				: { threadKey: String(mapping.messageThreadId) }),
		},
		...(message.reply_to_message === undefined
			? {}
			: {
					replyTo: {
						messageId: String(message.reply_to_message.message_id),
						...(message.reply_to_message.from?.id === undefined
							? {}
							: { senderId: String(message.reply_to_message.from.id) }),
						...(message.reply_to_message.text === undefined &&
						message.reply_to_message.caption === undefined
							? {}
							: {
									text: message.reply_to_message.text ?? message.reply_to_message.caption ?? "",
								}),
					},
				}),
		transport: {
			chatId: message.chat.id,
			...(mapping.messageThreadId === undefined
				? {}
				: { messageThreadId: mapping.messageThreadId }),
			...(message.reply_to_message === undefined
				? {}
				: { replyToMessageId: message.reply_to_message.message_id }),
		},
		user: {
			id: String(message.from?.id ?? message.chat.id),
			...(displayName === "" ? {} : { displayName }),
			...(message.from?.is_bot === undefined ? {} : { isBot: message.from.is_bot }),
			...(message.from?.username === undefined ? {} : { username: message.from.username }),
		},
	};

	return { kind: "message", updateId: update.update_id, value };
}
