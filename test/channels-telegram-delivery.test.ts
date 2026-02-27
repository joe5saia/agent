import { describe, expect, it } from "vitest";
import {
	createTurnStreamState,
	deliverTelegramFinalText,
	handleTelegramStreamDelta,
	splitTextForTelegram,
} from "../src/channels/telegram/delivery.js";
import type { OutboundEnvelope } from "../src/channels/types.js";

function buildEnvelope(): OutboundEnvelope {
	return {
		accountId: "default",
		channel: "telegram",
		conversationKey: "telegram:dm:1",
		parts: [],
		runId: "RUN",
		transport: {
			chatId: 1,
		},
	};
}

describe("telegram delivery", () => {
	it("S24.14: chunks text deterministically", () => {
		const source = String.raw`first paragraph\n\nsecond paragraph`;
		const chunks = splitTextForTelegram(source, 10);
		expect(chunks.length).toBeGreaterThan(1);
		expect(chunks.join("")).toBe(source);
	});

	it("S24.11: stream preview updates respect debounce", async () => {
		const sent: Array<string> = [];
		const edits: Array<string> = [];
		const streamState = createTurnStreamState();
		const envelope = buildEnvelope();

		await handleTelegramStreamDelta(
			{
				delivery: { textChunkLimit: 4000 },
				streaming: { mode: "partial", statusDebounceMs: 10_000 },
			},
			{
				editText: async (_chatId, options) => {
					edits.push(options.text);
				},
				sendText: async (_chatId, options) => {
					sent.push(options.text);
					return 10;
				},
			},
			envelope,
			streamState,
			"a",
		);
		await handleTelegramStreamDelta(
			{
				delivery: { textChunkLimit: 4000 },
				streaming: { mode: "partial", statusDebounceMs: 10_000 },
			},
			{
				editText: async (_chatId, options) => {
					edits.push(options.text);
				},
				sendText: async (_chatId, options) => {
					sent.push(options.text);
					return 10;
				},
			},
			envelope,
			streamState,
			"b",
		);

		expect(sent).toHaveLength(1);
		expect(edits).toHaveLength(0);
	});

	it("S24.12: final response edits preview and sends overflow chunks", async () => {
		const edits: Array<string> = [];
		const sent: Array<string> = [];
		const streamState = createTurnStreamState();
		streamState.previewMessageId = 77;

		const messageIds = await deliverTelegramFinalText(
			{
				delivery: { textChunkLimit: 5 },
				streaming: { mode: "partial", statusDebounceMs: 0 },
			},
			{
				editText: async (_chatId, options) => {
					edits.push(options.text);
				},
				sendText: async (_chatId, options) => {
					sent.push(options.text);
					return 88 + sent.length;
				},
			},
			buildEnvelope(),
			streamState,
			"hello world",
		);

		expect(edits[0]).toBe("hello");
		expect(sent.length).toBeGreaterThan(0);
		expect(messageIds[0]).toBe(77);
	});
});
