import { Cron } from "croner";
import { agentLoop } from "../agent/index.js";
import type { AgentLoopConfig } from "../agent/index.js";
import type { Logger } from "../logging/index.js";
import { toSessionAppendInput, type SessionManager } from "../sessions/index.js";
import type { ToolRegistry } from "../tools/index.js";
import { ToolRegistry as RuntimeToolRegistry } from "../tools/index.js";
import { normalizeToolName } from "../tools/tool-names.js";
import type { CronJobConfig, CronJobStatus } from "./types.js";

interface CronJobRuntime {
	config: CronJobConfig;
	handle?: Cron;
	paused: boolean;
	status: CronJobStatus;
}

export interface CronServiceDependencies {
	apiKeyResolver?: AgentLoopConfig["apiKeyResolver"];
	defaultMaxIterations: number;
	logger: Logger;
	model: Parameters<typeof agentLoop>[3];
	runAgentLoop?: typeof agentLoop;
	sessionManager: SessionManager;
	systemPromptBuilder?: (session: Awaited<ReturnType<SessionManager["get"]>>) => string;
	toolRegistry: ToolRegistry;
}

function cronSessionName(jobId: string, now: Date = new Date()): string {
	const stamp = now.toISOString().replace("T", " ").slice(0, 16);
	return `[cron] ${jobId} - ${stamp}`;
}

function filterToolsForJob(baseRegistry: ToolRegistry, job: CronJobConfig): ToolRegistry {
	const filtered = new RuntimeToolRegistry();
	const allowedSet = job.policy?.allowedTools;
	const normalizedAllowed =
		allowedSet === undefined
			? undefined
			: new Set(allowedSet.map((entry) => normalizeToolName(entry)));

	for (const tool of baseRegistry.list()) {
		if (tool.category === "admin") {
			continue;
		}
		if (normalizedAllowed === undefined) {
			if (tool.category === "read") {
				filtered.register(tool);
			}
			continue;
		}
		const normalizedName = normalizeToolName(tool.name);
		if (normalizedAllowed.has(normalizedName) || normalizedAllowed.has(tool.name)) {
			filtered.register(tool);
		}
	}

	return filtered;
}

function toIsoDateIfValid(value: unknown): string | undefined {
	if (
		typeof value !== "object" ||
		value === null ||
		!("getTime" in value) ||
		!("toISOString" in value)
	) {
		return undefined;
	}
	const candidate = value as { getTime: () => number; toISOString: () => string };
	return Number.isNaN(candidate.getTime()) ? undefined : candidate.toISOString();
}

/**
 * Schedules and executes cron jobs with isolated sessions and restricted tools.
 */
export class CronService {
	readonly #deps: CronServiceDependencies;
	readonly #jobs = new Map<string, CronJobRuntime>();

	public constructor(deps: CronServiceDependencies) {
		this.#deps = deps;
	}

	/**
	 * Replaces the active cron set with the provided jobs.
	 */
	public start(jobs: Array<CronJobConfig>): void {
		this.#stopAll();
		for (const job of jobs) {
			const runtime: CronJobRuntime = {
				config: job,
				paused: false,
				status: {
					consecutiveFailures: 0,
					enabled: job.enabled,
					id: job.id,
					schedule: job.schedule,
				},
			};
			this.#jobs.set(job.id, runtime);
			if (job.enabled) {
				this.#schedule(runtime);
			}
		}
	}

