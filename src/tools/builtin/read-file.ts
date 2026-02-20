import type { AgentTool } from "../types.js";
import { createReadTool, type ReadToolOptions } from "./read.js";

/**
 * Backward-compatible alias for the read built-in tool.
 */
export function createReadFileTool(options: ReadToolOptions): AgentTool {
	return createReadTool({
		...options,
		name: "read_file",
	});
}

export type { ReadToolOptions } from "./read.js";
