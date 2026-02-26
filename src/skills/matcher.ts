import type { SkillDefinition } from "./types.js";

export interface SkillSelectionOptions {
	maxSkills?: number;
	minimumOverlap?: number;
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

function extractExplicitSkillRefs(input: string): Set<string> {
	const refs = new Set<string>();
	for (const pattern of [/\$([a-z0-9][a-z0-9-]{1,63})/gi, /\/skill:([a-z0-9][a-z0-9-]{1,63})/gi]) {
		let match: RegExpExecArray | null = pattern.exec(input);
		while (match !== null) {
			const skillName = match[1];
			if (skillName !== undefined) {
				refs.add(skillName.toLowerCase());
			}
			match = pattern.exec(input);
		}
	}
	return refs;
}

function overlaps(left: Set<string>, right: Set<string>): number {
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

/**
 * Selects relevant skills for a user prompt. Explicit references always win.
 */
export function selectRelevantSkills(
	skills: Array<SkillDefinition>,
	userText: string,
	options: SkillSelectionOptions = {},
): Array<SkillDefinition> {
	const normalizedText = userText.trim().toLowerCase();
	if (normalizedText === "") {
		return [];
	}

	const maxSkills = Math.max(1, options.maxSkills ?? 3);
	const minimumOverlap = Math.max(1, options.minimumOverlap ?? 2);
	const explicitRefs = extractExplicitSkillRefs(normalizedText);
	const queryTokens = tokenize(normalizedText);

	const scored = skills
		.map((skill) => {
			const normalizedName = skill.name.toLowerCase();
			const skillTokens = tokenize(`${skill.name} ${skill.description}`);
			const overlapCount = overlaps(queryTokens, skillTokens);
			const explicit = explicitRefs.has(normalizedName);
			const includesName = new RegExp(
				`(^|[^a-z0-9-])${escapeRegExp(normalizedName)}([^a-z0-9-]|$)`,
				"i",
			).test(normalizedText);
			const score =
				(explicit ? 1000 : 0) +
				(includesName ? 100 : 0) +
				(overlapCount >= minimumOverlap ? overlapCount : 0);
			return {
				score,
				skill,
			};
		})
		.filter(({ score }) => score > 0)
		.sort((left, right) => {
			if (right.score !== left.score) {
				return right.score - left.score;
			}
			return left.skill.name.localeCompare(right.skill.name);
		});

	return scored.slice(0, maxSkills).map((entry) => entry.skill);
}
