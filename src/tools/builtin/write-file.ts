import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { Type } from "@sinclair/typebox";
import { validatePath } from "../../security/index.js";
import type { AgentTool } from "../types.js";

/**
 * Configuration for the write_file built-in tool.
 */
export interface WriteFileToolOptions {
	allowedPaths: Array<string>;
	deniedPaths: Array<string>;
	outputLimitBytes: number;
	timeoutSeconds: number;
}

/**
 * Creates the write_file built-in tool.
 */
export function createWriteFileTool(options: WriteFileToolOptions): AgentTool {
	return {
		category: "write",
		description: "Write UTF-8 text content to disk.",
		async execute(args: Record<string, unknown>): Promise<string> {
			const content = typeof args["content"] === "string" ? args["content"] : "";
			const path = typeof args["path"] === "string" ? args["path"] : "";
			const result = validatePath(path, options.allowedPaths, options.deniedPaths);
			if (!result.allowed) {
				throw new Error(result.reason ?? "Path denied by policy.");
			}

			await mkdir(dirname(result.resolvedPath), { recursive: true });
			await writeFile(result.resolvedPath, content, "utf8");
			return `Wrote ${String(Buffer.byteLength(content, "utf8"))} bytes to ${result.resolvedPath}`;
		},
		name: "write_file",
		outputLimitBytes: options.outputLimitBytes,
		parameters: Type.Object({
			content: Type.String(),
			path: Type.String({ minLength: 1 }),
		}),
		timeoutSeconds: options.timeoutSeconds,
	};
}
