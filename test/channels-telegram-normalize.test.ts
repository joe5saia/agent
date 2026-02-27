import { describe, expect, it } from "vitest";
import { normalizeTelegramUpdate } from "../src/channels/telegram/normalize.js";

describe("telegram normalize", () => {
	it("S23.1 + S24.10: normalizes DM thread conversation keys deterministically", () => {
		const result = normalizeTelegramUpdate(
			{
				message: {
					chat: { id: 777, type: "private" },
					from: { id: 123 },
					message_id: 42,
					message_thread_id: 9,
					text: "hello",
				},
				update_id: 1,
			},
			{ ignoreBotMessages: true },
		);

		expect(result.kind).toBe("message");
		if (result.kind !== "message") {
			return;
		}
		expect(result.value.conversationKey).toBe("telegram:dm:123:thread:9");
		expect(result.value.transport.messageThreadId).toBe(9);
	});

	it("S24.8: isolates forum topic messages by topic ID", () => {
		const result = normalizeTelegramUpdate(
			{
				message: {
					chat: { id: -100, is_forum: true, type: "supergroup" },
					from: { id: 55 },
					message_id: 10,
					message_thread_id: 99,
					text: "topic",
				},
				update_id: 2,
			},
			{ ignoreBotMessages: true },
		);

		expect(result.kind).toBe("message");
		if (result.kind !== "message") {
			return;
		}
		expect(result.value.conversationKey).toBe("telegram:group:-100:topic:99");
	});

	it("S24.19: treats edited messages as non-runnable events", () => {
		const result = normalizeTelegramUpdate(
			{
				edited_message: {
					chat: { id: 1, type: "private" },
					message_id: 2,
					text: "edited",
				},
				update_id: 3,
			},
			{ ignoreBotMessages: true },
		);

		expect(result).toEqual({
			kind: "edited_message",
			reason: "edited_message",
			updateId: 3,
		});
	});

	it("S24.21: ignores bot-authored messages when configured", () => {
		const result = normalizeTelegramUpdate(
			{
				message: {
					chat: { id: 1, type: "private" },
					from: { id: 2, is_bot: true },
					message_id: 3,
					text: "bot",
				},
				update_id: 4,
			},
			{ ignoreBotMessages: true },
		);

		expect(result).toEqual({
			kind: "ignored",
			reason: "bot_message",
			updateId: 4,
		});
	});

	it("S24.3: rejects invalid control characters", () => {
		const result = normalizeTelegramUpdate(
			{
				message: {
					chat: { id: 1, type: "private" },
					from: { id: 2 },
					message_id: 3,
					text: "bad\u0001text",
				},
				update_id: 5,
			},
			{ ignoreBotMessages: true },
		);

		expect(result).toEqual({
			kind: "ignored",
			reason: "invalid_control_characters",
			updateId: 5,
		});
	});
});
