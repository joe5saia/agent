import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { executeTool, registerBuiltinTools, ToolRegistry } from "../src/tools/index.js";

const tempDirectories: Array<string> = [];

function createTempDirectory(): string {
	const directory = mkdtempSync(join(tmpdir(), "agent-tools-edit-test-"));
	tempDirectories.push(directory);
	return directory;
}

afterEach(() => {
	for (const directory of tempDirectories.splice(0)) {
		rmSync(directory, { force: true, recursive: true });
	}
});

describe("edit built-in", () => {
	it("S6.21: rejects non-unique matches and asks for more context", async () => {
		const root = createTempDirectory();
		const target = join(root, "file.txt");
		mkdirSync(root, { recursive: true });
		writeFileSync(target, "alpha\nneedle\nbeta\nneedle\n", "utf8");

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

		const result = await executeTool(registry, "edit", {
			newText: "replaced",
			oldText: "needle",
			path: target,
		});

		expect(result.isError).toBe(true);
		expect(result.content).toMatch(/ambiguous|more specific/i);
	});

	it("S6.22: returns unified diff summary after successful edit", async () => {
		const root = createTempDirectory();
		const target = join(root, "file.txt");
		mkdirSync(root, { recursive: true });
		writeFileSync(target, "before\nreplace me\nafter\n", "utf8");

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

		const result = await executeTool(registry, "edit", {
			new_text: "replaced",
			old_text: "replace me",
			path: target,
		});

		expect(result.isError).toBe(false);
		expect(result.content).toContain("Unified diff:");
		expect(result.content).toContain("---");
		expect(result.content).toContain("+++");
		expect(result.content).toContain("-replace me");
		expect(result.content).toContain("+replaced");
		expect(readFileSync(target, "utf8")).toContain("replaced");
	});

	it("applies fuzzy fallback when exact text is not found", async () => {
		const root = createTempDirectory();
		const target = join(root, "file.txt");
		mkdirSync(root, { recursive: true });
		writeFileSync(target, "const value = 1;\n", "utf8");

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

		const result = await executeTool(registry, "edit", {
			newText: "const value = 2;",
			oldText: "const\nvalue\n=\n1;",
			path: target,
		});

		expect(result.isError).toBe(false);
		expect(result.content).toContain("fuzzy replacement");
		expect(readFileSync(target, "utf8")).toContain("const value = 2;");
	});
});
