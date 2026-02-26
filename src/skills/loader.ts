import { existsSync, readdirSync, readFileSync, statSync, type Dirent } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, extname, join, normalize, relative, resolve } from "node:path";
import { parse as parseYaml, YAMLParseError } from "yaml";
import type { SkillDefinition, SkillLoadResult, SkillLoadWarning, SkillResource } from "./types.js";

type JsonValue =
	| boolean
	| null
	| number
	| string
	| JsonValue[]
	| {
			[key: string]: JsonValue;
	  };

type JsonObject = {
	[key: string]: JsonValue;
};

function isJsonObject(value: unknown): value is JsonObject {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}

/**
 * Expands a path that starts with ~/.
 */
function expandHomePath(path: string): string {
	if (path === "~") {
		return homedir();
	}
	if (path.startsWith("~/")) {
		return join(homedir(), path.slice(2));
	}
	return path;
}

function isWithinRoot(rootDir: string, candidate: string): boolean {
	const resolvedRoot = resolve(rootDir);
	const resolvedCandidate = resolve(candidate);
	if (resolvedCandidate === resolvedRoot) {
		return true;
	}
	return resolvedCandidate.startsWith(`${resolvedRoot}/`);
}

function normalizeRelativePath(rootDir: string, absolutePath: string): string {
	return normalize(relative(rootDir, absolutePath)).replaceAll("\\", "/");
}

function classifySkillResource(relativePath: string): SkillResource["kind"] {
	if (relativePath.startsWith("scripts/")) {
		return "script";
	}
	if (relativePath.startsWith("assets/")) {
		return "asset";
	}
	if (relativePath.startsWith("references/")) {
		return "reference";
	}
	const extension = extname(relativePath).toLowerCase();
	if ([".sh", ".py", ".js", ".ts", ".rb", ".bash", ".zsh"].includes(extension)) {
		return "script";
	}
	if (
		[".md", ".markdown", ".txt", ".json", ".yaml", ".yml", ".toml", ".xml", ".csv"].includes(
			extension,
		)
	) {
		return "reference";
	}
	return "asset";
}

function isIgnoredLinkTarget(target: string): boolean {
	const normalizedTarget = target.trim();
	if (normalizedTarget === "") {
		return true;
	}
	if (normalizedTarget.startsWith("#")) {
		return true;
	}
	return /^(https?:|mailto:|tel:)/i.test(normalizedTarget);
}

function extractLocalLinkedResources(
	instructions: string,
): Array<{ target: string; title: string }> {
	const links: Array<{ target: string; title: string }> = [];
	const linkRegex = /\[([^\]]+)\]\(([^)\n]+)\)/g;
	let match: RegExpExecArray | null = linkRegex.exec(instructions);
	while (match !== null) {
		const title = match[1]?.trim();
		const rawTarget = match[2]?.trim();
		if (title !== undefined && rawTarget !== undefined && !isIgnoredLinkTarget(rawTarget)) {
			const withoutAnchor = rawTarget.split("#")[0]?.split("?")[0]?.trim();
			if (withoutAnchor !== undefined && withoutAnchor !== "") {
				links.push({ target: withoutAnchor, title });
			}
		}
		match = linkRegex.exec(instructions);
	}
	return links;
}

function listFilesRecursively(rootDir: string, maxFiles: number): Array<string> {
	if (!existsSync(rootDir)) {
		return [];
	}

	const files: Array<string> = [];
	const queue: Array<string> = [rootDir];
	while (queue.length > 0 && files.length < maxFiles) {
		const current = queue.shift();
		if (current === undefined) {
			continue;
		}
		let entries: Array<Dirent<string>>;
		try {
			entries = readdirSync(current, { encoding: "utf8", withFileTypes: true });
		} catch {
			continue;
		}

		for (const entry of entries) {
			if (files.length >= maxFiles) {
				break;
			}
			const fullPath = join(current, entry.name);
			if (entry.isSymbolicLink()) {
				continue;
			}
			if (entry.isDirectory()) {
				queue.push(fullPath);
				continue;
			}
			if (entry.isFile()) {
				files.push(fullPath);
			}
		}
	}
	files.sort((left, right) => left.localeCompare(right));
	return files;
}

