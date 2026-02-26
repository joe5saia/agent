import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
	loadSkills,
	selectRelevantSkills,
	selectSkillResourceSnippets,
	type SkillDefinition,
} from "../src/skills/index.js";

const tempDirectories: Array<string> = [];

function createTempDir(prefix: string): string {
	const directory = mkdtempSync(join(tmpdir(), prefix));
	tempDirectories.push(directory);
	return directory;
}

function writeSkill(root: string, name: string, markdown: string): string {
	const skillDir = join(root, name);
	mkdirSync(skillDir, { recursive: true });
	const path = join(skillDir, "SKILL.md");
	writeFileSync(path, markdown, "utf8");
	return path;
}

function writeSkillFile(
	root: string,
	skillName: string,
	relativePath: string,
	content: string,
): string {
	const filePath = join(root, skillName, relativePath);
	mkdirSync(dirname(filePath), { recursive: true });
	writeFileSync(filePath, content, "utf8");
	return filePath;
}

afterEach(() => {
	for (const directory of tempDirectories.splice(0)) {
		rmSync(directory, { force: true, recursive: true });
	}
});

describe("loadSkills", () => {
	it("loads skills from standard SKILL.md format", () => {
		const skillsRoot = createTempDir("agent-skills-");
		const expectedPath = writeSkill(
			skillsRoot,
			"brave-search",
			[
				"---",
				"name: brave-search",
				"description: Search the web for docs and facts.",
				"---",
				"",
				"# Brave Search",
				"",
				"Use search.js for docs lookups.",
			].join("\n"),
		);

		const result = loadSkills([skillsRoot]);
		expect(result.warnings).toEqual([]);
		expect(result.skills).toHaveLength(1);
		expect(result.skills[0]).toMatchObject({
			description: "Search the web for docs and facts.",
			instructions: "# Brave Search\n\nUse search.js for docs lookups.",
			name: "brave-search",
			rootDir: join(skillsRoot, "brave-search"),
			sourcePath: expectedPath,
		});
		expect(result.skills[0]?.resources).toEqual([]);
	});

	it("skips invalid skills and records warnings", () => {
		const skillsRoot = createTempDir("agent-skills-");
		writeSkill(
			skillsRoot,
			"broken",
			[
				"---",
				"name: broken",
				"description: Broken skill.",
				"not valid yaml",
				"---",
				"",
				"# Broken",
			].join("\n"),
		);

		const result = loadSkills([skillsRoot]);
		expect(result.skills).toEqual([]);
		expect(result.warnings).toHaveLength(1);
		expect(result.warnings[0]?.message).toMatch(/Invalid frontmatter YAML/i);
	});

	it("uses later directories to override duplicate skill names", () => {
		const globalRoot = createTempDir("agent-global-skills-");
		const workspaceRoot = createTempDir("agent-workspace-skills-");
		writeSkill(
			globalRoot,
			"frontend-design",
			[
				"---",
				"name: frontend-design",
				"description: Global skill description.",
				"---",
				"",
				"# Global",
				"",
				"Use default global behavior.",
			].join("\n"),
		);
		const workspacePath = writeSkill(
			workspaceRoot,
			"frontend-design",
			[
				"---",
				"name: frontend-design",
				"description: Workspace override description.",
				"---",
				"",
				"# Workspace",
				"",
				"Use workspace behavior.",
			].join("\n"),
		);

		const result = loadSkills([globalRoot, workspaceRoot]);
		expect(result.skills).toHaveLength(1);
		expect(result.skills[0]?.description).toBe("Workspace override description.");
		expect(result.skills[0]?.sourcePath).toBe(workspacePath);
	});

	it("discovers linked and bundled resources under skill root", () => {
		const skillsRoot = createTempDir("agent-skills-");
		writeSkill(
			skillsRoot,
			"doc-helper",
			[
				"---",
				"name: doc-helper",
				"description: Summarize product docs.",
				"---",
				"",
				"# Doc Helper",
				"",
				"See [API Guide](references/api.md) and [run](scripts/collect.sh).",
			].join("\n"),
		);
		const apiDocPath = writeSkillFile(
			skillsRoot,
			"doc-helper",
			"references/api.md",
			"# API\nImportant fields.",
		);
		const scriptPath = writeSkillFile(
			skillsRoot,
			"doc-helper",
			"scripts/collect.sh",
			"#!/usr/bin/env bash\necho collecting",
		);
		writeSkillFile(skillsRoot, "doc-helper", "assets/template.txt", "template-body");

		const result = loadSkills([skillsRoot]);
		expect(result.warnings).toEqual([]);
		expect(result.skills).toHaveLength(1);
		expect(result.skills[0]?.resources).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					kind: "reference",
					path: apiDocPath,
					relativePath: "references/api.md",
				}),
				expect.objectContaining({
					kind: "script",
					path: scriptPath,
					relativePath: "scripts/collect.sh",
				}),
			]),
		);
	});
});

describe("selectRelevantSkills", () => {
	const skills: Array<SkillDefinition> = [
		{
			description: "Web search and content extraction for documentation and facts.",
			instructions: "# brave-search instructions",
			name: "brave-search",
			resources: [],
			rootDir: "/tmp/skills/brave-search",
			sourcePath: "/tmp/skills/brave-search/SKILL.md",
		},
		{
			description: "Create polished, responsive frontend interfaces with strong typography.",
			instructions: "# frontend-design instructions",
			name: "frontend-design",
			resources: [],
			rootDir: "/tmp/skills/frontend-design",
			sourcePath: "/tmp/skills/frontend-design/SKILL.md",
		},
	];

	it("prioritizes explicit skill references", () => {
		const selected = selectRelevantSkills(skills, "Please use $frontend-design for this page.");
		expect(selected.map((skill) => skill.name)).toEqual(["frontend-design"]);
	});

	it("selects by description overlap when no explicit reference exists", () => {
		const selected = selectRelevantSkills(
			skills,
			"Can you search web documentation and extract content for this API?",
		);
		expect(selected.map((skill) => skill.name)).toContain("brave-search");
	});
});

describe("selectSkillResourceSnippets", () => {
	it("loads only relevant resources for active skills", () => {
		const skillsRoot = createTempDir("agent-resource-skills-");
		writeSkill(
			skillsRoot,
			"doc-helper",
			["---", "name: doc-helper", "description: Docs helper", "---", "", "# Doc helper"].join("\n"),
		);
		const apiPath = writeSkillFile(skillsRoot, "doc-helper", "references/api.md", "api schema");
		const scriptPath = writeSkillFile(
			skillsRoot,
			"doc-helper",
			"scripts/build.sh",
			"#!/bin/sh\necho build",
		);

		const activeSkills: Array<SkillDefinition> = [
			{
				description: "Docs helper",
				instructions: "# Doc helper",
				name: "doc-helper",
				resources: [
					{
						kind: "reference",
						path: apiPath,
						relativePath: "references/api.md",
						title: "api",
					},
					{
						kind: "script",
						path: scriptPath,
						relativePath: "scripts/build.sh",
						title: "build",
					},
				],
				rootDir: join(skillsRoot, "doc-helper"),
				sourcePath: join(skillsRoot, "doc-helper", "SKILL.md"),
			},
		];

		const result = selectSkillResourceSnippets(
			activeSkills,
			"Use the API reference details for payloads.",
		);

		expect(result.snippets).toHaveLength(1);
		expect(result.snippets[0]?.relativePath).toBe("references/api.md");
		expect(result.snippets[0]?.content).toContain("api schema");
	});
});
