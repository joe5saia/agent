/**
 * Canonical representation of a loaded skill from SKILL.md frontmatter + body.
 */
export interface SkillDefinition {
	description: string;
	instructions: string;
	name: string;
	resources: Array<SkillResource>;
	rootDir: string;
	sourcePath: string;
}

/**
 * Resource discovered from a skill directory and eligible for on-demand loading.
 */
export interface SkillResource {
	kind: "asset" | "reference" | "script";
	path: string;
	relativePath: string;
	title: string;
}

/**
 * Loaded resource snippet selected for the current turn.
 */
export interface SkillResourceSnippet {
	content: string;
	kind: SkillResource["kind"];
	path: string;
	relativePath: string;
	skillName: string;
	title: string;
	truncated: boolean;
}

/**
 * Non-fatal warning surfaced while selecting/loading active skill resources.
 */
export interface SkillResourceWarning {
	message: string;
	path: string;
}

/**
 * Result of selecting on-demand resource snippets for a specific turn.
 */
export interface SkillResourceSelectionResult {
	snippets: Array<SkillResourceSnippet>;
	warnings: Array<SkillResourceWarning>;
}

/**
 * Non-fatal warning surfaced while loading skills.
 */
export interface SkillLoadWarning {
	message: string;
	path: string;
}

/**
 * Result of loading skill definitions from disk.
 */
export interface SkillLoadResult {
	skills: Array<SkillDefinition>;
	warnings: Array<SkillLoadWarning>;
}
