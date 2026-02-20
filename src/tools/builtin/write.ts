import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { Type } from "@sinclair/typebox";
import { validatePath } from "../../security/index.js";
import type { AgentTool } from "../types.js";
import { warnLegacyAliasUsage } from "./deprecation.js";

/**
 * Configuration for write-like built-in tools.
 */
export interface WriteToolOptions {
	allowedPaths: Array<string>;
	deniedPaths: Array<string>;
	name?: string;
	outputLimitBytes: number;
	timeoutSeconds: number;
}

/**
 * Creates the write built-in tool with optional alias naming.
 */
export function createWriteTool(options: WriteToolOptions): AgentTool {
	const toolName = options.name ?? "write";

	return {
		category: "write",
		description: "Write UTF-8 text content to disk.",
		async execute(args: Record<string, unknown>): Promise<string> {
			if (toolName !== "write") {
				warnLegacyAliasUsage(toolName);
			}

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
		name: toolName,
		outputLimitBytes: options.outputLimitBytes,
		parameters: Type.Object({
			content: Type.String(),
			path: Type.String({ minLength: 1 }),
		}),
		timeoutSeconds: options.timeoutSeconds,
	};
}
