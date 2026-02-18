import { getOAuthApiKey, type OAuthProvider } from "@mariozechner/pi-ai";
import type { OAuthCredentials, Provider } from "@mariozechner/pi-ai";
import {
	defaultAuthStorePath,
	loadAuthStore,
	type AuthStoreData,
	upsertOAuthCredentials,
} from "./store.js";

/**
 * Dependency injection for OAuth API key exchange, used by tests.
 */
type OAuthApiKeyFetcher = typeof getOAuthApiKey;

/**
 * Resolver options.
 */
export interface ResolveApiKeyOptions {
	authStorePath?: string;
	env?: NodeJS.ProcessEnv;
	getOAuthApiKeyFn?: OAuthApiKeyFetcher;
}

/**
 * Set of providers that support OAuth credentials in auth.json.
 */
const oauthProviders = new Set<OAuthProvider>([
	"anthropic",
	"github-copilot",
	"google-antigravity",
	"google-gemini-cli",
	"openai-codex",
]);

/**
 * Reads provider API key from environment variables.
 */
function getEnvApiKey(provider: string, env: NodeJS.ProcessEnv): string | undefined {
	if (provider === "anthropic") {
		return env["ANTHROPIC_OAUTH_TOKEN"] ?? env["ANTHROPIC_API_KEY"];
	}
	if (provider === "github-copilot") {
		return env["COPILOT_GITHUB_TOKEN"] ?? env["GH_TOKEN"] ?? env["GITHUB_TOKEN"];
	}

	const envKeyMap: Record<string, string> = {
		cerebras: "CEREBRAS_API_KEY",
		google: "GEMINI_API_KEY",
		groq: "GROQ_API_KEY",
		mistral: "MISTRAL_API_KEY",
		openai: "OPENAI_API_KEY",
		opencode: "OPENCODE_API_KEY",
		openrouter: "OPENROUTER_API_KEY",
		xai: "XAI_API_KEY",
		zai: "ZAI_API_KEY",
	};
	const envKey = envKeyMap[provider];
	return envKey === undefined ? undefined : env[envKey];
}

/**
 * Returns true if a provider string is an OAuth provider.
 */
function isOAuthProvider(provider: string): provider is OAuthProvider {
	return oauthProviders.has(provider as OAuthProvider);
}

/**
 * Builds the credential map expected by getOAuthApiKey.
 */
function credentialsForOAuthLookup(data: AuthStoreData): Record<string, OAuthCredentials> {
	const credentials: Record<string, OAuthCredentials> = {};
	for (const [provider, stored] of Object.entries(data)) {
		if (stored === undefined) {
			continue;
		}
		const { type: _type, ...oauthCredentials } = stored;
		credentials[provider] = oauthCredentials;
	}
	return credentials;
}

/**
 * Resolves an API key for a provider with env-first semantics and OAuth fallback.
 */
export async function resolveApiKey(
	provider: Provider,
	options: ResolveApiKeyOptions = {},
): Promise<string | undefined> {
	const env = options.env ?? process.env;
	const envApiKey = getEnvApiKey(provider, env);
	if (envApiKey !== undefined && envApiKey !== "") {
		return envApiKey;
	}

	if (!isOAuthProvider(provider)) {
		return undefined;
	}

	const authStorePath = options.authStorePath ?? defaultAuthStorePath;
	const getOAuthApiKeyFn = options.getOAuthApiKeyFn ?? getOAuthApiKey;

	let authStore: AuthStoreData;
	try {
		authStore = await loadAuthStore(authStorePath);
	} catch {
		return undefined;
	}

	const result = await getOAuthApiKeyFn(provider, credentialsForOAuthLookup(authStore));
	if (result === null) {
		return undefined;
	}

	await upsertOAuthCredentials(provider, result.newCredentials, authStorePath);
	return result.apiKey;
}
