import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { AgentConfig } from "../config/index.js";
import type { SessionMetadata } from "../sessions/index.js";
import type { SkillDefinition, SkillResourceSnippet } from "../skills/index.js";
import type { AgentTool } from "../tools/index.js";

/**
 * Minimal workflow descriptor for prompt assembly.
 */
export interface WorkflowSummary {
	description: string;
	name: string;
	parameters?: Record<string, unknown>;
}

export interface PreparedSystemPrompt {
	customInstructions?: string;
	identity: string;
	skills: Array<SkillDefinition>;
	skillsCatalogSection?: string;
	soulSection: string;
	toolsSection?: string;
	warnings: Array<SystemPromptWarning>;
	workflowsSection?: string;
}

export interface BuildPromptOptions {
	activeSkillResources?: Array<SkillResourceSnippet>;
	activeSkills?: Array<SkillDefinition>;
}

export type SystemPromptWarningCode =
	| "legacy_identity_file"
	| "legacy_identity_compatibility"
	| "prompt_file_fallback";

export interface SystemPromptWarning {
	code: SystemPromptWarningCode;
	message: string;
	path?: string;
}

export class SystemPromptFileError extends Error {
	public constructor(message: string) {
		super(message);
		this.name = "SystemPromptFileError";
	}
}

const defaultSystemBlock = [
	"You are an AI agent running on a dedicated virtual machine.",
	"",
	"You have access to tools and should use them proactively when needed.",
	"",
	"Rules:",
	"- Explain what you are about to do before executing a tool.",
	"- If a tool fails, analyze the error and try an alternative approach.",
	"- Never execute destructive operations unless intent is clearly established.",
	"- Provide a concise summary when your task is complete.",
].join("\n");

const defaultSoulBlock = [
	"You communicate like a thoughtful, pragmatic engineer.",
	"- Be concise and direct.",
	"- Be respectful and collaborative.",
	"- Highlight tradeoffs clearly.",
	"- Prefer actionable next steps over theory.",
].join("\n");

const styleSectionPreamble = [
	"## Style Directives (Subordinate to System Rules)",
	"If style guidance conflicts with system, safety, or tool constraints above, follow the constraints above.",
].join("\n");

interface PromptFileReadResult {
	content?: string;
	error?: Error;
	missing: boolean;
	resolvedPath: string;
}

/**
 * Expands a path that starts with ~/.
 */
function expandHomePath(path: string): string {
	if (path === "~") {
		return homedir();
	}
	if (path.startsWith("~/")) {
		return join(homedir(), path.slice(2));
	}
	return path;
}

/**
 * Reads a UTF-8 file and reports missing/unreadable state.
 */
function readPromptFile(path: string): PromptFileReadResult {
	const resolvedPath = expandHomePath(path);
	try {
		return {
			content: readFileSync(resolvedPath, "utf8"),
			missing: false,
			resolvedPath,
		};
	} catch (error: unknown) {
		if (error instanceof Error && "code" in error && error.code === "ENOENT") {
			return {
				missing: true,
				resolvedPath,
			};
		}
		return {
			error: error instanceof Error ? error : new Error(String(error)),
			missing: false,
			resolvedPath,
		};
	}
}

/**
 * Reads a UTF-8 file, returning undefined when the file is missing.
 */
function readOptionalFile(path: string): string | undefined {
	const result = readPromptFile(path);
	if (result.missing) {
		return undefined;
	}
	if (result.error !== undefined) {
		throw result.error;
	}
	return result.content;
}

function normalizePromptContent(content: string | undefined): string | undefined {
	if (content === undefined) {
		return undefined;
	}
	const normalized = content.trim();
	return normalized === "" ? undefined : normalized;
}

function describePromptFileIssue(label: string, result: PromptFileReadResult): string {
	if (result.missing) {
		return `${label} file was not found at ${result.resolvedPath}.`;
	}
	if (result.error !== undefined) {
		return `${label} file could not be read at ${result.resolvedPath}: ${result.error.message}`;
	}
	return `${label} file did not contain any usable content at ${result.resolvedPath}.`;
}

function buildSoulSection(soulText: string): string {
	return [styleSectionPreamble, soulText].join("\n\n");
}

