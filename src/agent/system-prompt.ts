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

/**
 * Builds the system prompt by concatenating identity, tool/workflow metadata, and session layers.
 */
export function buildSystemPrompt(
	session: Pick<SessionMetadata, "systemPromptOverride">,
	tools: Array<AgentTool>,
	workflows: Array<WorkflowSummary>,
	config: Pick<AgentConfig, "systemPrompt">,
): string {
	const parts: Array<string> = [];

	const identity =
		readOptionalFile(config.systemPrompt.identityFile)?.trim() ?? defaultIdentityBlock;
	parts.push(identity);

	if (tools.length > 0) {
		const toolLines = tools.map((tool) => {
			const schema = JSON.stringify(tool.parameters, null, 2);
			return `- **${tool.name}**: ${tool.description}\n\`\`\`json\n${schema}\n\`\`\``;
		});
		parts.push(["## Available Tools", ...toolLines].join("\n"));
	}

	if (workflows.length > 0) {
		const workflowLines = workflows.map((workflow) => {
			const parameterText =
				workflow.parameters === undefined
					? ""
					: `\n\`\`\`json\n${JSON.stringify(workflow.parameters, null, 2)}\n\`\`\``;
			return `- **${workflow.name}**: ${workflow.description}${parameterText}`;
		});
		parts.push(["## Available Workflows", ...workflowLines].join("\n"));
	}

	if (
		typeof session.systemPromptOverride === "string" &&
		session.systemPromptOverride.trim() !== ""
	) {
		parts.push(`## Session Instructions\n${session.systemPromptOverride.trim()}`);
	}

	const customInstructionsPath = config.systemPrompt.customInstructionsFile;
	if (typeof customInstructionsPath === "string") {
		const customInstructions = readOptionalFile(customInstructionsPath);
		if (typeof customInstructions === "string" && customInstructions.trim() !== "") {
			parts.push(customInstructions.trim());
		}
	}

	return `${parts.join("\n\n")}\n`;
}
