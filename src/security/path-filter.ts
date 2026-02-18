import { existsSync, realpathSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, relative, resolve, sep } from "node:path";

/**
 * Result of validating whether a path is inside allowed boundaries.
 */
export interface PathValidationResult {
	allowed: boolean;
	reason?: string;
	resolvedPath: string;
}

/**
 * Expands a leading tilde path segment.
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

/**
 * Resolves a policy path to an absolute canonical path when possible.
 */
function resolvePolicyPath(path: string): string {
	const expanded = expandHomePath(path);
	if (existsSync(expanded)) {
		return realpathSync(expanded);
	}
	return resolve(expanded);
}

/**
 * Resolves a target path. If it does not exist, resolves the nearest existing parent.
 */
function resolveTargetPath(path: string): string {
	const expanded = expandHomePath(path);
	if (existsSync(expanded)) {
		return realpathSync(expanded);
	}

	const parentDirectory = dirname(expanded);
	if (!existsSync(parentDirectory)) {
		return resolve(expanded);
	}

	const canonicalParent = realpathSync(parentDirectory);
	const relativeTarget = relative(parentDirectory, expanded);
	return join(canonicalParent, relativeTarget);
}

/**
 * Checks whether a path is inside a boundary path (inclusive).
 */
function isWithinBoundary(targetPath: string, boundaryPath: string): boolean {
	if (targetPath === boundaryPath) {
		return true;
	}
	return targetPath.startsWith(`${boundaryPath}${sep}`);
}

/**
 * Validates a target path against denied and allowed path lists.
 */
export function validatePath(
	target: string,
	allowedPaths: Array<string>,
	deniedPaths: Array<string>,
): PathValidationResult {
	const resolvedTarget = resolveTargetPath(target);
	const resolvedDeniedPaths = deniedPaths.map((path) => resolvePolicyPath(path));
	const resolvedAllowedPaths = allowedPaths.map((path) => resolvePolicyPath(path));

	for (const deniedPath of resolvedDeniedPaths) {
		if (isWithinBoundary(resolvedTarget, deniedPath)) {
			return {
				allowed: false,
				reason: `Path is denied by security policy: ${target}`,
				resolvedPath: resolvedTarget,
			};
		}
	}

	for (const allowedPath of resolvedAllowedPaths) {
		if (isWithinBoundary(resolvedTarget, allowedPath)) {
			return { allowed: true, resolvedPath: resolvedTarget };
		}
	}

	return {
		allowed: false,
		reason: `Path is outside allowed paths: ${target}`,
		resolvedPath: resolvedTarget,
	};
}
