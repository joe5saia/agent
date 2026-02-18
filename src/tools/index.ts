import { createBashTool } from "./builtin/bash.js";
import { createListDirectoryTool } from "./builtin/list-directory.js";
import { createReadFileTool } from "./builtin/read-file.js";
import { createWriteFileTool } from "./builtin/write-file.js";
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
 * Registers all built-in tools in the provided registry.
 */
export function registerBuiltinTools(registry: ToolRegistry, config: BuiltinToolConfig): void {
	registry.register(
		createBashTool({
			allowedEnv: config.security.allowedEnv,
			blockedCommands: config.security.blockedCommands,
			outputLimitBytes: config.tools.outputLimit,
			timeoutSeconds: config.tools.timeout,
		}),
	);
	registry.register(
		createReadFileTool({
			allowedPaths: config.security.allowedPaths,
			deniedPaths: config.security.deniedPaths,
			outputLimitBytes: config.tools.outputLimit,
			timeoutSeconds: config.tools.timeout,
		}),
	);
	registry.register(
		createWriteFileTool({
			allowedPaths: config.security.allowedPaths,
			deniedPaths: config.security.deniedPaths,
			outputLimitBytes: config.tools.outputLimit,
			timeoutSeconds: config.tools.timeout,
		}),
	);
	registry.register(
		createListDirectoryTool({
			allowedPaths: config.security.allowedPaths,
			deniedPaths: config.security.deniedPaths,
			outputLimitBytes: config.tools.outputLimit,
			timeoutSeconds: config.tools.timeout,
		}),
	);
}

export { executeTool } from "./executor.js";
export { loadCliTools } from "./cli-loader.js";
export { ToolRegistry } from "./registry.js";
export type { AgentTool, ToolCategory, ToolResult, ToolSchema } from "./types.js";
