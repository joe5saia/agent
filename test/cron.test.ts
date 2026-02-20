import { setTimeout as sleep } from "node:timers/promises";
import type { Message } from "@mariozechner/pi-ai";
import { Type } from "@sinclair/typebox";
import { afterEach, describe, expect, it } from "vitest";
import { CronService } from "../src/cron/index.js";
import { SessionManager } from "../src/sessions/index.js";
import { ToolRegistry } from "../src/tools/index.js";
import {
	cleanupTempDirs,
	createLoggerSink,
	createModel,
	createTempSessionsDir,
} from "./helpers/server-fixtures.js";

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

describe("cron service", () => {
	it("S8.2 + S8.3: schedules enabled jobs and creates isolated cron sessions", async () => {
		const logEvents: Array<{ event: string; fields?: Record<string, unknown> }> = [];
		const sessionManager = new SessionManager({
			defaultModel: "gpt-test",
			sessionsDir: createTempSessionsDir(),
		});
		const toolRegistry = new ToolRegistry();
		const service = new CronService({
			defaultMaxIterations: 3,
			logger: createLoggerSink(logEvents),
			model: createModel(),
			runAgentLoop: async (messages) => [...messages, assistantMessage("done")],
			sessionManager,
			systemPromptBuilder: () => "system",
			toolRegistry,
		});

		service.start([
			{ enabled: false, id: "disabled", prompt: "skip", schedule: "*/1 * * * * *" },
			{ enabled: true, id: "daily", prompt: "run", schedule: "*/1 * * * * *" },
		]);
		await sleep(1200);
		service.stop();

		const sessions = await sessionManager.list();
		expect(sessions.some((session) => session.source === "cron")).toBe(true);
		const cronSession = sessions.find((session) => session.source === "cron");
		expect(cronSession?.name.startsWith("[cron] daily")).toBe(true);
		const metadata =
			cronSession === undefined ? undefined : await sessionManager.get(cronSession.id);
		expect(metadata?.cronJobId).toBe("daily");
	});

	it("S8.7 + S8.13: supports pause/resume and status listing", async () => {
		const sessionManager = new SessionManager({
			defaultModel: "gpt-test",
			sessionsDir: createTempSessionsDir(),
		});
		const service = new CronService({
			defaultMaxIterations: 3,
			logger: createLoggerSink([]),
			model: createModel(),
			runAgentLoop: async (messages) => [...messages, assistantMessage("ok")],
			sessionManager,
			systemPromptBuilder: () => "system",
			toolRegistry: new ToolRegistry(),
		});

		service.start([{ enabled: true, id: "job", prompt: "run", schedule: "*/1 * * * * *" }]);
		expect(service.pause("job")).toBe(true);
		expect(service.pause("missing")).toBe(false);
		const paused = service.getStatus().find((entry) => entry.id === "job");
		expect(paused?.enabled).toBe(false);
		expect(service.resume("job")).toBe(true);
		expect(service.resume("missing")).toBe(false);
		const resumed = service.getStatus().find((entry) => entry.id === "job");
		expect(resumed?.enabled).toBe(true);
		service.stop();
	});

	it("S8.9 + S8.10 + S8.11: enforces per-job tool policy and admin block", async () => {
		const sessionManager = new SessionManager({
			defaultModel: "gpt-test",
			sessionsDir: createTempSessionsDir(),
		});
		const toolRegistry = new ToolRegistry();
		toolRegistry.register({
			category: "read",
			description: "Read tool.",
			execute: async () => "",
			name: "read_tool",
			parameters: Type.Object({}),
		});
		toolRegistry.register({
			category: "write",
			description: "Write tool.",
			execute: async () => "",
			name: "write_tool",
			parameters: Type.Object({}),
		});
		toolRegistry.register({
			category: "admin",
			description: "Admin tool.",
			execute: async () => "",
			name: "admin_tool",
			parameters: Type.Object({}),
		});

		const seenToolSets: Array<Array<string>> = [];
		const service = new CronService({
			defaultMaxIterations: 3,
			logger: createLoggerSink([]),
			model: createModel(),
			runAgentLoop: async (messages, tools) => {
				seenToolSets.push(
					tools
						.list()
						.map((tool) => tool.name)
						.sort((left, right) => left.localeCompare(right)),
				);
				return [...messages, assistantMessage("ok")];
			},
			sessionManager,
			systemPromptBuilder: () => "system",
			toolRegistry,
		});

		service.start([
			{ enabled: true, id: "default-policy", prompt: "run", schedule: "*/1 * * * * *" },
			{
				enabled: true,
				id: "explicit-policy",
				policy: { allowedTools: ["write_tool", "admin_tool"] },
				prompt: "run",
				schedule: "*/1 * * * * *",
			},
		]);
		await sleep(1200);
		service.stop();

		expect(seenToolSets.some((set) => set.join(",") === "read_tool")).toBe(true);
		expect(seenToolSets.some((set) => set.join(",") === "write_tool")).toBe(true);
		expect(seenToolSets.some((set) => set.includes("admin_tool"))).toBe(false);
	});

	it("supports legacy tool aliases in allowedTools policy during migration", async () => {
		const sessionManager = new SessionManager({
			defaultModel: "gpt-test",
			sessionsDir: createTempSessionsDir(),
		});
		const toolRegistry = new ToolRegistry();
		toolRegistry.register({
			category: "read",
			description: "Read tool.",
			execute: async () => "",
			name: "read",
			parameters: Type.Object({}),
		});
		toolRegistry.register({
			category: "write",
			description: "Write tool.",
			execute: async () => "",
			name: "write",
			parameters: Type.Object({}),
		});

		const seenToolSets: Array<Array<string>> = [];
		const service = new CronService({
			defaultMaxIterations: 3,
			logger: createLoggerSink([]),
			model: createModel(),
			runAgentLoop: async (messages, tools) => {
				seenToolSets.push(
					tools
						.list()
						.map((tool) => tool.name)
						.sort((left, right) => left.localeCompare(right)),
				);
				return [...messages, assistantMessage("ok")];
			},
			sessionManager,
			systemPromptBuilder: () => "system",
			toolRegistry,
		});

		service.start([
			{
				enabled: true,
				id: "alias-policy",
				policy: { allowedTools: ["read_file"] },
				prompt: "run",
				schedule: "*/1 * * * * *",
			},
		]);
		await sleep(1200);
		service.stop();

		expect(seenToolSets.some((set) => set.join(",") === "read")).toBe(true);
		expect(seenToolSets.some((set) => set.includes("write"))).toBe(false);
	});

	it("S8.12: tracks consecutive failures and resets on success", async () => {
		const sessionManager = new SessionManager({
			defaultModel: "gpt-test",
			sessionsDir: createTempSessionsDir(),
		});
		let attempts = 0;
		const service = new CronService({
			defaultMaxIterations: 3,
			logger: createLoggerSink([]),
			model: createModel(),
			runAgentLoop: async (messages) => {
				attempts += 1;
				if (attempts === 1) {
					throw new Error("boom");
				}
				return [...messages, assistantMessage("ok")];
			},
			sessionManager,
			systemPromptBuilder: () => "system",
			toolRegistry: new ToolRegistry(),
		});

		service.start([{ enabled: true, id: "job", prompt: "run", schedule: "*/1 * * * * *" }]);
		const deadline = Date.now() + 5000;
		while (attempts < 2 && Date.now() < deadline) {
			await sleep(200);
		}
		const status = service.getStatus().find((entry) => entry.id === "job");
		expect(status?.lastStatus).toBe("success");
		expect(status?.consecutiveFailures).toBe(0);
		service.stop();
	});
});
