import { Type } from "@sinclair/typebox";
import { afterEach, describe, expect, it } from "vitest";
import { createApp } from "../src/server/app.js";
import { ToolRegistry } from "../src/tools/index.js";
import { WorkflowEngine } from "../src/workflows/index.js";
import {
	cleanupTempDirs,
	createConfig,
	createModel,
	createServerDeps,
} from "./helpers/server-fixtures.js";

afterEach(() => {
	cleanupTempDirs();
});

describe("workflows api", () => {
	it("lists workflows and triggers runs", async () => {
		const events: Array<{ event: string; fields?: Record<string, unknown> }> = [];
		const deps = createServerDeps(events);
		const workflowEngine = new WorkflowEngine({
			defaultMaxIterations: 3,
			model: createModel(),
			runAgentLoop: async (messages) => messages,
			sessionManager: deps.sessionManager,
			systemPromptBuilder: deps.systemPromptBuilder,
			toolRegistry: new ToolRegistry(),
		});
		workflowEngine.setDefinitions([
			{
				description: "Deploy app",
				name: "deploy",
				parameterDefinitions: {},
				parameterSchema: Type.Object({}),
				steps: [],
			},
		]);
		deps.workflowEngine = workflowEngine;

		const app = createApp(createConfig(), deps);
		const listResponse = await app.request("/api/workflows");
		expect(listResponse.status).toBe(200);
		const list = (await listResponse.json()) as Array<{ name: string }>;
		expect(list.some((entry) => entry.name === "deploy")).toBe(true);

		const runResponse = await app.request("/api/workflows/deploy/run", {
			body: JSON.stringify({ parameters: {} }),
			headers: { "Content-Type": "application/json" },
			method: "POST",
		});
		expect(runResponse.status).toBe(200);

		const missingResponse = await app.request("/api/workflows/missing/run", { method: "POST" });
		expect(missingResponse.status).toBe(404);
	});
});
