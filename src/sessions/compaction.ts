import type { SessionRecord } from "./types.js";

export interface CompactionRunConfig {
	keepRecentTokens: number;
	reserveTokens: number;
}

export interface CompactionDependencies {
	appendRecord: (record: Extract<SessionRecord, { recordType: "compaction" }>) => Promise<void>;
	estimateTokens: (text: string) => number;
	logger?: {
		info(event: string, fields?: Record<string, unknown>): void;
		warn(event: string, fields?: Record<string, unknown>): void;
	};
	records: Array<SessionRecord>;
	sessionId: string;
	summarize?: (input: { mode: "initial" | "update"; prompt: string }) => Promise<string>;
}

function serializeContent(record: Extract<SessionRecord, { recordType: "message" }>): string {
	if (record.role === "user") {
		return record.content
			.filter((entry) => entry.type === "text")
			.map((entry) => `[User]: ${entry.text}`)
			.join("\n");
	}
	if (record.role === "assistant") {
		const lines: Array<string> = [];
		const text = record.content
			.filter((entry): entry is Extract<(typeof record.content)[number], { type: "text" }> => {
				return entry.type === "text";
			})
			.map((entry) => entry.text)
			.join("\n")
			.trim();
		if (text !== "") {
			lines.push(`[Assistant]: ${text}`);
		}
		const calls = record.content.filter(
			(entry): entry is Extract<(typeof record.content)[number], { type: "toolCall" }> => {
				return entry.type === "toolCall";
			},
		);
		if (calls.length > 0) {
			lines.push(
				`[Assistant tool calls]: ${calls
					.map((call) => `${call.name}(${JSON.stringify(call.arguments)})`)
					.join(", ")}`,
			);
		}
		return lines.join("\n");
	}
	return record.content
		.filter((entry) => entry.type === "text")
		.map((entry) => `[Tool result]: ${entry.text}`)
		.join("\n");
}

function normalizeSummary(summary: string, serialized: string): string {
	const normalized = summary.trim();
	if (normalized !== "") {
		return normalized;
	}

	const excerpt = serialized.length > 500 ? `${serialized.slice(0, 500)}...` : serialized;
	return [
		"## Goal",
		"- Preserve prior conversation context.",
		"",
		"## Constraints & Preferences",
		"- Continue from the persisted session safely.",
		"",
		"## Progress",
		"### Done",
		"- [x] Captured compacted conversation history.",
		"",
		"### In Progress",
		"- [ ] Resume with the latest preserved context.",
		"",
		"### Blocked",
		"- None.",
		"",
		"## Key Decisions",
		"- **Compaction overlay**: Preserve append-only history with summary checkpoints.",
		"",
		"## Next Steps",
		"1. Continue from kept recent messages.",
		"",
		"## Critical Context",
		`- ${excerpt || "No serialized messages available."}`,
	].join("\n");
}

function extractFileSets(messages: Array<Extract<SessionRecord, { recordType: "message" }>>): {
	modifiedFiles: Set<string>;
	readFiles: Set<string>;
} {
	const readFiles = new Set<string>();
	const modifiedFiles = new Set<string>();
	for (const record of messages) {
		if (record.role !== "assistant") {
			continue;
		}
		for (const block of record.content) {
			if (block.type !== "toolCall") {
				continue;
			}
			const path =
				typeof block.arguments["path"] === "string" ? block.arguments["path"] : undefined;
			if (path === undefined) {
				continue;
			}
			if (block.name === "read_file") {
				readFiles.add(path);
			}
			if (block.name === "write_file") {
				modifiedFiles.add(path);
			}
		}
	}

	for (const modified of modifiedFiles) {
		readFiles.delete(modified);
	}
	return { modifiedFiles, readFiles };
}

function estimateMessageTokens(
	record: Extract<SessionRecord, { recordType: "message" }>,
	estimateTokens: (text: string) => number,
): number {
	const serialized = serializeContent(record);
	return Math.max(1, estimateTokens(serialized));
}

