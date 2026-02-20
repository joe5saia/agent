import { readdir, stat } from "node:fs/promises";
import { join, relative } from "node:path";
import { validatePath } from "../../security/index.js";

export interface DiscoveryToolOptions {
	allowedPaths: Array<string>;
	deniedPaths: Array<string>;
	outputLimitBytes: number;
	timeoutSeconds: number;
}

export interface DiscoveredPath {
	path: string;
	type: "directory" | "file";
}

/**
 * Resolves and validates an input path for discovery/read-only tools.
 */
export function resolveScopedPath(
	path: string,
	options: Pick<DiscoveryToolOptions, "allowedPaths" | "deniedPaths">,
): string {
	const result = validatePath(path, options.allowedPaths, options.deniedPaths);
	if (!result.allowed) {
		throw new Error(result.reason ?? "Path denied by policy.");
	}
	return result.resolvedPath;
}

/**
 * Returns true when the candidate is inside the root boundary.
 */
export function isWithinRoot(root: string, candidate: string): boolean {
	if (root === candidate) {
		return true;
	}
	const rel = relative(root, candidate);
	return rel !== "" && !rel.startsWith("..") && rel !== "..";
}

/**
 * Recursively walks files and directories under the scoped root.
 */
export async function walkScopedTree(
	rootPath: string,
	options: Pick<DiscoveryToolOptions, "allowedPaths" | "deniedPaths">,
	signal?: AbortSignal,
): Promise<Array<DiscoveredPath>> {
	const scopedRoot = resolveScopedPath(rootPath, options);
	const rootStats = await stat(scopedRoot);
	if (!rootStats.isDirectory()) {
		return [{ path: scopedRoot, type: "file" }];
	}

	const results: Array<DiscoveredPath> = [];
	const queued = [scopedRoot];
	const visitedDirectories = new Set<string>();

	while (queued.length > 0) {
		signal?.throwIfAborted();
		const directory = queued.shift();
		if (directory === undefined || visitedDirectories.has(directory)) {
			continue;
		}
		visitedDirectories.add(directory);
		results.push({ path: directory, type: "directory" });

		const entries = await readdir(directory, { withFileTypes: true });
		entries.sort((left, right) => left.name.localeCompare(right.name));
		for (const entry of entries) {
			signal?.throwIfAborted();
			const nextRawPath = join(directory, entry.name);
			const validation = validatePath(nextRawPath, options.allowedPaths, options.deniedPaths);
			if (!validation.allowed || !isWithinRoot(scopedRoot, validation.resolvedPath)) {
				continue;
			}

			if (entry.isDirectory()) {
				queued.push(validation.resolvedPath);
				continue;
			}
			results.push({ path: validation.resolvedPath, type: "file" });
		}
	}

	results.sort((left, right) => left.path.localeCompare(right.path));
	return results;
}
