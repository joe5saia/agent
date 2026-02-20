import { Type } from "@sinclair/typebox";
import type { AgentTool } from "../types.js";
import type { DiscoveryToolOptions } from "./discovery-shared.js";
import { walkScopedTree } from "./discovery-shared.js";

type FindKind = "all" | "directory" | "file";

function patternToRegex(pattern: string): RegExp {
	const escaped = pattern.replaceAll(/[.+^${}()|[\]\\]/g, String.raw`\$&`);
	const wildcard = escaped.replaceAll("*", ".*").replaceAll("?", ".");
	return new RegExp(`^${wildcard}$`);
}

function matchesPattern(path: string, pattern: string): boolean {
	if (!pattern.includes("*") && !pattern.includes("?")) {
		return path.includes(pattern);
	}
	return patternToRegex(pattern).test(path);
}

/**
 * Creates the find built-in tool.
 */
export function createFindTool(options: DiscoveryToolOptions): AgentTool {
	return {
		category: "read",
		description: "Discover files and directories under a path.",
		async execute(args: Record<string, unknown>, signal?: AbortSignal): Promise<string> {
			const path = typeof args["path"] === "string" ? args["path"] : "";
			const pattern = typeof args["pattern"] === "string" ? args["pattern"] : "";
			const kind = typeof args["kind"] === "string" ? (args["kind"] as FindKind) : ("all" as const);
			const maxResults =
				typeof args["max_results"] === "number"
					? Math.floor(args["max_results"])
					: typeof args["maxResults"] === "number"
						? Math.floor(args["maxResults"])
						: 500;
			const safeMaxResults = Math.max(1, maxResults);

			const discovered = await walkScopedTree(path, options, signal);
			const matched = discovered.filter((entry) => {
				if (kind === "file" && entry.type !== "file") {
					return false;
				}
				if (kind === "directory" && entry.type !== "directory") {
					return false;
				}
				if (pattern === "") {
					return true;
				}
				return matchesPattern(entry.path, pattern);
			});

			const limited = matched.slice(0, safeMaxResults).map((entry) => entry.path);
			if (matched.length <= safeMaxResults) {
				return limited.join("\n");
			}
			return [
				...limited,
				`[find truncated] returned ${String(safeMaxResults)} of ${String(matched.length)} entries.`,
			].join("\n");
		},
		name: "find",
		outputLimitBytes: options.outputLimitBytes,
		parameters: Type.Object({
			kind: Type.Optional(
				Type.Union([Type.Literal("all"), Type.Literal("file"), Type.Literal("directory")]),
			),
			max_results: Type.Optional(Type.Number({ minimum: 1 })),
			maxResults: Type.Optional(Type.Number({ minimum: 1 })),
			path: Type.String({ minLength: 1 }),
			pattern: Type.Optional(Type.String({ minLength: 1 })),
		}),
		timeoutSeconds: options.timeoutSeconds,
	};
}
