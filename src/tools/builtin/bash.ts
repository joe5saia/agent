import { spawn } from "node:child_process";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Type } from "@sinclair/typebox";
import { buildToolEnv, isBlockedCommand } from "../../security/index.js";
import type { AgentTool } from "../types.js";

/**
 * Configuration for the bash built-in tool.
 */
export interface BashToolOptions {
	allowedEnv: Array<string>;
	blockedCommands?: Array<string>;
	onOutputChunk?: (chunk: string) => void;
	outputLimitBytes: number;
	timeoutSeconds: number;
}

interface TruncatedOutput {
	content: string;
	fullOutputPath?: string;
	truncated: boolean;
}

async function maybeTruncateBashOutput(
	output: string,
	limitBytes: number,
): Promise<TruncatedOutput> {
	const encoded = Buffer.from(output, "utf8");
	if (encoded.byteLength <= limitBytes) {
		return {
			content: output,
			truncated: false,
		};
	}

	const outputDir = await mkdtemp(join(tmpdir(), "agent-bash-output-"));
	const fullOutputPath = join(outputDir, "full-output.log");
	await writeFile(fullOutputPath, output, "utf8");

	const prefix = ["[output truncated: showing tail]", `Full output: ${fullOutputPath}`, ""].join(
		"\n",
	);
	const prefixBytes = Buffer.byteLength(prefix, "utf8");
	const tailBytes = Math.max(1, limitBytes - prefixBytes);
	const tail = encoded.subarray(Math.max(0, encoded.byteLength - tailBytes)).toString("utf8");

	return {
		content: `${prefix}${tail}`,
		fullOutputPath,
		truncated: true,
	};
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

			const raw = await new Promise<string>((resolve, reject) => {
				const child = spawn(command, {
					env: buildToolEnv(options.allowedEnv),
					shell: true,
					signal,
				});

				let output = "";
				const onChunk = (buffer: Buffer): void => {
					const text = buffer.toString("utf8");
					output += text;
					options.onOutputChunk?.(text);
				};
				child.stdout.on("data", onChunk);
				child.stderr.on("data", onChunk);
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

			const truncated = await maybeTruncateBashOutput(raw, options.outputLimitBytes);
			if (!truncated.truncated) {
				return raw;
			}
			if (truncated.fullOutputPath === undefined) {
				return truncated.content;
			}

			return truncated.content;
		},
		name: "bash",
		outputLimitBytes: options.outputLimitBytes,
		parameters: Type.Object({
			command: Type.String({ minLength: 1 }),
		}),
		timeoutSeconds: options.timeoutSeconds,
	};
}
