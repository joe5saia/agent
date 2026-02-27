import { setTimeout as sleep } from "node:timers/promises";
import type { TelegramUpdate } from "./types.js";

/**
 * Polling loop dependencies.
 */
export interface TelegramPollingLoopOptions {
	callGetUpdates: (offset: number, timeoutSeconds: number) => Promise<Array<TelegramUpdate>>;
	getPauseDelayMs?: () => number;
	getUpdateOffset: () => number;
	isUpdateSeen?: (updateId: number) => boolean;
	logger?: {
		warn(event: string, fields?: Record<string, unknown>): void;
	};
	onUpdate: (update: TelegramUpdate) => Promise<void>;
	setUpdateOffset: (nextOffset: number) => void;
	signal: AbortSignal;
	timeoutSeconds: number;
}

async function sleepWithAbort(ms: number, signal: AbortSignal): Promise<void> {
	if (ms <= 0 || signal.aborted) {
		return;
	}
	try {
		await sleep(ms, undefined, { signal });
	} catch {
		return;
	}
}

/**
 * Runs Telegram long-poll update intake until aborted.
 */
export async function runTelegramPollingLoop(options: TelegramPollingLoopOptions): Promise<void> {
	while (!options.signal.aborted) {
		const pauseDelayMs = options.getPauseDelayMs?.() ?? 0;
		if (pauseDelayMs > 0) {
			await sleepWithAbort(pauseDelayMs, options.signal);
			continue;
		}

		try {
			const updates = await options.callGetUpdates(
				options.getUpdateOffset(),
				options.timeoutSeconds,
			);
			for (const update of updates) {
				if (typeof update.update_id === "number") {
					options.setUpdateOffset(Math.max(options.getUpdateOffset(), update.update_id + 1));
					if (options.isUpdateSeen?.(update.update_id) ?? false) {
						continue;
					}
				}
				await options.onUpdate(update);
				if (options.signal.aborted) {
					break;
				}
			}
			if (updates.length === 0) {
				// Prevent tight-loop spin when upstream returns immediately with no updates.
				await sleepWithAbort(25, options.signal);
			}
		} catch (error: unknown) {
			options.logger?.warn("telegram_poll_error", {
				error: error instanceof Error ? error.message : String(error),
			});
			await sleepWithAbort(1000, options.signal);
		}
	}
}
