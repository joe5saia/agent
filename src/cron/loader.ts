import { readFileSync } from "node:fs";
import { parse as parseYaml } from "yaml";
import type { CronJobConfig } from "./types.js";

interface CronJobsDocument {
	jobs: Array<CronJobConfig>;
}

function isObject(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}

function parseJob(input: unknown, path: string, index: number): CronJobConfig {
	if (!isObject(input)) {
		throw new Error(`Invalid cron job at ${path}[${String(index)}]: expected an object`);
	}
	if (typeof input["id"] !== "string" || input["id"].trim() === "") {
		throw new Error(`Invalid cron job at ${path}[${String(index)}]: id is required`);
	}
	if (typeof input["schedule"] !== "string" || input["schedule"].trim() === "") {
		throw new Error(`Invalid cron job at ${path}[${String(index)}]: schedule is required`);
	}
	if (typeof input["prompt"] !== "string" || input["prompt"].trim() === "") {
		throw new Error(`Invalid cron job at ${path}[${String(index)}]: prompt is required`);
	}
	if (typeof input["enabled"] !== "boolean") {
		throw new Error(`Invalid cron job at ${path}[${String(index)}]: enabled must be boolean`);
	}

	const rawPolicy = input["policy"];
	const policy =
		isObject(rawPolicy) &&
		(Array.isArray(rawPolicy["allowed_tools"]) ||
			Array.isArray(rawPolicy["allowedTools"]) ||
			typeof rawPolicy["max_iterations"] === "number" ||
			typeof rawPolicy["maxIterations"] === "number")
			? {
					...(Array.isArray(rawPolicy["allowed_tools"])
						? {
								allowedTools: rawPolicy["allowed_tools"].filter(
									(entry): entry is string => typeof entry === "string",
								),
							}
						: Array.isArray(rawPolicy["allowedTools"])
							? {
									allowedTools: rawPolicy["allowedTools"].filter(
										(entry): entry is string => typeof entry === "string",
									),
								}
							: {}),
					...(typeof rawPolicy["max_iterations"] === "number"
						? { maxIterations: rawPolicy["max_iterations"] }
						: typeof rawPolicy["maxIterations"] === "number"
							? { maxIterations: rawPolicy["maxIterations"] }
							: {}),
				}
			: undefined;

	return {
		...(policy === undefined ? {} : { policy }),
		enabled: input["enabled"],
		id: input["id"],
		prompt: input["prompt"],
		schedule: input["schedule"],
		...(typeof input["timezone"] === "string" ? { timezone: input["timezone"] } : {}),
	};
}

/**
 * Loads cron jobs from YAML and validates required fields.
 */
export function loadCronJobs(path: string): Array<CronJobConfig> {
	let raw = "";
	try {
		raw = readFileSync(path, "utf8");
	} catch (error: unknown) {
		if (error instanceof Error && "code" in error && error.code === "ENOENT") {
			return [];
		}
		throw error;
	}

	const parsed = parseYaml(raw) as unknown;
	if (!isObject(parsed) || !Array.isArray(parsed["jobs"])) {
		throw new Error(`Invalid cron jobs file ${path}: root must contain a jobs array`);
	}

	const document: CronJobsDocument = {
		jobs: parsed["jobs"].map((job, index) => parseJob(job, path, index)),
	};
	return document.jobs;
}
