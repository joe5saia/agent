import { readFile } from "node:fs/promises";
import { Type } from "@sinclair/typebox";
import type { AgentTool } from "../types.js";
import type { DiscoveryToolOptions } from "./discovery-shared.js";
import { walkScopedTree } from "./discovery-shared.js";

function buildPatternMatcher(
	pattern: string,
	options: {
		caseSensitive: boolean;
		regex: boolean;
	},
): (line: string) => Array<number> {
	if (options.regex) {
		const flags = options.caseSensitive ? "g" : "gi";
		const compiled = new RegExp(pattern, flags);
		return (line: string): Array<number> => {
			const columns: Array<number> = [];
			for (let match = compiled.exec(line); match !== null; match = compiled.exec(line)) {
				columns.push(match.index + 1);
				if (match.index === compiled.lastIndex) {
					compiled.lastIndex += 1;
				}
			}
			compiled.lastIndex = 0;
			return columns;
		};
	}

	const needle = options.caseSensitive ? pattern : pattern.toLowerCase();
	return (line: string): Array<number> => {
		const haystack = options.caseSensitive ? line : line.toLowerCase();
		const columns: Array<number> = [];
		let cursor = 0;
		while (cursor <= haystack.length) {
			const index = haystack.indexOf(needle, cursor);
			if (index === -1) {
				break;
			}
			columns.push(index + 1);
			cursor = index + Math.max(needle.length, 1);
		}
		return columns;
	};
}

/**
 * Creates the grep built-in tool.
 */
export function createGrepTool(options: DiscoveryToolOptions): AgentTool {
	return {
		category: "read",
		description: "Search for matching text in files under a path.",
		async execute(args: Record<string, unknown>, signal?: AbortSignal): Promise<string> {
			const path = typeof args["path"] === "string" ? args["path"] : "";
			const pattern = typeof args["pattern"] === "string" ? args["pattern"] : "";
			const regex =
				typeof args["regex"] === "boolean"
					? args["regex"]
					: typeof args["is_regex"] === "boolean"
						? args["is_regex"]
						: false;
			const caseSensitive =
				typeof args["case_sensitive"] === "boolean"
					? args["case_sensitive"]
					: typeof args["caseSensitive"] === "boolean"
						? args["caseSensitive"]
						: true;
			const maxResults =
				typeof args["max_results"] === "number"
					? Math.floor(args["max_results"])
					: typeof args["maxResults"] === "number"
						? Math.floor(args["maxResults"])
						: 200;
			const safeMaxResults = Math.max(1, maxResults);
			if (pattern.trim() === "") {
				throw new Error("Invalid arguments for grep: pattern must be a non-empty string.");
			}

			const matcher = buildPatternMatcher(pattern, { caseSensitive, regex });
			const discovered = await walkScopedTree(path, options, signal);
			const files = discovered.filter((entry) => entry.type === "file").map((entry) => entry.path);
			const matches: Array<string> = [];

			for (const filePath of files) {
				signal?.throwIfAborted();
				const content = await readFile(filePath, "utf8");
				const lines = content.split(/\r?\n/u);
				for (let index = 0; index < lines.length; index += 1) {
					const line = lines[index];
					if (line === undefined) {
						continue;
					}
					for (const column of matcher(line)) {
						matches.push(`${filePath}:${String(index + 1)}:${String(column)}:${line}`);
						if (matches.length >= safeMaxResults) {
							return [
								...matches,
								`[grep truncated] returned ${String(safeMaxResults)} or more matches.`,
							].join("\n");
						}
					}
				}
			}

			return matches.join("\n");
		},
		name: "grep",
		outputLimitBytes: options.outputLimitBytes,
		parameters: Type.Object({
			case_sensitive: Type.Optional(Type.Boolean()),
			caseSensitive: Type.Optional(Type.Boolean()),
			is_regex: Type.Optional(Type.Boolean()),
			max_results: Type.Optional(Type.Number({ minimum: 1 })),
			maxResults: Type.Optional(Type.Number({ minimum: 1 })),
			path: Type.String({ minLength: 1 }),
			pattern: Type.String({ minLength: 1 }),
			regex: Type.Optional(Type.Boolean()),
		}),
		timeoutSeconds: options.timeoutSeconds,
	};
}
