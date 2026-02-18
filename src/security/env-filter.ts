/**
 * Constructs the minimal environment passed to tool subprocesses.
 */
export function buildToolEnv(
	allowedKeys: Array<string>,
	toolEnv?: Record<string, string>,
): Record<string, string> {
	const env: Record<string, string> = {};

	for (const key of allowedKeys) {
		const value = process.env[key];
		if (typeof value === "string") {
			env[key] = value;
		}
	}

	if (typeof toolEnv === "object" && toolEnv !== null) {
		for (const [key, value] of Object.entries(toolEnv)) {
			env[key] = value;
		}
	}

	return env;
}
