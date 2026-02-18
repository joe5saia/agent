/**
 * Result of checking whether a shell command is blocked by policy.
 */
export interface BlockedCommandResult {
	blocked: boolean;
	reason?: string;
}

/**
 * Detects dangerous shell command patterns for the bash tool.
 */
export function isBlockedCommand(
	command: string,
	blockedCommandPatterns: Array<string> = [],
): BlockedCommandResult {
	const normalized = command.trim().replaceAll(/\s+/g, " ").toLowerCase();

	const hasRm = /\brm\b/.test(normalized);
	const hasRecursiveForce = /-(?:[a-z]*r[a-z]*f[a-z]*|[a-z]*f[a-z]*r[a-z]*)\b/.test(normalized);
	const hasDangerousTarget = /(?:^|\s)(?:\/\*?|~|\*)(?:\s|$)/.test(normalized);
	if (hasRm && hasRecursiveForce && hasDangerousTarget) {
		return {
			blocked: true,
			reason: "Blocked dangerous recursive delete command.",
		};
	}

	if (/^sudo(?:\s|$)/.test(normalized)) {
		return { blocked: true, reason: "Blocked sudo command." };
	}

	if (/\b(?:shutdown|reboot|halt)\b/.test(normalized)) {
		return { blocked: true, reason: "Blocked system power command." };
	}

	if (/\bmkfs(?:\.[a-z0-9]+)?\b/.test(normalized)) {
		return { blocked: true, reason: "Blocked filesystem format command." };
	}

	if (/\bdd\s+if=/.test(normalized)) {
		return { blocked: true, reason: "Blocked raw disk write command." };
	}

	if (/\bchmod\s+777\b/.test(normalized)) {
		return { blocked: true, reason: "Blocked insecure chmod 777 command." };
	}

	const isGitPush = /\bgit\s+push\b/.test(normalized);
	const hasForcePushFlag = /(?:^|\s)(?:--force(?:-with-lease)?(?:=[^\s]+)?|-f)(?:\s|$)/.test(
		normalized,
	);
	const targetsProtectedBranch =
		/(?:^|\s)(?:main|master|refs\/heads\/main|refs\/heads\/master)(?:\s|$)/.test(normalized);
	if (isGitPush && hasForcePushFlag && targetsProtectedBranch) {
		return { blocked: true, reason: "Blocked force push to protected branch." };
	}

	for (const pattern of blockedCommandPatterns) {
		const regex = new RegExp(pattern, "i");
		if (regex.test(command)) {
			return { blocked: true, reason: `Blocked by configured command pattern: ${pattern}` };
		}
	}

	return { blocked: false };
}
