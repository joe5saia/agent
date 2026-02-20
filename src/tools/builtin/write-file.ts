import type { AgentTool } from "../types.js";
import { createWriteTool, type WriteToolOptions } from "./write.js";

/**
 * Backward-compatible alias for the write built-in tool.
 */
export function createWriteFileTool(options: WriteToolOptions): AgentTool {
	return createWriteTool({
		...options,
		name: "write_file",
	});
}

export type { WriteToolOptions } from "./write.js";
