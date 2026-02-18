import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Type } from "@sinclair/typebox";
import { afterEach, describe, expect, it } from "vitest";
import { buildSystemPrompt } from "../src/agent/system-prompt.js";

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

describe("buildSystemPrompt", () => {
	it("S13.1: includes identity from configured file", () => {
		const identityPath = createTempFile("identity.md", "Identity block here");
		const prompt = buildSystemPrompt({}, [], [], { systemPrompt: { identityFile: identityPath } });

		expect(prompt).toContain("Identity block here");
	});

	it("S13.2: includes tool descriptions for all tools", () => {
		const identityPath = createTempFile("identity.md", "Identity");
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
			{ systemPrompt: { identityFile: identityPath } },
		);

		expect(prompt).toContain("## Available Tools");
		expect(prompt).toContain("**read_file**");
		expect(prompt).toContain("Read file");
	});

	it("S13.3: includes workflow catalog when workflows exist", () => {
		const identityPath = createTempFile("identity.md", "Identity");
		const prompt = buildSystemPrompt(
			{},
			[],
			[{ description: "Run deploy flow", name: "deploy", parameters: { env: "prod" } }],
			{ systemPrompt: { identityFile: identityPath } },
		);

		expect(prompt).toContain("## Available Workflows");
		expect(prompt).toContain("**deploy**");
	});

	it("S13.4: appends per-session systemPromptOverride", () => {
		const identityPath = createTempFile("identity.md", "Identity");
		const prompt = buildSystemPrompt({ systemPromptOverride: "Always be concise." }, [], [], {
			systemPrompt: { identityFile: identityPath },
		});

		expect(prompt).toContain("## Session Instructions");
		expect(prompt).toContain("Always be concise.");
	});

	it("S13.5: loads and appends custom instructions when file exists", () => {
		const identityPath = createTempFile("identity.md", "Identity");
		const customPath = createTempFile("custom.md", "Custom block");
		const prompt = buildSystemPrompt({}, [], [], {
			systemPrompt: {
				customInstructionsFile: customPath,
				identityFile: identityPath,
			},
		});

		expect(prompt).toContain("Custom block");
	});

	it("S13.6: missing custom instructions file is skipped", () => {
		const identityPath = createTempFile("identity.md", "Identity");
		const prompt = buildSystemPrompt({}, [], [], {
			systemPrompt: {
				customInstructionsFile: "/missing/custom-instructions.md",
				identityFile: identityPath,
			},
		});

		expect(prompt).not.toContain("custom-instructions");
	});

	it("S13.7: tool section reflects current tool list", () => {
		const identityPath = createTempFile("identity.md", "Identity");
		const promptWithoutTools = buildSystemPrompt({}, [], [], {
			systemPrompt: { identityFile: identityPath },
		});
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
			{ systemPrompt: { identityFile: identityPath } },
		);

		expect(promptWithoutTools).not.toContain("list_directory");
		expect(promptWithTools).toContain("list_directory");
	});

	it("uses default identity when identity file is missing", () => {
		const prompt = buildSystemPrompt({}, [], [], {
			systemPrompt: { identityFile: "/missing/identity.md" },
		});

		expect(prompt).toContain("You are an AI agent running on a dedicated virtual machine.");
	});
});
