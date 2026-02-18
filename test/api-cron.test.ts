import { afterEach, describe, expect, it } from "vitest";
import { CronService } from "../src/cron/index.js";
import { createApp } from "../src/server/app.js";
import { ToolRegistry } from "../src/tools/index.js";
import {
	cleanupTempDirs,
	createConfig,
	createLoggerSink,
	createModel,
	createServerDeps,
} from "./helpers/server-fixtures.js";

afterEach(() => {
	cleanupTempDirs();
});

describe("cron api", () => {
	it("S8.7 + S8.13: lists and controls cron jobs", async () => {
		const events: Array<{ event: string; fields?: Record<string, unknown> }> = [];
		const deps = createServerDeps(events);
		const cronService = new CronService({
			defaultMaxIterations: 3,
			logger: createLoggerSink(events),
			model: createModel(),
			runAgentLoop: async (messages) => messages,
			sessionManager: deps.sessionManager,
			systemPromptBuilder: deps.systemPromptBuilder,
			toolRegistry: new ToolRegistry(),
		});
		cronService.start([{ enabled: true, id: "job", prompt: "run", schedule: "*/5 * * * * *" }]);
		deps.cronService = cronService;
		const app = createApp(createConfig(), deps);

		const listResponse = await app.request("/api/cron");
		expect(listResponse.status).toBe(200);
		const list = (await listResponse.json()) as Array<{ id: string }>;
		expect(list.some((entry) => entry.id === "job")).toBe(true);

		const pauseResponse = await app.request("/api/cron/job/pause", { method: "POST" });
		expect(pauseResponse.status).toBe(200);

		const resumeResponse = await app.request("/api/cron/job/resume", { method: "POST" });
		expect(resumeResponse.status).toBe(200);

		const missing = await app.request("/api/cron/does-not-exist/pause", { method: "POST" });
		expect(missing.status).toBe(404);

		cronService.stop();
	});
});
