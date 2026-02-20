import { createBashTool } from "./builtin/bash.js";
import { createEditTool } from "./builtin/edit.js";
import { createFindTool } from "./builtin/find.js";
import { createGrepTool } from "./builtin/grep.js";
import { createListDirectoryTool } from "./builtin/list-directory.js";
import { createLsTool } from "./builtin/ls.js";
import { createReadFileTool } from "./builtin/read-file.js";
import { createReadTool } from "./builtin/read.js";
import { createWriteFileTool } from "./builtin/write-file.js";
import { createWriteTool } from "./builtin/write.js";
import type { ToolRegistry } from "./registry.js";

/**
 * Options used to configure built-in tools.
 */
export interface BuiltinToolConfig {
	security: {
		allowedEnv: Array<string>;
		allowedPaths: Array<string>;
		blockedCommands: Array<string>;
		deniedPaths: Array<string>;
	};
	tools: {
		outputLimit: number;
		timeout: number;
	};
}

/**
 * Canonical default interactive built-in tool names.
 */
export const defaultInteractiveBuiltinTools = ["read", "bash", "edit", "write"] as const;

/**
 * Additional read-only discovery built-ins.
 */
export const discoveryBuiltinTools = ["grep", "find", "ls"] as const;

/**
 * Registers all built-in tools in the provided registry.
 */
export function registerBuiltinTools(registry: ToolRegistry, config: BuiltinToolConfig): void {
	const sharedFsConfig = {
		allowedPaths: config.security.allowedPaths,
		deniedPaths: config.security.deniedPaths,
		outputLimitBytes: config.tools.outputLimit,
		timeoutSeconds: config.tools.timeout,
	};

	for (const tool of [
		createReadTool(sharedFsConfig),
		createBashTool({
			allowedEnv: config.security.allowedEnv,
			blockedCommands: config.security.blockedCommands,
			outputLimitBytes: config.tools.outputLimit,
			timeoutSeconds: config.tools.timeout,
		}),
		createEditTool(sharedFsConfig),
		createWriteTool(sharedFsConfig),
		createGrepTool(sharedFsConfig),
		createFindTool(sharedFsConfig),
		createLsTool(sharedFsConfig),
		// Compatibility aliases during migration window.
		createReadFileTool(sharedFsConfig),
		createWriteFileTool(sharedFsConfig),
		createListDirectoryTool(sharedFsConfig),
	]) {
		registry.register(tool);
	}
}

export { executeTool } from "./executor.js";
export { loadCliTools } from "./cli-loader.js";
export { ToolRegistry } from "./registry.js";
export { isLegacyToolAlias, legacyBuiltinToolAliases, normalizeToolName } from "./tool-names.js";
export type { AgentTool, ToolCategory, ToolResult, ToolSchema } from "./types.js";