	/**
	 * Returns current status snapshots for all known jobs.
	 */
	public getStatus(): Array<CronJobStatus> {
		return [...this.#jobs.values()]
			.map((runtime) => {
				const nextRun = runtime.handle?.nextRun();
				const resolvedNextRunAt = toIsoDateIfValid(nextRun) ?? runtime.status.nextRunAt;
				return {
					...runtime.status,
					...(resolvedNextRunAt === undefined ? {} : { nextRunAt: resolvedNextRunAt }),
				};
			})
			.sort((left, right) => left.id.localeCompare(right.id));
	}

	/**
	 * Pauses a scheduled job.
	 */
	public pause(id: string): boolean {
		const runtime = this.#jobs.get(id);
		if (runtime === undefined) {
			return false;
		}
		runtime.handle?.stop();
		delete runtime.handle;
		runtime.paused = true;
		runtime.status.enabled = false;
		delete runtime.status.nextRunAt;
		return true;
	}

	/**
	 * Resumes a paused job.
	 */
	public resume(id: string): boolean {
		const runtime = this.#jobs.get(id);
		if (runtime === undefined) {
			return false;
		}
		runtime.paused = false;
		runtime.status.enabled = runtime.config.enabled;
		if (runtime.config.enabled) {
			this.#schedule(runtime);
		}
		return true;
	}

	/**
	 * Stops all running cron handles.
	 */
	public stop(): void {
		this.#stopAll();
	}

	async #executeJob(runtime: CronJobRuntime): Promise<void> {
		const startedAt = Date.now();
		const startedIso = new Date(startedAt).toISOString();
		runtime.status.lastRunAt = startedIso;

		const session = await this.#deps.sessionManager.create({
			cronJobId: runtime.config.id,
			name: cronSessionName(runtime.config.id, new Date(startedAt)),
			source: "cron",
		});
		await this.#deps.sessionManager.appendMessage(session.id, {
			content: [{ text: runtime.config.prompt, type: "text" }],
			role: "user",
		});

		this.#deps.logger.info("cron_start", {
			jobId: runtime.config.id,
			schedule: runtime.config.schedule,
			sessionId: session.id,
		});

		const runAgentLoop = this.#deps.runAgentLoop ?? agentLoop;
		const maxIterations = runtime.config.policy?.maxIterations ?? this.#deps.defaultMaxIterations;
		const scopedTools = filterToolsForJob(this.#deps.toolRegistry, runtime.config);

		try {
			const contextMessages = await this.#deps.sessionManager.buildContextForRun(session.id);
			const systemPrompt =
				this.#deps.systemPromptBuilder === undefined
					? "You are running a scheduled cron job."
					: this.#deps.systemPromptBuilder(await this.#deps.sessionManager.get(session.id));
			const beforeLength = contextMessages.length;
			const finalMessages = await runAgentLoop(
				contextMessages,
				scopedTools,
				systemPrompt,
				this.#deps.model,
				{
					...(this.#deps.apiKeyResolver === undefined
						? {}
						: { apiKeyResolver: this.#deps.apiKeyResolver }),
					logger: this.#deps.logger,
					maxIterations,
					onTurnComplete: (event) => {
						void this.#deps.sessionManager.recordTurnMetrics(session.id, event).catch(() => {
							return;
						});
					},
					sessionId: session.id,
				},
			);

			for (const message of finalMessages.slice(beforeLength)) {
				const appendInput = toSessionAppendInput(message);
				if (appendInput !== undefined) {
					await this.#deps.sessionManager.appendMessage(session.id, appendInput);
				}
			}

			runtime.status.consecutiveFailures = 0;
			delete runtime.status.lastErrorSnippet;
			runtime.status.lastStatus = "success";
			this.#deps.logger.info("cron_end", {
				durationMs: Date.now() - startedAt,
				jobId: runtime.config.id,
				sessionId: session.id,
				status: "success",
			});
		} catch (error: unknown) {
			const message = error instanceof Error ? error.message : String(error);
			runtime.status.consecutiveFailures += 1;
			runtime.status.lastErrorSnippet = message.slice(0, 200);
			runtime.status.lastStatus = "error";
			this.#deps.logger.error("cron_error", {
				error: message,
				jobId: runtime.config.id,
				sessionId: session.id,
			});
			this.#deps.logger.info("cron_end", {
				durationMs: Date.now() - startedAt,
				jobId: runtime.config.id,
				sessionId: session.id,
				status: "error",
			});
		}
	}

	#schedule(runtime: CronJobRuntime): void {
		runtime.handle?.stop();
		runtime.handle = new Cron(
			runtime.config.schedule,
			{
				catch: (error: unknown) => {
					const message = error instanceof Error ? error.message : String(error);
					runtime.status.consecutiveFailures += 1;
					runtime.status.lastErrorSnippet = message.slice(0, 200);
					runtime.status.lastStatus = "error";
					this.#deps.logger.error("cron_error", {
						error: message,
						jobId: runtime.config.id,
					});
				},
				name: runtime.config.id,
				protect: true,
				...(runtime.config.timezone === undefined ? {} : { timezone: runtime.config.timezone }),
			},
			async () => {
				await this.#executeJob(runtime);
			},
		);

		const nextRun = runtime.handle.nextRun();
		const nextRunAt = toIsoDateIfValid(nextRun);
		if (nextRunAt !== undefined) {
			runtime.status.nextRunAt = nextRunAt;
		} else {
			delete runtime.status.nextRunAt;
		}
	}

	#stopAll(): void {
		for (const runtime of this.#jobs.values()) {
			runtime.handle?.stop();
			delete runtime.handle;
		}
		this.#jobs.clear();
	}
}

export type { CronJobConfig, CronJobStatus } from "./types.js";
