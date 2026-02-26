import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadCronJobs } from "../src/cron/loader.js";
import { createCronTool } from "../src/tools/builtin/cron.js";
import { executeTool, ToolRegistry } from "../src/tools/index.js";

const tempDirs: Array<string> = [];

function createTempDir(): string {
	const directory = mkdtempSync(join(tmpdir(), "agent-tools-cron-"));
	tempDirs.push(directory);
	return directory;
}

function createCronRegistry(jobsPath: string): ToolRegistry {
	const registry = new ToolRegistry();
	registry.register(
		createCronTool({
			jobsPath,
			outputLimitBytes: 100_000,
			timeoutSeconds: 5,
		}),
	);
	return registry;
}

afterEach(() => {
	for (const directory of tempDirs.splice(0)) {
		rmSync(directory, { force: true, recursive: true });
	}
});

describe("cron tool", () => {
	it("upserts, lists, and reads jobs with validated persistence", async () => {
		const directory = createTempDir();
		const jobsPath = join(directory, "cron", "jobs.yaml");
		const registry = createCronRegistry(jobsPath);

		const upsertResult = await executeTool(registry, "cron", {
			action: "upsert",
			job: {
				enabled: true,
				id: "daily-report",
				prompt: "Generate report",
				schedule: "0 9 * * 1-5",
				timezone: "America/New_York",
			},
		});
		expect(upsertResult.isError).toBe(false);

		const listResult = await executeTool(registry, "cron", { action: "list" });
		expect(listResult.isError).toBe(false);
		const payload = JSON.parse(listResult.content) as {
			jobCount: number;
			jobs: Array<{ id: string }>;
		};
		expect(payload.jobCount).toBe(1);
		expect(payload.jobs[0]?.id).toBe("daily-report");

		const persisted = loadCronJobs(jobsPath);
		expect(persisted).toHaveLength(1);
		expect(persisted[0]?.id).toBe("daily-report");
	});

	it("rejects invalid schedules and keeps the previous file contents", async () => {
		const directory = createTempDir();
		const jobsPath = join(directory, "cron", "jobs.yaml");
		const registry = createCronRegistry(jobsPath);

		await executeTool(registry, "cron", {
			action: "upsert",
			job: {
				enabled: true,
				id: "valid-job",
				prompt: "Run safe task",
				schedule: "*/15 * * * *",
			},
		});
		const before = readFileSync(jobsPath, "utf8");

		const invalidResult = await executeTool(registry, "cron", {
			action: "upsert",
			job: {
				enabled: true,
				id: "invalid-job",
				prompt: "Run bad task",
				schedule: "not-a-cron-expression",
			},
		});
		expect(invalidResult.isError).toBe(true);
		expect(invalidResult.content).toMatch(/invalid/i);

		const after = readFileSync(jobsPath, "utf8");
		expect(after).toBe(before);
	});

	it("supports enable, disable, and delete operations", async () => {
		const directory = createTempDir();
		const jobsPath = join(directory, "cron", "jobs.yaml");
		const registry = createCronRegistry(jobsPath);

		await executeTool(registry, "cron", {
			action: "upsert",
			job: {
				enabled: true,
				id: "toggle-job",
				prompt: "Toggle me",
				schedule: "0 * * * *",
			},
		});

		const disableResult = await executeTool(registry, "cron", {
			action: "disable",
			id: "toggle-job",
		});
		expect(disableResult.isError).toBe(false);
		expect(loadCronJobs(jobsPath)[0]?.enabled).toBe(false);

		const enableResult = await executeTool(registry, "cron", {
			action: "enable",
			id: "toggle-job",
		});
		expect(enableResult.isError).toBe(false);
		expect(loadCronJobs(jobsPath)[0]?.enabled).toBe(true);

		const deleteResult = await executeTool(registry, "cron", {
			action: "delete",
			id: "toggle-job",
		});
		expect(deleteResult.isError).toBe(false);
		expect(loadCronJobs(jobsPath)).toHaveLength(0);
	});
});
