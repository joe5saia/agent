import { mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { Type } from "@sinclair/typebox";
import { afterEach, describe, expect, it } from "vitest";
import { executeTool, registerBuiltinTools, ToolRegistry } from "../src/tools/index.js";

const tempDirectories: Array<string> = [];
const homeDirectories: Array<string> = [];

function createTempDirectory(): string {
	const directory = mkdtempSync(join(tmpdir(), "agent-tools-test-"));
	tempDirectories.push(directory);
	return directory;
}

function createHomeDirectory(): string {
	const directory = mkdtempSync(join(homedir(), ".agent-tools-test-"));
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

describe("ToolRegistry", () => {
	it("registers tools and rejects duplicates", () => {
		const registry = new ToolRegistry();
		const tool = {
			category: "read" as const,
			description: "Echo text.",
			async execute(args: Record<string, unknown>): Promise<string> {
				return String(args["value"] ?? "");
			},
			name: "echo",
			parameters: Type.Object({ value: Type.String() }),
		};

		registry.register(tool);
		expect(() => registry.register(tool)).toThrowError(/already registered/i);
		expect(registry.list()).toHaveLength(1);
		expect(registry.toToolSchemas()).toHaveLength(1);
	});
});

describe("executeTool", () => {
	it("S6.1: executes a tool with valid parameters", async () => {
		const registry = new ToolRegistry();
		registry.register({
			category: "read",
			description: "Echo text.",
			async execute(args: Record<string, unknown>): Promise<string> {
				return String(args["value"] ?? "");
			},
			name: "echo",
			parameters: Type.Object({ value: Type.String() }),
		});

		const result = await executeTool(registry, "echo", { value: "hello" });

		expect(result).toEqual({ content: "hello", isError: false });
	});

	it("S6.2: returns validation errors instead of throwing", async () => {
		const registry = new ToolRegistry();
		registry.register({
			category: "read",
			description: "Echo text.",
			async execute(args: Record<string, unknown>): Promise<string> {
				return String(args["value"] ?? "");
			},
			name: "echo",
			parameters: Type.Object({ value: Type.String() }),
		});

		const result = await executeTool(registry, "echo", { value: 123 });

		expect(result.isError).toBe(true);
		expect(result.content).toMatch(/invalid arguments/i);
	});

	it("S6.3: truncates tool output at configured limit", async () => {
		const registry = new ToolRegistry();
		registry.register({
			category: "read",
			description: "Generate output.",
			async execute(): Promise<string> {
				return "x".repeat(500);
			},
			name: "generate",
			outputLimitBytes: 32,
			parameters: Type.Object({}),
		});

		const result = await executeTool(registry, "generate", {});

		expect(result.isError).toBe(false);
		expect(result.content).toContain("[output truncated]");
	});

	it("S6.4: returns timeout error when execution exceeds timeout", async () => {
		const registry = new ToolRegistry();
		registry.register({
			category: "read",
			description: "Sleep.",
			async execute(_args: Record<string, unknown>, signal?: AbortSignal): Promise<string> {
				return await new Promise<string>((resolve, reject) => {
					const timeout = setTimeout(() => {
						resolve("done");
					}, 1000);
					signal?.addEventListener(
						"abort",
						() => {
							clearTimeout(timeout);
							reject(new Error("aborted"));
						},
						{ once: true },
					);
				});
			},
			name: "sleep",
			parameters: Type.Object({}),
			timeoutSeconds: 0.01,
		});

		const result = await executeTool(registry, "sleep", {});

		expect(result.isError).toBe(true);
		expect(result.content).toMatch(/timed out|aborted/i);
	});

	it("returns timeout error for non-cooperative tools", async () => {
		const registry = new ToolRegistry();
		registry.register({
			category: "read",
			description: "Never resolves and ignores cancellation.",
			async execute(): Promise<string> {
				return await new Promise<string>(() => {});
			},
			name: "hang",
			parameters: Type.Object({}),
			timeoutSeconds: 0.01,
		});

		const result = await executeTool(registry, "hang", {});

		expect(result.isError).toBe(true);
		expect(result.content).toMatch(/timed out/i);
	});
});

describe("built-in tools", () => {
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
				outputLimit: 1000,
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
				outputLimit: 1000,
				timeout: 2,
			},
		});

		const command =
			"node -e \"process.stdout.write((process.env.AGENT_TOOLS_ALLOW || 'x') + ':' + (process.env.AGENT_TOOLS_SECRET || ''))\"";
		const result = await executeTool(registry, "bash", { command });

		expect(result.isError).toBe(false);
		expect(result.content.trim()).toBe("1:");
	});

	it("S6.10: read_file rejects targets outside allowed paths", async () => {
		const root = createTempDirectory();
		const outside = createTempDirectory();
		const outsideFile = join(outside, "outside.txt");
		mkdirSync(root, { recursive: true });
		mkdirSync(outside, { recursive: true });
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

		const result = await executeTool(registry, "read_file", { path: outsideFile });

		expect(result.isError).toBe(true);
		expect(result.content).toMatch(/outside allowed paths/i);
	});

	it("S6.11: write_file denies denied_paths even under allowed path", async () => {
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

		const result = await executeTool(registry, "write_file", {
			content: "top secret",
			path: target,
		});

		expect(result.isError).toBe(true);
		expect(result.content).toMatch(/denied/i);
	});

	it("S6.12: read_file rejects symlink escape outside allowed paths", async () => {
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

		const result = await executeTool(registry, "read_file", { path: symlinkPath });

		expect(result.isError).toBe(true);
		expect(result.content).toMatch(/outside allowed paths/i);
	});

	it("writes and reads files within allowed paths", async () => {
		const root = createTempDirectory();
		const target = join(root, "hello.txt");
		mkdirSync(root, { recursive: true });

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

		const writeResult = await executeTool(registry, "write_file", {
			content: "hello world",
			path: target,
		});
		expect(writeResult.isError).toBe(false);
		expect(readFileSync(target, "utf8")).toBe("hello world");

		const readResult = await executeTool(registry, "read_file", { path: target });
		expect(readResult).toEqual({ content: "hello world", isError: false });
	});

	it("expands and uses tilde paths for file operations", async () => {
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

		const writeResult = await executeTool(registry, "write_file", {
			content: "hello tilde",
			path: target,
		});
		expect(writeResult.isError).toBe(false);

		const readResult = await executeTool(registry, "read_file", { path: target });
		expect(readResult).toEqual({ content: "hello tilde", isError: false });

		const listResult = await executeTool(registry, "list_directory", { path: tildeRoot });
		expect(listResult.isError).toBe(false);
		expect(listResult.content).toContain("hello.txt");
	});
});
