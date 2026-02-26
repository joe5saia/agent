import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { Type } from "@sinclair/typebox";
import { stringify as stringifyYaml } from "yaml";
import { parseCronJobsDocument, parseCronJobsYaml } from "../../cron/loader.js";
import type { CronJobConfig } from "../../cron/types.js";
import type { AgentTool } from "../types.js";

const defaultCronJobsPath = "~/.agent/cron/jobs.yaml";

type CronAction = "list" | "get" | "upsert" | "delete" | "enable" | "disable" | "validate";

interface CronJobRecord {
	enabled: boolean;
	id: string;
	policy?: {
		allowed_tools?: Array<string>;
		max_iterations?: number;
	};
	prompt: string;
	schedule: string;
	timezone?: string;
}

/**
 * Configuration for the cron management built-in tool.
 */
export interface CronToolOptions {
	jobsPath?: string;
	outputLimitBytes: number;
	timeoutSeconds: number;
}

function expandHomePath(path: string): string {
	if (path === "~") {
		return homedir();
	}
	if (path.startsWith("~/")) {
		return join(homedir(), path.slice(2));
	}
	return path;
}

function isObject(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function toSerializableJob(job: CronJobConfig): CronJobRecord {
	return {
		enabled: job.enabled,
		id: job.id,
		...(job.policy === undefined
			? {}
			: {
					policy: {
						...(job.policy.allowedTools === undefined
							? {}
							: { allowed_tools: job.policy.allowedTools }),
						...(job.policy.maxIterations === undefined
							? {}
							: { max_iterations: job.policy.maxIterations }),
					},
				}),
		prompt: job.prompt,
		schedule: job.schedule,
		...(job.timezone === undefined ? {} : { timezone: job.timezone }),
	};
}

async function loadJobs(path: string): Promise<Array<CronJobConfig>> {
	try {
		const raw = await readFile(path, "utf8");
		return parseCronJobsYaml(raw, path);
	} catch (error: unknown) {
		if (error instanceof Error && "code" in error && error.code === "ENOENT") {
			return [];
		}
		throw error;
	}
}

async function writeJobs(path: string, jobs: Array<CronJobConfig>): Promise<void> {
	const document = {
		jobs: jobs.map((job) => toSerializableJob(job)),
	};
	parseCronJobsDocument(document, path);

	const yaml = stringifyYaml(document, { lineWidth: 0 });
	await mkdir(dirname(path), { recursive: true });
	const tmpPath = `${path}.${randomUUID()}.tmp`;
	await writeFile(tmpPath, yaml, "utf8");
	await rename(tmpPath, path);
}

function summarizeJob(job: CronJobConfig): Record<string, unknown> {
	return {
		enabled: job.enabled,
		id: job.id,
		...(job.policy === undefined
			? {}
			: {
					policy: {
						...(job.policy.allowedTools === undefined
							? {}
							: { allowedTools: job.policy.allowedTools }),
						...(job.policy.maxIterations === undefined
							? {}
							: { maxIterations: job.policy.maxIterations }),
					},
				}),
		prompt: job.prompt,
		schedule: job.schedule,
		...(job.timezone === undefined ? {} : { timezone: job.timezone }),
	};
}

function stringifyPayload(payload: Record<string, unknown>): string {
	return JSON.stringify(payload, null, 2);
}

/**
 * Creates the cron management built-in tool.
 */
export function createCronTool(options: CronToolOptions): AgentTool {
	const cronJobsPath = expandHomePath(options.jobsPath ?? defaultCronJobsPath);

	return {
		category: "admin",
		description:
			"Safely manage cron jobs with structured operations and strict validation before writes.",
		async execute(args: Record<string, unknown>): Promise<string> {
			const action = args["action"];
			if (typeof action !== "string") {
				throw new Error("Invalid cron action.");
			}

			const jobs = await loadJobs(cronJobsPath);
			switch (action) {
				case "list":
					return stringifyPayload({
						jobCount: jobs.length,
						jobs: jobs.map((job) => summarizeJob(job)),
					});
				case "get": {
					const id = args["id"];
					if (typeof id !== "string" || id.trim() === "") {
						throw new Error("Cron get requires a non-empty id.");
					}
					const job = jobs.find((entry) => entry.id === id);
					if (job === undefined) {
						throw new Error(`Cron job not found: ${id}`);
					}
					return stringifyPayload({ job: summarizeJob(job) });
				}
				case "validate":
					return stringifyPayload({
						jobCount: jobs.length,
						jobs: jobs.map((job) => job.id),
						ok: true,
						path: cronJobsPath,
					});
				case "delete": {
					const id = args["id"];
					if (typeof id !== "string" || id.trim() === "") {
						throw new Error("Cron delete requires a non-empty id.");
					}
					const nextJobs = jobs.filter((entry) => entry.id !== id);
					if (nextJobs.length === jobs.length) {
						throw new Error(`Cron job not found: ${id}`);
					}
					await writeJobs(cronJobsPath, nextJobs);
					return stringifyPayload({
						deletedId: id,
						jobCount: nextJobs.length,
						ok: true,
						path: cronJobsPath,
					});
				}
				case "enable":
				case "disable": {
					const id = args["id"];
					if (typeof id !== "string" || id.trim() === "") {
						throw new Error(`Cron ${action} requires a non-empty id.`);
					}
					const enabled = action === "enable";
					const index = jobs.findIndex((entry) => entry.id === id);
					if (index === -1) {
						throw new Error(`Cron job not found: ${id}`);
					}
					const job = jobs[index];
					if (job === undefined) {
						throw new Error(`Cron job not found: ${id}`);
					}
					const nextJobs = [...jobs];
					nextJobs[index] = { ...job, enabled };
					await writeJobs(cronJobsPath, nextJobs);
					return stringifyPayload({
						enabled,
						id,
						ok: true,
						path: cronJobsPath,
					});
				}
				case "upsert": {
					const rawJob = args["job"];
					if (!isObject(rawJob)) {
						throw new Error("Cron upsert requires a job object.");
					}
					const candidateDocument = {
						jobs: [rawJob],
					};
					const [validatedJob] = parseCronJobsDocument(candidateDocument, cronJobsPath);
					if (validatedJob === undefined) {
						throw new Error("Cron upsert failed validation.");
					}

					const index = jobs.findIndex((entry) => entry.id === validatedJob.id);
					const nextJobs = [...jobs];
					if (index === -1) {
						nextJobs.push(validatedJob);
					} else {
						nextJobs[index] = validatedJob;
					}
					await writeJobs(cronJobsPath, nextJobs);
					return stringifyPayload({
						id: validatedJob.id,
						jobCount: nextJobs.length,
						ok: true,
						path: cronJobsPath,
						replaced: index !== -1,
					});
				}
				default:
					throw new Error(`Unsupported cron action: ${action}`);
			}
		},
		name: "cron",
		outputLimitBytes: options.outputLimitBytes,
		parameters: Type.Union([
			Type.Object(
				{
					action: Type.Literal("list"),
				},
				{ additionalProperties: false },
			),
			Type.Object(
				{
					action: Type.Literal("get"),
					id: Type.String({ minLength: 1 }),
				},
				{ additionalProperties: false },
			),
			Type.Object(
				{
					action: Type.Literal("validate"),
				},
				{ additionalProperties: false },
			),
			Type.Object(
				{
					action: Type.Literal("delete"),
					id: Type.String({ minLength: 1 }),
				},
				{ additionalProperties: false },
			),
			Type.Object(
				{
					action: Type.Literal("enable"),
					id: Type.String({ minLength: 1 }),
				},
				{ additionalProperties: false },
			),
			Type.Object(
				{
					action: Type.Literal("disable"),
					id: Type.String({ minLength: 1 }),
				},
				{ additionalProperties: false },
			),
			Type.Object(
				{
					action: Type.Literal("upsert"),
					job: Type.Object(
						{
							enabled: Type.Boolean(),
							id: Type.String({ minLength: 1 }),
							policy: Type.Optional(
								Type.Object(
									{
										allowedTools: Type.Optional(Type.Array(Type.String())),
										maxIterations: Type.Optional(Type.Number({ minimum: 1 })),
									},
									{ additionalProperties: false },
								),
							),
							prompt: Type.String({ minLength: 1 }),
							schedule: Type.String({ minLength: 1 }),
							timezone: Type.Optional(Type.String({ minLength: 1 })),
						},
						{ additionalProperties: false },
					),
				},
				{ additionalProperties: false },
			),
		]),
		timeoutSeconds: options.timeoutSeconds,
	};
}
