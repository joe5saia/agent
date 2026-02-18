import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { Type, type TSchema } from "@sinclair/typebox";
import { parse as parseYaml } from "yaml";
import { listTemplateVariables } from "./template.js";
import type { WorkflowDefinition, WorkflowParameterDefinition, WorkflowStep } from "./types.js";

interface WorkflowDocument {
	description?: string;
	name: string;
	parameters?: Record<string, WorkflowParameterDefinition>;
	steps: Array<WorkflowStep>;
}

function buildParameterSchema(parameters: Record<string, WorkflowParameterDefinition>): TSchema {
	const properties: Record<string, TSchema> = {};
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
				} else {
					schema = Type.String();
				}
				break;
			}
		}

		if (definition.default !== undefined) {
			schema = Type.Optional(schema);
		}
		properties[name] = schema;
	}
	return Type.Object(properties);
}

function isObject(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === "object";
}

function parseWorkflowDocument(value: unknown, path: string): WorkflowDocument {
	if (!isObject(value)) {
		throw new Error(`Invalid workflow file ${path}: root must be an object`);
	}
	if (typeof value["name"] !== "string" || value["name"].trim() === "") {
		throw new Error(`Invalid workflow file ${path}: name is required`);
	}
	if (!Array.isArray(value["steps"])) {
		throw new Error(`Invalid workflow file ${path}: steps must be an array`);
	}

	const steps = value["steps"].map((step, index) => {
		if (!isObject(step) || typeof step["name"] !== "string" || typeof step["prompt"] !== "string") {
			throw new Error(
				`Invalid workflow file ${path}: step ${String(index)} must include name/prompt`,
			);
		}
		const condition = typeof step["condition"] === "string" ? step["condition"] : undefined;
		const onFailure =
			typeof step["on_failure"] === "string" &&
			["continue", "halt", "skip_remaining"].includes(step["on_failure"])
				? (step["on_failure"] as WorkflowStep["onFailure"])
				: undefined;
		return {
			...(condition === undefined ? {} : { condition }),
			name: step["name"],
			...(onFailure === undefined ? {} : { onFailure }),
			prompt: step["prompt"],
		};
	});

	const parameters: Record<string, WorkflowParameterDefinition> = {};
	if (isObject(value["parameters"])) {
		for (const [key, rawDefinition] of Object.entries(value["parameters"])) {
			if (!isObject(rawDefinition)) {
				throw new Error(`Invalid parameter definition ${key} in ${path}`);
			}
			const type = rawDefinition["type"];
			if (type !== "boolean" && type !== "number" && type !== "string") {
				throw new Error(`Invalid parameter type for ${key} in ${path}`);
			}
			parameters[key] = {
				type,
				...(typeof rawDefinition["description"] === "string"
					? { description: rawDefinition["description"] }
					: {}),
				...(Array.isArray(rawDefinition["enum"])
					? {
							enum: rawDefinition["enum"].filter(
								(entry): entry is string => typeof entry === "string",
							),
						}
					: {}),
				...(rawDefinition["default"] !== undefined
					? { default: rawDefinition["default"] as boolean | number | string }
					: {}),
			};
		}
	}

	return {
		...(typeof value["description"] === "string" ? { description: value["description"] } : {}),
		name: value["name"],
		parameters,
		steps,
	};
}

function validateTemplateReferences(definition: WorkflowDocument, sourcePath: string): void {
	const parameterNames = new Set(Object.keys(definition.parameters ?? {}));
	for (const step of definition.steps) {
		for (const variable of listTemplateVariables(step.prompt)) {
			const key = variable.replace("parameters.", "");
			if (!parameterNames.has(key)) {
				throw new Error(`Unknown template variable ${variable} in ${sourcePath}`);
			}
		}
	}
}

/**
 * Loads and validates workflow YAML files from a directory.
 */
export function loadWorkflows(directory: string): Array<WorkflowDefinition> {
	let filenames: Array<string> = [];
	try {
		filenames = readdirSync(directory).filter(
			(entry) => entry.endsWith(".yaml") || entry.endsWith(".yml"),
		);
	} catch (error: unknown) {
		if (error instanceof Error && "code" in error && error.code === "ENOENT") {
			return [];
		}
		throw error;
	}

	const workflows: Array<WorkflowDefinition> = [];
	for (const filename of filenames.sort((left, right) => left.localeCompare(right))) {
		const path = join(directory, filename);
		const parsed = parseYaml(readFileSync(path, "utf8")) as unknown;
		const document = parseWorkflowDocument(parsed, path);
		validateTemplateReferences(document, path);
		const parameterDefinitions = document.parameters ?? {};
		workflows.push({
			description: document.description ?? "",
			name: document.name,
			parameterDefinitions,
			parameterSchema: buildParameterSchema(parameterDefinitions),
			steps: document.steps,
		});
	}

	return workflows;
}
