import { join } from "node:path";
import type { ChannelRuntimeDependencies } from "../types.js";
import { TelegramRuntime } from "./runtime.js";

/**
 * Creates a Telegram runtime instance.
 */
export function createTelegramRuntime(
	deps: ChannelRuntimeDependencies,
	options: {
		agentDir: string;
	},
): TelegramRuntime {
	return new TelegramRuntime(deps, {
		mappingStorePath: join(options.agentDir, "channels", "telegram", "conversations.jsonl"),
		stateFilePath: join(options.agentDir, "channels", "telegram", "state.json"),
	});
}
