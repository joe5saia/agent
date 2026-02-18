import { Value } from "@sinclair/typebox/value";
import type { ToolRegistry } from "./registry.js";
import type { AgentTool, ToolResult } from "./types.js";

/**
 * Appends a truncation marker when a tool output exceeds the byte limit.
 */
function truncateOutput(output: string, limitBytes: number): string {
	const buffer = Buffer.from(output, "utf8");
	if (buffer.byteLength <= limitBytes) {
		return output;
	}

	const truncated = buffer.subarray(0, limitBytes).toString("utf8");
	return `${truncated}\n[output truncated]`;
}

/**
 * Races tool execution against a timeout and optional external cancellation.
 */
async function runWithTimeout(
	tool: AgentTool,
	args: Record<string, unknown>,
	signal?: AbortSignal,
): Promise<string> {
	const timeoutMs = Math.max(1, Math.floor((tool.timeoutSeconds ?? 120) * 1000));
	const controller = new AbortController();
	const timeoutError = new Error(`Tool execution timed out after ${timeoutMs}ms.`);

	if (signal?.aborted) {
		signal.throwIfAborted();
	}

	const onAbort = (): void => {
		controller.abort(signal?.reason);
	};
	signal?.addEventListener("abort", onAbort, { once: true });

	let timeout: ReturnType<typeof setTimeout> | undefined;
	const timeoutPromise = new Promise<string>((_resolve, reject) => {
		timeout = setTimeout(() => {
			controller.abort(timeoutError);
			reject(timeoutError);
		}, timeoutMs);
	});

	try {
		return await Promise.race([tool.execute(args, controller.signal), timeoutPromise]);
	} finally {
		if (timeout !== undefined) {
			clearTimeout(timeout);
		}
		signal?.removeEventListener("abort", onAbort);
	}
}

/**
 * Executes a tool by name with argument validation and safety controls.
 */
export async function executeTool(
	registry: ToolRegistry,
	name: string,
	args: Record<string, unknown>,
	signal?: AbortSignal,
): Promise<ToolResult> {
	const tool = registry.get(name);
	if (tool === undefined) {
		return {
			content: `Unknown tool: ${name}`,
			isError: true,
		};
	}

	if (!Value.Check(tool.parameters, args)) {
		const errors = [...Value.Errors(tool.parameters, args)]
			.map((entry) => `${entry.path || "/"}: ${entry.message}`)
			.join("; ");
		return {
			content: `Invalid arguments for tool ${name}: ${errors}`,
			isError: true,
		};
	}

	try {
		const output = await runWithTimeout(tool, args, signal);
		const content = truncateOutput(output, tool.outputLimitBytes ?? 200_000);
		return {
			content,
			isError: false,
		};
	} catch (error: unknown) {
		const message = error instanceof Error ? error.message : String(error);
		return {
			content: `Tool execution failed: ${message}`,
			isError: true,
		};
	}
}
