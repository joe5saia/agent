import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { buildToolEnv, isBlockedCommand, validatePath } from "../src/security/index.js";

const tempDirectories: Array<string> = [];

function createTempDirectory(prefix: string): string {
	const directory = mkdtempSync(join(tmpdir(), prefix));
	tempDirectories.push(directory);
	return directory;
}

afterEach(() => {
	for (const directory of tempDirectories.splice(0)) {
		rmSync(directory, { force: true, recursive: true });
	}
});

describe("isBlockedCommand", () => {
	it("S11.2: blocks dangerous commands", () => {
		expect(isBlockedCommand("rm -rf /")).toMatchObject({ blocked: true });
		expect(isBlockedCommand("sudo reboot")).toMatchObject({ blocked: true });
		expect(isBlockedCommand("dd if=/dev/zero of=/dev/disk1")).toMatchObject({ blocked: true });
		expect(isBlockedCommand("chmod 777 /tmp/file")).toMatchObject({ blocked: true });
		expect(isBlockedCommand("git push --force origin main")).toMatchObject({ blocked: true });
		expect(isBlockedCommand("git push origin main --force")).toMatchObject({ blocked: true });
		expect(isBlockedCommand("git push origin master -f")).toMatchObject({ blocked: true });
	});

	it("S11.10: catches rm -rf /* variants", () => {
		const result = isBlockedCommand("rm -rf /*");
		expect(result.blocked).toBe(true);
		expect(result.reason).toMatch(/recursive delete/i);
	});

	it("allows non-blocked commands", () => {
		expect(isBlockedCommand("ls -la")).toEqual({ blocked: false });
		expect(isBlockedCommand("git push origin feature/test")).toEqual({ blocked: false });
	});
});

describe("buildToolEnv", () => {
	it("S11.3 + S6.6: includes only allowlisted process env keys", () => {
		process.env["AGENT_TEST_ALLOWED"] = "allowed-value";
		process.env["AGENT_TEST_SECRET"] = "super-secret";

		const env = buildToolEnv(["AGENT_TEST_ALLOWED"]);

		expect(env).toEqual({ AGENT_TEST_ALLOWED: "allowed-value" });
		expect(env["AGENT_TEST_SECRET"]).toBeUndefined();
	});

	it("S11.5: secret keys are not inherited unless explicitly allowlisted", () => {
		process.env["OPENAI_API_KEY"] = "secret-key";

		const env = buildToolEnv(["PATH", "HOME"]);

		expect(env["OPENAI_API_KEY"]).toBeUndefined();
	});

	it("merges tool-specific env values", () => {
		const env = buildToolEnv([], { CUSTOM_TOOL_FLAG: "on" });
		expect(env).toEqual({ CUSTOM_TOOL_FLAG: "on" });
	});
});

describe("validatePath", () => {
	it("S6.10 + S11.9: rejects paths outside allowed_paths", () => {
		const root = createTempDirectory("agent-security-");
		const allowedPath = join(root, "allowed");
		const outsidePath = join(root, "outside");
		mkdirSync(allowedPath, { recursive: true });
		mkdirSync(outsidePath, { recursive: true });

		const result = validatePath(join(outsidePath, "file.txt"), [allowedPath], []);

		expect(result.allowed).toBe(false);
		expect(result.reason).toMatch(/outside allowed paths/i);
	});

	it("S6.11: denied paths take precedence over allowed paths", () => {
		const root = createTempDirectory("agent-security-");
		const allowedPath = join(root, "workspace");
		const deniedPath = join(allowedPath, "secrets");
		mkdirSync(deniedPath, { recursive: true });

		const result = validatePath(join(deniedPath, "key.txt"), [allowedPath], [deniedPath]);

		expect(result.allowed).toBe(false);
		expect(result.reason).toMatch(/denied/i);
	});

	it("S6.12: rejects symlink escapes outside allowed paths", () => {
		const root = createTempDirectory("agent-security-");
		const allowedPath = join(root, "allowed");
		const outsidePath = join(root, "outside");
		mkdirSync(allowedPath, { recursive: true });
		mkdirSync(outsidePath, { recursive: true });
		writeFileSync(join(outsidePath, "secret.txt"), "secret", "utf8");

		const symlinkPath = join(allowedPath, "linked-secret.txt");
		symlinkSync(join(outsidePath, "secret.txt"), symlinkPath);

		const result = validatePath(symlinkPath, [allowedPath], []);

		expect(result.allowed).toBe(false);
		expect(result.reason).toMatch(/outside allowed paths/i);
	});

	it("allows valid paths within allowed boundaries", () => {
		const root = createTempDirectory("agent-security-");
		const allowedPath = join(root, "allowed");
		mkdirSync(allowedPath, { recursive: true });
		const targetPath = join(allowedPath, "nested", "file.txt");
		mkdirSync(join(allowedPath, "nested"), { recursive: true });

		const result = validatePath(targetPath, [allowedPath], []);

		expect(result.allowed).toBe(true);
		expect(result.resolvedPath).toContain("nested");
	});
});
