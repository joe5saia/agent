import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ConversationMappingStore } from "../src/channels/mapping-store.js";

const tempDirectories: Array<string> = [];

function createTempDir(): string {
	const directory = mkdtempSync(join(tmpdir(), "agent-channels-test-"));
	tempDirectories.push(directory);
	return directory;
}

afterEach(() => {
	for (const directory of tempDirectories.splice(0)) {
		rmSync(directory, { force: true, recursive: true });
	}
});

describe("ConversationMappingStore", () => {
	it("S23.2 + S26.3: persists and reloads mappings", async () => {
		const directory = createTempDir();
		const filePath = join(directory, "conversations.jsonl");
		const store = new ConversationMappingStore({ filePath });
		await store.init();
		await store.upsert({
			channel: "telegram",
			chatId: 123,
			conversationKey: "telegram:dm:42",
			sessionId: "01ARZ3NDEKTSV4RRFFQ69G5FAV",
		});

		const reloaded = new ConversationMappingStore({ filePath });
		await reloaded.init();
		expect(reloaded.get("telegram:dm:42")?.sessionId).toBe("01ARZ3NDEKTSV4RRFFQ69G5FAV");
	});

	it("S23.13: ignores trailing partial json line", async () => {
		const directory = createTempDir();
		const filePath = join(directory, "conversations.jsonl");
		writeFileSync(
			filePath,
			[
				JSON.stringify({
					channel: "telegram",
					chatId: 1,
					conversationKey: "telegram:dm:1",
					sessionId: "01ARZ3NDEKTSV4RRFFQ69G5FAA",
					updatedAt: "2026-01-01T00:00:00.000Z",
				}),
				'{"channel":"telegram"',
			].join("\n"),
			"utf8",
		);

		const store = new ConversationMappingStore({ filePath });
		await store.init();
		expect(store.get("telegram:dm:1")?.sessionId).toBe("01ARZ3NDEKTSV4RRFFQ69G5FAA");
	});

	it("S23.14 + S26.6: resolves conflict by latest updatedAt", async () => {
		const directory = createTempDir();
		const filePath = join(directory, "conversations.jsonl");
		writeFileSync(
			filePath,
			[
				JSON.stringify({
					channel: "telegram",
					chatId: 1,
					conversationKey: "telegram:dm:1",
					sessionId: "01ARZ3NDEKTSV4RRFFQ69G5FAA",
					updatedAt: "2026-01-01T00:00:00.000Z",
				}),
				JSON.stringify({
					channel: "telegram",
					chatId: 1,
					conversationKey: "telegram:dm:1",
					sessionId: "01ARZ3NDEKTSV4RRFFQ69G5FAB",
					updatedAt: "2026-01-01T00:00:01.000Z",
				}),
			].join("\n"),
			"utf8",
		);

		const store = new ConversationMappingStore({ filePath });
		await store.init();
		expect(store.get("telegram:dm:1")?.sessionId).toBe("01ARZ3NDEKTSV4RRFFQ69G5FAB");
	});
});
