import { legacyBuiltinToolAliases } from "../tool-names.js";

const removalMilestone = "2026-06-01";
const warnedAliases = new Set<string>();

/**
 * Emits a one-time warning when a deprecated built-in alias is used.
 */
export function warnLegacyAliasUsage(aliasName: string): void {
	if (warnedAliases.has(aliasName)) {
		return;
	}

	const canonical = legacyBuiltinToolAliases[aliasName as keyof typeof legacyBuiltinToolAliases];
	if (canonical === undefined) {
		return;
	}

	warnedAliases.add(aliasName);
	process.emitWarning(
		`Tool alias "${aliasName}" is deprecated. Use "${canonical}" instead. Alias removal milestone: ${removalMilestone}.`,
		{
			code: "AGENT_TOOL_ALIAS_DEPRECATED",
			type: "DeprecationWarning",
		},
	);
}
