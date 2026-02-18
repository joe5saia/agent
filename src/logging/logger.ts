import { appendFileSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import type { AgentConfig } from "../config/index.js";
import { redactValue, type RedactableValue } from "./redaction.js";

/**
 * Supported log levels in ascending verbosity order.
 */
export type LogLevel = "debug" | "error" | "info" | "warn";

/**
 * JSON value type for structured log fields.
 */
export type JsonValue = RedactableValue;

/**
 * Structured logger methods.
 */
export interface Logger {
	debug(event: string, fields?: Record<string, JsonValue>): void;
	error(event: string, fields?: Record<string, JsonValue>): void;
	info(event: string, fields?: Record<string, JsonValue>): void;
	warn(event: string, fields?: Record<string, JsonValue>): void;
}

/**
 * Runtime logger configuration.
 */
export interface LoggerConfig {
	file: string;
	level: AgentConfig["logging"]["level"];
	stdout: boolean;
}

interface LoggerDependencies {
	now: () => Date;
	writeStdout: (line: string) => void;
}

const logLevelPriority: Record<LogLevel, number> = {
	debug: 10,
	error: 40,
	info: 20,
	warn: 30,
};

/**
 * Expands a leading tilde path segment to the current user's home directory.
 */
function expandHomePath(path: string): string {
	if (path === "~") {
		return homedir();
	}
	if (path.startsWith("~/")) {
		return join(homedir(), path.slice(2));
	}
	return path;
}

/**
 * Creates a structured JSON-lines logger with redaction and level filtering.
 */
export function createLogger(
	moduleName: string,
	config: LoggerConfig,
	dependencies?: Partial<LoggerDependencies>,
): Logger {
	const filePath = expandHomePath(config.file);
	mkdirSync(dirname(filePath), { recursive: true });

	const selectedLevel = config.level;
	const now = dependencies?.now ?? (() => new Date());
	const writeStdout =
		dependencies?.writeStdout ?? ((line: string) => process.stdout.write(`${line}\n`));

	const write = (level: LogLevel, event: string, fields?: Record<string, JsonValue>): void => {
		if (logLevelPriority[level] < logLevelPriority[selectedLevel]) {
			return;
		}

		const payload = redactValue({
			...(fields ?? {}),
			event,
			level,
			module: moduleName,
			ts: now().toISOString(),
		}) as Record<string, JsonValue>;
		const line = JSON.stringify(payload);

		if (config.stdout) {
			writeStdout(line);
		}
		appendFileSync(filePath, `${line}\n`, "utf8");
	};

	return {
		debug(event: string, fields?: Record<string, JsonValue>): void {
			write("debug", event, fields);
		},
		error(event: string, fields?: Record<string, JsonValue>): void {
			write("error", event, fields);
		},
		info(event: string, fields?: Record<string, JsonValue>): void {
			write("info", event, fields);
		},
		warn(event: string, fields?: Record<string, JsonValue>): void {
			write("warn", event, fields);
		},
	};
}
