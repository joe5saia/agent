import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getModels, type Api, type Model } from "@mariozechner/pi-ai";
import { afterAll, describe, expect, it } from "vitest";
import { WebSocket } from "ws";
import { startServer, type RunningServer } from "../../src/server/index.js";
import { SessionManager } from "../../src/sessions/index.js";
import { ToolRegistry } from "../../src/tools/index.js";

const hasAnthropicKey = process.env["ANTHROPIC_API_KEY"] !== undefined;
const describeIntegration = hasAnthropicKey ? describe : describe.skip;

const tempDirectories: Array<string> = [];
const runningServers: Array<RunningServer> = [];

function createTempDirectory(): string {
	const directory = mkdtempSync(join(tmpdir(), "agent-integration-test-"));
	tempDirectories.push(directory);
	return directory;
}

function resolveAnthropicModel(): Model<Api> {
	const configured = process.env["ANTHROPIC_MODEL"];
	const models = getModels("anthropic");
	const selected =
		(configured === undefined
			? models.find((model) => model.id.includes("haiku") || model.name.includes("haiku"))
			: models.find((model) => model.id === configured || model.name === configured)) ?? models[0];
	if (selected === undefined) {
		throw new Error("No anthropic model is available in pi-ai.");
	}
	return selected;
}

function waitForMessageComplete(socket: WebSocket): Promise<string> {
	return new Promise<string>((resolve, reject) => {
		const timeout = setTimeout(() => {
			reject(new Error("Timed out waiting for message_complete event."));
		}, 120_000);

		socket.addEventListener("message", (event) => {
			const payload = JSON.parse(String(event.data)) as {
				content?: string;
				error?: string;
				type: string;
			};
			if (payload.type === "error") {
				clearTimeout(timeout);
				reject(new Error(payload.error ?? "Unknown websocket error"));
				return;
			}
			if (payload.type !== "message_complete") {
				return;
			}
			clearTimeout(timeout);
			resolve(payload.content ?? "");
		});
	});
}

afterAll(async () => {
	for (const server of runningServers.splice(0)) {
		await server.close();
	}
	for (const directory of tempDirectories.splice(0)) {
		rmSync(directory, { force: true, recursive: true });
	}
});

describeIntegration("integration: agent websocket e2e", () => {
	it(
		"S21.4: creates a session, streams a response, and persists JSONL history",
		{ retry: 3 },
		async () => {
			const sessionsDir = createTempDirectory();
			const model = resolveAnthropicModel();
			const sessionManager = new SessionManager({
				contextWindow: model.contextWindow,
				defaultModel: model.id,
				sessionsDir,
			});
			const logger = {
				debug: () => {
					return;
				},
				error: () => {
					return;
				},
				info: () => {
					return;
				},
				warn: () => {
					return;
				},
			};
			const server = await startServer(
				{
					compaction: {
						enabled: false,
						keepRecentTokens: 20_000,
						reserveTokens: 16_384,
					},
					logging: {
						file: join(sessionsDir, "integration.log"),
						level: "info",
						rotation: { maxDays: 7, maxSizeMb: 100 },
						stdout: false,
					},
					model: {
						name: model.id,
						provider: "anthropic",
					},
					retry: {
						baseDelayMs: 1000,
						maxDelayMs: 10_000,
						maxRetries: 2,
						retryableStatuses: [429, 500, 502, 503, 529],
					},
					security: {
						allowedEnv: ["PATH", "HOME"],
						allowedPaths: [sessionsDir],
						allowedUsers: [],
						blockedCommands: ["rm -rf"],
						deniedPaths: [],
					},
					server: {
						host: "127.0.0.1",
						port: 0,
					},
					systemPrompt: {
						identityFile: join(sessionsDir, "missing-identity.md"),
					},
					tools: {
						maxIterations: 4,
						outputLimit: 200_000,
						timeout: 30,
					},
				},
				{
					apiKeyResolver: async () => process.env["ANTHROPIC_API_KEY"],
					logger,
					model,
					sessionManager,
					systemPromptBuilder: () => "You are a concise assistant.",
					toolRegistry: new ToolRegistry(),
				},
			);
			runningServers.push(server);

			const createResponse = await server.app.request("/api/sessions", { method: "POST" });
			expect(createResponse.status).toBe(200);
			const created = (await createResponse.json()) as { id: string };

			const address = server.httpServer.address();
			if (address === null || typeof address === "string") {
				throw new Error("Failed to resolve listening address.");
			}
			const socket = new WebSocket(
				`ws://127.0.0.1:${String(address.port)}/ws?sessionId=${created.id}`,
			);
			await new Promise<void>((resolve, reject) => {
				socket.addEventListener("open", () => resolve());
				socket.addEventListener("error", (error) => reject(error));
			});

			const completionPromise = waitForMessageComplete(socket);
			socket.send(
				JSON.stringify({
					content: "Reply with exactly: integration-ok",
					sessionId: created.id,
					type: "send_message",
				}),
			);

			const assistantOutput = await completionPromise;
			expect(assistantOutput.toLowerCase()).toContain("integration-ok");
			socket.close();

			const context = await sessionManager.buildContext(created.id);
			expect(context.some((message) => message.role === "user")).toBe(true);
			expect(context.some((message) => message.role === "assistant")).toBe(true);
		},
	);
});
