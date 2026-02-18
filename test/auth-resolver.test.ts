import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { OAuthCredentials } from "@mariozechner/pi-ai";
import { afterEach, describe, expect, it } from "vitest";
import { resolveApiKey } from "../src/auth/index.js";

const tempDirectories: Array<string> = [];

function createTempDir(): string {
	const directory = mkdtempSync(join(tmpdir(), "agent-auth-test-"));
	tempDirectories.push(directory);
	return directory;
}

afterEach(() => {
	for (const directory of tempDirectories.splice(0)) {
		rmSync(directory, { force: true, recursive: true });
	}
});

describe("resolveApiKey", () => {
	it("S11.11: prefers ANTHROPIC_OAUTH_TOKEN over auth.json", async () => {
		const directory = createTempDir();
		const authFile = join(directory, "auth.json");
		writeFileSync(
			authFile,
			JSON.stringify({
				anthropic: {
					access: "oauth-access",
					expires: Date.now() + 60_000,
					refresh: "oauth-refresh",
					type: "oauth",
				},
			}),
			"utf8",
		);

		let oauthLookupCalled = false;
		const apiKey = await resolveApiKey("anthropic", {
			authStorePath: authFile,
			env: {
				ANTHROPIC_OAUTH_TOKEN: "env-oauth-token",
			},
			getOAuthApiKeyFn: async () => {
				oauthLookupCalled = true;
				return {
					apiKey: "oauth-api-key",
					newCredentials: {
						access: "oauth-access",
						expires: Date.now() + 60_000,
						refresh: "oauth-refresh",
					},
				};
			},
		});

		expect(apiKey).toBe("env-oauth-token");
		expect(oauthLookupCalled).toBe(false);
	});

	it("S11.12 + S11.13: uses auth.json OAuth credentials and persists refresh", async () => {
		const directory = createTempDir();
		const authFile = join(directory, "auth.json");
		writeFileSync(
			authFile,
			JSON.stringify({
				anthropic: {
					access: "old-access",
					expires: Date.now() - 60_000,
					refresh: "old-refresh",
					type: "oauth",
				},
			}),
			"utf8",
		);

		const refreshedCredentials: OAuthCredentials = {
			access: "new-access",
			expires: Date.now() + 60_000,
			refresh: "new-refresh",
		};
		const apiKey = await resolveApiKey("anthropic", {
			authStorePath: authFile,
			env: {},
			getOAuthApiKeyFn: async () => {
				return {
					apiKey: "fresh-api-key",
					newCredentials: refreshedCredentials,
				};
			},
		});

		expect(apiKey).toBe("fresh-api-key");
		const updated = JSON.parse(readFileSync(authFile, "utf8")) as {
			anthropic?: OAuthCredentials & { type?: string };
		};
		expect(updated.anthropic?.access).toBe("new-access");
		expect(updated.anthropic?.refresh).toBe("new-refresh");
		expect(updated.anthropic?.type).toBe("oauth");
	});

	it("ignores auth store read errors when env credentials are present", async () => {
		const directory = createTempDir();
		const apiKey = await resolveApiKey("anthropic", {
			authStorePath: directory,
			env: {
				ANTHROPIC_API_KEY: "env-api-key",
			},
		});

		expect(apiKey).toBe("env-api-key");
	});
});
