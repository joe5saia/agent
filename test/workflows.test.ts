import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Message } from "@mariozechner/pi-ai";
import { afterEach, describe, expect, it } from "vitest";
import { SessionManager } from "../src/sessions/index.js";
import { ToolRegistry } from "../src/tools/index.js";
import { WorkflowEngine, loadWorkflows } from "../src/workflows/index.js";
import { createModel, createTempSessionsDir } from "./helpers/server-fixtures.js";

const tempDirectories: Array<string> = [];

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
	for (const directory of tempDirectories.splice(0)) {
		rmSync(directory, { force: true, recursive: true });
	}
});

describe("workflow loader and engine", () => {
	it("S9.1 + S9.11: loads workflows and rejects unknown template variables", () => {
		const directory = createTempDirectory("agent-workflow-test-");
		writeFileSync(
			join(directory, "deploy.yaml"),
			[
				"name: deploy",
				'description: "Deploy app"',
				"parameters:",
				"  environment:",
				"    type: string",
				"steps:",
				"  - name: build",
				'    prompt: "Build {{parameters.environment}}"',
			].join("\n"),
		);

		const workflows = loadWorkflows(directory);
		expect(workflows).toHaveLength(1);
		expect(workflows[0]?.name).toBe("deploy");

		writeFileSync(
			join(directory, "bad.yaml"),
			["name: bad", "steps:", "  - name: one", '    prompt: "Hello {{parameters.missing}}"'].join(
				"\n",
			),
		);
		expect(() => loadWorkflows(directory)).toThrowError(/Unknown template variable/i);
	});

	it("S9.2 + S9.4 + S9.5 + S9.6 + S9.8 + S9.12: executes steps with conditions, templates, validation, and continue policy", async () => {
		const workflowDir = createTempDirectory("agent-workflow-run-");
		writeFileSync(
			join(workflowDir, "deploy.yaml"),
			[
				"name: deploy",
				'description: "Deploy"',
				"parameters:",
				"  environment:",
				"    type: string",
				"  skip_tests:",
				"    type: boolean",
				"    default: false",
				"steps:",
				"  - name: tests",
				'    condition: "!parameters.skip_tests"',
				'    prompt: "run tests for {{parameters.environment}}"',
				"  - name: deploy",
				"    on_failure: continue",
				'    prompt: "fail-step {{parameters.environment}}"',
				"  - name: verify",
				'    prompt: "verify {{parameters.environment}}"',
			].join("\n"),
		);
		const workflows = loadWorkflows(workflowDir);

		const seenUserPrompts: Array<string> = [];
		const sessionManager = new SessionManager({
			defaultModel: "gpt-test",
			sessionsDir: createTempSessionsDir(),
		});
		const engine = new WorkflowEngine({
			defaultMaxIterations: 3,
			model: createModel(),
			runAgentLoop: async (messages) => {
				const prompt = [...messages]
					.reverse()
					.find((message) => message.role === "user")
					?.content.filter((entry) => entry.type === "text")
					.map((entry) => entry.text)
					.join("\n");
				if (typeof prompt === "string") {
					seenUserPrompts.push(prompt);
					if (prompt.includes("fail-step")) {
						throw new Error("forced failure");
					}
				}
				return [...messages, assistantMessage("ok")];
			},
			sessionManager,
			systemPromptBuilder: () => "system",
			toolRegistry: new ToolRegistry(),
		});
		engine.setDefinitions(workflows);

		await expect(engine.runWorkflow("deploy", { skip_tests: true })).rejects.toThrowError(
			/Invalid workflow parameters/i,
		);

		const result = await engine.runWorkflow("deploy", {
			environment: "prod",
			skip_tests: true,
		});
		expect(result.sessionId).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
		expect(result.steps[0]?.status).toBe("skipped");
		expect(result.steps[1]?.status).toBe("failed");
		expect(result.steps[2]?.status).toBe("completed");
		expect(seenUserPrompts.some((prompt) => prompt.includes("verify prod"))).toBe(true);

		const session = await sessionManager.get(result.sessionId);
		expect(session.name).toBe("[workflow] deploy");
	});

	it("S9.3 + S9.7: supports halt and workflow tools", async () => {
		const workflowDir = createTempDirectory("agent-workflow-halt-");
		writeFileSync(
			join(workflowDir, "rollback.yaml"),
			[
				"name: rollback",
				'description: "Rollback"',
				"steps:",
				"  - name: first",
				'    prompt: "break now"',
				"    on_failure: halt",
				"  - name: second",
				'    prompt: "should not run"',
			].join("\n"),
		);
		const workflows = loadWorkflows(workflowDir);
		const sessionManager = new SessionManager({
			defaultModel: "gpt-test",
			sessionsDir: createTempSessionsDir(),
		});
		const engine = new WorkflowEngine({
			defaultMaxIterations: 3,
			model: createModel(),
			runAgentLoop: async () => {
				throw new Error("step failed hard");
			},
			sessionManager,
			systemPromptBuilder: () => "system",
			toolRegistry: new ToolRegistry(),
		});
		engine.setDefinitions(workflows);

		const result = await engine.runWorkflow("rollback", {});
		expect(result.success).toBe(false);
		expect(result.steps[0]?.status).toBe("failed");
		expect(result.steps[1]?.status).toBe("pending");

		const workflowTool = engine.workflowToTool(workflows[0]!);
		expect(workflowTool.name).toBe("workflow_rollback");
		const payload = await workflowTool.execute({});
		expect(payload).toContain('"workflow":"rollback"');
	});
});
