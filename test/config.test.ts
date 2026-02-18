import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ConfigNotFoundError, ConfigValidationError, loadConfig } from "../src/config/index.js";

const tempDirectories: Array<string> = [];

function createTempFile(contents: string): string {
	const directory = mkdtempSync(join(tmpdir(), "agent-config-test-"));
	tempDirectories.push(directory);
	const path = join(directory, "config.yaml");
	writeFileSync(path, contents, "utf8");
	return path;
}

afterEach(() => {
	for (const directory of tempDirectories.splice(0)) {
		rmSync(directory, { force: true, recursive: true });
	}
});

describe("loadConfig", () => {
	it("S17.1: loads a valid config file", () => {
		const path = createTempFile(`
model:
  provider: openai
  name: gpt-4o-mini
security:
  blocked_commands:
    - "rm -rf /"
`);

		const config = loadConfig(path);

		expect(config.model.provider).toBe("openai");
		expect(config.model.name).toBe("gpt-4o-mini");
		expect(config.security.blockedCommands).toEqual(["rm -rf /"]);
	});

	it("S17.2: fills missing optional fields with defaults", () => {
		const path = createTempFile(`
model:
  provider: anthropic
  name: claude-sonnet-4-5
security:
  blocked_commands: []
`);

		const config = loadConfig(path);

		expect(config.server.host).toBe("127.0.0.1");
		expect(config.server.port).toBe(8080);
		expect(config.tools.outputLimit).toBe(200_000);
		expect(config.tools.timeout).toBe(120);
		expect(config.tools.maxIterations).toBe(20);
		expect(config.logging.level).toBe("info");
		expect(config.retry.maxRetries).toBe(3);
	});

	it("S17.3: reports invalid values with a clear field path", () => {
		const path = createTempFile(`
model:
  provider: openai
  name: gpt-4o-mini
server:
  port: 99999
security:
  blocked_commands: []
`);

		expect(() => loadConfig(path)).toThrowError(ConfigValidationError);
		expect(() => loadConfig(path)).toThrowError(/server.port/);
	});

	it("S17.4: reports missing required fields", () => {
		const path = createTempFile(`
model:
  name: gpt-4o-mini
security:
  blocked_commands: []
`);

		expect(() => loadConfig(path)).toThrowError(ConfigValidationError);
		expect(() => loadConfig(path)).toThrowError(/model.provider/);
	});

	it("S17.5: ignores extra YAML fields", () => {
		const path = createTempFile(`
model:
  provider: openai
  name: gpt-4o-mini
security:
  blocked_commands: []
unknown_field: true
tools:
  output_limit: 250000
  extra_nested: hello
`);

		const config = loadConfig(path);

		expect(config.tools.outputLimit).toBe(250_000);
		expect("unknown_field" in (config as unknown as Record<string, unknown>)).toBe(false);
	});

	it("S17.6: surfaces YAML parse errors", () => {
		const path = createTempFile(`
model:
  provider: openai
  name: gpt-4o-mini
security:
  blocked_commands:
    - "rm -rf /"
  invalid: [
`);

		expect(() => loadConfig(path)).toThrowError(ConfigValidationError);
		expect(() => loadConfig(path)).toThrowError(/Invalid YAML/i);
	});

	it("S17.7: throws ConfigNotFoundError when the config file is missing", () => {
		const directory = mkdtempSync(join(tmpdir(), "agent-config-test-"));
		tempDirectories.push(directory);
		const missingPath = join(directory, "missing.yaml");

		expect(() => loadConfig(missingPath)).toThrowError(ConfigNotFoundError);
		expect(() => loadConfig(missingPath)).toThrowError(/model:/);
		expect(() => loadConfig(missingPath)).toThrowError(/provider/);
		expect(() => loadConfig(missingPath)).toThrowError(/name/);
	});

	it("maps snake_case YAML keys to camelCase properties", () => {
		const path = createTempFile(`
model:
  provider: openai
  name: gpt-4o-mini
security:
  blocked_commands: []
system_prompt:
  identity_file: ~/.agent/identity.md
logging:
  rotation:
    max_days: 14
`);

		const config = loadConfig(path);

		expect(config.systemPrompt.identityFile).toBe("~/.agent/identity.md");
		expect(config.logging.rotation.maxDays).toBe(14);
	});
});
