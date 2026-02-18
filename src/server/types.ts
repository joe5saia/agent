import type { Message, Api, Model, Provider } from "@mariozechner/pi-ai";
import type { AgentEvent, AgentLoopConfig } from "../agent/index.js";
import type { AgentConfig } from "../config/index.js";
import type { Logger } from "../logging/index.js";
import type { SessionManager, SessionMetadata } from "../sessions/index.js";
import type { ToolRegistry } from "../tools/index.js";

export interface ServerDependencies {
	apiKeyResolver?: (provider: Provider) => Promise<string | undefined>;
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
	systemPromptBuilder: (session: SessionMetadata) => string;
	toolRegistry: ToolRegistry;
}

export interface ServerAppContext {
	config: AgentConfig;
	deps: ServerDependencies;
}

export interface WsServerEvent {
	payload: Record<string, unknown>;
	sessionId: string;
	type:
		| "error"
		| "message_complete"
		| "run_start"
		| "session_renamed"
		| "status"
		| "stream_delta"
		| "tool_result"
		| "tool_start";
}
