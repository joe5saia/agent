import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Message, Model } from "@mariozechner/pi-ai";
import { afterEach, describe, expect, it } from "vitest";
import { agentLoop } from "../src/agent/index.js";
import { SessionManager } from "../src/sessions/index.js";
import { ToolRegistry } from "../src/tools/index.js";
import { createMockStreamFactory } from "./helpers/mock-llm.js";

const tempDirectories: Array<string> = [];

function createTempDirectory(): string {
	const directory = mkdtempSync(join(tmpdir(), "agent-token-test-"));
	tempDirectories.push(directory);
	return directory;
}

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

afterEach(() => {
	for (const directory of tempDirectories.splice(0)) {
		rmSync(directory, { force: true, recursive: true });
	}
});

describe("token tracking", () => {
	it("includes turn token usage in turn_end logs", async () => {
		const events: Array<{ event: string; fields?: Record<string, unknown> }> = [];
		const logger = {
			error: (event: string, fields?: Record<string, unknown>) => {
				events.push({ event, fields });
			},
			info: (event: string, fields?: Record<string, unknown>) => {
				events.push({ event, fields });
			},
			warn: (event: string, fields?: Record<string, unknown>) => {
				events.push({ event, fields });
			},
		};

		const metrics: Array<{
			durationMs: number;
			inputTokens: number;
			outputTokens: number;
			toolCalls: number;
			totalTokens: number;
		}> = [];

		const result = await agentLoop(
			[userMessage("hello")],
			new ToolRegistry(),
			"system",
			createModel(),
			{
				logger,
				maxIterations: 3,
				onTurnComplete: (event) => {
					metrics.push(event);
				},
				streamFactory: createMockStreamFactory([
					{
						assistant: {
							api: "openai-completions",
							content: [{ text: "done", type: "text" }],
							model: "gpt-test",
							provider: "openai",
							role: "assistant",
							stopReason: "stop",
							timestamp: Date.now(),
							usage: {
								cacheRead: 0,
								cacheWrite: 0,
								cost: { cacheRead: 0, cacheWrite: 0, input: 0, output: 0, total: 0 },
								input: 11,
								output: 7,
								totalTokens: 18,
							},
						},
					},
				]),
			},
		);

		expect(result.at(-1)?.role).toBe("assistant");
		expect(metrics).toHaveLength(1);
		expect(metrics[0]).toMatchObject({
			inputTokens: 11,
			outputTokens: 7,
			toolCalls: 0,
			totalTokens: 18,
		});

		const turnEnd = events.find(
			(entry) => entry.event === "turn_end" && entry.fields?.["stopReason"] === "stop",
		);
		expect(turnEnd?.fields?.["inputTokens"]).toBe(11);
		expect(turnEnd?.fields?.["outputTokens"]).toBe(7);
		expect(turnEnd?.fields?.["totalTokens"]).toBe(18);
	});

	it("aggregates SessionMetrics across turns", async () => {
		const manager = new SessionManager({
			defaultModel: "gpt-test",
			sessionsDir: createTempDirectory(),
		});
		const session = await manager.create();

		await manager.recordTurnMetrics(session.id, {
			durationMs: 120,
			inputTokens: 12,
			outputTokens: 8,
			toolCalls: 1,
			totalTokens: 20,
		});
		await manager.recordTurnMetrics(session.id, {
			durationMs: 80,
			inputTokens: 7,
			outputTokens: 3,
			toolCalls: 2,
			totalTokens: 10,
		});

		const metadata = await manager.get(session.id);
		expect(metadata.metrics).toEqual({
			totalDurationMs: 200,
			totalTokens: 30,
			totalToolCalls: 3,
			totalTurns: 2,
		});
	});
});
