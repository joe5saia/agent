import { existsSync, mkdirSync } from "node:fs";
import { appendFile, readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

/**
 * Persistent mapping record from a channel conversation to a session ID.
 */
export interface ConversationMappingRecord {
	channel: "telegram";
	chatId: number;
	conversationKey: string;
	sessionId: string;
	threadId?: number;
	updatedAt: string;
}

interface MappingStoreOptions {
	filePath: string;
	logger?: {
		warn(event: string, fields?: Record<string, unknown>): void;
	};
}

function expandHomePath(path: string): string {
	if (path === "~") {
		return homedir();
	}
	if (path.startsWith("~/")) {
		return join(homedir(), path.slice(2));
	}
	return path;
}

function parseRecord(line: string): ConversationMappingRecord | undefined {
	let parsed: unknown;
	try {
		parsed = JSON.parse(line) as unknown;
	} catch {
		return undefined;
	}

	if (typeof parsed !== "object" || parsed === null) {
		return undefined;
	}
	const typed = parsed as Partial<ConversationMappingRecord>;
	if (
		typed.channel !== "telegram" ||
		typeof typed.conversationKey !== "string" ||
		typeof typed.sessionId !== "string" ||
		typeof typed.chatId !== "number" ||
		typeof typed.updatedAt !== "string"
	) {
		return undefined;
	}
	if (typed.threadId !== undefined && typeof typed.threadId !== "number") {
		return undefined;
	}
	return {
		channel: "telegram",
		chatId: typed.chatId,
		conversationKey: typed.conversationKey,
		sessionId: typed.sessionId,
		...(typed.threadId === undefined ? {} : { threadId: typed.threadId }),
		updatedAt: typed.updatedAt,
	};
}

/**
 * Append-only mapping store for conversation to session routing.
 */
export class ConversationMappingStore {
	readonly #filePath: string;
	readonly #logger:
		| {
				warn(event: string, fields?: Record<string, unknown>): void;
		  }
		| undefined;
	readonly #records = new Map<string, ConversationMappingRecord>();

	public constructor(options: MappingStoreOptions) {
		this.#filePath = expandHomePath(options.filePath);
		this.#logger = options.logger;
		mkdirSync(dirname(this.#filePath), { recursive: true });
	}

	public async init(): Promise<void> {
		this.#records.clear();
		if (!existsSync(this.#filePath)) {
			return;
		}
		const content = await readFile(this.#filePath, "utf8");
		const lines = content.split("\n");
		const lastLineIndex = lines.length - 1;
		for (const [index, line] of lines.entries()) {
			const trimmed = line.trim();
			if (trimmed === "") {
				continue;
			}
			const record = parseRecord(trimmed);
			if (record === undefined) {
				if (index === lastLineIndex) {
					this.#logger?.warn("channels_mapping_partial_line_ignored", {
						filePath: this.#filePath,
						lineIndex: index,
					});
					continue;
				}
				this.#logger?.warn("channels_mapping_record_invalid", {
					filePath: this.#filePath,
					lineIndex: index,
				});
				continue;
			}
			const existing = this.#records.get(record.conversationKey);
			if (existing === undefined || existing.updatedAt.localeCompare(record.updatedAt) <= 0) {
				if (existing !== undefined && existing.sessionId !== record.sessionId) {
					this.#logger?.warn("channels_mapping_conflict_resolved", {
						conversationKey: record.conversationKey,
						nextSessionId: record.sessionId,
						previousSessionId: existing.sessionId,
					});
				}
				this.#records.set(record.conversationKey, record);
			}
		}
	}

	public get(conversationKey: string): ConversationMappingRecord | undefined {
		return this.#records.get(conversationKey);
	}

	public async upsert(record: Omit<ConversationMappingRecord, "updatedAt">): Promise<void> {
		const nextRecord: ConversationMappingRecord = {
			...record,
			updatedAt: new Date().toISOString(),
		};
		this.#records.set(nextRecord.conversationKey, nextRecord);
		await appendFile(this.#filePath, `${JSON.stringify(nextRecord)}\n`, "utf8");
	}
}