function discoverSkillResources(
	skillPath: string,
	instructions: string,
	warnings: Array<SkillLoadWarning>,
): Array<SkillResource> {
	const rootDir = dirname(skillPath);
	const resourcesByPath = new Map<string, SkillResource>();

	const pushResource = (absolutePath: string, title?: string): void => {
		if (!isWithinRoot(rootDir, absolutePath)) {
			return;
		}
		if (!existsSync(absolutePath)) {
			return;
		}
		let stat;
		try {
			stat = statSync(absolutePath);
		} catch {
			return;
		}
		if (!stat.isFile()) {
			return;
		}

		const relativePath = normalizeRelativePath(rootDir, absolutePath);
		if (relativePath === "SKILL.md") {
			return;
		}

		const existing = resourcesByPath.get(absolutePath);
		if (existing !== undefined) {
			if (
				(title?.trim() ?? "") !== "" &&
				existing.title === basename(existing.relativePath, extname(existing.relativePath))
			) {
				existing.title = title?.trim() ?? existing.title;
			}
			return;
		}

		const defaultTitle = basename(relativePath, extname(relativePath));
		resourcesByPath.set(absolutePath, {
			kind: classifySkillResource(relativePath),
			path: absolutePath,
			relativePath,
			title: (title?.trim() ?? "") === "" ? defaultTitle : (title?.trim() ?? defaultTitle),
		});
	};

	for (const link of extractLocalLinkedResources(instructions)) {
		const absoluteTarget = resolve(rootDir, link.target);
		if (!existsSync(absoluteTarget)) {
			warnings.push({
				message: `Linked resource not found: ${link.target}`,
				path: skillPath,
			});
			continue;
		}
		pushResource(absoluteTarget, link.title);
	}

	for (const bundledDir of ["references", "scripts", "assets"]) {
		for (const file of listFilesRecursively(join(rootDir, bundledDir), 128)) {
			pushResource(file);
		}
	}

	return [...resourcesByPath.values()].sort((left, right) =>
		left.relativePath.localeCompare(right.relativePath),
	);
}

/**
 * Recursively finds SKILL.md files under a root directory.
 */
function findSkillFiles(rootDir: string): Array<string> {
	const resolvedRoot = expandHomePath(rootDir);
	if (!existsSync(resolvedRoot)) {
		return [];
	}

	const files: Array<string> = [];
	const queue: Array<string> = [resolvedRoot];

	while (queue.length > 0) {
		const current = queue.shift();
		if (current === undefined) {
			continue;
		}

		let entries: Array<Dirent<string>>;
		try {
			entries = readdirSync(current, { encoding: "utf8", withFileTypes: true });
		} catch {
			continue;
		}

		for (const entry of entries) {
			const fullPath = join(current, entry.name);
			if (entry.isSymbolicLink()) {
				continue;
			}
			if (entry.isDirectory()) {
				queue.push(fullPath);
				continue;
			}
			if (entry.isFile() && entry.name === "SKILL.md") {
				files.push(fullPath);
			}
		}
	}

	files.sort((left, right) => left.localeCompare(right));
	return files;
}

/**
 * Parses SKILL.md into a strict skill definition.
 */
function parseSkillFile(path: string, warnings: Array<SkillLoadWarning>): SkillDefinition {
	const source = readFileSync(path, "utf8");
	const match = source.match(/^---\s*\r?\n([\s\S]*?)\r?\n---\s*(?:\r?\n|$)/);
	if (match === null) {
		throw new Error("Missing YAML frontmatter.");
	}

	const frontmatterSource = match[1];
	if (frontmatterSource === undefined) {
		throw new Error("Missing frontmatter body.");
	}
	let frontmatter: unknown;
	try {
		frontmatter = parseYaml(frontmatterSource);
	} catch (error: unknown) {
		if (error instanceof YAMLParseError) {
			throw new Error(`Invalid frontmatter YAML: ${error.message}`);
		}
		throw error;
	}
	if (!isJsonObject(frontmatter)) {
		throw new Error("Frontmatter must be a YAML object.");
	}

	const name = frontmatter["name"];
	if (typeof name !== "string" || name.trim() === "") {
		throw new Error("Frontmatter requires a non-empty `name`.");
	}

	const description = frontmatter["description"];
	if (typeof description !== "string" || description.trim() === "") {
		throw new Error("Frontmatter requires a non-empty `description`.");
	}

	const instructions = source.slice(match[0].length).trim();
	if (instructions === "") {
		throw new Error("Skill instructions body is empty.");
	}

	const sourcePath = resolve(path);
	const rootDir = dirname(sourcePath);
	const resources = discoverSkillResources(sourcePath, instructions, warnings);

	return {
		description: description.trim(),
		instructions,
		name: name.trim(),
		resources,
		rootDir,
		sourcePath,
	};
}

/**
 * Loads skills from one or more directories. Later directories win on name collisions.
 */
export function loadSkills(skillDirectories: Array<string>): SkillLoadResult {
	const loadedByName = new Map<string, SkillDefinition>();
	const warnings: Array<SkillLoadWarning> = [];

	for (const directory of skillDirectories) {
		for (const path of findSkillFiles(directory)) {
			try {
				const parsed = parseSkillFile(path, warnings);
				loadedByName.set(parsed.name.toLowerCase(), parsed);
			} catch (error: unknown) {
				const message = error instanceof Error ? error.message : String(error);
				warnings.push({
					message,
					path,
				});
			}
		}
	}

	return {
		skills: [...loadedByName.values()].sort((left, right) => left.name.localeCompare(right.name)),
		warnings,
	};
}
