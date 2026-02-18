import { spawn } from "node:child_process";
import { Type } from "@sinclair/typebox";
import { buildToolEnv, isBlockedCommand } from "../../security/index.js";
import type { AgentTool } from "../types.js";

/**
 * Configuration for the bash built-in tool.
 */
export interface BashToolOptions {
	allowedEnv: Array<string>;
	blockedCommands?: Array<string>;
	outputLimitBytes: number;
	timeoutSeconds: number;
}

/**
 * Creates the bash built-in tool.
 */
export function createBashTool(options: BashToolOptions): AgentTool {
	return {
		category: "write",
		description: "Execute a shell command in a controlled environment.",
		async execute(args: Record<string, unknown>, signal?: AbortSignal): Promise<string> {
			const command = typeof args["command"] === "string" ? args["command"] : "";
			const blockResult = isBlockedCommand(command, options.blockedCommands ?? []);
			if (blockResult.blocked) {
				throw new Error(blockResult.reason ?? "Command blocked by security policy.");
			}

			return await new Promise<string>((resolve, reject) => {
				const child = spawn(command, {
					env: buildToolEnv(options.allowedEnv),
					shell: true,
					signal,
				});

				let output = "";
				child.stdout.on("data", (chunk: Buffer) => {
					output += chunk.toString("utf8");
				});
				child.stderr.on("data", (chunk: Buffer) => {
					output += chunk.toString("utf8");
				});
				child.on("error", (error) => {
					reject(error);
				});
				child.on("close", (code) => {
					if (code === 0) {
						resolve(output);
						return;
					}
					reject(new Error(`Command exited with code ${String(code)}: ${output}`));
				});
			});
		},
		name: "bash",
		outputLimitBytes: options.outputLimitBytes,
		parameters: Type.Object({
			command: Type.String({ minLength: 1 }),
		}),
		timeoutSeconds: options.timeoutSeconds,
	};
}