function resolveSystemAndSoul(config: AgentConfig["systemPrompt"]): {
	soulText: string;
	systemText: string;
	warnings: Array<SystemPromptWarning>;
} {
	const warnings: Array<SystemPromptWarning> = [];
	const strict = config.strictPromptFiles;
	const systemResult = readPromptFile(config.systemFile);
	const soulResult = readPromptFile(config.soulFile);
	const systemText = normalizePromptContent(systemResult.content);
	const soulText = normalizePromptContent(soulResult.content);
	const identityFile = config.identityFile?.trim();
	const hasLegacyIdentity = identityFile !== undefined && identityFile !== "";
	let legacyIdentityResult: PromptFileReadResult | undefined;
	let legacyIdentityText: string | undefined;

	if (hasLegacyIdentity) {
		warnings.push({
			code: "legacy_identity_file",
			message:
				"`system_prompt.identity_file` is deprecated. Use `system_prompt.system_file` and `system_prompt.soul_file`.",
			...(identityFile === undefined ? {} : { path: identityFile }),
		});
		legacyIdentityResult = readPromptFile(identityFile);
		legacyIdentityText = normalizePromptContent(legacyIdentityResult.content);
	}

	if (systemText !== undefined && soulText !== undefined) {
		return { soulText, systemText, warnings };
	}

	if (legacyIdentityText !== undefined) {
		warnings.push({
			code: "legacy_identity_compatibility",
			message:
				"Using compatibility mode from `identity_file` because universal prompt files are missing or unreadable.",
			...(identityFile === undefined ? {} : { path: identityFile }),
		});
		if (soulText === undefined) {
			warnings.push({
				code: "prompt_file_fallback",
				message:
					"Soul prompt file is unavailable; falling back to the built-in soul prompt while in identity compatibility mode.",
				path: config.soulFile,
			});
		}
		return {
			soulText: soulText ?? defaultSoulBlock,
			systemText: legacyIdentityText,
			warnings,
		};
	}

	if (strict) {
		const failures: Array<string> = [];
		if (systemText === undefined) {
			failures.push(describePromptFileIssue("System prompt", systemResult));
		}
		if (soulText === undefined) {
			failures.push(describePromptFileIssue("Soul prompt", soulResult));
		}
		if (
			hasLegacyIdentity &&
			legacyIdentityResult !== undefined &&
			legacyIdentityText === undefined
		) {
			failures.push(describePromptFileIssue("Legacy identity", legacyIdentityResult));
		}
		throw new SystemPromptFileError(
			`Unable to load required prompt files:\n- ${failures.join("\n- ")}`,
		);
	}

	if (systemText === undefined) {
		warnings.push({
			code: "prompt_file_fallback",
			message:
				"System prompt file is unavailable; falling back to the built-in default system prompt.",
			path: config.systemFile,
		});
	}
	if (soulText === undefined) {
		warnings.push({
			code: "prompt_file_fallback",
			message: "Soul prompt file is unavailable; falling back to the built-in default soul prompt.",
			path: config.soulFile,
		});
	}

	return {
		soulText: soulText ?? defaultSoulBlock,
		systemText: systemText ?? defaultSystemBlock,
		warnings,
	};
}

function buildToolsSection(tools: Array<AgentTool>): string | undefined {
	if (tools.length === 0) {
		return undefined;
	}
	const toolLines = tools.map((tool) => {
		const schema = JSON.stringify(tool.parameters);
		return `- **${tool.name}**: ${tool.description}\n  Parameters: \`${schema}\``;
	});
	return ["## Available Tools", ...toolLines].join("\n");
}

function buildWorkflowsSection(workflows: Array<WorkflowSummary>): string | undefined {
	if (workflows.length === 0) {
		return undefined;
	}
	const workflowLines = workflows.map((workflow) => {
		const parameterText =
			workflow.parameters === undefined
				? ""
				: `\n  Parameters: \`${JSON.stringify(workflow.parameters)}\``;
		return `- **${workflow.name}**: ${workflow.description}${parameterText}`;
	});
	return ["## Available Workflows", ...workflowLines].join("\n");
}

function buildSkillsCatalogSection(skills: Array<SkillDefinition>): string | undefined {
	if (skills.length === 0) {
		return undefined;
	}
	const lines = skills.map((skill) => `- **${skill.name}**: ${skill.description}`);
	return [
		"## Available Skills",
		"Skills use the standard `SKILL.md` format with YAML frontmatter and markdown instructions.",
		...lines,
	].join("\n");
}

