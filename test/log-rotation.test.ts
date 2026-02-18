import { existsSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createLogger, rotateIfNeeded } from "../src/logging/index.js";

const tempDirectories: Array<string> = [];

function createTempDirectory(): string {
	const directory = mkdtempSync(join(tmpdir(), "agent-log-rotation-test-"));
	tempDirectories.push(directory);
	return directory;
}

afterEach(() => {
	for (const directory of tempDirectories.splice(0)) {
		rmSync(directory, { force: true, recursive: true });
	}
});

describe("log rotation", () => {
	it("S14.9: rotates by date and size", () => {
		const directory = createTempDirectory();
		const logPath = join(directory, "agent.log");

		writeFileSync(logPath, "old", "utf8");
		utimesSync(logPath, new Date("2026-02-17T00:00:00.000Z"), new Date("2026-02-17T00:00:00.000Z"));
		rotateIfNeeded(logPath, { maxDays: 30, maxSizeMb: 100 }, new Date("2026-02-18T00:00:00.000Z"));
		expect(existsSync(join(directory, "agent.2026-02-18.log"))).toBe(true);

		writeFileSync(logPath, "x".repeat(1024 * 1024 + 10), "utf8");
		rotateIfNeeded(logPath, { maxDays: 30, maxSizeMb: 1 }, new Date("2026-02-18T12:00:00.000Z"));
		expect(existsSync(join(directory, "agent.2026-02-18.log"))).toBe(true);
	});

	it("deletes archives older than retention window", () => {
		const directory = createTempDirectory();
		const logPath = join(directory, "agent.log");
		writeFileSync(logPath, "current", "utf8");
		writeFileSync(join(directory, "agent.2026-01-01.log"), "old", "utf8");
		writeFileSync(join(directory, "agent.2026-02-15.log"), "recent", "utf8");

		rotateIfNeeded(logPath, { maxDays: 10, maxSizeMb: 100 }, new Date("2026-02-18T00:00:00.000Z"));

		expect(existsSync(join(directory, "agent.2026-01-01.log"))).toBe(false);
		expect(existsSync(join(directory, "agent.2026-02-15.log"))).toBe(true);
	});

	it("logger invokes rotation before writes", () => {
		const directory = createTempDirectory();
		const logPath = join(directory, "agent.log");
		const logger = createLogger(
			"test",
			{
				file: logPath,
				level: "info",
				rotation: { maxDays: 30, maxSizeMb: 1 },
				stdout: false,
			},
			{
				now: () => new Date("2026-02-18T00:00:00.000Z"),
				writeStdout: () => {},
			},
		);
		logger.info("event", { a: 1 });
		expect(readFileSync(logPath, "utf8")).toContain('"event":"event"');
	});
});
