import type { Message, Model } from "@mariozechner/pi-ai";
import { Type } from "@sinclair/typebox";
import { describe, expect, it } from "vitest";
import { agentLoop } from "../src/agent/index.js";
import { ToolRegistry } from "../src/tools/index.js";
import { createMockStreamFactory } from "./helpers/mock-llm.js";

function createModel(): Model<"openai-completions"> {
	return {
		api: "openai-completions",
		baseUrl: "https://example.com",
		contextWindow: 128_000,
		cost: { cacheRead: 0, cacheWrite: 0, input: 0, output: 0 },
		headers: {},
		id: "gpt-test",
		input: ["text"],
		maxTokens: 4000,
		name: "gpt-test",
		provider: "openai",
		reasoning: false,
	};
}

function userMessage(text: string): Extract<Message, { role: "user" }> {
	return { content: [{ text, type: "text" }], role: "user", timestamp: Date.now() };
}

function assistantMessage(options: {
	content: Extract<Message, { role: "assistant" }>["content"];
	stopReason: Extract<Message, { role: "assistant" }>["stopReason"];
}): Extract<Message, { role: "assistant" }> {
	return {
		api: "openai-completions",
		content: options.content,
		model: "gpt-test",
		provider: "openai",
		role: "assistant",
		stopReason: options.stopReason,
		timestamp: Date.now(),
		usage: {
			cacheRead: 0,
			cacheWrite: 0,
			cost: { cacheRead: 0, cacheWrite: 0, input: 0, output: 0, total: 0 },
			input: 0,
			output: 0,
			totalTokens: 0,
		},
	};
}

describe("agent loop logging", () => {
	it("S14.3 + S14.4: logs turn and tool events", async () => {
		const registry = new ToolRegistry();
		registry.register({
			category: "read",
			description: "Echo",
			async execute(args: Record<string, unknown>): Promise<string> {
				return String(args["value"] ?? "");
			},
			name: "echo",
			parameters: Type.Object({ value: Type.String() }),
		});

		const logs: Array<{ event: string; fields?: Record<string, unknown> }> = [];
		await agentLoop([userMessage("hi")], registry, "system", createModel(), {
			logger: {
				error(event, fields) {
					logs.push({ event, fields: fields as Record<string, unknown> | undefined });
				},
				info(event, fields) {
					logs.push({ event, fields: fields as Record<string, unknown> | undefined });
				},
				warn(event, fields) {
					logs.push({ event, fields: fields as Record<string, unknown> | undefined });
				},
			},
			maxIterations: 3,
			runId: "run-1",
			sessionId: "session-1",
			streamFactory: createMockStreamFactory([
				{
					assistant: assistantMessage({
						content: [{ arguments: { value: "x" }, id: "tc_1", name: "echo", type: "toolCall" }],
						stopReason: "toolUse",
					}),
				},
				{
					assistant: assistantMessage({
						content: [{ text: "done", type: "text" }],
						stopReason: "stop",
					}),
				},
			]),
		});

		expect(logs.some((entry) => entry.event === "turn_start")).toBe(true);
		expect(logs.some((entry) => entry.event === "tool_call")).toBe(true);
		expect(logs.some((entry) => entry.event === "tool_result")).toBe(true);
		expect(logs.some((entry) => entry.event === "turn_end")).toBe(true);
	});
});
