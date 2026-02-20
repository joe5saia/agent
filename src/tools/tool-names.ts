/**
 * Canonical built-in tool names used for migration and policy normalization.
 */
export const legacyBuiltinToolAliases = {
	list_directory: "ls",
	read_file: "read",
	write_file: "write",
} as const;

/**
 * Returns the canonical tool name for a legacy alias.
 */
export function normalizeToolName(name: string): string {
	return legacyBuiltinToolAliases[name as keyof typeof legacyBuiltinToolAliases] ?? name;
}

/**
 * Returns true when the provided tool name is a deprecated legacy alias.
 */
export function isLegacyToolAlias(name: string): boolean {
	return name in legacyBuiltinToolAliases;
}
