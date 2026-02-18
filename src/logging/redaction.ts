const REDACTED = "[REDACTED]";

const awsAccessKeyPattern = /\bAKIA[0-9A-Z]{16}\b/g;
const bearerTokenPattern = /\bBearer\s+[A-Za-z0-9\-._~+/]+=*\b/gi;
const jwtPattern = /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g;

/**
 * Value types accepted by the redaction layer.
 */
export type RedactableValue =
	| Array<RedactableValue>
	| boolean
	| null
	| number
	| string
	| { [key: string]: RedactableValue };

/**
 * Matches key names that should always be redacted.
 */
function isSensitiveKey(key: string): boolean {
	const lowerKey = key.toLowerCase();
	if (lowerKey === "authorization") {
		return true;
	}

	return (
		/(?:^|_)(key|token|secret|password)$/.test(lowerKey) ||
		/(key|token|secret|password)$/.test(lowerKey)
	);
}

/**
 * Redacts known secret-like patterns in arbitrary strings.
 */
function redactString(value: string): string {
	const withBearerRedacted = value.replaceAll(bearerTokenPattern, REDACTED);
	const withJwtRedacted = withBearerRedacted.replaceAll(jwtPattern, REDACTED);
	return withJwtRedacted.replaceAll(awsAccessKeyPattern, REDACTED);
}

/**
 * Recursively redacts secrets from structured log payloads.
 */
export function redactValue(value: RedactableValue, key?: string): RedactableValue {
	if (typeof key === "string" && isSensitiveKey(key)) {
		return REDACTED;
	}

	if (typeof value === "string") {
		return redactString(value);
	}

	if (Array.isArray(value)) {
		return value.map((entry) => redactValue(entry));
	}

	if (value === null || typeof value !== "object") {
		return value;
	}

	const redactedObject: { [key: string]: RedactableValue } = {};
	for (const [objectKey, objectValue] of Object.entries(value)) {
		redactedObject[objectKey] = redactValue(objectValue, objectKey);
	}
	return redactedObject;
}

export { REDACTED };
