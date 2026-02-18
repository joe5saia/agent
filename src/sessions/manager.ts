import { existsSync } from "node:fs";
import { mkdir, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import type { Message } from "@mariozechner/pi-ai";
import { appendRecord, readRecords } from "./jsonl.js";
import {
	isValidSessionId,
	type ContentBlock,
	type SessionContext,
	type SessionListItem,
	type SessionMetadata,
	type SessionRecord,
} from "./types.js";

interface CreateSessionOptions {
	cronJobId?: string;
	name?: string;
	source?: "cron" | "interactive";
	systemPromptOverride?: string;
}

interface AppendMessageInput {
	content: Array<ContentBlock>;
	isError?: boolean;
	role: "assistant" | "toolResult" | "user";
	toolCallId?: string;
}

interface SessionManagerOptions {
	defaultModel: string;
	sessionsDir?: string;
}

const defaultSessionName = "New Session";

/**
 * Expands a path that starts with ~/.
 */
function expandHomePath(path: string): string {
	if (path === "~") {
		return homedir();
	}
	if (path.startsWith("~/")) {
		return join(homedir(), path.slice(2));
	}
	return path;
}

/**
 * Generates a ULID-like identifier (26 Crockford-base32 chars).
 */
function generateSessionId(now: number = Date.now()): string {
	const alphabet = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
	let timestamp = now;
	let timePart = "";
	for (let index = 0; index < 10; index += 1) {
		timePart = alphabet[timestamp % 32] + timePart;
		timestamp = Math.floor(timestamp / 32);
	}

	let randomPart = "";
	for (let index = 0; index < 16; index += 1) {
		randomPart += alphabet[Math.floor(Math.random() * alphabet.length)];
	}

	return `${timePart}${randomPart}`;
}

/**
 * Manages session persistence and context reconstruction.
 */
export class SessionManager {
	readonly #defaultModel: string;
	readonly #locks = new Map<string, Promise<void>>();
	readonly #sessionsDir: string;

	public constructor(options: SessionManagerOptions) {
		this.#defaultModel = options.defaultModel;
		this.#sessionsDir = expandHomePath(options.sessionsDir ?? "~/.agent/sessions");
	}

	/**
	 * Creates a new session with empty history and initial metadata.
	 */
	public async create(options: CreateSessionOptions = {}): Promise<SessionMetadata> {
		const id = generateSessionId();
		const timestamp = new Date().toISOString();
		const sessionPath = this.#resolveSessionDir(id);
		await mkdir(sessionPath, { recursive: true });
		await writeFile(this.#sessionFilePath(id), "", "utf8");

		const metadata: SessionMetadata = {
			createdAt: timestamp,
			id,
			lastMessageAt: timestamp,
			messageCount: 0,
			model: this.#defaultModel,
			name: options.name ?? defaultSessionName,
			source: options.source ?? "interactive",
		};
		if (options.cronJobId !== undefined) {
			metadata.cronJobId = options.cronJobId;
		}
		if (options.systemPromptOverride !== undefined) {
			metadata.systemPromptOverride = options.systemPromptOverride;
		}

		await this.#writeMetadataAtomic(id, metadata);
		return metadata;
	}

	/**
	 * Reads metadata for an existing session.
	 */
	public async get(id: string): Promise<SessionMetadata> {
		this.#assertValidSessionId(id);
		const metadataPath = this.#metadataFilePath(id);
		const raw = await readFile(metadataPath, "utf8");
		return JSON.parse(raw) as SessionMetadata;
	}

	/**
	 * Lists all sessions ordered by last activity descending.
	 */
	public async list(): Promise<Array<SessionListItem>> {
		if (!existsSync(this.#sessionsDir)) {
			return [];
		}

		const entries = await readdir(this.#sessionsDir, { withFileTypes: true });
		const sessions: Array<SessionListItem> = [];
		for (const entry of entries) {
			if (!entry.isDirectory()) {
				continue;
			}
			if (!isValidSessionId(entry.name)) {
				continue;
			}
			try {
				const metadata = await this.get(entry.name);
				sessions.push({
					id: metadata.id,
					lastMessageAt: metadata.lastMessageAt,
					messageCount: metadata.messageCount,
					model: metadata.model,
					name: metadata.name,
					source: metadata.source,
				});
			} catch {
				continue;
			}
		}

		sessions.sort((left, right) => right.lastMessageAt.localeCompare(left.lastMessageAt));
		return sessions;
	}

	/**
	 * Deletes a session directory recursively.
	 */
	public async delete(id: string): Promise<void> {
		this.#assertValidSessionId(id);
		await rm(this.#resolveSessionDir(id), { force: true, recursive: true });
	}

	/**
	 * Appends a message record and updates metadata atomically per session.
	 */
	public async appendMessage(id: string, input: AppendMessageInput): Promise<SessionRecord> {
		this.#assertValidSessionId(id);
		return await this.#withSessionLock(id, async () => {
			const records = await readRecords(this.#sessionFilePath(id));
			const latestSeq = records.reduce((maxSeq, record) => Math.max(maxSeq, record.seq), 0);
			const timestamp = new Date().toISOString();
			const record: SessionRecord = {
				content: input.content,
				recordType: "message",
				role: input.role,
				schemaVersion: 1,
				seq: latestSeq + 1,
				timestamp,
			};
			if (input.isError !== undefined) {
				record.isError = input.isError;
			}
			if (input.toolCallId !== undefined) {
				record.toolCallId = input.toolCallId;
			}

			await appendRecord(this.#sessionFilePath(id), record);

			const metadata = await this.get(id);
			await this.#writeMetadataAtomic(id, {
				...metadata,
				lastMessageAt: timestamp,
				messageCount: metadata.messageCount + 1,
			});

			return record;
		});
	}

	/**
	 * Rebuilds LLM messages from persisted session records.
	 */
	public async buildContext(id: string): Promise<Array<Message>> {
		this.#assertValidSessionId(id);
		const context = await this.getContextWithRecords(id);
		return context.messages;
	}

	/**
	 * Returns reconstructed messages along with raw records.
	 */
	public async getContextWithRecords(id: string): Promise<SessionContext> {
		this.#assertValidSessionId(id);
		const records = await readRecords(this.#sessionFilePath(id));
		const latestCompaction = [...records]
			.reverse()
			.find(
				(record): record is Extract<SessionRecord, { recordType: "compaction" }> =>
					record.recordType === "compaction",
			);

		const messages: Array<Message> = [];
		if (latestCompaction !== undefined) {
			messages.push({
				content: [
					{
						text: [
							"The conversation history before this point was compacted into the following summary:",
							"<summary>",
							latestCompaction.summary,
							"</summary>",
						].join("\n"),
						type: "text",
					},
				],
				role: "user",
				timestamp: Date.now(),
			});
		}

		for (const record of records) {
			if (record.recordType !== "message") {
				continue;
			}
			if (latestCompaction !== undefined && record.seq < latestCompaction.firstKeptSeq) {
				continue;
			}
			messages.push(this.#recordToMessage(record));
		}

		return { messages, records };
	}

	/**
	 * Updates metadata using an atomic write.
	 */
	public async updateMetadata(
		id: string,
		patch: Partial<SessionMetadata>,
	): Promise<SessionMetadata> {
		this.#assertValidSessionId(id);
		return await this.#withSessionLock(id, async () => {
			const current = await this.get(id);
			const next: SessionMetadata = {
				...current,
				...patch,
			};
			await this.#writeMetadataAtomic(id, next);
			return next;
		});
	}

	#assertValidSessionId(id: string): void {
		if (!isValidSessionId(id)) {
			throw new Error(`Invalid session ID: ${id}`);
		}
	}

	#metadataFilePath(id: string): string {
		return join(this.#resolveSessionDir(id), "metadata.json");
	}

	#recordToMessage(record: Extract<SessionRecord, { recordType: "message" }>): Message {
		const asTextContent = record.content
			.filter((entry): entry is Extract<ContentBlock, { type: "text" }> => entry.type === "text")
			.map((entry) => ({ text: entry.text, type: "text" as const }));

		if (record.role === "toolResult") {
			return {
				content: asTextContent,
				isError: record.isError ?? false,
				role: "toolResult",
				timestamp: Date.parse(record.timestamp),
				toolCallId: record.toolCallId ?? "",
				toolName: "tool",
			};
		}

		if (record.role === "user") {
			return {
				content: asTextContent,
				role: "user",
				timestamp: Date.parse(record.timestamp),
			};
		}

		const assistantContent = record.content.map((entry) => {
			if (entry.type === "text") {
				return { text: entry.text, type: "text" as const };
			}
			return {
				arguments: entry.arguments,
				id: entry.id,
				name: entry.name,
				type: "toolCall" as const,
			};
		});

		return {
			api: "session",
			content: assistantContent,
			model: this.#defaultModel,
			provider: "session",
			role: "assistant",
			stopReason: "stop",
			timestamp: Date.parse(record.timestamp),
			usage: {
				cacheRead: 0,
				cacheWrite: 0,
				cost: {
					cacheRead: 0,
					cacheWrite: 0,
					input: 0,
					output: 0,
					total: 0,
				},
				input: 0,
				output: 0,
				totalTokens: 0,
			},
		} as Message;
	}

	#resolveSessionDir(id: string): string {
		return join(this.#sessionsDir, id);
	}

	#sessionFilePath(id: string): string {
		return join(this.#resolveSessionDir(id), "session.jsonl");
	}

	async #withSessionLock<T>(id: string, operation: () => Promise<T>): Promise<T> {
		const priorLock = this.#locks.get(id) ?? Promise.resolve();
		let release!: () => void;
		const currentLock = new Promise<void>((resolve) => {
			release = resolve;
		});
		const chainedLock = priorLock.then(async () => await currentLock);
		this.#locks.set(id, chainedLock);

		await priorLock;
		try {
			return await operation();
		} finally {
			release();
			if (this.#locks.get(id) === chainedLock) {
				this.#locks.delete(id);
			}
		}
	}

	async #writeMetadataAtomic(id: string, metadata: SessionMetadata): Promise<void> {
		const metadataPath = this.#metadataFilePath(id);
		const tempPath = `${metadataPath}.tmp`;
		await mkdir(dirname(metadataPath), { recursive: true });
		await writeFile(tempPath, JSON.stringify(metadata, null, 2), "utf8");
		await rename(tempPath, metadataPath);
	}
}

export type { AppendMessageInput, CreateSessionOptions, SessionManagerOptions };
