import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createLogger } from "../src/logging/index.js";

const tempDirectories: Array<string> = [];

function createLogFilePath(): string {
	const directory = mkdtempSync(join(tmpdir(), "agent-logging-test-"));
	tempDirectories.push(directory);
	return join(directory, "logs", "agent.log");
}

function readLogLines(path: string): Array<string> {
	const content = readFileSync(path, "utf8").trim();
	if (content === "") {
		return [];
	}
	return content.split("\n");
}

afterEach(() => {
	for (const directory of tempDirectories.splice(0)) {
		rmSync(directory, { force: true, recursive: true });
	}
});

describe("createLogger", () => {
	it("S14.6: writes valid JSON log entries", () => {
		const logPath = createLogFilePath();
		const logger = createLogger("agent-loop", {
			file: logPath,
			level: "debug",
			stdout: false,
		});

		logger.info("turn_start", { sessionId: "abc123" });

		const lines = readLogLines(logPath);
		expect(lines).toHaveLength(1);
		const parsed = JSON.parse(lines[0] ?? "");
		expect(parsed).toMatchObject({
			event: "turn_start",
			level: "info",
			module: "agent-loop",
			sessionId: "abc123",
		});
		expect(typeof parsed.ts).toBe("string");
	});

	it("S14.7: filters entries below configured level", () => {
		const logPath = createLogFilePath();
		const logger = createLogger("agent-loop", {
			file: logPath,
			level: "info",
			stdout: false,
		});

		logger.debug("stream_delta", { chunk: "hello" });
		logger.info("turn_start", { sessionId: "abc123" });

		const lines = readLogLines(logPath);
		expect(lines).toHaveLength(1);
		const parsed = JSON.parse(lines[0] ?? "");
		expect(parsed.event).toBe("turn_start");
	});

	it("S11.7 + S14.10: redacts secret-like values by key before writing", () => {
		const logPath = createLogFilePath();
		const logger = createLogger("security", {
			file: logPath,
			level: "debug",
			stdout: false,
		});

		logger.info("credential_seen", {
			apiKey: "sk-live-123",
			authorization: "Bearer super-secret",
			nested: {
				service_token: "token-value",
			},
		});

		const lines = readLogLines(logPath);
		const parsed = JSON.parse(lines[0] ?? "");
		expect(parsed.apiKey).toBe("[REDACTED]");
		expect(parsed.authorization).toBe("[REDACTED]");
		expect(parsed.nested.service_token).toBe("[REDACTED]");
	});

	it("S11.8: redacts JWT-like output strings in debug logs", () => {
		const logPath = createLogFilePath();
		const logger = createLogger("agent-loop", {
			file: logPath,
			level: "debug",
			stdout: false,
		});

		logger.debug("tool_output", {
			output: "token=eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjMifQ.signature",
		});

		const lines = readLogLines(logPath);
		const parsed = JSON.parse(lines[0] ?? "");
		expect(parsed.output).toContain("[REDACTED]");
		expect(parsed.output).not.toContain("eyJhbGciOiJIUzI1NiJ9");
	});

	it("creates parent directories and can emit to stdout", () => {
		const writes: Array<string> = [];
		const logPath = createLogFilePath();
		const writeStdout = vi.fn((line: string) => {
			writes.push(line);
		});
		const logger = createLogger(
			"server",
			{
				file: logPath,
				level: "info",
				stdout: true,
			},
			{ writeStdout },
		);

		logger.info("server_start", { host: "127.0.0.1", port: 8080 });

		expect(writeStdout).toHaveBeenCalledTimes(1);
		expect(writes).toHaveLength(1);
		const fileLines = readLogLines(logPath);
		expect(fileLines).toHaveLength(1);
	});
});
