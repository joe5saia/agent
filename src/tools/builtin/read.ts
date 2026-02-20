import { readFile } from "node:fs/promises";
import { Type } from "@sinclair/typebox";
import { validatePath } from "../../security/index.js";
import type { AgentTool } from "../types.js";
import { warnLegacyAliasUsage } from "./deprecation.js";

/**
 * Configuration for read-like built-in tools.
 */
export interface ReadToolOptions {
	allowedPaths: Array<string>;
	deniedPaths: Array<string>;
	name?: string;
	outputLimitBytes: number;
	timeoutSeconds: number;
}

/**
 * Creates the read built-in tool with optional alias naming.
 */
export function createReadTool(options: ReadToolOptions): AgentTool {
	const toolName = options.name ?? "read";

	return {
		category: "read",
		description:
			"Read a UTF-8 text file from disk. Supports pagination with optional offset and limit.",
		async execute(args: Record<string, unknown>): Promise<string> {
			if (toolName !== "read") {
				warnLegacyAliasUsage(toolName);
			}

			const path = typeof args["path"] === "string" ? args["path"] : "";
			const offset = typeof args["offset"] === "number" ? Math.floor(args["offset"]) : 0;
			const requestedLimit =
				typeof args["limit"] === "number" ? Math.floor(args["limit"]) : options.outputLimitBytes;
			const safeOffset = Math.max(0, offset);
			const safeRequestedLimit = Math.max(1, requestedLimit);

			const result = validatePath(path, options.allowedPaths, options.deniedPaths);
			if (!result.allowed) {
				throw new Error(result.reason ?? "Path denied by policy.");
			}

			const raw = await readFile(result.resolvedPath, "utf8");
			const sourceBuffer = Buffer.from(raw, "utf8");
			if (safeOffset >= sourceBuffer.byteLength) {
				return [
					`Read 0 bytes from ${result.resolvedPath}.`,
					`Reached end of file (${String(sourceBuffer.byteLength)} total bytes).`,
				].join("\n");
			}

			const noticeBudget = 256;
			const payloadLimit = Math.max(1, options.outputLimitBytes - noticeBudget);
			const sliceLimit = Math.min(safeRequestedLimit, payloadLimit);
			const sliceEnd = Math.min(sourceBuffer.byteLength, safeOffset + sliceLimit);
			const slice = sourceBuffer.subarray(safeOffset, sliceEnd).toString("utf8");
			if (sliceEnd >= sourceBuffer.byteLength) {
				return slice;
			}

			const continuation = [
				"",
				`[read truncated] showing bytes ${String(safeOffset)}-${String(sliceEnd)} of ${String(sourceBuffer.byteLength)}.`,
				`Continue with offset=${String(sliceEnd)}.`,
			].join("\n");
			return `${slice}${continuation}`;
		},
		name: toolName,
		outputLimitBytes: options.outputLimitBytes,
		parameters: Type.Object({
			limit: Type.Optional(Type.Number({ minimum: 1 })),
			offset: Type.Optional(Type.Number({ minimum: 0 })),
			path: Type.String({ minLength: 1 }),
		}),
		timeoutSeconds: options.timeoutSeconds,
	};
}
