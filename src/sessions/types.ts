import type { Message } from "@mariozechner/pi-ai";

/**
 * Persisted content block used in session records.
 */
export type ContentBlock =
	| {
			text: string;
			type: "text";
	  }
	| {
			arguments: Record<string, unknown>;
			id: string;
			name: string;
			type: "toolCall";
	  };

/**
 * Append-only record persisted in session.jsonl.
 */
export type SessionRecord =
	| {
			content: Array<ContentBlock>;
			isError?: boolean;
			recordType: "message";
			role: "assistant" | "toolResult" | "user";
			schemaVersion: 1;
			seq: number;
			timestamp: string;
			toolCallId?: string;
	  }
	| {
			firstKeptSeq: number;
			modifiedFiles: Array<string>;
			readFiles: Array<string>;
			recordType: "compaction";
			schemaVersion: 1;
			seq: number;
			summary: string;
			timestamp: string;
			tokensBefore: number;
	  };

/**
 * Session metadata persisted in metadata.json.
 */
export interface SessionMetadata {
	createdAt: string;
	cronJobId?: string;
	id: string;
	lastMessageAt: string;
	messageCount: number;
	model: string;
	name: string;
	source: "cron" | "interactive";
	systemPromptOverride?: string;
}

/**
 * Lightweight session list item.
 */
export interface SessionListItem {
	id: string;
	lastMessageAt: string;
	messageCount: number;
	model: string;
	name: string;
	source: "cron" | "interactive";
}

/**
 * Session compaction config.
 */
export interface CompactionSettings {
	enabled: boolean;
	keepRecentTokens: number;
	reserveTokens: number;
}

/**
 * Context result returned for a session.
 */
export interface SessionContext {
	messages: Array<Message>;
	records: Array<SessionRecord>;
}

/**
 * Validates the canonical ULID session-id format.
 */
export function isValidSessionId(value: string): boolean {
	return /^[0-9A-HJKMNP-TV-Z]{26}$/.test(value);
}
