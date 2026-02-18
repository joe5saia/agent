import type { TSchema } from "@sinclair/typebox";

/**
 * Tool category used for authorization decisions.
 */
export type ToolCategory = "admin" | "read" | "write";

/**
 * Tool execution result returned to the agent loop.
 */
export interface ToolResult {
	content: string;
	isError: boolean;
}

/**
 * LLM-facing schema representation for a registered tool.
 */
export interface ToolSchema {
	description: string;
	name: string;
	parameters: TSchema;
}

/**
 * Agent tool contract.
 */
export interface AgentTool {
	category: ToolCategory;
	description: string;
	execute: (args: Record<string, unknown>, signal?: AbortSignal) => Promise<string>;
	name: string;
	outputLimitBytes?: number;
	parameters: TSchema;
	timeoutSeconds?: number;
}
