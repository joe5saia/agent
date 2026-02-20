import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { executeTool, registerBuiltinTools, ToolRegistry } from "../src/tools/index.js";

const tempDirectories: Array<string> = [];

function createTempDirectory(): string {
	const directory = mkdtempSync(join(tmpdir(), "agent-tools-discovery-test-"));
	tempDirectories.push(directory);
	return directory;
}

afterEach(() => {
	for (const directory of tempDirectories.splice(0)) {
		rmSync(directory, { force: true, recursive: true });
	}
});

describe("discovery built-ins", () => {
	it("S6.17: grep is restricted to allowed paths", async () => {
		const root = createTempDirectory();
		const outside = createTempDirectory();
		mkdirSync(root, { recursive: true });
		mkdirSync(outside, { recursive: true });
		writeFileSync(join(root, "app.ts"), "const value = 1;\n", "utf8");
		writeFileSync(join(outside, "secret.txt"), "secret\n", "utf8");

		const registry = new ToolRegistry();
		registerBuiltinTools(registry, {
			security: {
				allowedEnv: ["PATH"],
				allowedPaths: [root],
				blockedCommands: [],
				deniedPaths: [],
			},
			tools: {
				outputLimit: 10_000,
				timeout: 2,
			},
		});

		const ok = await executeTool(registry, "grep", {
			path: root,
			pattern: "value",
		});
		expect(ok.isError).toBe(false);
		expect(ok.content).toContain("app.ts:1:7");

		const denied = await executeTool(registry, "grep", {
			path: outside,
			pattern: "secret",
		});
		expect(denied.isError).toBe(true);
		expect(denied.content).toMatch(/outside allowed paths/i);
	});

	it("S6.18: find is restricted to allowed paths", async () => {
		const root = createTempDirectory();
		const outside = createTempDirectory();
		mkdirSync(join(root, "src"), { recursive: true });
		writeFileSync(join(root, "src", "a.ts"), "a\n", "utf8");
		writeFileSync(join(outside, "b.ts"), "b\n", "utf8");

		const registry = new ToolRegistry();
		registerBuiltinTools(registry, {
			security: {
				allowedEnv: ["PATH"],
				allowedPaths: [root],
				blockedCommands: [],
				deniedPaths: [],
			},
			tools: {
				outputLimit: 10_000,
				timeout: 2,
			},
		});

		const ok = await executeTool(registry, "find", {
			kind: "file",
			path: root,
			pattern: "*.ts",
		});
		expect(ok.isError).toBe(false);
		expect(ok.content).toContain("a.ts");

		const denied = await executeTool(registry, "find", { path: outside });
		expect(denied.isError).toBe(true);
		expect(denied.content).toMatch(/outside allowed paths/i);
	});

	it("S6.19: ls is restricted to allowed paths", async () => {
		const root = createTempDirectory();
		const outside = createTempDirectory();
		mkdirSync(join(root, "dir"), { recursive: true });
		writeFileSync(join(root, "a.txt"), "a\n", "utf8");
		writeFileSync(join(outside, "b.txt"), "b\n", "utf8");

		const registry = new ToolRegistry();
		registerBuiltinTools(registry, {
			security: {
				allowedEnv: ["PATH"],
				allowedPaths: [root],
				blockedCommands: [],
				deniedPaths: [],
			},
			tools: {
				outputLimit: 10_000,
				timeout: 2,
			},
		});

		const ok = await executeTool(registry, "ls", { path: root });
		expect(ok.isError).toBe(false);
		expect(ok.content).toContain("a.txt");
		expect(ok.content).toContain("dir/");

		const denied = await executeTool(registry, "ls", { path: outside });
		expect(denied.isError).toBe(true);
		expect(denied.content).toMatch(/outside allowed paths/i);
	});
});
