import type { Api, Message, Model, Provider } from "@mariozechner/pi-ai";
import type { AgentEvent, AgentLoopConfig } from "../agent/index.js";
import type { AgentConfig } from "../config/index.js";
import type { Logger } from "../logging/index.js";
import type { SessionManager, SessionMetadata } from "../sessions/index.js";
import type { ToolRegistry } from "../tools/index.js";

/**
 * Normalized inbound payload accepted by channel runtimes.
 */
export interface InboundEnvelope {
	accountId: string;
	channel: "telegram";
	content: {
		media?: Array<{
			type: "audio" | "document" | "image" | "video";
			url: string;
		}>;
		text: string;
	};
	conversationKey: string;
	messageId: string;
	meta: {
		rawUpdateId?: number;
		receivedAt: string;
		threadKey?: string;
	};
	replyTo?: {
		messageId: string;
		senderId?: string;
		text?: string;
	};
	transport: {
		chatId: number;
		messageThreadId?: number;
		replyToMessageId?: number;
	};
	user: {
		displayName?: string;
		id: string;
		isBot?: boolean;
		username?: string;
	};
}

/**
 * Outbound channel payload emitted by the runner.
 */
export interface OutboundEnvelope {
	accountId: string;
	channel: "telegram";
	conversationKey: string;
	parts: Array<
		| { text: string; type: "status" | "text" | "tool_event" }
		| { messageId?: number; text: string; type: "stream_delta" }
	>;
	runId: string;
	threadKey?: string;
	transport: {
		chatId: number;
		messageThreadId?: number;
		replyToMessageId?: number;
	};
}

/**
 * Delivery result metadata from a channel runtime.
 */
export interface DeliveryResult {
	error?: string;
	messageIds: Array<number>;
	ok: boolean;
}

/**
 * Core runtime interface each channel provider must implement.
 */
export interface ChannelRuntime {
	send(event: OutboundEnvelope): Promise<DeliveryResult>;
	start(signal?: AbortSignal): Promise<void>;
	stop(): Promise<void>;
}

/**
 * Optional hook adapter for channel runtime observability/testing.
 */
export interface ChannelRuntimeHooks {
	onInbound?: (event: InboundEnvelope) => void;
	onOutbound?: (event: OutboundEnvelope) => void;
}

/**
 * Shared runtime dependencies required by channel providers.
 */
export interface ChannelRuntimeDependencies {
	apiKeyResolver?: (provider: Provider) => Promise<string | undefined>;
	config: AgentConfig;
	logger: Logger;
	model: Model<Api>;
	runAgentLoop?: (
		messages: Array<Message>,
		tools: ToolRegistry,
		systemPrompt: string,
		model: Model<Api>,
		config: AgentLoopConfig,
		signal?: AbortSignal,
		onEvent?: (event: AgentEvent) => void,
	) => Promise<Array<Message>>;
	sessionManager: SessionManager;
	systemPromptBuilder: (session: SessionMetadata, userText?: string) => string;
	toolRegistry: ToolRegistry;
}
