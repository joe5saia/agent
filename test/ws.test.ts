import { setTimeout as sleep } from "node:timers/promises";
import type { Message } from "@mariozechner/pi-ai";
import { afterEach, describe, expect, it } from "vitest";
import { WebSocket } from "ws";
import { startServer } from "../src/server/index.js";
import { createConfig, createServerDeps, cleanupTempDirs } from "./helpers/server-fixtures.js";

function assistantMessage(text: string): Extract<Message, { role: "assistant" }> {
	return {
		api: "openai-completions",
		content: [{ text, type: "text" }],
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

afterEach(() => {
	cleanupTempDirs();
});

describe("ws runtime", () => {
	it("S10.3 + S10.10: streams events and handles missing sessions", async () => {
		const events: Array<{ event: string; fields?: Record<string, unknown> }> = [];
		const deps = createServerDeps(events);
		deps.runAgentLoop = async (messages, _tools, _prompt, _model, _config, _signal, onEvent) => {
			onEvent?.({
				event: {
					contentIndex: 0,
					delta: "hello",
					partial: assistantMessage(""),
					type: "text_delta",
				},
				type: "stream",
			});
			return [...messages, assistantMessage("hello")];
		};
		const created = await deps.sessionManager.create();

		const server = await startServer(
			createConfig({ server: { host: "127.0.0.1", port: 0 } }),
			deps,
		);
		const address = server.httpServer.address();
		if (address === null || typeof address === "string") {
			throw new Error("Expected TCP address");
		}

		const client = new WebSocket(`ws://127.0.0.1:${address.port}/ws`);
		await new Promise<void>((resolve, reject) => {
			client.once("open", () => resolve());
			client.once("error", reject);
		});

		const payloads: Array<{ content?: string; error?: string; type: string }> = [];
		client.on("message", (buffer) => {
			payloads.push(
				JSON.parse(buffer.toString("utf8")) as { content?: string; error?: string; type: string },
			);
		});

		client.send(JSON.stringify({ content: "x", sessionId: "BAD", type: "send_message" }));
		client.send(JSON.stringify({ content: "hi", sessionId: created.id, type: "send_message" }));
		await sleep(100);

		expect(
			payloads.some((entry) => entry.type === "error" && entry.error === "Invalid session ID"),
		).toBe(true);
		expect(payloads.some((entry) => entry.type === "run_start")).toBe(true);
		expect(payloads.some((entry) => entry.type === "stream_delta")).toBe(true);
		expect(payloads.some((entry) => entry.type === "message_complete")).toBe(true);

		client.close();
		await server.close();
	});

	it("S10.5: serializes runs per session", async () => {
		const events: Array<{ event: string; fields?: Record<string, unknown> }> = [];
		const deps = createServerDeps(events);
		const created = await deps.sessionManager.create();
		const starts: Array<number> = [];
		deps.runAgentLoop = async (messages) => {
			starts.push(Date.now());
			await sleep(50);
			return [...messages, assistantMessage("ok")];
		};

		const server = await startServer(
			createConfig({ server: { host: "127.0.0.1", port: 0 } }),
			deps,
		);
		const address = server.httpServer.address();
		if (address === null || typeof address === "string") {
			throw new Error("Expected TCP address");
		}

		const client = new WebSocket(`ws://127.0.0.1:${address.port}/ws`);
		await new Promise<void>((resolve, reject) => {
			client.once("open", () => resolve());
			client.once("error", reject);
		});
		client.send(JSON.stringify({ content: "one", sessionId: created.id, type: "send_message" }));
		client.send(JSON.stringify({ content: "two", sessionId: created.id, type: "send_message" }));

		await sleep(200);
		expect(starts).toHaveLength(2);
		expect(starts[1]).toBeGreaterThanOrEqual(starts[0]);

		client.close();
		await server.close();
	});
});
