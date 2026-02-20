import { existsSync } from "node:fs";
import { mkdir, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import type { Message } from "@mariozechner/pi-ai";
import { compactSession } from "./compaction.js";
import { appendRecord, readRecords } from "./jsonl.js";
import { recordToMessage, type AppendMessageInput } from "./message-codec.js";
import {
	isValidSessionId,
	type CompactionSettings,
	type SessionContext,
	type SessionListItem,
	type SessionMetadata,
	type SessionMetrics,
	type SessionRecord,
} from "./types.js";

interface CreateSessionOptions {
	cronJobId?: string;
	name?: string;
	source?: "cron" | "interactive";
	systemPromptOverride?: string;
}

export interface SessionTurnMetricsInput {
	durationMs: number;
	inputTokens: number;
	outputTokens: number;
	toolCalls: number;
	totalTokens: number;
}

interface SessionManagerOptions {
	compaction?: CompactionSettings;
	contextWindow?: number;
	defaultModel: string;
	logger?: {
		info(event: string, fields?: Record<string, unknown>): void;
		warn(event: string, fields?: Record<string, unknown>): void;
	};
	sessionsDir?: string;
	summarizeCompaction?: (input: { mode: "initial" | "update"; prompt: string }) => Promise<string>;
}

interface GenerateTitleOptions {
	assistantText: string;
	generate?: (prompt: string) => Promise<string>;
	userText: string;
}

const defaultSessionName = "New Session";
const listConcurrencyLimit = 8;

function defaultSessionMetrics(): SessionMetrics {
	return {
		totalDurationMs: 0,
		totalTokens: 0,
		totalToolCalls: 0,
		totalTurns: 0,
	};
}

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
	readonly #compaction: CompactionSettings;
	readonly #contextWindow: number;
	readonly #defaultModel: string;
	readonly #logger:
		| {
				info(event: string, fields?: Record<string, unknown>): void;
				warn(event: string, fields?: Record<string, unknown>): void;
		  }
		| undefined;
	readonly #locks = new Map<string, Promise<void>>();
	readonly #nextSeqReconciled = new Set<string>();
	readonly #sessionsDir: string;
	readonly #summarizeCompaction:
		| ((input: { mode: "initial" | "update"; prompt: string }) => Promise<string>)
		| undefined;
	readonly #contextCache = new Map<string, SessionContext>();

	public constructor(options: SessionManagerOptions) {
		this.#compaction = options.compaction ?? {
			enabled: true,
			keepRecentTokens: 20_000,
			reserveTokens: 16_384,
		};
		this.#contextWindow = options.contextWindow ?? 200_000;
		this.#defaultModel = options.defaultModel;
		this.#logger = options.logger;
		this.#summarizeCompaction = options.summarizeCompaction;
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
			metrics: defaultSessionMetrics(),
			model: this.#defaultModel,
			name: options.name ?? defaultSessionName,
			nextSeq: 1,
			source: options.source ?? "interactive",
		};
		if (options.cronJobId !== undefined) {
			metadata.cronJobId = options.cronJobId;
		}
		if (options.systemPromptOverride !== undefined) {
			metadata.systemPromptOverride = options.systemPromptOverride;
		}

		await this.#writeMetadataAtomic(id, metadata);
		this.#nextSeqReconciled.add(id);
		return metadata;
	}

	/**
	 * Reads metadata for an existing session.
	 */
	public async get(id: string): Promise<SessionMetadata> {
		this.#assertValidSessionId(id);
		const metadata = await this.#readMetadataLite(id);
		if (this.#nextSeqReconciled.has(id)) {
			return metadata;
		}
		return await this.#withSessionLock(id, async () => {
			const current = await this.#readMetadataLite(id);
			if (this.#nextSeqReconciled.has(id)) {
				return current;
			}
			return await this.#reconcileNextSeqWithinLock(id, current);
		});
	}

	/**
	 * Lists all sessions ordered by last activity descending.
	 */
	public async list(): Promise<Array<SessionListItem>> {
		if (!existsSync(this.#sessionsDir)) {
			return [];
		}

		const entries = await readdir(this.#sessionsDir, { withFileTypes: true });
		const sessionIds = entries
			.filter((entry) => entry.isDirectory() && isValidSessionId(entry.name))
			.map((entry) => entry.name);
		const sessions: Array<SessionListItem> = [];
		let nextIndex = 0;
		const workerCount = Math.min(listConcurrencyLimit, sessionIds.length);

		await Promise.all(
			Array.from({ length: workerCount }, async () => {
				while (nextIndex < sessionIds.length) {
					const currentIndex = nextIndex;
					nextIndex += 1;
					const sessionId = sessionIds[currentIndex];
					if (sessionId === undefined) {
						continue;
					}
					try {
						const metadata = await this.#readMetadataLite(sessionId);
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
			}),
		);

		sessions.sort((left, right) => right.lastMessageAt.localeCompare(left.lastMessageAt));
		return sessions;
	}

	/**
	 * Deletes a session directory recursively.
	 */
	public async delete(id: string): Promise<void> {
		this.#assertValidSessionId(id);
		await rm(this.#resolveSessionDir(id), { force: true, recursive: true });
		this.#contextCache.delete(id);
		this.#nextSeqReconciled.delete(id);
	}

	/**
	 * Appends a message record and updates metadata atomically per session.
	 */
	public async appendMessage(id: string, input: AppendMessageInput): Promise<SessionRecord> {
		this.#assertValidSessionId(id);
		return await this.#withSessionLock(id, async () => {
			let metadata = await this.#readMetadataLite(id);
			if (!this.#nextSeqReconciled.has(id)) {
				metadata = await this.#reconcileNextSeqWithinLock(id, metadata);
			}
			const timestamp = new Date().toISOString();
			const record: SessionRecord = {
				content: input.content,
				recordType: "message",
				role: input.role,
				schemaVersion: 1,
				seq: metadata.nextSeq,
				timestamp,
			};
			if (input.isError !== undefined) {
				record.isError = input.isError;
			}
			if (input.toolCallId !== undefined) {
				record.toolCallId = input.toolCallId;
			}
			if (input.toolName !== undefined) {
				record.toolName = input.toolName;
			}

			let metadataWriteSucceeded = false;
			try {
				await appendRecord(this.#sessionFilePath(id), record);
				await this.#writeMetadataAtomic(id, {
					...metadata,
					lastMessageAt: timestamp,
					messageCount: metadata.messageCount + 1,
					nextSeq: metadata.nextSeq + 1,
				});
				metadataWriteSucceeded = true;
			} finally {
				if (metadataWriteSucceeded) {
					this.#nextSeqReconciled.add(id);
				} else {
					this.#contextCache.delete(id);
					this.#nextSeqReconciled.delete(id);
				}
			}

			const cached = this.#contextCache.get(id);
			if (cached !== undefined) {
				cached.records.push(record);
				cached.messages.push(recordToMessage(record, this.#defaultModel));
			}

			return record;
		});
	}

	/**
	 * Rebuilds LLM messages from persisted session records without mutating persistence.
	 */
	public async buildContext(id: string): Promise<Array<Message>> {
		this.#assertValidSessionId(id);
		const context = await this.getContextWithRecords(id);
		return context.messages;
	}

	/**
	 * Rebuilds LLM messages and performs compaction if the context exceeds budget.
	 */
	public async buildContextForRun(id: string): Promise<Array<Message>> {
		this.#assertValidSessionId(id);
		return await this.#withSessionLock(id, async () => {
			const context = await this.getContextWithRecords(id);
			if (!this.#compaction.enabled) {
				return context.messages;
			}

			const contextTokens = this.#estimateContextTokens(context.messages);
			const limit = this.#contextWindow - this.#compaction.reserveTokens;
			if (contextTokens <= limit) {
				return context.messages;
			}

			let compactedRecord: Extract<SessionRecord, { recordType: "compaction" }> | undefined;
			const compacted = await compactSession(this.#compaction, {
				appendRecord: async (record) => {
					compactedRecord = record;
					await appendRecord(this.#sessionFilePath(id), record);
				},
				estimateTokens: (text: string) => this.#estimateTokens(text),
				...(this.#logger === undefined ? {} : { logger: this.#logger }),
				records: context.records,
				sessionId: id,
				...(this.#summarizeCompaction === undefined
					? {}
					: { summarize: this.#summarizeCompaction }),
			});
			if (!compacted || compactedRecord === undefined) {
				return context.messages;
			}

			const metadata = await this.#readMetadataLite(id);
			if (metadata.nextSeq <= compactedRecord.seq) {
				await this.#writeMetadataAtomic(id, {
					...metadata,
					nextSeq: compactedRecord.seq + 1,
				});
			}

			const refreshed = this.#buildContextFromRecords([...context.records, compactedRecord]);
			this.#contextCache.set(id, refreshed);
			return refreshed.messages;
		});
	}

	/**
	 * Returns reconstructed messages along with raw records.
	 */
	public async getContextWithRecords(id: string): Promise<SessionContext> {
		this.#assertValidSessionId(id);
		const cached = this.#contextCache.get(id);
		if (cached !== undefined) {
			return {
				messages: [...cached.messages],
				records: [...cached.records],
			};
		}

		const records = await readRecords(this.#sessionFilePath(id));
		const context = this.#buildContextFromRecords(records);
		this.#contextCache.set(id, context);
		return {
			messages: [...context.messages],
			records: [...context.records],
		};
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
			const current = await this.#readMetadataLite(id);
			const next = this.#normalizeMetadataForWrite({
				...current,
				...patch,
			});
			await this.#writeMetadataAtomic(id, next);
			return next;
		});
	}

	/**
	 * Aggregates turn-level usage metrics in metadata.json.
	 */
	public async recordTurnMetrics(
		id: string,
		input: SessionTurnMetricsInput,
	): Promise<SessionMetadata> {
		this.#assertValidSessionId(id);
		return await this.#withSessionLock(id, async () => {
			const metadata = await this.#readMetadataLite(id);
			const currentMetrics = metadata.metrics;
			const next: SessionMetadata = {
				...metadata,
				metrics: {
					totalDurationMs: currentMetrics.totalDurationMs + Math.max(0, input.durationMs),
					totalTokens: currentMetrics.totalTokens + Math.max(0, input.totalTokens),
					totalToolCalls: currentMetrics.totalToolCalls + Math.max(0, input.toolCalls),
					totalTurns: currentMetrics.totalTurns + 1,
				},
			};
			await this.#writeMetadataAtomic(id, next);
			return next;
		});
	}

	/**
	 * Generates and persists a session title unless it was explicitly set by the user.
	 */
	public async generateTitle(id: string, options: GenerateTitleOptions): Promise<string> {
		this.#assertValidSessionId(id);
		return await this.#withSessionLock(id, async () => {
			const metadata = await this.#readMetadataLite(id);
			if (metadata.name !== defaultSessionName) {
				return metadata.name;
			}

			const prompt = [
				"Generate a concise conversation title.",
				"Max 6 words. No quotes. Plain text only.",
				`User: ${options.userText}`,
				`Assistant: ${options.assistantText}`,
			].join(String.raw`\n`);

			let title = "";
			try {
				title = options.generate === undefined ? "" : (await options.generate(prompt)).trim();
			} catch {
				title = "";
			}

			const normalized = this.#normalizeTitle(title);
			const finalTitle = normalized === "" ? this.#fallbackTitle(options.userText) : normalized;
			await this.#writeMetadataAtomic(id, { ...metadata, name: finalTitle });
			return finalTitle;
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

	async #readMetadataLite(id: string): Promise<SessionMetadata> {
		const metadataPath = this.#metadataFilePath(id);
		const raw = await readFile(metadataPath, "utf8");
		const metadata = JSON.parse(raw) as SessionMetadata;
		return this.#normalizeMetadataForWrite(metadata);
	}

	#buildContextFromRecords(records: Array<SessionRecord>): SessionContext {
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
			messages.push(recordToMessage(record, this.#defaultModel));
		}

		return {
			messages,
			records: [...records],
		};
	}

	async #reconcileNextSeqWithinLock(
		id: string,
		metadata: SessionMetadata,
	): Promise<SessionMetadata> {
		const records = await readRecords(this.#sessionFilePath(id));
		const inferredFromRecords =
			records.reduce((maxSeq, record) => Math.max(maxSeq, record.seq), 0) + 1;
		const nextSeq = Math.max(metadata.nextSeq, inferredFromRecords);
		let normalized = metadata;
		if (nextSeq !== metadata.nextSeq) {
			normalized = {
				...metadata,
				nextSeq,
			};
			await this.#writeMetadataAtomic(id, normalized);
		}
		this.#nextSeqReconciled.add(id);
		return normalized;
	}

	#normalizeMetadataForWrite(metadata: SessionMetadata): SessionMetadata {
		const messageCount = Number.isFinite(metadata.messageCount) ? metadata.messageCount : 0;
		const inferredNextSeq = Math.max(1, Math.floor(messageCount) + 1);
		const nextSeq =
			typeof metadata.nextSeq === "number" &&
			Number.isFinite(metadata.nextSeq) &&
			metadata.nextSeq > 0
				? Math.floor(metadata.nextSeq)
				: inferredNextSeq;
		const metrics = metadata.metrics ?? defaultSessionMetrics();
		return {
			...metadata,
			metrics,
			nextSeq,
		};
	}

	#estimateContextTokens(messages: Array<Message>): number {
		return messages.reduce((total, message) => {
			const text = (
				Array.isArray(message.content)
					? message.content
					: [{ text: message.content, type: "text" as const }]
			)
				.filter((entry) => entry.type === "text")
				.map((entry) => entry.text)
				.join("\n");
			return total + this.#estimateTokens(text);
		}, 0);
	}

	#estimateTokens(text: string): number {
		return Math.max(1, Math.ceil(text.length / 4));
	}

	#resolveSessionDir(id: string): string {
		return join(this.#sessionsDir, id);
	}

	#sessionFilePath(id: string): string {
		return join(this.#resolveSessionDir(id), "session.jsonl");
	}

	#fallbackTitle(userText: string): string {
		const trimmed = userText.trim();
		if (trimmed.length <= 60) {
			return trimmed.length > 0 ? trimmed : defaultSessionName;
		}

		const sliced = trimmed.slice(0, 60);
		const lastSpace = sliced.lastIndexOf(" ");
		const boundary = lastSpace <= 0 ? sliced : sliced.slice(0, lastSpace);
		return `${boundary.trimEnd()}...`;
	}

	#normalizeTitle(rawTitle: string): string {
		const singleLine = rawTitle.replaceAll(/\s+/g, " ").trim();
		if (singleLine === "") {
			return "";
		}
		return singleLine.split(" ").slice(0, 6).join(" ");
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
		const normalized = this.#normalizeMetadataForWrite(metadata);
		await mkdir(dirname(metadataPath), { recursive: true });
		await writeFile(tempPath, JSON.stringify(normalized, null, 2), "utf8");
		await rename(tempPath, metadataPath);
	}
}

export type { AppendMessageInput, CreateSessionOptions, SessionManagerOptions };
export type { GenerateTitleOptions };
