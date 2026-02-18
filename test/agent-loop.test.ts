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
	return {
		content: [{ text, type: "text" }],
		role: "user",
		timestamp: Date.now(),
	};
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

describe("agentLoop", () => {
	it("S5.1: returns after a single non-tool response", async () => {
		const registry = new ToolRegistry();
		const messages: Array<Message> = [userMessage("hello")];
		const result = await agentLoop(messages, registry, "system", createModel(), {
			maxIterations: 5,
			streamFactory: createMockStreamFactory([
				{
					assistant: assistantMessage({
						content: [{ text: "hi", type: "text" }],
						stopReason: "stop",
					}),
				},
			]),
		});

		expect(result).toHaveLength(2);
		expect(result.at(-1)?.role).toBe("assistant");
	});

	it("S5.2: executes a tool call then continues", async () => {
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

		const messages: Array<Message> = [userMessage("use tool")];
		const result = await agentLoop(messages, registry, "system", createModel(), {
			maxIterations: 5,
			streamFactory: createMockStreamFactory([
				{
					assistant: assistantMessage({
						content: [
							{ arguments: { value: "hello" }, id: "tc_1", name: "echo", type: "toolCall" },
						],
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

		expect(result.some((message) => message.role === "toolResult")).toBe(true);
		expect(result.at(-1)?.role).toBe("assistant");
	});

	it("S5.3: executes multiple tool calls in one turn", async () => {
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

		const messages: Array<Message> = [userMessage("multi")];
		const result = await agentLoop(messages, registry, "system", createModel(), {
			maxIterations: 5,
			streamFactory: createMockStreamFactory([
				{
					assistant: assistantMessage({
						content: [
							{ arguments: { value: "a" }, id: "tc_1", name: "echo", type: "toolCall" },
							{ arguments: { value: "b" }, id: "tc_2", name: "echo", type: "toolCall" },
						],
						stopReason: "toolUse",
					}),
				},
				{
					assistant: assistantMessage({
						content: [{ text: "ok", type: "text" }],
						stopReason: "stop",
					}),
				},
			]),
		});

		const toolResults = result.filter((message) => message.role === "toolResult");
		expect(toolResults).toHaveLength(2);
	});

	it("S5.4: tool failures are returned as isError tool results", async () => {
		const registry = new ToolRegistry();
		registry.register({
			category: "read",
			description: "Fail",
			async execute(): Promise<string> {
				throw new Error("boom");
			},
			name: "explode",
			parameters: Type.Object({}),
		});

		const messages: Array<Message> = [userMessage("fail")];
		const result = await agentLoop(messages, registry, "system", createModel(), {
			maxIterations: 5,
			streamFactory: createMockStreamFactory([
				{
					assistant: assistantMessage({
						content: [{ arguments: {}, id: "tc_1", name: "explode", type: "toolCall" }],
						stopReason: "toolUse",
					}),
				},
				{
					assistant: assistantMessage({
						content: [{ text: "handled", type: "text" }],
						stopReason: "stop",
					}),
				},
			]),
		});

		const toolResult = result.find((message) => message.role === "toolResult");
		expect(toolResult?.role).toBe("toolResult");
		if (toolResult?.role === "toolResult") {
			expect(toolResult.isError).toBe(true);
		}
	});

	it("S5.5: abort signal stops loop cleanly", async () => {
		const registry = new ToolRegistry();
		const controller = new AbortController();
		controller.abort(new Error("cancelled"));
		await expect(
			agentLoop(
				[userMessage("hi")],
				registry,
				"system",
				createModel(),
				{
					maxIterations: 3,
					streamFactory: createMockStreamFactory([
						{
							assistant: assistantMessage({
								content: [{ text: "ignored", type: "text" }],
								stopReason: "stop",
							}),
						},
					]),
				},
				controller.signal,
			),
		).rejects.toThrowError();
	});

	it("S5.6: supports multi-iteration tool loops", async () => {
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

		const result = await agentLoop([userMessage("loop")], registry, "system", createModel(), {
			maxIterations: 5,
			streamFactory: createMockStreamFactory([
				{
					assistant: assistantMessage({
						content: [{ arguments: { value: "1" }, id: "tc_1", name: "echo", type: "toolCall" }],
						stopReason: "toolUse",
					}),
				},
				{
					assistant: assistantMessage({
						content: [{ arguments: { value: "2" }, id: "tc_2", name: "echo", type: "toolCall" }],
						stopReason: "toolUse",
					}),
				},
				{
					assistant: assistantMessage({
						content: [{ text: "final", type: "text" }],
						stopReason: "stop",
					}),
				},
			]),
		});

		expect(result.filter((message) => message.role === "toolResult")).toHaveLength(2);
		expect(result.at(-1)?.role).toBe("assistant");
	});

	it("S5.7: appends terminal message when max iterations are reached", async () => {
		const registry = new ToolRegistry();
		registry.register({
			category: "read",
			description: "Echo",
			async execute(): Promise<string> {
				return "ok";
			},
			name: "echo",
			parameters: Type.Object({}),
		});

		const result = await agentLoop([userMessage("loop")], registry, "system", createModel(), {
			maxIterations: 1,
			streamFactory: createMockStreamFactory([
				{
					assistant: assistantMessage({
						content: [{ arguments: {}, id: "tc_1", name: "echo", type: "toolCall" }],
						stopReason: "toolUse",
					}),
				},
			]),
		});

		expect(JSON.stringify(result.at(-1))).toContain("maximum iteration limit reached");
	});

	it("S5.8: propagates AbortSignal to stream and tool execution", async () => {
		const registry = new ToolRegistry();
		let receivedToolSignal = false;
		registry.register({
			category: "read",
			description: "Echo",
			async execute(_args: Record<string, unknown>, signal?: AbortSignal): Promise<string> {
				receivedToolSignal = signal !== undefined;
				return "ok";
			},
			name: "echo",
			parameters: Type.Object({}),
		});

		const controller = new AbortController();
		let receivedStreamSignal = false;
		await agentLoop(
			[userMessage("loop")],
			registry,
			"system",
			createModel(),
			{
				maxIterations: 2,
				streamFactory: (model, context, options) => {
					receivedStreamSignal = options?.signal === controller.signal;
					return createMockStreamFactory([
						{
							assistant: assistantMessage({
								content: [{ arguments: {}, id: "tc_1", name: "echo", type: "toolCall" }],
								stopReason: "toolUse",
							}),
						},
						{
							assistant: assistantMessage({
								content: [{ text: "done", type: "text" }],
								stopReason: "stop",
							}),
						},
					])(model, context, options);
				},
			},
			controller.signal,
		);

		expect(receivedStreamSignal).toBe(true);
		expect(receivedToolSignal).toBe(true);
	});
});
