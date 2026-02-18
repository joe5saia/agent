import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { getModels, type Api, type Model } from "@mariozechner/pi-ai";
import { afterEach, describe, expect, it } from "vitest";
import { CronService } from "../../src/cron/index.js";
import { SessionManager } from "../../src/sessions/index.js";
import { ToolRegistry } from "../../src/tools/index.js";

const hasAnthropicKey = process.env["ANTHROPIC_API_KEY"] !== undefined;
const describeIntegration = hasAnthropicKey ? describe : describe.skip;

const tempDirectories: Array<string> = [];

function createTempDirectory(): string {
	const directory = mkdtempSync(join(tmpdir(), "agent-cron-e2e-"));
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

afterEach(() => {
	for (const directory of tempDirectories.splice(0)) {
		rmSync(directory, { force: true, recursive: true });
	}
});

describeIntegration("integration: cron e2e", () => {
	it("creates a cron session on schedule", { retry: 3 }, async () => {
		const sessionsDir = createTempDirectory();
		const model = resolveAnthropicModel();
		const sessionManager = new SessionManager({
			contextWindow: model.contextWindow,
			defaultModel: model.id,
			sessionsDir,
		});
		const service = new CronService({
			apiKeyResolver: async () => process.env["ANTHROPIC_API_KEY"],
			defaultMaxIterations: 2,
			logger: {
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
			},
			model,
			sessionManager,
			systemPromptBuilder: () => "You are a concise cron assistant.",
			toolRegistry: new ToolRegistry(),
		});

		service.start([
			{
				enabled: true,
				id: "integration-cron",
				policy: {
					maxIterations: 1,
				},
				prompt: "Reply with exactly: cron-ok",
				schedule: "*/1 * * * * *",
			},
		]);

		await sleep(15_000);
		service.stop();

		const sessions = await sessionManager.list();
		expect(sessions.some((session) => session.source === "cron")).toBe(true);
		const cronSession = sessions.find((session) => session.source === "cron");
		expect(cronSession).toBeDefined();
		if (cronSession !== undefined) {
			const context = await sessionManager.buildContext(cronSession.id);
			expect(context.some((message) => message.role === "assistant")).toBe(true);
		}
	});
});
