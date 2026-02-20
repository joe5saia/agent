import { appendFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { readRecords, SessionManager } from "../src/sessions/index.js";

const tempDirectories: Array<string> = [];

function createTempSessionsDir(): string {
	const directory = mkdtempSync(join(tmpdir(), "agent-sessions-test-"));
	tempDirectories.push(directory);
	return directory;
}

afterEach(() => {
	for (const directory of tempDirectories.splice(0)) {
		rmSync(directory, { force: true, recursive: true });
	}
});

describe("SessionManager", () => {
	it("S7.1: create() initializes session directory and metadata", async () => {
		const sessionsDir = createTempSessionsDir();
		const manager = new SessionManager({
			defaultModel: "test-model",
			sessionsDir,
		});

		const session = await manager.create();
		const sessionDir = join(sessionsDir, session.id);

		expect(readFileSync(join(sessionDir, "session.jsonl"), "utf8")).toBe("");
		const metadataRaw = readFileSync(join(sessionDir, "metadata.json"), "utf8");
		const metadata = JSON.parse(metadataRaw) as { name: string };
		expect(metadata.name).toBe("New Session");
	});

	it("S7.2 + S7.4 + S7.12: appendMessage appends JSONL and updates metadata", async () => {
		const sessionsDir = createTempSessionsDir();
		const manager = new SessionManager({
			defaultModel: "test-model",
			sessionsDir,
		});
		const session = await manager.create();

		await manager.appendMessage(session.id, {
			content: [{ text: "hello", type: "text" }],
			role: "user",
		});
		await manager.appendMessage(session.id, {
			content: [{ text: "world", type: "text" }],
			role: "assistant",
		});

		const records = await readRecords(join(sessionsDir, session.id, "session.jsonl"));
		expect(records).toHaveLength(2);
		expect(records[0]?.recordType).toBe("message");
		expect(records[0]?.content).toEqual([{ text: "hello", type: "text" }]);

		const metadata = await manager.get(session.id);
		expect(metadata.messageCount).toBe(2);
		expect(metadata.lastMessageAt >= metadata.createdAt).toBe(true);
	});

	it("S7.3: buildContext reconstructs persisted messages", async () => {
		const sessionsDir = createTempSessionsDir();
		const manager = new SessionManager({
			defaultModel: "test-model",
			sessionsDir,
		});
		const session = await manager.create();

		await manager.appendMessage(session.id, {
			content: [{ text: "What is 2+2?", type: "text" }],
			role: "user",
		});
		await manager.appendMessage(session.id, {
			content: [{ text: "4", type: "text" }],
			role: "assistant",
		});

		const context = await manager.buildContext(session.id);
		expect(context).toHaveLength(2);
		expect(context[0]?.role).toBe("user");
		expect(context[1]?.role).toBe("assistant");
	});

	it("S7.5: list() returns sessions sorted by lastMessageAt desc", async () => {
		const sessionsDir = createTempSessionsDir();
		const manager = new SessionManager({
			defaultModel: "test-model",
			sessionsDir,
		});
		const first = await manager.create({ name: "first" });
		await new Promise((resolve) => setTimeout(resolve, 5));
		const second = await manager.create({ name: "second" });

		await manager.appendMessage(first.id, {
			content: [{ text: "older", type: "text" }],
			role: "user",
		});
		await new Promise((resolve) => setTimeout(resolve, 5));
		await manager.appendMessage(second.id, {
			content: [{ text: "newer", type: "text" }],
			role: "user",
		});

		const sessions = await manager.list();
		expect(sessions).toHaveLength(2);
		expect(sessions[0]?.id).toBe(second.id);
		expect(sessions[1]?.id).toBe(first.id);
	});

	it("S7.8: invalid session ids are rejected", async () => {
		const sessionsDir = createTempSessionsDir();
		const manager = new SessionManager({
			defaultModel: "test-model",
			sessionsDir,
		});

		await expect(manager.get("../../bad")).rejects.toThrowError(/invalid session id/i);
	});

	it("S7.9: readRecords ignores trailing partial lines", async () => {
		const sessionsDir = createTempSessionsDir();
		const manager = new SessionManager({
			defaultModel: "test-model",
			sessionsDir,
		});
		const session = await manager.create();
		await manager.appendMessage(session.id, {
			content: [{ text: "valid", type: "text" }],
			role: "user",
		});

		const sessionFile = join(sessionsDir, session.id, "session.jsonl");
		appendFileSync(sessionFile, '{"recordType":"message"', "utf8");

		const records = await readRecords(sessionFile);
		expect(records).toHaveLength(1);
		expect(records[0]?.recordType).toBe("message");
	});

	it("S7.10: concurrent appendMessage calls are queued", async () => {
		const sessionsDir = createTempSessionsDir();
		const manager = new SessionManager({
			defaultModel: "test-model",
			sessionsDir,
		});
		const session = await manager.create();

		await Promise.all([
			manager.appendMessage(session.id, {
				content: [{ text: "a", type: "text" }],
				role: "user",
			}),
			manager.appendMessage(session.id, {
				content: [{ text: "b", type: "text" }],
				role: "user",
			}),
			manager.appendMessage(session.id, {
				content: [{ text: "c", type: "text" }],
				role: "user",
			}),
		]);

		const records = await readRecords(join(sessionsDir, session.id, "session.jsonl"));
		expect(records).toHaveLength(3);
		const messageRecords = records.filter((record) => record.recordType === "message");
		expect(messageRecords).toHaveLength(3);
		expect(messageRecords[0]?.seq).toBe(1);
		expect(messageRecords[1]?.seq).toBe(2);
		expect(messageRecords[2]?.seq).toBe(3);
	});

	it("applies latest compaction overlay when building context", async () => {
		const sessionsDir = createTempSessionsDir();
		const manager = new SessionManager({
			defaultModel: "test-model",
			sessionsDir,
		});
		const session = await manager.create();
		const sessionFile = join(sessionsDir, session.id, "session.jsonl");

		appendFileSync(
			sessionFile,
			[
				JSON.stringify({
					content: [{ text: "old", type: "text" }],
					recordType: "message",
					role: "user",
					schemaVersion: 1,
					seq: 1,
					timestamp: new Date().toISOString(),
				}),
				JSON.stringify({
					firstKeptSeq: 2,
					modifiedFiles: [],
					readFiles: [],
					recordType: "compaction",
					schemaVersion: 1,
					seq: 2,
					summary: "summary text",
					timestamp: new Date().toISOString(),
					tokensBefore: 100,
				}),
				JSON.stringify({
					content: [{ text: "new", type: "text" }],
					recordType: "message",
					role: "user",
					schemaVersion: 1,
					seq: 3,
					timestamp: new Date().toISOString(),
				}),
			].join("\n") + "\n",
			"utf8",
		);

		const context = await manager.buildContext(session.id);
		expect(context).toHaveLength(2);
		expect(context[0]?.role).toBe("user");
		expect(context[1]?.role).toBe("user");
		expect(JSON.stringify(context[0])).toContain("summary text");
		expect(JSON.stringify(context[1])).toContain("new");
	});

	it("restores toolResult toolName from persisted records", async () => {
		const sessionsDir = createTempSessionsDir();
		const manager = new SessionManager({
			defaultModel: "test-model",
			sessionsDir,
		});
		const session = await manager.create();

		await manager.appendMessage(session.id, {
			content: [{ text: "result", type: "text" }],
			isError: false,
			role: "toolResult",
			toolCallId: "call_1",
			toolName: "read_file",
		});

		const context = await manager.buildContext(session.id);
		const toolResult = context.find((message) => message.role === "toolResult");
		expect(toolResult?.role).toBe("toolResult");
		if (toolResult?.role === "toolResult") {
			expect(toolResult.toolName).toBe("read_file");
		}
	});

	it("infers nextSeq from max persisted seq for legacy metadata", async () => {
		const sessionsDir = createTempSessionsDir();
		const manager = new SessionManager({
			defaultModel: "test-model",
			sessionsDir,
		});
		const session = await manager.create();
		const sessionDir = join(sessionsDir, session.id);
		const sessionFile = join(sessionDir, "session.jsonl");
		const metadataFile = join(sessionDir, "metadata.json");

		appendFileSync(
			sessionFile,
			[
				JSON.stringify({
					content: [{ text: "first", type: "text" }],
					recordType: "message",
					role: "user",
					schemaVersion: 1,
					seq: 1,
					timestamp: new Date().toISOString(),
				}),
				JSON.stringify({
					firstKeptSeq: 3,
					modifiedFiles: [],
					readFiles: [],
					recordType: "compaction",
					schemaVersion: 1,
					seq: 2,
					summary: "summary",
					timestamp: new Date().toISOString(),
					tokensBefore: 100,
				}),
				JSON.stringify({
					content: [{ text: "third", type: "text" }],
					recordType: "message",
					role: "user",
					schemaVersion: 1,
					seq: 3,
					timestamp: new Date().toISOString(),
				}),
			].join("\n") + "\n",
			"utf8",
		);
		writeFileSync(
			metadataFile,
			JSON.stringify(
				{
					createdAt: session.createdAt,
					id: session.id,
					lastMessageAt: session.lastMessageAt,
					messageCount: 2,
					metrics: session.metrics,
					model: session.model,
					name: session.name,
					source: session.source,
				},
				null,
				2,
			),
			"utf8",
		);

		const reopenedManager = new SessionManager({
			defaultModel: "test-model",
			sessionsDir,
		});
		await reopenedManager.appendMessage(session.id, {
			content: [{ text: "new", type: "text" }],
			role: "user",
		});

		const records = await readRecords(sessionFile);
		const appended = records.at(-1);
		expect(appended?.seq).toBe(4);
	});

	it("clamps stale explicit nextSeq against persisted records", async () => {
		const sessionsDir = createTempSessionsDir();
		const manager = new SessionManager({
			defaultModel: "test-model",
			sessionsDir,
		});
		const session = await manager.create();
		const sessionDir = join(sessionsDir, session.id);
		const sessionFile = join(sessionDir, "session.jsonl");
		const metadataFile = join(sessionDir, "metadata.json");

		appendFileSync(
			sessionFile,
			[
				JSON.stringify({
					content: [{ text: "first", type: "text" }],
					recordType: "message",
					role: "user",
					schemaVersion: 1,
					seq: 1,
					timestamp: new Date().toISOString(),
				}),
				JSON.stringify({
					content: [{ text: "second", type: "text" }],
					recordType: "message",
					role: "assistant",
					schemaVersion: 1,
					seq: 2,
					timestamp: new Date().toISOString(),
				}),
			].join("\n") + "\n",
			"utf8",
		);
		writeFileSync(
			metadataFile,
			JSON.stringify(
				{
					createdAt: session.createdAt,
					id: session.id,
					lastMessageAt: session.lastMessageAt,
					messageCount: 2,
					metrics: session.metrics,
					model: session.model,
					name: session.name,
					nextSeq: 2,
					source: session.source,
				},
				null,
				2,
			),
			"utf8",
		);

		const reopenedManager = new SessionManager({
			defaultModel: "test-model",
			sessionsDir,
		});
		await reopenedManager.appendMessage(session.id, {
			content: [{ text: "third", type: "text" }],
			role: "user",
		});

		const records = await readRecords(sessionFile);
		const appended = records.at(-1);
		expect(appended?.seq).toBe(3);
	});

	it("persists reconciled nextSeq on read before first append", async () => {
		const sessionsDir = createTempSessionsDir();
		const manager = new SessionManager({
			defaultModel: "test-model",
			sessionsDir,
		});
		const session = await manager.create();
		const sessionDir = join(sessionsDir, session.id);
		const sessionFile = join(sessionDir, "session.jsonl");
		const metadataFile = join(sessionDir, "metadata.json");

		appendFileSync(
			sessionFile,
			[
				JSON.stringify({
					content: [{ text: "first", type: "text" }],
					recordType: "message",
					role: "user",
					schemaVersion: 1,
					seq: 1,
					timestamp: new Date().toISOString(),
				}),
				JSON.stringify({
					content: [{ text: "second", type: "text" }],
					recordType: "message",
					role: "assistant",
					schemaVersion: 1,
					seq: 2,
					timestamp: new Date().toISOString(),
				}),
			].join("\n") + "\n",
			"utf8",
		);
		writeFileSync(
			metadataFile,
			JSON.stringify(
				{
					createdAt: session.createdAt,
					id: session.id,
					lastMessageAt: session.lastMessageAt,
					messageCount: 2,
					metrics: session.metrics,
					model: session.model,
					name: session.name,
					nextSeq: 2,
					source: session.source,
				},
				null,
				2,
			),
			"utf8",
		);

		const reopenedManager = new SessionManager({
			defaultModel: "test-model",
			sessionsDir,
		});
		const metadata = await reopenedManager.get(session.id);
		expect(metadata.nextSeq).toBe(3);
		const persistedAfterRead = JSON.parse(readFileSync(metadataFile, "utf8")) as {
			nextSeq: number;
		};
		expect(persistedAfterRead.nextSeq).toBe(3);

		await reopenedManager.appendMessage(session.id, {
			content: [{ text: "third", type: "text" }],
			role: "user",
		});
		const records = await readRecords(sessionFile);
		expect(records.at(-1)?.seq).toBe(3);
	});
});
