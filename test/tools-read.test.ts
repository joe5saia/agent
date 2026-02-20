import { mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { executeTool, registerBuiltinTools, ToolRegistry } from "../src/tools/index.js";

const tempDirectories: Array<string> = [];
const homeDirectories: Array<string> = [];

function createTempDirectory(): string {
	const directory = mkdtempSync(join(tmpdir(), "agent-tools-read-test-"));
	tempDirectories.push(directory);
	return directory;
}

function createHomeDirectory(): string {
	const directory = mkdtempSync(join(homedir(), ".agent-tools-read-test-"));
	homeDirectories.push(directory);
	return directory;
}

afterEach(() => {
	for (const directory of tempDirectories.splice(0)) {
		rmSync(directory, { force: true, recursive: true });
	}
	for (const directory of homeDirectories.splice(0)) {
		rmSync(directory, { force: true, recursive: true });
	}
});

describe("read/write built-ins", () => {
	it("S6.3: read truncates output with actionable continuation offset", async () => {
		const root = createTempDirectory();
		const target = join(root, "long.txt");
		mkdirSync(root, { recursive: true });
		writeFileSync(target, "x".repeat(200), "utf8");

		const registry = new ToolRegistry();
		registerBuiltinTools(registry, {
			security: {
				allowedEnv: ["PATH"],
				allowedPaths: [root],
				blockedCommands: [],
				deniedPaths: [],
			},
			tools: {
				outputLimit: 128,
				timeout: 2,
			},
		});

		const result = await executeTool(registry, "read", { path: target });
		expect(result.isError).toBe(false);
		expect(result.content).toContain("[read truncated]");
		expect(result.content).toMatch(/offset=\d+/i);
	});

	it("S6.10: read rejects targets outside allowed paths", async () => {
		const root = createTempDirectory();
		const outside = createTempDirectory();
		const outsideFile = join(outside, "outside.txt");
		mkdirSync(root, { recursive: true });
		mkdirSync(outside, { recursive: true });
		writeFileSync(outsideFile, "outside", "utf8");

		const registry = new ToolRegistry();
		registerBuiltinTools(registry, {
			security: {
				allowedEnv: ["PATH"],
				allowedPaths: [root],
				blockedCommands: [],
				deniedPaths: [],
			},
			tools: {
				outputLimit: 1000,
				timeout: 2,
			},
		});

		const result = await executeTool(registry, "read", { path: outsideFile });
		expect(result.isError).toBe(true);
		expect(result.content).toMatch(/outside allowed paths/i);
	});

	it("S6.11: write denies denied_paths even under allowed path", async () => {
		const root = createTempDirectory();
		const denied = join(root, "private");
		mkdirSync(denied, { recursive: true });
		const target = join(denied, "secret.txt");

		const registry = new ToolRegistry();
		registerBuiltinTools(registry, {
			security: {
				allowedEnv: ["PATH"],
				allowedPaths: [root],
				blockedCommands: [],
				deniedPaths: [denied],
			},
			tools: {
				outputLimit: 1000,
				timeout: 2,
			},
		});

		const result = await executeTool(registry, "write", {
			content: "top secret",
			path: target,
		});
		expect(result.isError).toBe(true);
		expect(result.content).toMatch(/denied/i);
	});

	it("S6.12: read rejects symlink escape outside allowed paths", async () => {
		const root = createTempDirectory();
		const outside = createTempDirectory();
		const outsideFile = join(outside, "secret.txt");
		mkdirSync(root, { recursive: true });
		mkdirSync(outside, { recursive: true });
		writeFileSync(outsideFile, "secret", "utf8");

		const symlinkPath = join(root, "linked.txt");
		symlinkSync(outsideFile, symlinkPath);

		const registry = new ToolRegistry();
		registerBuiltinTools(registry, {
			security: {
				allowedEnv: ["PATH"],
				allowedPaths: [root],
				blockedCommands: [],
				deniedPaths: [],
			},
			tools: {
				outputLimit: 1000,
				timeout: 2,
			},
		});

		const result = await executeTool(registry, "read", { path: symlinkPath });
		expect(result.isError).toBe(true);
		expect(result.content).toMatch(/outside allowed paths/i);
	});

	it("writes and reads files with tilde path expansion", async () => {
		const root = createHomeDirectory();
		const relativeRoot = root.startsWith(`${homedir()}/`) ? root.slice(homedir().length + 1) : "";
		const tildeRoot = `~/${relativeRoot}`;
		const target = `${tildeRoot}/hello.txt`;

		const registry = new ToolRegistry();
		registerBuiltinTools(registry, {
			security: {
				allowedEnv: ["PATH"],
				allowedPaths: [tildeRoot],
				blockedCommands: [],
				deniedPaths: [],
			},
			tools: {
				outputLimit: 1000,
				timeout: 2,
			},
		});

		const writeResult = await executeTool(registry, "write", {
			content: "hello tilde",
			path: target,
		});
		expect(writeResult.isError).toBe(false);

		const readResult = await executeTool(registry, "read", { path: target });
		expect(readResult).toEqual({ content: "hello tilde", isError: false });
		expect(readFileSync(join(root, "hello.txt"), "utf8")).toBe("hello tilde");
	});
});
