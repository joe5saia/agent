import { watch, type FSWatcher, readFileSync } from "node:fs";
import { Value } from "@sinclair/typebox/value";
import { parse as parseYaml, YAMLParseError } from "yaml";
import { defaultConfig } from "./defaults.js";
import type { AgentConfig } from "./schema.js";
import { agentConfigSchema } from "./schema.js";

/**
 * Error raised when the configuration file does not exist.
 */
export class ConfigNotFoundError extends Error {
	public readonly path: string;

	public constructor(path: string) {
		super(
			[
				`Configuration file was not found at: ${path}`,
				"Create a config file with at least:",
				"  model:",
				"    provider: <provider>",
				"    name: <model>",
			].join("\n"),
		);
		this.name = "ConfigNotFoundError";
		this.path = path;
	}
}

/**
 * Error raised when configuration content cannot be parsed or validated.
 */
export class ConfigValidationError extends Error {
	public constructor(message: string) {
		super(message);
		this.name = "ConfigValidationError";
	}
}

export interface ConfigWatchEvent {
	path: string;
	type: "change" | "rename";
}

export interface ConfigWatcher {
	close: () => void;
}

type JsonValue = boolean | null | number | string | JsonValue[] | { [key: string]: JsonValue };

type JsonObject = { [key: string]: JsonValue };

function isJsonObject(value: unknown): value is JsonObject {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}

/**
 * Converts snake_case keys to camelCase recursively to map YAML keys to TypeScript fields.
 */
function toCamelCaseKeys(value: JsonValue): JsonValue {
	if (Array.isArray(value)) {
		return value.map((entry) => toCamelCaseKeys(entry));
	}
	if (value === null || typeof value !== "object") {
		return value;
	}

	const transformed: JsonObject = {};
	for (const [key, nestedValue] of Object.entries(value)) {
		const camelKey = key.replaceAll(/_([a-z])/g, (_match, letter: string) => letter.toUpperCase());
		transformed[camelKey] = toCamelCaseKeys(nestedValue);
	}

	return transformed;
}

/**
 * Loads, normalizes, defaults, and validates an agent config from YAML.
 */
export function loadConfig(path: string): AgentConfig {
	let rawConfig = "";
	try {
		rawConfig = readFileSync(path, "utf8");
	} catch (error: unknown) {
		if (error instanceof Error && "code" in error && error.code === "ENOENT") {
			throw new ConfigNotFoundError(path);
		}
		throw error;
	}

	let parsedConfig: JsonValue;
	try {
		parsedConfig = parseYaml(rawConfig) as JsonValue;
	} catch (error: unknown) {
		if (error instanceof YAMLParseError) {
			throw new ConfigValidationError(`Invalid YAML: ${error.message}`);
		}
		throw error;
	}

	if (parsedConfig === null || typeof parsedConfig !== "object" || Array.isArray(parsedConfig)) {
		throw new ConfigValidationError("Invalid configuration: root value must be a YAML object.");
	}

	const normalized = toCamelCaseKeys(parsedConfig);
	if (!isJsonObject(normalized)) {
		throw new ConfigValidationError("Invalid configuration: root value must be a YAML object.");
	}

	const mergedWithTopLevelDefaults: JsonObject = {
		...defaultConfig,
		...normalized,
		compaction: {
			...defaultConfig.compaction,
			...(isJsonObject(normalized.compaction) ? normalized.compaction : {}),
		},
		logging: {
			...defaultConfig.logging,
			...(isJsonObject(normalized.logging) ? normalized.logging : {}),
			rotation: {
				...defaultConfig.logging.rotation,
				...(isJsonObject(normalized.logging) && isJsonObject(normalized.logging.rotation)
					? normalized.logging.rotation
					: {}),
			},
		},
		retry: {
			...defaultConfig.retry,
			...(isJsonObject(normalized.retry) ? normalized.retry : {}),
		},
		security: {
			...defaultConfig.security,
			...(isJsonObject(normalized.security) ? normalized.security : {}),
		},
		server: {
			...defaultConfig.server,
			...(isJsonObject(normalized.server) ? normalized.server : {}),
		},
		systemPrompt: {
			...defaultConfig.systemPrompt,
			...(isJsonObject(normalized.systemPrompt) ? normalized.systemPrompt : {}),
		},
		tools: {
			...defaultConfig.tools,
			...(isJsonObject(normalized.tools) ? normalized.tools : {}),
		},
	};

	const cleaned = Value.Clean(agentConfigSchema, mergedWithTopLevelDefaults);
	const withDefaults = Value.Default(agentConfigSchema, cleaned);

	if (!Value.Check(agentConfigSchema, withDefaults)) {
		const errors = [...Value.Errors(agentConfigSchema, withDefaults)];
		const formatted = errors
			.map((entry) => {
				const pathWithoutSlash = entry.path.startsWith("/") ? entry.path.slice(1) : entry.path;
				const dottedPath = pathWithoutSlash.replaceAll("/", ".");
				return `  - ${dottedPath}: ${entry.message}`;
			})
			.join("\n");
		throw new ConfigValidationError(`Invalid configuration:\n${formatted}`);
	}

	return withDefaults as AgentConfig;
}

/**
 * Watches config-related paths and invokes onChange when files are updated.
 */
export function watchConfig(
	paths: Array<string>,
	onChange: (event: ConfigWatchEvent) => void,
): ConfigWatcher {
	const watchers: Array<FSWatcher> = [];
	for (const path of paths) {
		const watcher = watch(path, { persistent: true }, (eventType) => {
			if (eventType === "change" || eventType === "rename") {
				onChange({ path, type: eventType });
			}
		});
		watcher.on("error", () => {
			return;
		});
		watchers.push(watcher);
	}

	return {
		close: () => {
			for (const watcher of watchers) {
				watcher.close();
			}
		},
	};
}
