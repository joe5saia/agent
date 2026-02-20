import { Type } from "@sinclair/typebox";
import { describe, expect, it, vi } from "vitest";
import {
	discoveryBuiltinTools,
	executeTool,
	defaultInteractiveBuiltinTools,
	registerBuiltinTools,
	ToolRegistry,
} from "../src/tools/index.js";

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
});

describe("built-in tool registration", () => {
	const builtinConfig = {
		security: {
			allowedEnv: ["PATH"],
			allowedPaths: ["/tmp"],
			blockedCommands: [],
			deniedPaths: [],
		},
		tools: {
			outputLimit: 10_000,
			timeout: 5,
		},
	};

	it("S6.15: keeps the default interactive built-in set", () => {
		expect(defaultInteractiveBuiltinTools).toEqual(["read", "bash", "edit", "write"]);

		const registry = new ToolRegistry();
		registerBuiltinTools(registry, builtinConfig);
		const names = registry.list().map((tool) => tool.name);
		for (const builtin of defaultInteractiveBuiltinTools) {
			expect(names).toContain(builtin);
		}
	});

	it("S6.16: registers discovery tools", () => {
		const registry = new ToolRegistry();
		registerBuiltinTools(registry, builtinConfig);
		const names = registry.list().map((tool) => tool.name);
		for (const toolName of discoveryBuiltinTools) {
			expect(names).toContain(toolName);
		}
	});

	it("registers legacy aliases and emits deprecation warnings on use", async () => {
		const warnSpy = vi.spyOn(process, "emitWarning").mockImplementation(() => undefined);
		const registry = new ToolRegistry();
		registerBuiltinTools(registry, builtinConfig);
		const names = registry.list().map((tool) => tool.name);
		expect(names).toContain("read_file");
		expect(names).toContain("write_file");
		expect(names).toContain("list_directory");

		await executeTool(registry, "list_directory", { path: "/tmp" });
		expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("list_directory"), {
			code: "AGENT_TOOL_ALIAS_DEPRECATED",
			type: "DeprecationWarning",
		});
		warnSpy.mockRestore();
	});
});