function findCutIndex(
	messages: Array<Extract<SessionRecord, { recordType: "message" }>>,
	keepRecentTokens: number,
	estimateTokens: (text: string) => number,
): number {
	let accumulated = 0;
	let cutIndex = Math.max(0, messages.length - 1);
	for (let index = messages.length - 1; index >= 0; index -= 1) {
		const entry = messages[index];
		if (entry === undefined) {
			continue;
		}
		accumulated += estimateMessageTokens(entry, estimateTokens);
		if (accumulated >= keepRecentTokens) {
			cutIndex = index;
			break;
		}
	}

	while (cutIndex > 0) {
		const current = messages[cutIndex];
		const previous = messages[cutIndex - 1];
		if (current === undefined || previous === undefined) {
			break;
		}
		if (current.role === "toolResult" && previous.role === "assistant") {
			const pendingCall = previous.content.find(
				(block): block is Extract<(typeof previous.content)[number], { type: "toolCall" }> => {
					return block.type === "toolCall" && block.id === current.toolCallId;
				},
			);
			if (pendingCall !== undefined) {
				cutIndex -= 1;
				continue;
			}
		}
		break;
	}

	return cutIndex;
}

/**
 * Appends a compaction overlay record when context exceeds the configured budget.
 */
export async function compactSession(
	config: CompactionRunConfig,
	deps: CompactionDependencies,
): Promise<boolean> {
	const messageRecords = deps.records.filter(
		(record): record is Extract<SessionRecord, { recordType: "message" }> =>
			record.recordType === "message",
	);
	if (messageRecords.length < 2) {
		return false;
	}

	const cutIndex = findCutIndex(messageRecords, config.keepRecentTokens, deps.estimateTokens);
	if (cutIndex <= 0 || cutIndex >= messageRecords.length) {
		return false;
	}

	const summarizedMessages = messageRecords.slice(0, cutIndex);
	const keptMessages = messageRecords.slice(cutIndex);
	if (summarizedMessages.length === 0 || keptMessages.length === 0) {
		return false;
	}

	const previousCompaction = [...deps.records]
		.reverse()
		.find((record): record is Extract<SessionRecord, { recordType: "compaction" }> => {
			return record.recordType === "compaction";
		});

	const serialized = summarizedMessages
		.map((record) => serializeContent(record))
		.filter(Boolean)
		.join("\n");
	const prompt =
		previousCompaction === undefined
			? ["Summarize the following conversation in the required structure.", serialized].join("\n\n")
			: [
					"Update the previous summary with these new messages.",
					"<previous-summary>",
					previousCompaction.summary,
					"</previous-summary>",
					serialized,
				].join("\n\n");
	const summary = normalizeSummary(
		deps.summarize === undefined
			? ""
			: await deps.summarize({
					mode: previousCompaction === undefined ? "initial" : "update",
					prompt,
				}),
		serialized,
	);

	const newSets = extractFileSets(summarizedMessages);
	const mergedReadFiles = new Set<string>(previousCompaction?.readFiles ?? []);
	const mergedModifiedFiles = new Set<string>(previousCompaction?.modifiedFiles ?? []);
	for (const readFile of newSets.readFiles) {
		mergedReadFiles.add(readFile);
	}
	for (const modifiedFile of newSets.modifiedFiles) {
		mergedModifiedFiles.add(modifiedFile);
	}
	for (const modifiedFile of mergedModifiedFiles) {
		mergedReadFiles.delete(modifiedFile);
	}

	const nextSeq = deps.records.reduce((maxSeq, record) => Math.max(maxSeq, record.seq), 0) + 1;
	const tokensBefore = summarizedMessages
		.map((record) => estimateMessageTokens(record, deps.estimateTokens))
		.reduce((total, value) => total + value, 0);
	await deps.appendRecord({
		firstKeptSeq: keptMessages[0]?.seq ?? 0,
		modifiedFiles: [...mergedModifiedFiles.values()].sort((left, right) =>
			left.localeCompare(right),
		),
		readFiles: [...mergedReadFiles.values()].sort((left, right) => left.localeCompare(right)),
		recordType: "compaction",
		schemaVersion: 1,
		seq: nextSeq,
		summary,
		timestamp: new Date().toISOString(),
		tokensBefore,
	});

	deps.logger?.info("session_compacted", {
		firstKeptSeq: keptMessages[0]?.seq ?? 0,
		removedMessages: summarizedMessages.length,
		sessionId: deps.sessionId,
		summaryTokens: deps.estimateTokens(summary),
	});
	return true;
}
