import type { Message } from "@mariozechner/pi-ai";
import { describe, expect, it } from "vitest";
import { toSessionAppendInput } from "../src/sessions/index.js";

function assistantMessage(
	content: Extract<Message, { role: "assistant" }>["content"],
): Extract<Message, { role: "assistant" }> {
	return {
		api: "openai-completions",
		content,
		model: "gpt-test",
		provider: "openai",
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
	};
}

describe("session message codec", () => {
	it("does not persist assistant thinking blocks", () => {
		const appendInput = toSessionAppendInput(
			assistantMessage([
				{ text: "visible", type: "text" },
				{ thinking: "private reasoning", type: "thinking" },
			]),
		);

		expect(appendInput).toEqual({
			content: [{ text: "visible", type: "text" }],
			role: "assistant",
		});
	});

	it("preserves toolResult tool names", () => {
		const toolResult: Extract<Message, { role: "toolResult" }> = {
			content: [{ text: "ok", type: "text" }],
			isError: false,
			role: "toolResult",
			timestamp: Date.now(),
			toolCallId: "call_1",
			toolName: "read_file",
		};

		const appendInput = toSessionAppendInput(toolResult);
		expect(appendInput).toEqual({
			content: [{ text: "ok", type: "text" }],
			isError: false,
			role: "toolResult",
			toolCallId: "call_1",
			toolName: "read_file",
		});
	});
});
