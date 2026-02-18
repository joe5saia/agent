import { readFile } from "node:fs/promises";
import { Type } from "@sinclair/typebox";
import { validatePath } from "../../security/index.js";
import type { AgentTool } from "../types.js";

/**
 * Configuration for the read_file built-in tool.
 */
export interface ReadFileToolOptions {
	allowedPaths: Array<string>;
	deniedPaths: Array<string>;
	outputLimitBytes: number;
	timeoutSeconds: number;
}

/**
 * Creates the read_file built-in tool.
 */
export function createReadFileTool(options: ReadFileToolOptions): AgentTool {
	return {
		category: "read",
		description: "Read a UTF-8 text file from disk.",
		async execute(args: Record<string, unknown>): Promise<string> {
			const path = typeof args["path"] === "string" ? args["path"] : "";
			const result = validatePath(path, options.allowedPaths, options.deniedPaths);
			if (!result.allowed) {
				throw new Error(result.reason ?? "Path denied by policy.");
			}
			return await readFile(result.resolvedPath, "utf8");
		},
		name: "read_file",
		outputLimitBytes: options.outputLimitBytes,
		parameters: Type.Object({
			path: Type.String({ minLength: 1 }),
		}),
		timeoutSeconds: options.timeoutSeconds,
	};
}
