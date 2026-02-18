import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { Type, type TSchema } from "@sinclair/typebox";
import { parse as parseYaml } from "yaml";
import { buildToolEnv } from "../security/index.js";
import type { AgentTool, ToolCategory } from "./types.js";

const defaultAllowedEnv = [
	"PATH",
	"HOME",
	"USER",
	"LANG",
	"LC_ALL",
	"TERM",
	"SHELL",
	"TMPDIR",
	"TZ",
];

interface LoadCliToolsOptions {
	allowedEnv?: Array<string>;
}

interface CliParameterDefinition {
	description?: string;
	enum?: Array<string>;
	optional?: boolean;
	pattern?: string;
	type: "boolean" | "number" | "string";
}

interface CliToolDefinition {
	args?: Array<string>;
	category: ToolCategory;
	cmd: string;
	description: string;
	env?: Record<string, string>;
	name: string;
	optional_args?: Record<string, Array<string>>;
	parameters: Record<string, CliParameterDefinition>;
}

interface CliToolsDocument {
	tools: Array<CliToolDefinition>;
}

function isObject(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === "object";
}

function parseEnvReference(value: string): string {
	const match = value.match(/^\$\{([A-Z0-9_]+)\}$/i);
	if (match === null) {
		return value;
	}
	const envKey = match[1];
	if (envKey === undefined) {
		return "";
	}
	return process.env[envKey] ?? "";
}

function interpolateTemplate(value: string, args: Record<string, unknown>): string {
	return value.replaceAll(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_match, key: string) => {
		const argValue = args[key];
		if (argValue === undefined || argValue === null) {
			return "";
		}
		return String(argValue);
	});
}

function buildParameterSchema(parameters: Record<string, CliParameterDefinition>): TSchema {
	const requiredProperties: Record<string, TSchema> = {};
	const optionalProperties: Record<string, TSchema> = {};

	for (const [name, definition] of Object.entries(parameters)) {
		let schema: TSchema;
		switch (definition.type) {
			case "boolean": {
				schema = Type.Boolean();
				break;
			}
			case "number": {
				schema = Type.Number();
				break;
			}
			case "string": {
				if (definition.enum !== undefined && definition.enum.length > 0) {
					schema = Type.Union(definition.enum.map((entry) => Type.Literal(entry)));
					break;
				}
				schema = Type.String(
					definition.pattern === undefined
						? {}
						: {
								pattern: definition.pattern,
							},
				);
				break;
			}
		}

		if (definition.optional) {
			optionalProperties[name] = schema;
			continue;
		}
		requiredProperties[name] = schema;
	}

	return Type.Object({
		...requiredProperties,
		...Object.fromEntries(
			Object.entries(optionalProperties).map(([name, schema]) => [name, Type.Optional(schema)]),
		),
	});
}

function normalizeParsedTools(document: unknown): CliToolsDocument {
	if (!isObject(document) || !("tools" in document) || !Array.isArray(document["tools"])) {
		throw new Error("Invalid tools.yaml: root object must include a tools array.");
	}

	return {
		tools: document["tools"] as Array<CliToolDefinition>,
	};
}

/**
 * Loads CLI tool definitions from YAML and converts them into AgentTool entries.
 */
export function loadCliTools(path: string, options: LoadCliToolsOptions = {}): Array<AgentTool> {
	let raw = "";
	try {
		raw = readFileSync(path, "utf8");
	} catch (error: unknown) {
		if (error instanceof Error && "code" in error && error.code === "ENOENT") {
			return [];
		}
		throw error;
	}

	const parsed = parseYaml(raw);
	const document = normalizeParsedTools(parsed);

	return document.tools.map((toolDefinition): AgentTool => {
		const parameterSchema = buildParameterSchema(toolDefinition.parameters);
		return {
			category: toolDefinition.category,
			description: toolDefinition.description,
			async execute(args: Record<string, unknown>, signal?: AbortSignal): Promise<string> {
				const requiredArgs = (toolDefinition.args ?? []).map((value) =>
					interpolateTemplate(value, args),
				);
				const optionalArgs: Array<string> = [];

				for (const [parameterName, argParts] of Object.entries(
					toolDefinition.optional_args ?? {},
				)) {
					if (args[parameterName] === undefined) {
						continue;
					}
					for (const part of argParts) {
						optionalArgs.push(interpolateTemplate(part, args));
					}
				}

				const commandArgs = [...requiredArgs, ...optionalArgs];
				const resolvedToolEnv = Object.fromEntries(
					Object.entries(toolDefinition.env ?? {}).map(([key, value]) => [
						key,
						parseEnvReference(value),
					]),
				);
				const env = buildToolEnv(options.allowedEnv ?? defaultAllowedEnv, resolvedToolEnv);

				return await new Promise<string>((resolve, reject) => {
					const child = spawn(toolDefinition.cmd, commandArgs, {
						env,
						shell: false,
						signal,
					});

					let output = "";
					child.stdout.on("data", (chunk: Buffer) => {
						output += chunk.toString("utf8");
					});
					child.stderr.on("data", (chunk: Buffer) => {
						output += chunk.toString("utf8");
					});
					child.on("error", (error) => {
						reject(error);
					});
					child.on("close", (code) => {
						if (code === 0) {
							resolve(output);
							return;
						}
						reject(new Error(`CLI tool exited with code ${String(code)}: ${output}`));
					});
				});
			},
			name: toolDefinition.name,
			parameters: parameterSchema,
		};
	});
}
