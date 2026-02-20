import { describe, expect, it } from "vitest";
import { compactSession } from "../src/sessions/index.js";
import type { SessionRecord } from "../src/sessions/index.js";

function message(
	seq: number,
	role: "assistant" | "toolResult" | "user",
	content: SessionRecord extends infer T
		? T extends { content: infer C; recordType: "message" }
			? C
			: never
		: never,
	overrides?: Partial<Extract<SessionRecord, { recordType: "message" }>>,
): Extract<SessionRecord, { recordType: "message" }> {
	return {
		content,
		recordType: "message",
		role,
		schemaVersion: 1,
		seq,
		timestamp: "2026-02-18T00:00:00.000Z",
		...overrides,
	};
}

describe("session compaction", () => {
	it("S7.6 + S7.14 + S7.18: appends compaction records with structured summary and flat serialization", async () => {
		const records: Array<SessionRecord> = [
			message(1, "user", [{ text: "Need deployment status", type: "text" }]),
			message(2, "assistant", [
				{ text: "Checking files", type: "text" },
				{
					arguments: { path: "src/app.ts" },
					id: "tc1",
					name: "read",
					type: "toolCall",
				},
			]),
			message(3, "toolResult", [{ text: "file contents", type: "text" }], {
				isError: false,
				toolCallId: "tc1",
			}),
			message(4, "assistant", [{ text: "Done", type: "text" }]),
		];
		const appended: Array<Extract<SessionRecord, { recordType: "compaction" }>> = [];
		const prompts: Array<string> = [];

		const changed = await compactSession(
			{ keepRecentTokens: 2, reserveTokens: 1 },
			{
				appendRecord: async (record) => {
					appended.push(record);
				},
				estimateTokens: (text) => Math.max(1, Math.ceil(text.length / 4)),
				records,
				sessionId: "01HXXXXXXXXXXXXXXXXXXXXXXX",
				summarize: async ({ prompt }) => {
					prompts.push(prompt);
					return [
						"## Goal",
						"Ship changes",
						"",
						"## Constraints & Preferences",
						"- Keep quality high",
						"",
						"## Progress",
						"### Done",
						"- [x] Reviewed files",
						"",
						"### In Progress",
						"- [ ] Verify deploy",
						"",
						"### Blocked",
						"- None",
						"",
						"## Key Decisions",
						"- **Use compaction**: Keep append-only history",
						"",
						"## Next Steps",
						"1. Continue",
						"",
						"## Critical Context",
						"- Serialized",
					].join("\n");
				},
			},
		);

		expect(changed).toBe(true);
		expect(appended).toHaveLength(1);
		expect(appended[0]?.summary).toContain("## Goal");
		expect(prompts[0]).toContain("[User]:");
		expect(prompts[0]).toContain("[Assistant]:");
		expect(prompts[0]).toContain("[Tool result]:");
	});

	it("S7.13: does not cut between tool call and tool result", async () => {
		const records: Array<SessionRecord> = [
			message(1, "user", [{ text: "u1", type: "text" }]),
			message(2, "assistant", [
				{ text: "a1", type: "text" },
				{
					arguments: { path: "a" },
					id: "call-1",
					name: "read",
					type: "toolCall",
				},
			]),
			message(3, "toolResult", [{ text: "result", type: "text" }], { toolCallId: "call-1" }),
			message(4, "assistant", [{ text: "tail", type: "text" }]),
		];
		let firstKeptSeq = 0;

		await compactSession(
			{ keepRecentTokens: 100, reserveTokens: 1 },
			{
				appendRecord: async (record) => {
					firstKeptSeq = record.firstKeptSeq;
				},
				estimateTokens: () => 60,
				records,
				sessionId: "01HXXXXXXXXXXXXXXXXXXXXXXX",
				summarize: async () => "## Goal\nTest",
			},
		);

		expect(firstKeptSeq).not.toBe(3);
	});

	it("S7.15 + S7.16 + S7.17: uses update mode and merges cumulative file sets", async () => {
		const records: Array<SessionRecord> = [
			message(1, "assistant", [
				{
					arguments: { path: "src/new.ts" },
					id: "tc2",
					name: "edit",
					type: "toolCall",
				},
			]),
			{
				firstKeptSeq: 2,
				modifiedFiles: ["src/old-mod.ts", "src/shared.ts"],
				readFiles: ["src/old-read.ts", "src/shared.ts"],
				recordType: "compaction",
				schemaVersion: 1,
				seq: 2,
				summary: "prior summary",
				timestamp: "2026-02-18T00:00:00.000Z",
				tokensBefore: 100,
			},
			message(3, "user", [{ text: "recent", type: "text" }]),
		];
		let summarizeMode: "initial" | "update" | undefined;
		let mergedRecord: Extract<SessionRecord, { recordType: "compaction" }> | undefined;

		await compactSession(
			{ keepRecentTokens: 2, reserveTokens: 1 },
			{
				appendRecord: async (record) => {
					mergedRecord = record;
				},
				estimateTokens: () => 50,
				records,
				sessionId: "01HXXXXXXXXXXXXXXXXXXXXXXX",
				summarize: async ({ mode }) => {
					summarizeMode = mode;
					return "## Goal\nUpdated";
				},
			},
		);

		expect(summarizeMode).toBe("update");
		expect(mergedRecord?.modifiedFiles).toContain("src/new.ts");
		expect(mergedRecord?.modifiedFiles).toContain("src/shared.ts");
		expect(mergedRecord?.readFiles).toContain("src/old-read.ts");
		expect(mergedRecord?.readFiles).not.toContain("src/shared.ts");
	});

	it("normalizes legacy file tool aliases during compaction", async () => {
		const records: Array<SessionRecord> = [
			message(1, "assistant", [
				{
					arguments: { path: "src/legacy-read.ts" },
					id: "tc1",
					name: "read_file",
					type: "toolCall",
				},
			]),
			message(2, "assistant", [
				{
					arguments: { path: "src/legacy-write.ts" },
					id: "tc2",
					name: "write_file",
					type: "toolCall",
				},
				{
					arguments: { path: "src/ignored-dir.ts" },
					id: "tc3",
					name: "list_directory",
					type: "toolCall",
				},
			]),
			message(3, "user", [{ text: "tail", type: "text" }]),
		];
		let compacted: Extract<SessionRecord, { recordType: "compaction" }> | undefined;

		await compactSession(
			{ keepRecentTokens: 1, reserveTokens: 1 },
			{
				appendRecord: async (record) => {
					compacted = record;
				},
				estimateTokens: () => 50,
				records,
				sessionId: "01HXXXXXXXXXXXXXXXXXXXXXXX",
				summarize: async () => "## Goal\nNormalized",
			},
		);

		expect(compacted?.readFiles).toContain("src/legacy-read.ts");
		expect(compacted?.modifiedFiles).toContain("src/legacy-write.ts");
		expect(compacted?.readFiles).not.toContain("src/ignored-dir.ts");
		expect(compacted?.modifiedFiles).not.toContain("src/ignored-dir.ts");
	});
});
