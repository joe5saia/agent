import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { Type } from "@sinclair/typebox";
import { validatePath } from "../../security/index.js";
import type { AgentTool } from "../types.js";

/**
 * Configuration for the edit built-in tool.
 */
export interface EditToolOptions {
	allowedPaths: Array<string>;
	deniedPaths: Array<string>;
	outputLimitBytes: number;
	timeoutSeconds: number;
}

interface TextMatch {
	end: number;
	matched: string;
	start: number;
}

function escapeRegex(value: string): string {
	return value.replaceAll(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`);
}

function extractStringArg(args: Record<string, unknown>, keys: Array<string>): string | undefined {
	for (const key of keys) {
		const value = args[key];
		if (typeof value === "string") {
			return value;
		}
	}
	return undefined;
}

function findExactMatches(source: string, target: string): Array<TextMatch> {
	const matches: Array<TextMatch> = [];
	let cursor = 0;
	while (cursor <= source.length) {
		const index = source.indexOf(target, cursor);
		if (index === -1) {
			break;
		}
		matches.push({
			end: index + target.length,
			matched: target,
			start: index,
		});
		cursor = index + target.length;
	}
	return matches;
}

function findFuzzyMatches(source: string, target: string): Array<TextMatch> {
	const whitespaceFlexiblePattern = target
		.trim()
		.split(/\s+/)
		.filter((part) => part !== "")
		.map((part) => escapeRegex(part))
		.join(String.raw`\s+`);
	if (whitespaceFlexiblePattern === "") {
		return [];
	}

	const regex = new RegExp(whitespaceFlexiblePattern, "gm");
	const matches: Array<TextMatch> = [];
	for (let entry = regex.exec(source); entry !== null; entry = regex.exec(source)) {
		matches.push({
			end: entry.index + entry[0].length,
			matched: entry[0],
			start: entry.index,
		});
		if (entry.index === regex.lastIndex) {
			regex.lastIndex += 1;
		}
	}
	return matches;
}

function applyReplacement(source: string, match: TextMatch, replacement: string): string {
	return `${source.slice(0, match.start)}${replacement}${source.slice(match.end)}`;
}

function buildUnifiedDiff(path: string, before: string, after: string): string {
	const beforeLines = before.split("\n");
	const afterLines = after.split("\n");

	let prefix = 0;
	while (
		prefix < beforeLines.length &&
		prefix < afterLines.length &&
		beforeLines[prefix] === afterLines[prefix]
	) {
		prefix += 1;
	}

	let beforeSuffix = beforeLines.length - 1;
	let afterSuffix = afterLines.length - 1;
	while (
		beforeSuffix >= prefix &&
		afterSuffix >= prefix &&
		beforeLines[beforeSuffix] === afterLines[afterSuffix]
	) {
		beforeSuffix -= 1;
		afterSuffix -= 1;
	}

	const removed = beforeLines.slice(prefix, beforeSuffix + 1);
	const added = afterLines.slice(prefix, afterSuffix + 1);
	const header = `@@ -${String(prefix + 1)},${String(removed.length)} +${String(prefix + 1)},${String(added.length)} @@`;

	return [
		`--- ${path}`,
		`+++ ${path}`,
		header,
		...removed.map((line) => `-${line}`),
		...added.map((line) => `+${line}`),
	].join("\n");
}

/**
 * Creates the edit built-in tool.
 */
export function createEditTool(options: EditToolOptions): AgentTool {
	return {
		category: "write",
		description: "Edit a UTF-8 text file by replacing one exact, unique snippet with new content.",
		async execute(args: Record<string, unknown>): Promise<string> {
			const path = typeof args["path"] === "string" ? args["path"] : "";
			const oldText = extractStringArg(args, ["oldText", "old_text"]);
			const newText = extractStringArg(args, ["newText", "new_text"]);
			if (oldText === undefined || oldText === "" || newText === undefined) {
				throw new Error(
					"Invalid arguments for edit: provide path, oldText/newText (or old_text/new_text).",
				);
			}

			const result = validatePath(path, options.allowedPaths, options.deniedPaths);
			if (!result.allowed) {
				throw new Error(result.reason ?? "Path denied by policy.");
			}

			const before = await readFile(result.resolvedPath, "utf8");
			const exactMatches = findExactMatches(before, oldText);
			if (exactMatches.length > 1) {
				throw new Error(
					`Edit target is ambiguous: found ${String(exactMatches.length)} exact matches. Provide a more specific oldText.`,
				);
			}

			let replacementMode = "exact";
			let selectedMatch: TextMatch | undefined = exactMatches[0];
			if (selectedMatch === undefined) {
				const fuzzyMatches = findFuzzyMatches(before, oldText);
				if (fuzzyMatches.length === 0) {
					throw new Error(
						"Edit target not found. Verify oldText and retry with a precise existing snippet.",
					);
				}
				if (fuzzyMatches.length > 1) {
					throw new Error(
						`Edit fuzzy match is ambiguous: found ${String(fuzzyMatches.length)} matches. Provide more surrounding context.`,
					);
				}
				replacementMode = "fuzzy";
				selectedMatch = fuzzyMatches[0];
			}

			if (selectedMatch === undefined) {
				throw new Error("Edit failed to resolve a replacement target.");
			}

			const after = applyReplacement(before, selectedMatch, newText);
			if (after === before) {
				return [
					`No changes applied to ${result.resolvedPath}.`,
					"The replacement produced identical file content.",
				].join("\n");
			}

			await mkdir(dirname(result.resolvedPath), { recursive: true });
			await writeFile(result.resolvedPath, after, "utf8");

			const diff = buildUnifiedDiff(result.resolvedPath, before, after);
			return [
				`Edited ${result.resolvedPath} using ${replacementMode} replacement.`,
				"",
				"Unified diff:",
				diff,
			].join("\n");
		},
		name: "edit",
		outputLimitBytes: options.outputLimitBytes,
		parameters: Type.Object({
			new_text: Type.Optional(Type.String()),
			newText: Type.Optional(Type.String()),
			old_text: Type.Optional(Type.String({ minLength: 1 })),
			oldText: Type.Optional(Type.String({ minLength: 1 })),
			path: Type.String({ minLength: 1 }),
		}),
		timeoutSeconds: options.timeoutSeconds,
	};
}
