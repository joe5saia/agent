import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { AgentConfig } from "../config/index.js";
import type { SessionMetadata } from "../sessions/index.js";
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
	toolsSection?: string;
	workflowsSection?: string;
}

const defaultIdentityBlock = [
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
 * Reads a UTF-8 file, returning undefined when the file is missing.
 */
function readOptionalFile(path: string): string | undefined {
	try {
		return readFileSync(expandHomePath(path), "utf8");
	} catch (error: unknown) {
		if (error instanceof Error && "code" in error && error.code === "ENOENT") {
			return undefined;
		}
		throw error;
	}
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

/**
 * Builds cacheable static prompt fragments from config/tool/workflow state.
 */
export function prepareSystemPrompt(
	tools: Array<AgentTool>,
	workflows: Array<WorkflowSummary>,
	config: Pick<AgentConfig, "systemPrompt">,
): PreparedSystemPrompt {
	const identity =
		readOptionalFile(config.systemPrompt.identityFile)?.trim() ?? defaultIdentityBlock;
	const customInstructionsPath = config.systemPrompt.customInstructionsFile;
	const customInstructions =
		typeof customInstructionsPath === "string"
			? readOptionalFile(customInstructionsPath)?.trim()
			: undefined;
	const toolsSection = buildToolsSection(tools);
	const workflowsSection = buildWorkflowsSection(workflows);

	return {
		...(customInstructions === undefined || customInstructions === ""
			? {}
			: { customInstructions }),
		identity,
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
): string {
	const parts: Array<string> = [prepared.identity];
	if (prepared.toolsSection !== undefined) {
		parts.push(prepared.toolsSection);
	}
	if (prepared.workflowsSection !== undefined) {
		parts.push(prepared.workflowsSection);
	}
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
	config: Pick<AgentConfig, "systemPrompt">,
): string {
	return buildSystemPromptFromPrepared(session, prepareSystemPrompt(tools, workflows, config));
}
