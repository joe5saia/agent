import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { Type } from "@sinclair/typebox";
import { validatePath } from "../../security/index.js";
import type { AgentTool } from "../types.js";

/**
 * Configuration for the list_directory built-in tool.
 */
export interface ListDirectoryToolOptions {
	allowedPaths: Array<string>;
	deniedPaths: Array<string>;
	outputLimitBytes: number;
	timeoutSeconds: number;
}

/**
 * Creates the list_directory built-in tool.
 */
export function createListDirectoryTool(options: ListDirectoryToolOptions): AgentTool {
	return {
		category: "read",
		description: "List files and directories at a path.",
		async execute(args: Record<string, unknown>): Promise<string> {
			const path = typeof args["path"] === "string" ? args["path"] : "";
			const result = validatePath(path, options.allowedPaths, options.deniedPaths);
			if (!result.allowed) {
				throw new Error(result.reason ?? "Path denied by policy.");
			}

			const entries = await readdir(result.resolvedPath, { withFileTypes: true });
			const lines = entries
				.map((entry) => {
					const suffix = entry.isDirectory() ? "/" : "";
					return join(result.resolvedPath, `${entry.name}${suffix}`);
				})
				.sort((left, right) => left.localeCompare(right));
			return lines.join("\n");
		},
		name: "list_directory",
		outputLimitBytes: options.outputLimitBytes,
		parameters: Type.Object({
			path: Type.String({ minLength: 1 }),
		}),
		timeoutSeconds: options.timeoutSeconds,
	};
}
