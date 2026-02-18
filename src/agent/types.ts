import type {
	Api,
	AssistantMessageEvent,
	Context,
	Message,
	Model,
	Provider,
	SimpleStreamOptions,
} from "@mariozechner/pi-ai";
import type { RetryConfig, RetryStatusEvent } from "./retry.js";

/**
 * Stream interface returned by streamSimple, abstracted for testability.
 */
export interface AssistantMessageEventStreamLike extends AsyncIterable<AssistantMessageEvent> {
	result: () => Promise<Extract<Message, { role: "assistant" }>>;
}

/**
 * Agent loop runtime configuration.
 */
export interface AgentLoopConfig {
	apiKeyResolver?: (provider: Provider) => Promise<string | undefined>;
	logger?: {
		error(event: string, fields?: Record<string, unknown>): void;
		info(event: string, fields?: Record<string, unknown>): void;
		warn(event: string, fields?: Record<string, unknown>): void;
	};
	maxIterations: number;
	onStatus?: (event: RetryStatusEvent) => void;
	onTurnComplete?: (event: {
		durationMs: number;
		inputTokens: number;
		outputTokens: number;
		toolCalls: number;
		totalTokens: number;
	}) => void;
	retry?: RetryConfig;
	runId?: string;
	sessionId?: string;
	streamFactory?: (
		model: Model<Api>,
		context: Context,
		options?: SimpleStreamOptions,
	) => AssistantMessageEventStreamLike;
}

/**
 * Events emitted during an agent loop run.
 */
export type AgentEvent =
	| {
			event: AssistantMessageEvent;
			type: "stream";
	  }
	| {
			message: string;
			type: "error";
	  }
	| {
			status: RetryStatusEvent;
			type: "status";
	  }
	| {
			toolResult: Extract<Message, { role: "toolResult" }>;
			type: "toolResult";
	  };
