import type {
	Api,
	AssistantMessageEvent,
	Context,
	Message,
	Model,
	Provider,
	SimpleStreamOptions,
} from "@mariozechner/pi-ai";

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
	maxIterations: number;
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
			toolResult: Extract<Message, { role: "toolResult" }>;
			type: "toolResult";
	  };
