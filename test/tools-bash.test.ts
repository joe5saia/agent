import { readFileSync } from "node:fs";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createBashTool } from "../src/tools/builtin/bash.js";
import { executeTool, registerBuiltinTools, ToolRegistry } from "../src/tools/index.js";

const tempDirectories: Array<string> = [];

function createTempDirectory(): string {
	const directory = mkdtempSync(join(tmpdir(), "agent-tools-bash-test-"));
	tempDirectories.push(directory);
	return directory;
}

afterEach(() => {
	for (const directory of tempDirectories.splice(0)) {
		rmSync(directory, { force: true, recursive: true });
	}
});

describe("bash built-in", () => {
	it("S6.5: blocks dangerous bash commands", async () => {
		const root = createTempDirectory();
		const registry = new ToolRegistry();
		registerBuiltinTools(registry, {
			security: {
				allowedEnv: ["PATH"],
				allowedPaths: [root],
				blockedCommands: [],
				deniedPaths: [],
			},
			tools: {
				outputLimit: 2000,
				timeout: 2,
			},
		});

		const result = await executeTool(registry, "bash", { command: "rm -rf /" });
		expect(result.isError).toBe(true);
		expect(result.content).toMatch(/blocked/i);
	});

	it("S6.6: bash env contains only allowlisted variables", async () => {
		const root = createTempDirectory();
		process.env["AGENT_TOOLS_ALLOW"] = "1";
		process.env["AGENT_TOOLS_SECRET"] = "hidden";

		const registry = new ToolRegistry();
		registerBuiltinTools(registry, {
			security: {
				allowedEnv: ["PATH", "AGENT_TOOLS_ALLOW"],
				allowedPaths: [root],
				blockedCommands: [],
				deniedPaths: [],
			},
			tools: {
				outputLimit: 2000,
				timeout: 2,
			},
		});

		const command =
			"node -e \"process.stdout.write((process.env.AGENT_TOOLS_ALLOW || 'x') + ':' + (process.env.AGENT_TOOLS_SECRET || ''))\"";
		const result = await executeTool(registry, "bash", { command });
		expect(result.isError).toBe(false);
		expect(result.content.trim()).toBe("1:");
	});

	it("S6.20: tail-truncates large output and writes full output to a temp file", async () => {
		const root = createTempDirectory();
		const registry = new ToolRegistry();
		registerBuiltinTools(registry, {
			security: {
				allowedEnv: ["PATH"],
				allowedPaths: [root],
				blockedCommands: [],
				deniedPaths: [],
			},
			tools: {
				outputLimit: 1024,
				timeout: 2,
			},
		});

		const result = await executeTool(registry, "bash", {
			command: "node -e \"process.stdout.write('x'.repeat(12000))\"",
		});

		expect(result.isError).toBe(false);
		expect(result.content).toContain("[output truncated: showing tail]");
		expect(result.content).toContain("Full output: ");

		const pathLine = result.content.split("\n").find((line) => line.startsWith("Full output: "));
		expect(pathLine).toBeDefined();
		const fullOutputPath = pathLine?.replace("Full output: ", "").trim() ?? "";
		expect(readFileSync(fullOutputPath, "utf8")).toHaveLength(12_000);
	});

	it("streams output chunks while command executes", async () => {
		const chunks: Array<string> = [];
		const registry = new ToolRegistry();
		registry.register(
			createBashTool({
				allowedEnv: ["PATH"],
				onOutputChunk: (chunk) => {
					chunks.push(chunk);
				},
				outputLimitBytes: 5000,
				timeoutSeconds: 2,
			}),
		);

		const result = await executeTool(registry, "bash", {
			command: "node -e \"process.stdout.write('chunk-1'); process.stdout.write('chunk-2')\"",
		});

		expect(result.isError).toBe(false);
		expect(chunks.join("")).toContain("chunk-1");
		expect(chunks.join("")).toContain("chunk-2");
	});
});