function buildActiveSkillsSection(skills: Array<SkillDefinition>): string | undefined {
	if (skills.length === 0) {
		return undefined;
	}
	const blocks = skills.map((skill) =>
		[`### ${skill.name}`, `Source: \`${skill.sourcePath}\``, "", skill.instructions.trim()].join(
			"\n",
		),
	);
	return ["## Active Skill Instructions", ...blocks].join("\n\n");
}

function buildActiveSkillResourcesSection(
	resources: Array<SkillResourceSnippet>,
): string | undefined {
	if (resources.length === 0) {
		return undefined;
	}
	const resourceBlocks = resources.map((resource) =>
		[
			`### ${resource.skillName}: ${resource.relativePath}`,
			`Kind: \`${resource.kind}\``,
			`Source: \`${resource.path}\``,
			"",
			resource.content,
		].join("\n"),
	);
	return [
		"## Active Skill Resources",
		"Load these excerpts as conditional detail for the currently active skills.",
		...resourceBlocks,
	].join("\n\n");
}

/**
 * Builds cacheable static prompt fragments from config/tool/workflow state.
 */
export function prepareSystemPrompt(
	tools: Array<AgentTool>,
	workflows: Array<WorkflowSummary>,
	skills: Array<SkillDefinition>,
	config: Pick<AgentConfig, "systemPrompt">,
): PreparedSystemPrompt {
	const { soulText, systemText, warnings } = resolveSystemAndSoul(config.systemPrompt);
	const customInstructionsPath = config.systemPrompt.customInstructionsFile;
	const customInstructions =
		typeof customInstructionsPath === "string"
			? normalizePromptContent(readOptionalFile(customInstructionsPath))
			: undefined;
	const toolsSection = buildToolsSection(tools);
	const workflowsSection = buildWorkflowsSection(workflows);
	const skillsCatalogSection = buildSkillsCatalogSection(skills);

	return {
		...(customInstructions === undefined || customInstructions === ""
			? {}
			: { customInstructions }),
		identity: systemText,
		skills,
		soulSection: buildSoulSection(soulText),
		warnings,
		...(skillsCatalogSection === undefined ? {} : { skillsCatalogSection }),
		...(toolsSection === undefined ? {} : { toolsSection }),
		...(workflowsSection === undefined ? {} : { workflowsSection }),
	};
}

/**
 * Builds the final prompt from precomputed static fragments and session-specific overrides.
 */
export function buildSystemPromptFromPrepared(
	session: Pick<SessionMetadata, "systemPromptOverride">,
	prepared: PreparedSystemPrompt,
	options: BuildPromptOptions = {},
): string {
	const parts: Array<string> = [prepared.identity];
	if (prepared.toolsSection !== undefined) {
		parts.push(prepared.toolsSection);
	}
	if (prepared.workflowsSection !== undefined) {
		parts.push(prepared.workflowsSection);
	}
	if (prepared.skillsCatalogSection !== undefined) {
		parts.push(prepared.skillsCatalogSection);
	}
	const activeSkillsSection = buildActiveSkillsSection(options.activeSkills ?? []);
	if (activeSkillsSection !== undefined) {
		parts.push(activeSkillsSection);
	}
	const activeResourcesSection = buildActiveSkillResourcesSection(
		options.activeSkillResources ?? [],
	);
	if (activeResourcesSection !== undefined) {
		parts.push(activeResourcesSection);
	}
	parts.push(prepared.soulSection);
	if (
		typeof session.systemPromptOverride === "string" &&
		session.systemPromptOverride.trim() !== ""
	) {
		parts.push(`## Session Instructions\n${session.systemPromptOverride.trim()}`);
	}
	if (prepared.customInstructions !== undefined) {
		parts.push(prepared.customInstructions);
	}
	return `${parts.join("\n\n")}\n`;
}

/**
 * Builds the system prompt by concatenating identity, tool/workflow metadata, and session layers.
 */
export function buildSystemPrompt(
	session: Pick<SessionMetadata, "systemPromptOverride">,
	tools: Array<AgentTool>,
	workflows: Array<WorkflowSummary>,
	skills: Array<SkillDefinition>,
	config: Pick<AgentConfig, "systemPrompt">,
	options: BuildPromptOptions = {},
): string {
	return buildSystemPromptFromPrepared(
		session,
		prepareSystemPrompt(tools, workflows, skills, config),
		options,
	);
}
