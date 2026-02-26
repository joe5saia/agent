import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Type } from "@sinclair/typebox";
import { afterEach, describe, expect, it } from "vitest";
import {
	buildSystemPrompt,
	prepareSystemPrompt,
	SystemPromptFileError,
} from "../src/agent/system-prompt.js";
import type { AgentConfig } from "../src/config/index.js";

const tempDirectories: Array<string> = [];

function createTempFile(name: string, contents: string): string {
	const directory = mkdtempSync(join(tmpdir(), "agent-prompt-test-"));
	tempDirectories.push(directory);
	const path = join(directory, name);
	writeFileSync(path, contents, "utf8");
	return path;
}

afterEach(() => {
	for (const directory of tempDirectories.splice(0)) {
		rmSync(directory, { force: true, recursive: true });
	}
});

function createPromptConfig(
	overrides: Partial<AgentConfig["systemPrompt"]> = {},
): Pick<AgentConfig, "systemPrompt"> {
	const systemFile = createTempFile("system.md", "System baseline");
	const soulFile = createTempFile("soul.md", "Soul baseline");
	return {
		systemPrompt: {
			soulFile,
			strictPromptFiles: true,
			systemFile,
			...overrides,
		},
	};
}

describe("buildSystemPrompt", () => {
	it("S13.1: includes text from configured system file", () => {
		const config = createPromptConfig({
			systemFile: createTempFile("system.md", "System block here"),
		});
		const prompt = buildSystemPrompt({}, [], [], [], config);

		expect(prompt).toContain("System block here");
	});

	it("S13.2: includes text from configured soul file", () => {
		const config = createPromptConfig({
			soulFile: createTempFile("soul.md", "Soul block here"),
		});
		const prompt = buildSystemPrompt({}, [], [], [], config);

		expect(prompt).toContain("Soul block here");
	});

	it("S13.3: inserts soul style precedence section", () => {
		const prompt = buildSystemPrompt({}, [], [], [], createPromptConfig());

		expect(prompt).toContain("## Style Directives (Subordinate to System Rules)");
		expect(prompt).toContain(
			"If style guidance conflicts with system, safety, or tool constraints above",
		);
	});

	it("S13.4: includes tool descriptions for all tools", () => {
		const prompt = buildSystemPrompt(
			{},
			[
				{
					category: "read",
					description: "Read file",
					async execute(): Promise<string> {
						return "";
					},
					name: "read_file",
					parameters: Type.Object({ path: Type.String() }),
				},
			],
			[],
			[],
			createPromptConfig(),
		);

		expect(prompt).toContain("## Available Tools");
		expect(prompt).toContain("**read_file**");
		expect(prompt).toContain("Read file");
	});

	it("S13.5: includes workflow catalog when workflows exist", () => {
		const prompt = buildSystemPrompt(
			{},
			[],
			[{ description: "Run deploy flow", name: "deploy", parameters: { env: "prod" } }],
			[],
			createPromptConfig(),
		);

		expect(prompt).toContain("## Available Workflows");
		expect(prompt).toContain("**deploy**");
	});

	it("S13.8: appends per-session systemPromptOverride after soul directives", () => {
		const prompt = buildSystemPrompt({ systemPromptOverride: "Always be concise." }, [], [], [], {
			systemPrompt: createPromptConfig().systemPrompt,
		});

		const soulIndex = prompt.indexOf("## Style Directives (Subordinate to System Rules)");
		const sessionIndex = prompt.indexOf("## Session Instructions");
		expect(soulIndex).toBeGreaterThan(-1);
		expect(sessionIndex).toBeGreaterThan(soulIndex);
		expect(prompt).toContain("## Session Instructions");
		expect(prompt).toContain("Always be concise.");
	});

	it("S13.9: loads and appends custom instructions when file exists", () => {
		const customPath = createTempFile("custom.md", "Custom block");
		const prompt = buildSystemPrompt(
			{},
			[],
			[],
			[],
			createPromptConfig({ customInstructionsFile: customPath }),
		);

		expect(prompt).toContain("Custom block");
		expect(prompt.trimEnd().endsWith("Custom block")).toBe(true);
	});

	it("custom instructions missing file is skipped", () => {
		const prompt = buildSystemPrompt(
			{},
			[],
			[],
			[],
			createPromptConfig({
				customInstructionsFile: "/missing/custom-instructions.md",
			}),
		);

		expect(prompt).not.toContain("custom-instructions");
	});

	it("tool section reflects current tool list", () => {
		const config = createPromptConfig();
		const promptWithoutTools = buildSystemPrompt({}, [], [], [], config);
		const promptWithTools = buildSystemPrompt(
			{},
			[
				{
					category: "read",
					description: "List directory",
					async execute(): Promise<string> {
						return "";
					},
					name: "list_directory",
					parameters: Type.Object({ path: Type.String() }),
				},
			],
			[],
			[],
			config,
		);

		expect(promptWithoutTools).not.toContain("list_directory");
		expect(promptWithTools).toContain("list_directory");
	});

	it("S13.10: strict prompt mode fails when system file is missing", () => {
		const config = createPromptConfig({
			systemFile: "/missing/system.md",
		});

		expect(() => prepareSystemPrompt([], [], [], config)).toThrowError(SystemPromptFileError);
		expect(() => prepareSystemPrompt([], [], [], config)).toThrowError(/System prompt file/);
	});

	it("S13.11: strict prompt mode fails when soul file is missing", () => {
		const config = createPromptConfig({
			soulFile: "/missing/soul.md",
		});

		expect(() => prepareSystemPrompt([], [], [], config)).toThrowError(SystemPromptFileError);
		expect(() => prepareSystemPrompt([], [], [], config)).toThrowError(/Soul prompt file/);
	});

	it("S13.12: non-strict mode falls back to built-in defaults", () => {
		const prepared = prepareSystemPrompt(
			[],
			[],
			[],
			createPromptConfig({
				soulFile: "/missing/soul.md",
				strictPromptFiles: false,
				systemFile: "/missing/system.md",
			}),
		);
		const prompt = buildSystemPrompt(
			{},
			[],
			[],
			[],
			createPromptConfig({
				soulFile: "/missing/soul.md",
				strictPromptFiles: false,
				systemFile: "/missing/system.md",
			}),
		);

		expect(prepared.warnings.some((warning) => warning.code === "prompt_file_fallback")).toBe(true);
		expect(prompt).toContain("You are an AI agent running on a dedicated virtual machine.");
		expect(prompt).toContain("You communicate like a thoughtful, pragmatic engineer.");
	});

	it("S13.13: legacy identity-only compatibility mode still builds prompts", () => {
		const identityPath = createTempFile("identity.md", "Legacy identity block");
		const prepared = prepareSystemPrompt(
			[],
			[],
			[],
			createPromptConfig({
				identityFile: identityPath,
				soulFile: "/missing/soul.md",
				systemFile: "/missing/system.md",
			}),
		);
		const prompt = buildSystemPrompt(
			{},
			[],
			[],
			[],
			createPromptConfig({
				identityFile: identityPath,
				soulFile: "/missing/soul.md",
				systemFile: "/missing/system.md",
			}),
		);

		expect(prompt).toContain("Legacy identity block");
		expect(
			prepared.warnings.some((warning) => warning.code === "legacy_identity_compatibility"),
		).toBe(true);
	});

	it("S13.14: new system and soul files override identity fallback", () => {
		const prompt = buildSystemPrompt(
			{},
			[],
			[],
			[],
			createPromptConfig({
				identityFile: createTempFile("identity.md", "Legacy identity block"),
				soulFile: createTempFile("soul.md", "Preferred soul block"),
				systemFile: createTempFile("system.md", "Preferred system block"),
			}),
		);

		expect(prompt).toContain("Preferred system block");
		expect(prompt).toContain("Preferred soul block");
		expect(prompt).not.toContain("Legacy identity block");
	});

	it("S13.15: legacy identity key emits deprecation warnings", () => {
		const prepared = prepareSystemPrompt(
			[],
			[],
			[],
			createPromptConfig({
				identityFile: createTempFile("identity.md", "Legacy identity block"),
			}),
		);

		expect(prepared.warnings.some((warning) => warning.code === "legacy_identity_file")).toBe(true);
	});

	it("S13.6: includes available skills catalog when skills are loaded", () => {
		const prompt = buildSystemPrompt(
			{},
			[],
			[],
			[
				{
					description: "Search the web for current facts.",
					instructions: "# Web Search\nUse brave-search scripts.",
					name: "brave-search",
					resources: [],
					rootDir: "/tmp/skills/brave-search",
					sourcePath: "/tmp/skills/brave-search/SKILL.md",
				},
			],
			createPromptConfig(),
		);

		expect(prompt).toContain("## Available Skills");
		expect(prompt).toContain("**brave-search**");
		expect(prompt).toContain("Search the web for current facts.");
	});

	it("S13.7: includes active skill instructions when provided", () => {
		const prompt = buildSystemPrompt(
			{},
			[],
			[],
			[
				{
					description: "Search the web for current facts.",
					instructions: "# Web Search\nUse brave-search scripts.",
					name: "brave-search",
					resources: [],
					rootDir: "/tmp/skills/brave-search",
					sourcePath: "/tmp/skills/brave-search/SKILL.md",
				},
			],
			createPromptConfig(),
			{
				activeSkills: [
					{
						description: "Search the web for current facts.",
						instructions: "# Web Search\nUse brave-search scripts.",
						name: "brave-search",
						resources: [],
						rootDir: "/tmp/skills/brave-search",
						sourcePath: "/tmp/skills/brave-search/SKILL.md",
					},
				],
			},
		);

		expect(prompt).toContain("## Active Skill Instructions");
		expect(prompt).toContain("Source: `/tmp/skills/brave-search/SKILL.md`");
		expect(prompt).toContain("Use brave-search scripts.");
	});

	it("includes active skill resource excerpts when provided", () => {
		const prompt = buildSystemPrompt(
			{},
			[],
			[],
			[
				{
					description: "Search the web for current facts.",
					instructions: "# Web Search\nUse brave-search scripts.",
					name: "brave-search",
					resources: [],
					rootDir: "/tmp/skills/brave-search",
					sourcePath: "/tmp/skills/brave-search/SKILL.md",
				},
			],
			createPromptConfig(),
			{
				activeSkillResources: [
					{
						content: "Use this API schema for request payloads.",
						kind: "reference",
						path: "/tmp/skills/brave-search/references/api.md",
						relativePath: "references/api.md",
						skillName: "brave-search",
						title: "api",
						truncated: false,
					},
				],
			},
		);

		expect(prompt).toContain("## Active Skill Resources");
		expect(prompt).toContain("### brave-search: references/api.md");
		expect(prompt).toContain("Use this API schema for request payloads.");
	});
});
