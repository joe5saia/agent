import { createTelegramRuntime } from "./telegram/index.js";
import type { ChannelRuntime, ChannelRuntimeDependencies } from "./types.js";

export interface RunningChannels {
	close: () => Promise<void>;
}

/**
 * Starts all configured channel runtimes.
 */
export async function startChannels(
	deps: ChannelRuntimeDependencies,
	options: {
		agentDir: string;
		signal?: AbortSignal;
	},
): Promise<RunningChannels> {
	const runtimes: Array<ChannelRuntime> = [];

	if (deps.config.channels.telegram.enabled) {
		const telegramRuntime = createTelegramRuntime(deps, { agentDir: options.agentDir });
		await telegramRuntime.start(options.signal);
		runtimes.push(telegramRuntime);
	}

	return {
		close: async () => {
			await Promise.all(
				runtimes.map(async (runtime) => {
					await runtime.stop();
				}),
			);
		},
	};
}

export type { ChannelRuntime, ChannelRuntimeDependencies } from "./types.js";
