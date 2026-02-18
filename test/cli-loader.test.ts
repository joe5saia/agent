import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadCliTools } from "../src/tools/cli-loader.js";
import { executeTool, ToolRegistry } from "../src/tools/index.js";

const tempDirectories: Array<string> = [];

function createToolsFile(contents: string): string {
	const directory = mkdtempSync(join(tmpdir(), "agent-cli-tools-test-"));
	tempDirectories.push(directory);
	const path = join(directory, "tools.yaml");
	writeFileSync(path, contents, "utf8");
	return path;
}

afterEach(() => {
	for (const directory of tempDirectories.splice(0)) {
		rmSync(directory, { force: true, recursive: true });
	}
});

describe("loadCliTools", () => {
	it("S6.7: loads CLI tools and registers them", async () => {
		const path = createToolsFile(`
tools:
  - name: cli_echo
    description: Echo a resource name
    category: read
    cmd: node
    args:
      - -e
      - process.stdout.write(process.argv[1])
      - "{{resource}}"
    parameters:
      resource:
        type: string
        enum: [pods, services]
`);

		const tools = loadCliTools(path);
		expect(tools).toHaveLength(1);

		const registry = new ToolRegistry();
		for (const tool of tools) {
			registry.register(tool);
		}

		const result = await executeTool(registry, "cli_echo", { resource: "pods" });
		expect(result).toEqual({ content: "pods", isError: false });
	});

	it("S6.8: executes with shell=false so metacharacters stay literal", async () => {
		const path = createToolsFile(`
tools:
  - name: literal_args
    description: prints arg literally
    category: read
    cmd: node
    args:
      - -e
      - process.stdout.write(process.argv[1])
      - "{{value}}"
    parameters:
      value:
        type: string
`);

		const registry = new ToolRegistry();
		for (const tool of loadCliTools(path)) {
			registry.register(tool);
		}

		const value = "pods; rm -rf ~";
		const result = await executeTool(registry, "literal_args", { value });
		expect(result).toEqual({ content: value, isError: false });
	});

	it("S6.9: injection-style invalid values are rejected by parameter validation", async () => {
		const path = createToolsFile(`
tools:
  - name: kubectl_get
    description: get kubernetes resource
    category: read
    cmd: node
    args:
      - -e
      - process.stdout.write(process.argv[1])
      - "{{resource}}"
    parameters:
      resource:
        type: string
        enum: [pods, services]
`);

		const registry = new ToolRegistry();
		for (const tool of loadCliTools(path)) {
			registry.register(tool);
		}

		const result = await executeTool(registry, "kubectl_get", { resource: "pods; rm -rf ~" });
		expect(result.isError).toBe(true);
		expect(result.content).toMatch(/invalid arguments/i);
	});

	it("S6.13: optional args and tool env variables are passed", async () => {
		process.env["CLI_LOADER_TEST_TOKEN"] = "token-123";
		const path = createToolsFile(`
tools:
  - name: env_and_optional
    description: prints env and namespace
    category: read
    cmd: node
    args:
      - -e
      - process.stdout.write((process.env.DEPLOY_TOKEN || "") + ":" + process.argv[1])
      - "{{resource}}"
    optional_args:
      namespace:
        - "-n"
        - "{{namespace}}"
    env:
      DEPLOY_TOKEN: "\${CLI_LOADER_TEST_TOKEN}"
    parameters:
      resource:
        type: string
        enum: [pods]
      namespace:
        type: string
        pattern: "^[a-z0-9-]+$"
        optional: true
`);

		const registry = new ToolRegistry();
		for (const tool of loadCliTools(path)) {
			registry.register(tool);
		}

		const result = await executeTool(registry, "env_and_optional", {
			namespace: "default",
			resource: "pods",
		});
		expect(result).toEqual({ content: "token-123:pods", isError: false });
	});

	it("uses configured allowed env for CLI tools", async () => {
		process.env["CLI_ALLOWED_ENV"] = "yes";
		process.env["CLI_BLOCKED_ENV"] = "no";

		const path = createToolsFile(
			[
				"tools:",
				"  - name: env_policy",
				"    description: verifies inherited env policy",
				"    category: read",
				"    cmd: node",
				"    args:",
				"      - -e",
				'      - process.stdout.write((process.env.CLI_ALLOWED_ENV || "") + ":" + (process.env.CLI_BLOCKED_ENV || ""))',
				"    parameters: {}",
			].join("\n"),
		);

		const registry = new ToolRegistry();
		for (const tool of loadCliTools(path, { allowedEnv: ["PATH", "CLI_ALLOWED_ENV"] })) {
			registry.register(tool);
		}

		const result = await executeTool(registry, "env_policy", {});
		expect(result).toEqual({ content: "yes:", isError: false });
	});
});
