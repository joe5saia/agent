import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { Type } from "@sinclair/typebox";
import type { AgentTool } from "../types.js";
import { warnLegacyAliasUsage } from "./deprecation.js";
import type { DiscoveryToolOptions } from "./discovery-shared.js";
import { resolveScopedPath } from "./discovery-shared.js";

/**
 * Creates the ls built-in tool with optional alias naming.
 */
export function createLsTool(options: DiscoveryToolOptions & { name?: string }): AgentTool {
	const toolName = options.name ?? "ls";

	return {
		category: "read",
		description: "List files and directories at a path with deterministic ordering.",
		async execute(args: Record<string, unknown>): Promise<string> {
			if (toolName !== "ls") {
				warnLegacyAliasUsage(toolName);
			}

			const path = typeof args["path"] === "string" ? args["path"] : "";
			const scopedPath = resolveScopedPath(path, options);
			const entries = await readdir(scopedPath, { withFileTypes: true });
			const lines = entries
				.map((entry) => {
					const suffix = entry.isDirectory() ? "/" : "";
					return join(scopedPath, `${entry.name}${suffix}`);
				})
				.sort((left, right) => left.localeCompare(right));
			return lines.join("\n");
		},
		name: toolName,
		outputLimitBytes: options.outputLimitBytes,
		parameters: Type.Object({
			path: Type.String({ minLength: 1 }),
		}),
		timeoutSeconds: options.timeoutSeconds,
	};
}
