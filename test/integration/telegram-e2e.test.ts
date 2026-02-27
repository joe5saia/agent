import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import type { Message } from "@mariozechner/pi-ai";
import { afterEach, describe, expect, it } from "vitest";
import { createTelegramRuntime } from "../../src/channels/telegram/index.js";
import { createConfig, createServerDeps } from "../helpers/server-fixtures.js";

const tempDirectories: Array<string> = [];
const originalFetch = globalThis.fetch;

function createTempDirectory(prefix: string): string {
	const directory = mkdtempSync(join(tmpdir(), prefix));
	tempDirectories.push(directory);
	return directory;
}

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
	globalThis.fetch = originalFetch;
	for (const directory of tempDirectories.splice(0)) {
		rmSync(directory, { force: true, recursive: true });
	}
});

describe("integration: telegram runtime", () => {
	it("S26.4: end-to-end Telegram message persists user and assistant records", async () => {
		const events: Array<{ event: string; fields?: Record<string, unknown> }> = [];
		const deps = createServerDeps(events);
		const agentDir = createTempDirectory("agent-telegram-dir-");

		const config = createConfig({
			channels: {
				telegram: {
					botToken: "test-token",
					dmPolicy: "open",
					enabled: true,
					polling: {
						timeoutSeconds: 1,
					},
					streaming: {
						mode: "off",
						statusDebounceMs: 0,
					},
				},
			},
		});

		const updateQueue = [
			{
				message: {
					chat: { id: 101, type: "private" },
					from: { id: 101, is_bot: false, username: "alice" },
					message_id: 1,
					text: "hello",
				},
				update_id: 1,
			},
		];
		const sentTexts: Array<string> = [];
		globalThis.fetch = (async (input: string | URL, init?: RequestInit) => {
			const url = String(input);
			const method = url.split("/").at(-1);
			if (method === "getMe") {
				return new Response(
					JSON.stringify({ ok: true, result: { id: 999, username: "agentbot" } }),
					{
						headers: { "content-type": "application/json" },
						status: 200,
					},
				);
			}
			if (method === "getUpdates") {
				const next = updateQueue.shift();
				return new Response(
					JSON.stringify({ ok: true, result: next === undefined ? [] : [next] }),
					{
						headers: { "content-type": "application/json" },
						status: 200,
					},
				);
			}
			if (method === "sendMessage") {
				const payload =
					typeof init?.body === "string"
						? (JSON.parse(init.body) as { text?: string })
						: ({ text: "" } as { text?: string });
				sentTexts.push(payload.text ?? "");
				return new Response(
					JSON.stringify({ ok: true, result: { message_id: sentTexts.length } }),
					{
						headers: { "content-type": "application/json" },
						status: 200,
					},
				);
			}
			if (method === "editMessageText") {
				return new Response(JSON.stringify({ ok: true, result: true }), {
					headers: { "content-type": "application/json" },
					status: 200,
				});
			}
			throw new Error(`Unexpected Telegram method in test: ${method}`);
		}) as typeof fetch;

		deps.runAgentLoop = async (messages) => [...messages, assistantMessage("telegram-ok")];
		const runtime = createTelegramRuntime(
			{
				config,
				logger: deps.logger,
				model: deps.model,
				runAgentLoop: deps.runAgentLoop,
				sessionManager: deps.sessionManager,
				systemPromptBuilder: deps.systemPromptBuilder,
				toolRegistry: deps.toolRegistry,
			},
			{ agentDir },
		);

		await runtime.start();
		await sleep(150);
		await runtime.stop();

		expect(sentTexts.some((text) => text.includes("telegram-ok"))).toBe(true);
		const sessions = await deps.sessionManager.list();
		expect(sessions.length).toBe(1);
		const firstSession = sessions[0];
		if (firstSession === undefined) {
			throw new Error("Expected a persisted session");
		}
		const messages = await deps.sessionManager.buildContext(firstSession.id);
		expect(messages.some((message) => message.role === "user")).toBe(true);
		expect(messages.some((message) => message.role === "assistant")).toBe(true);
	});
});
