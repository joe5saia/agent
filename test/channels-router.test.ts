import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ConversationMappingStore } from "../src/channels/mapping-store.js";
import { ConversationRouter } from "../src/channels/router.js";
import { SessionManager } from "../src/sessions/index.js";

const tempDirectories: Array<string> = [];

function createTempDir(): string {
	const directory = mkdtempSync(join(tmpdir(), "agent-channel-router-test-"));
	tempDirectories.push(directory);
	return directory;
}

afterEach(() => {
	for (const directory of tempDirectories.splice(0)) {
		rmSync(directory, { force: true, recursive: true });
	}
});

describe("ConversationRouter", () => {
	it("S23.3: creates a new session for unknown conversation", async () => {
		const directory = createTempDir();
		const mappingStore = new ConversationMappingStore({
			filePath: join(directory, "mappings.jsonl"),
		});
		await mappingStore.init();
		const sessionManager = new SessionManager({
			defaultModel: "gpt-test",
			sessionsDir: join(directory, "sessions"),
		});
		const router = new ConversationRouter({
			mappingStore,
			sessionManager,
		});

		const resolved = await router.resolve({
			channel: "telegram",
			chatId: 100,
			conversationKey: "telegram:dm:100",
		});
		expect(resolved.created).toBe(true);
		expect(resolved.sessionId).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
	});

	it("S23.2: reuses existing mapped session", async () => {
		const directory = createTempDir();
		const mappingStore = new ConversationMappingStore({
			filePath: join(directory, "mappings.jsonl"),
		});
		await mappingStore.init();
		const sessionManager = new SessionManager({
			defaultModel: "gpt-test",
			sessionsDir: join(directory, "sessions"),
		});
		const router = new ConversationRouter({
			mappingStore,
			sessionManager,
		});

		const first = await router.resolve({
			channel: "telegram",
			chatId: 100,
			conversationKey: "telegram:dm:100",
		});
		const second = await router.resolve({
			channel: "telegram",
			chatId: 100,
			conversationKey: "telegram:dm:100",
		});
		expect(second.created).toBe(false);
		expect(second.sessionId).toBe(first.sessionId);
	});

	it("S23.14: remaps when mapped session has been deleted", async () => {
		const directory = createTempDir();
		const mappingStore = new ConversationMappingStore({
			filePath: join(directory, "mappings.jsonl"),
		});
		await mappingStore.init();
		const sessionManager = new SessionManager({
			defaultModel: "gpt-test",
			sessionsDir: join(directory, "sessions"),
		});
		const router = new ConversationRouter({
			mappingStore,
			sessionManager,
		});

		const first = await router.resolve({
			channel: "telegram",
			chatId: 100,
			conversationKey: "telegram:dm:100",
		});
		await sessionManager.delete(first.sessionId);
		const remapped = await router.resolve({
			channel: "telegram",
			chatId: 100,
			conversationKey: "telegram:dm:100",
		});
		expect(remapped.sessionId).not.toBe(first.sessionId);
	});
});
