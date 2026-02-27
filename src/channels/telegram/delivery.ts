import { setTimeout as sleep } from "node:timers/promises";
import type { OutboundEnvelope } from "../types.js";

/**
 * Runtime stream state for one Telegram run.
 */
export interface TelegramTurnStreamState {
	lastPreviewAtMs: number;
	previewMessageId?: number;
	previewText: string;
}

export interface TelegramDeliveryOptions {
	delivery: {
		textChunkLimit: number;
	};
	streaming: {
		mode: "block" | "off" | "partial" | "progress";
		statusDebounceMs: number;
	};
}

export interface TelegramDeliveryTransport {
	editText: (
		chatId: number,
		options: {
			messageId: number;
			text: string;
		},
	) => Promise<void>;
	sendText: (
		chatId: number,
		options: {
			replyToMessageId?: number;
			text: string;
			threadId?: number;
		},
	) => Promise<number>;
}

function shouldPreviewStream(mode: TelegramDeliveryOptions["streaming"]["mode"]): boolean {
	return mode === "partial" || mode === "progress";
}

/**
 * Creates the initial stream state used for delta previews.
 */
export function createTurnStreamState(): TelegramTurnStreamState {
	return {
		lastPreviewAtMs: 0,
		previewText: "",
	};
}

/**
 * Deterministically splits text to Telegram-safe chunks by code points.
 */
export function splitTextForTelegram(value: string, maxChunkLength: number): Array<string> {
	const codePoints = Array.from(value);
	if (codePoints.length <= maxChunkLength) {
		return [value];
	}

	const chunks: Array<string> = [];
	let cursor = 0;
	while (cursor < codePoints.length) {
		let end = Math.min(cursor + maxChunkLength, codePoints.length);
		const window = codePoints.slice(cursor, end).join("");
		const paragraphBoundary = window.lastIndexOf("\n\n");
		if (paragraphBoundary > 0 && end < codePoints.length) {
			end = cursor + Array.from(window.slice(0, paragraphBoundary)).length;
		}
		const chunk = codePoints.slice(cursor, end).join("");
		chunks.push(chunk);
		cursor = end;
	}

	return chunks;
}

/**
 * Handles stream delta updates as preview edits/messages.
 */
export async function handleTelegramStreamDelta(
	options: TelegramDeliveryOptions,
	transport: TelegramDeliveryTransport,
	envelope: OutboundEnvelope,
	streamState: TelegramTurnStreamState,
	delta: string,
): Promise<number | undefined> {
	if (!shouldPreviewStream(options.streaming.mode)) {
		return undefined;
	}

	streamState.previewText += delta;
	const nowMs = Date.now();
	if (
		streamState.previewMessageId !== undefined &&
		options.streaming.statusDebounceMs > 0 &&
		nowMs - streamState.lastPreviewAtMs < options.streaming.statusDebounceMs
	) {
		return streamState.previewMessageId;
	}

	const chunk =
		splitTextForTelegram(streamState.previewText, options.delivery.textChunkLimit)[0] ?? "";
	if (streamState.previewMessageId === undefined) {
		const createdId = await transport.sendText(envelope.transport.chatId, {
			...(envelope.transport.replyToMessageId === undefined
				? {}
				: { replyToMessageId: envelope.transport.replyToMessageId }),
			text: chunk,
			...(envelope.transport.messageThreadId === undefined
				? {}
				: { threadId: envelope.transport.messageThreadId }),
		});
		streamState.previewMessageId = createdId;
		streamState.lastPreviewAtMs = nowMs;
		return createdId;
	}

	await transport.editText(envelope.transport.chatId, {
		messageId: streamState.previewMessageId,
		text: chunk,
	});
	streamState.lastPreviewAtMs = nowMs;
	return streamState.previewMessageId;
}

/**
 * Sends a debounced status line to Telegram.
 */
export async function emitTelegramStatus(
	options: TelegramDeliveryOptions,
	transport: TelegramDeliveryTransport,
	envelope: OutboundEnvelope,
	text: string,
): Promise<number> {
	if (options.streaming.statusDebounceMs > 0) {
		await sleep(options.streaming.statusDebounceMs);
	}
	return await transport.sendText(envelope.transport.chatId, {
		...(envelope.transport.replyToMessageId === undefined
			? {}
			: { replyToMessageId: envelope.transport.replyToMessageId }),
		text,
		...(envelope.transport.messageThreadId === undefined
			? {}
			: { threadId: envelope.transport.messageThreadId }),
	});
}

/**
 * Finalizes Telegram output by editing preview when possible and chunk-sending the remainder.
 */
export async function deliverTelegramFinalText(
	options: TelegramDeliveryOptions,
	transport: TelegramDeliveryTransport,
	envelope: OutboundEnvelope,
	streamState: TelegramTurnStreamState,
	text: string,
): Promise<Array<number>> {
	const chunks = splitTextForTelegram(text, options.delivery.textChunkLimit);
	if (chunks.length === 0) {
		return [];
	}

	const deliveredMessageIds: Array<number> = [];
	if (streamState.previewMessageId !== undefined) {
		await transport.editText(envelope.transport.chatId, {
			messageId: streamState.previewMessageId,
			text: chunks[0] ?? "",
		});
		deliveredMessageIds.push(streamState.previewMessageId);
		for (const chunk of chunks.slice(1)) {
			const messageId = await transport.sendText(envelope.transport.chatId, {
				text: chunk,
				...(envelope.transport.messageThreadId === undefined
					? {}
					: { threadId: envelope.transport.messageThreadId }),
			});
			deliveredMessageIds.push(messageId);
		}
		return deliveredMessageIds;
	}

	for (const [index, chunk] of chunks.entries()) {
		const messageId = await transport.sendText(envelope.transport.chatId, {
			...(index === 0 && envelope.transport.replyToMessageId !== undefined
				? { replyToMessageId: envelope.transport.replyToMessageId }
				: {}),
			text: chunk,
			...(envelope.transport.messageThreadId === undefined
				? {}
				: { threadId: envelope.transport.messageThreadId }),
		});
		deliveredMessageIds.push(messageId);
	}
	return deliveredMessageIds;
}
