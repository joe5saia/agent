import { describe, expect, it } from "vitest";
import { runTelegramPollingLoop } from "../src/channels/telegram/polling.js";
import type { TelegramUpdate } from "../src/channels/telegram/types.js";

describe("telegram polling", () => {
	it("S24.1 + S24.17: advances offset and dedupes update IDs", async () => {
		const controller = new AbortController();
		let offset = 0;
		const handled: Array<number> = [];

		await runTelegramPollingLoop({
			callGetUpdates: async (): Promise<Array<TelegramUpdate>> => {
				controller.abort();
				return [
					{ message: { chat: { id: 1, type: "private" }, message_id: 1, text: "a" }, update_id: 1 },
					{ message: { chat: { id: 1, type: "private" }, message_id: 2, text: "b" }, update_id: 1 },
				];
			},
			getUpdateOffset: () => offset,
			isUpdateSeen: (updateId) => handled.includes(updateId),
			onUpdate: async (update) => {
				handled.push(update.update_id);
			},
			setUpdateOffset: (nextOffset) => {
				offset = nextOffset;
			},
			signal: controller.signal,
			timeoutSeconds: 1,
		});

		expect(offset).toBe(2);
		expect(handled).toEqual([1]);
	});

	it("S23.12: pauses intake while global queue pressure is signaled", async () => {
		const controller = new AbortController();
		let pauseCalls = 0;
		let pollCalls = 0;

		await runTelegramPollingLoop({
			callGetUpdates: async () => {
				pollCalls += 1;
				controller.abort();
				return [];
			},
			getPauseDelayMs: () => {
				pauseCalls += 1;
				return pauseCalls === 1 ? 10 : 0;
			},
			getUpdateOffset: () => 0,
			onUpdate: async () => {
				return;
			},
			setUpdateOffset: () => {
				return;
			},
			signal: controller.signal,
			timeoutSeconds: 1,
		});

		expect(pauseCalls).toBeGreaterThan(1);
		expect(pollCalls).toBe(1);
	});
});
