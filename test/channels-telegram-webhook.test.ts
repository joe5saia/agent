import { afterEach, describe, expect, it } from "vitest";
import type { TelegramUpdate } from "../src/channels/telegram/types.js";
import {
	TelegramWebhookServer,
	verifyTelegramWebhookSecret,
} from "../src/channels/telegram/webhook.js";

const runningServers: Array<TelegramWebhookServer> = [];

afterEach(async () => {
	for (const server of runningServers.splice(0)) {
		await server.stop();
	}
});

describe("telegram webhook", () => {
	it("S24.3: rejects invalid webhook secret", async () => {
		const received: Array<TelegramUpdate> = [];
		const server = new TelegramWebhookServer({
			host: "127.0.0.1",
			onUpdate: async (update) => {
				received.push(update);
				return "accepted";
			},
			path: "/hook",
			port: 0,
			secret: "abcdefghijklmnop",
		});
		runningServers.push(server);
		await server.start();
		const port = server.getPort();
		if (port === undefined) {
			throw new Error("Expected webhook server port");
		}

		const response = await fetch(`http://127.0.0.1:${String(port)}/hook`, {
			body: JSON.stringify({ update_id: 1 }),
			headers: {
				"x-telegram-bot-api-secret-token": "wrong-secret",
			},
			method: "POST",
		});

		expect(response.status).toBe(401);
		expect(received).toHaveLength(0);
	});

	it("accepts valid webhook requests and can apply 503 backpressure", async () => {
		let calls = 0;
		const server = new TelegramWebhookServer({
			host: "127.0.0.1",
			onUpdate: async () => {
				calls += 1;
				return calls === 1 ? "accepted" : "global_queue_full";
			},
			path: "/hook",
			port: 0,
			secret: "abcdefghijklmnop",
		});
		runningServers.push(server);
		await server.start();
		const port = server.getPort();
		if (port === undefined) {
			throw new Error("Expected webhook server port");
		}

		const headers = {
			"content-type": "application/json",
			"x-telegram-bot-api-secret-token": "abcdefghijklmnop",
		};
		const first = await fetch(`http://127.0.0.1:${String(port)}/hook`, {
			body: JSON.stringify({ update_id: 1 }),
			headers,
			method: "POST",
		});
		const second = await fetch(`http://127.0.0.1:${String(port)}/hook`, {
			body: JSON.stringify({ update_id: 2 }),
			headers,
			method: "POST",
		});

		expect(first.status).toBe(200);
		expect(second.status).toBe(503);
		expect(calls).toBe(2);
	});

	it("verifies webhook secrets in constant-time-safe manner", () => {
		expect(verifyTelegramWebhookSecret("abcdefghijklmnop", "abcdefghijklmnop")).toBe(true);
		expect(verifyTelegramWebhookSecret("abcdefghijklmnop", "abc")).toBe(false);
		expect(verifyTelegramWebhookSecret("abcdefghijklmnop", undefined)).toBe(false);
	});
});
