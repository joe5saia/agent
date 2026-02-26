import { readFileSync } from "node:fs";
import { basename, extname } from "node:path";
import type {
	SkillDefinition,
	SkillResource,
	SkillResourceSelectionResult,
	SkillResourceSnippet,
} from "./types.js";

export interface SkillResourceSelectionOptions {
	maxBytesPerResource?: number;
	maxResourcesPerSkill?: number;
	maxResourcesTotal?: number;
	minimumScore?: number;
}

const stopWords = new Set<string>([
	"a",
	"an",
	"and",
	"are",
	"at",
	"be",
	"by",
	"for",
	"from",
	"help",
	"how",
	"in",
	"is",
	"it",
	"of",
	"on",
	"or",
	"please",
	"that",
	"the",
	"this",
	"to",
	"use",
	"with",
]);

const textLikeExtensions = new Set<string>([
	".bash",
	".cjs",
	".css",
	".csv",
	".go",
	".graphql",
	".hbs",
	".html",
	".ini",
	".java",
	".js",
	".json",
	".jsx",
	".kt",
	".lua",
	".md",
	".mjs",
	".py",
	".rb",
	".rs",
	".sh",
	".sql",
	".swift",
	".toml",
	".ts",
	".tsx",
	".txt",
	".xml",
	".yaml",
	".yml",
	".zsh",
]);

function tokenize(input: string): Set<string> {
	const matches = input.toLowerCase().match(/[a-z0-9][a-z0-9-]{1,}/g);
	const tokens = new Set<string>();
	for (const token of matches ?? []) {
		if (!stopWords.has(token)) {
			tokens.add(token);
		}
	}
	return tokens;
}

function overlap(left: Set<string>, right: Set<string>): number {
	let count = 0;
	for (const token of left) {
		if (right.has(token)) {
			count += 1;
		}
	}
	return count;
}

function escapeRegExp(input: string): string {
	return input.replaceAll(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`);
}

function hasExplicitMention(text: string, resource: SkillResource): boolean {
	const patterns = [
		resource.relativePath.toLowerCase(),
		basename(resource.relativePath).toLowerCase(),
		resource.title.toLowerCase(),
	];
	return patterns.some((pattern) =>
		new RegExp(`(^|[^a-z0-9_.\\/-])${escapeRegExp(pattern)}([^a-z0-9_.\\/-]|$)`, "i").test(text),
	);
}

function intentBonus(kind: SkillResource["kind"], normalizedText: string): number {
	if (
		kind === "reference" &&
		/(reference|references|docs|documentation|schema|guide|details|api)/i.test(normalizedText)
	) {
		return 3;
	}
	if (kind === "script" && /(script|run|execute|cli|command|automation)/i.test(normalizedText)) {
		return 3;
	}
	if (
		kind === "asset" &&
		/(asset|template|logo|icon|font|image|screenshot|mockup|design)/i.test(normalizedText)
	) {
		return 3;
	}
	return 0;
}

function isLikelyText(path: string, buffer: Buffer): boolean {
	const extension = extname(path).toLowerCase();
	if (textLikeExtensions.has(extension)) {
		return true;
	}
	const probeSize = Math.min(buffer.length, 1024);
	return !buffer.subarray(0, probeSize).includes(0);
}

function readSnippet(
	path: string,
	byteLimit: number,
): { content: string; truncated: boolean } | undefined {
	const source = readFileSync(path);
	if (!isLikelyText(path, source)) {
		return undefined;
	}
	const truncated = source.length > byteLimit;
	const content = source.subarray(0, byteLimit).toString("utf8");
	return {
		content: truncated
			? `${content}\n\n[resource truncated at ${String(byteLimit)} bytes]`
			: content,
		truncated,
	};
}

/**
 * Selects and loads on-demand skill resource snippets for the current user turn.
 */
export function selectSkillResourceSnippets(
	activeSkills: Array<SkillDefinition>,
	userText: string,
	options: SkillResourceSelectionOptions = {},
): SkillResourceSelectionResult {
	const normalizedText = userText.trim().toLowerCase();
	if (normalizedText === "") {
		return { snippets: [], warnings: [] };
	}

	const maxBytesPerResource = Math.max(512, options.maxBytesPerResource ?? 12_000);
	const maxResourcesPerSkill = Math.max(1, options.maxResourcesPerSkill ?? 2);
	const maxResourcesTotal = Math.max(1, options.maxResourcesTotal ?? 6);
	const minimumScore = Math.max(1, options.minimumScore ?? 2);
	const queryTokens = tokenize(normalizedText);

	const candidates = activeSkills
		.flatMap((skill) =>
			skill.resources.map((resource) => {
				const explicit = hasExplicitMention(normalizedText, resource);
				const resourceTokens = tokenize(`${resource.relativePath} ${resource.title}`);
				const baseScore =
					(explicit ? 1000 : 0) +
					overlap(queryTokens, resourceTokens) * 4 +
					intentBonus(resource.kind, normalizedText);
				return {
					explicit,
					resource,
					score: baseScore,
					skillName: skill.name,
				};
			}),
		)
		.filter((candidate) => candidate.explicit || candidate.score >= minimumScore)
		.sort((left, right) => {
			if (right.score !== left.score) {
				return right.score - left.score;
			}
			if (left.skillName !== right.skillName) {
				return left.skillName.localeCompare(right.skillName);
			}
			return left.resource.relativePath.localeCompare(right.resource.relativePath);
		});

	const snippets: Array<SkillResourceSnippet> = [];
	const warnings: SkillResourceSelectionResult["warnings"] = [];
	const selectedPerSkill = new Map<string, number>();

	for (const candidate of candidates) {
		if (snippets.length >= maxResourcesTotal) {
			break;
		}
		const skillCount = selectedPerSkill.get(candidate.skillName) ?? 0;
		if (skillCount >= maxResourcesPerSkill) {
			continue;
		}

		try {
			const snippet = readSnippet(candidate.resource.path, maxBytesPerResource);
			if (snippet === undefined) {
				warnings.push({
					message: "Skipped non-text resource.",
					path: candidate.resource.path,
				});
				continue;
			}
			snippets.push({
				content: snippet.content,
				kind: candidate.resource.kind,
				path: candidate.resource.path,
				relativePath: candidate.resource.relativePath,
				skillName: candidate.skillName,
				title: candidate.resource.title,
				truncated: snippet.truncated,
			});
			selectedPerSkill.set(candidate.skillName, skillCount + 1);
		} catch (error: unknown) {
			warnings.push({
				message:
					error instanceof Error
						? `Failed to read selected resource: ${error.message}`
						: `Failed to read selected resource: ${String(error)}`,
				path: candidate.resource.path,
			});
		}
	}

	return { snippets, warnings };
}
