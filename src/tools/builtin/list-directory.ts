import type { AgentTool } from "../types.js";
import type { DiscoveryToolOptions } from "./discovery-shared.js";
import { createLsTool } from "./ls.js";

/**
 * Backward-compatible alias for the ls built-in tool.
 */
export function createListDirectoryTool(options: DiscoveryToolOptions): AgentTool {
	return createLsTool({
		...options,
		name: "list_directory",
	});
}

export type { DiscoveryToolOptions } from "./discovery-shared.js";
