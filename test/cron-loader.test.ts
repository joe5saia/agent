import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadCronJobs } from "../src/cron/loader.js";

const tempDirs: Array<string> = [];

function createTempDir(): string {
	const directory = mkdtempSync(join(tmpdir(), "agent-cron-loader-"));
	tempDirs.push(directory);
	return directory;
}

afterEach(() => {
	for (const directory of tempDirs.splice(0)) {
		rmSync(directory, { force: true, recursive: true });
	}
});

describe("cron loader", () => {
	it("rejects duplicate job IDs", () => {
		const directory = createTempDir();
		const jobsPath = join(directory, "jobs.yaml");
		writeFileSync(
			jobsPath,
			[
				"jobs:",
				"  - id: duplicate",
				'    schedule: "0 9 * * 1-5"',
				'    prompt: "first"',
				"    enabled: true",
				"  - id: duplicate",
				'    schedule: "0 10 * * 1-5"',
				'    prompt: "second"',
				"    enabled: true",
				"",
			].join("\n"),
			"utf8",
		);

		expect(() => loadCronJobs(jobsPath)).toThrowError(/duplicate job id/i);
	});

	it("rejects invalid cron schedules before runtime scheduling", () => {
		const directory = createTempDir();
		const jobsPath = join(directory, "jobs.yaml");
		writeFileSync(
			jobsPath,
			[
				"jobs:",
				"  - id: invalid",
				'    schedule: "not-a-cron"',
				'    prompt: "bad"',
				"    enabled: true",
				"",
			].join("\n"),
			"utf8",
		);

		expect(() => loadCronJobs(jobsPath)).toThrowError(/schedule\/timezone is invalid/i);
	});
});
