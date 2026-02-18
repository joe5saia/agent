import { constants } from "node:fs";
import { access } from "node:fs/promises";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import type { OAuthCredentials, OAuthProvider } from "@mariozechner/pi-ai";

/**
 * OAuth credential entry persisted in auth.json.
 */
export interface StoredOAuthCredentials extends OAuthCredentials {
	type?: "oauth";
}

/**
 * auth.json object keyed by provider ID.
 */
export type AuthStoreData = Partial<Record<OAuthProvider, StoredOAuthCredentials>>;

/**
 * Default auth store path.
 */
export const defaultAuthStorePath = "~/.agent/auth.json";

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

/**
 * Validates that an unknown value is a persisted OAuth credential object.
 */
function isStoredOAuthCredentials(value: unknown): value is StoredOAuthCredentials {
	if (typeof value !== "object" || value === null) {
		return false;
	}

	const candidate = value as Record<string, unknown>;
	if (
		typeof candidate["access"] !== "string" ||
		typeof candidate["refresh"] !== "string" ||
		typeof candidate["expires"] !== "number"
	) {
		return false;
	}

	const optionalStringKeys: Array<keyof StoredOAuthCredentials> = [
		"accountId",
		"email",
		"enterpriseUrl",
		"projectId",
		"type",
	];
	for (const key of optionalStringKeys) {
		const field = candidate[key];
		if (field !== undefined && typeof field !== "string") {
			return false;
		}
	}

	return candidate["type"] === undefined || candidate["type"] === "oauth";
}

/**
 * Reads and validates provider credentials from auth.json.
 */
export async function loadAuthStore(path: string = defaultAuthStorePath): Promise<AuthStoreData> {
	const resolvedPath = expandHomePath(path);
	try {
		await access(resolvedPath, constants.F_OK);
	} catch {
		return {};
	}

	const raw = await readFile(resolvedPath, "utf8");
	const parsed = JSON.parse(raw) as unknown;
	if (typeof parsed !== "object" || parsed === null) {
		throw new Error(`Invalid auth store format at ${resolvedPath}: expected object.`);
	}

	const normalized: AuthStoreData = {};
	for (const [provider, value] of Object.entries(parsed)) {
		if (isStoredOAuthCredentials(value)) {
			normalized[provider as OAuthProvider] = value;
		}
	}
	return normalized;
}

/**
 * Writes the auth store atomically.
 */
export async function saveAuthStore(
	data: AuthStoreData,
	path: string = defaultAuthStorePath,
): Promise<void> {
	const resolvedPath = expandHomePath(path);
	const tempPath = `${resolvedPath}.tmp`;
	await mkdir(dirname(resolvedPath), { recursive: true });
	await writeFile(tempPath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
	await rename(tempPath, resolvedPath);
}

/**
 * Persists refreshed credentials for a single provider.
 */
export async function upsertOAuthCredentials(
	provider: OAuthProvider,
	credentials: OAuthCredentials,
	path: string = defaultAuthStorePath,
): Promise<void> {
	const data = await loadAuthStore(path);
	data[provider] = {
		...credentials,
		type: "oauth",
	};
	await saveAuthStore(data, path);
}
