# Specification: System Prompt, Logging & Error Handling

System prompt assembly, structured logging, observability, and error handling strategy.

**Related documents:**

- [Overview](spec-overview.md) — architecture context
- [Agent Loop & Tools](spec-agent-loop.md) — loop events logged and streamed
- [Sessions](spec-sessions.md) — token metrics stored in session metadata
- [Web Interface](spec-web-interface.md#103-websocket-protocol) — error/status events over WebSocket
- [Security](spec-security.md#114-log-redaction) — log redaction rules
- [Configuration](spec-configuration.md) — logging and retry config schemas

---

## 13. System Prompt & Agent Identity

The system prompt defines who the agent is, what tools it has, and how it should behave. It is assembled dynamically per session from composable layers.

### 13.1 Prompt Layers

The system prompt is constructed by concatenating these layers in order:

```
┌──────────────────────────────────────┐
│  1. Identity         (who you are)   │
│  2. Tool Descriptions (what you can) │
│  3. Workflow Catalog  (structured)   │
│  4. Session Context   (per-session)  │
│  5. Custom Instructions (user file)  │
└──────────────────────────────────────┘
```

1. **Identity** — a static block defining the agent's persona, behavioral rules, and output format preferences. Stored in `~/.agent/config.yaml` under `system_prompt.identity` or loaded from `~/.agent/system-prompt.md`.
2. **Tool Descriptions** — auto-generated from registered tools. Each tool's `name`, `description`, and parameter schema are formatted into the prompt. This layer is managed by the tool system — not hand-written.
3. **Workflow Catalog** — auto-generated from loaded workflow definitions. Lists available workflows, their descriptions, and parameters so the LLM knows it can trigger them.
4. **Session Context** — optional per-session instructions. When creating a session, the user or cron job can provide additional instructions that apply only to that session.
5. **Custom Instructions** — a user-editable markdown file (`~/.agent/instructions.md`) appended last. This allows the user to add persistent instructions without modifying config.

### 13.2 Identity Block

The identity block is the only part of the system prompt that is hand-written. It defines:

```markdown
You are an AI agent running on a dedicated virtual machine.

You have access to the tools listed below to accomplish tasks. Use them proactively.

Rules:

- Always explain what you are about to do before executing a tool.
- If a tool fails, analyze the error and try an alternative approach.
- Never execute destructive operations without confirming the intent is clear.
- When you are done, provide a concise summary of what was accomplished.
```

The identity block is intentionally minimal. The agent is general-purpose — its personality comes from the tools and workflows available to it, not from a long persona description.

### 13.3 Prompt Assembly

```typescript
function buildSystemPrompt(
	session: SessionMetadata,
	tools: AgentTool[],
	workflows: WorkflowDefinition[],
	config: AgentConfig,
): string {
	const parts: string[] = [];

	// 1. Identity
	parts.push(config.systemPrompt.identity);

	// 2. Tools (auto-generated)
	parts.push("## Available Tools\n");
	for (const tool of tools) {
		parts.push(`- **${tool.name}**: ${tool.description}`);
	}

	// 3. Workflows (auto-generated)
	if (workflows.length > 0) {
		parts.push("\n## Available Workflows\n");
		for (const wf of workflows) {
			parts.push(`- **${wf.name}**: ${wf.description}`);
		}
	}

	// 4. Session context (if provided)
	if (session.systemPromptOverride) {
		parts.push(`\n## Session Instructions\n${session.systemPromptOverride}`);
	}

	// 5. Custom instructions file
	if (config.systemPrompt.customInstructions) {
		parts.push(`\n${config.systemPrompt.customInstructions}`);
	}

	return parts.join("\n");
}
```

### 13.4 Configuration

```yaml
# ~/.agent/config.yaml (relevant section)
system_prompt:
  identity_file: "~/.agent/system-prompt.md" # Path to identity block
  custom_instructions_file: "~/.agent/instructions.md" # Optional user instructions
```

**Naming convention:** YAML config uses `snake_case` keys. At load time, the config loader maps these to `camelCase` TypeScript properties (e.g., `system_prompt.identity_file` → `config.systemPrompt.identityFile`). The TypeBox schema defines the YAML-side names; the `Static<typeof Schema>` type produces the runtime type.

### 13.5 Test Scenarios

- **S13.1**: System prompt includes the identity block from config.
- **S13.2**: System prompt includes auto-generated tool descriptions for all registered tools.
- **S13.3**: System prompt includes workflow catalog when workflows are loaded.
- **S13.4**: Per-session system prompt override is appended when provided.
- **S13.5**: Custom instructions file is loaded and appended when the file exists.
- **S13.6**: Custom instructions file missing does not cause an error — the layer is skipped.
- **S13.7**: Tool descriptions update when tools are added or removed without restarting.

---

## 14. Logging & Observability

Structured logging is critical for a VM-based agent that cannot be debugged interactively. Every significant action is logged with machine-parseable context.

### 14.1 Log Format

All logs are structured JSON, one entry per line (JSON Lines), written to `~/.agent/logs/agent.log` and stdout.

```jsonl
{"ts":"2025-02-11T10:00:00.000Z","level":"info","module":"agent-loop","event":"turn_start","sessionId":"abc123","model":"claude-sonnet-4-20250514"}
{"ts":"2025-02-11T10:00:01.500Z","level":"info","module":"agent-loop","event":"tool_call","sessionId":"abc123","tool":"bash","args":{"command":"kubectl get pods"},"durationMs":1200}
{"ts":"2025-02-11T10:00:03.000Z","level":"info","module":"agent-loop","event":"turn_end","sessionId":"abc123","inputTokens":1500,"outputTokens":320,"totalTokens":1820,"durationMs":3000}
```

### 14.2 Log Levels

| Level   | Usage                                                                                                     |
| ------- | --------------------------------------------------------------------------------------------------------- |
| `error` | Unrecoverable failures: LLM provider errors after all retries, config parse failures, process crashes     |
| `warn`  | Recoverable issues: rate limits (before retry), tool timeouts, truncated output, deprecated config fields |
| `info`  | Normal operations: turn start/end, tool calls, cron job execution, session creation, config reload        |
| `debug` | Verbose diagnostics: full tool output, message payloads, WebSocket frame details                          |

### 14.3 Logged Events

| Event                   | Level | Fields                                                                                   |
| ----------------------- | ----- | ---------------------------------------------------------------------------------------- |
| `turn_start`            | info  | `sessionId`, `model`, `messageCount`                                                     |
| `turn_end`              | info  | `sessionId`, `inputTokens`, `outputTokens`, `totalTokens`, `durationMs`, `toolCallCount` |
| `tool_call`             | info  | `sessionId`, `tool`, `durationMs`, `isError`                                             |
| `tool_blocked`          | warn  | `sessionId`, `tool`, `command`, `reason`                                                 |
| `tool_timeout`          | warn  | `sessionId`, `tool`, `timeoutMs`                                                         |
| `tool_output_truncated` | warn  | `sessionId`, `tool`, `originalSize`, `truncatedSize`                                     |
| `cron_start`            | info  | `jobId`, `sessionId`, `schedule`                                                         |
| `cron_end`              | info  | `jobId`, `sessionId`, `status`, `durationMs`                                             |
| `cron_error`            | error | `jobId`, `error`                                                                         |
| `session_created`       | info  | `sessionId`, `source`                                                                    |
| `session_compacted`     | info  | `sessionId`, `removedMessages`, `summaryTokens`                                          |
| `config_reload`         | info  | `changedSections`                                                                        |
| `provider_error`        | error | `provider`, `statusCode`, `error`, `retryAttempt`                                        |
| `provider_rate_limit`   | warn  | `provider`, `retryAfterMs`                                                               |
| `ws_connect`            | info  | `clientId`, `sessionId`                                                                  |
| `ws_disconnect`         | info  | `clientId`, `reason`                                                                     |
| `server_start`          | info  | `host`, `port`, `version`                                                                |

### 14.4 Token Usage Tracking

Token usage is tracked per turn and aggregated per session:

```typescript
interface TokenUsage {
	inputTokens: number;
	outputTokens: number;
	totalTokens: number;
}

interface SessionMetrics {
	sessionId: string;
	totalTurns: number;
	totalTokens: TokenUsage;
	totalToolCalls: number;
	totalDurationMs: number;
}
```

Token usage is extracted from the `pi-ai` response metadata and logged at `turn_end`. Session-level aggregates are stored in `metadata.json` for the web UI to display.

### 14.5 Log Rotation

- Logs rotate daily: `agent.log` → `agent.2025-02-11.log`.
- Retention: 30 days (configurable).
- Maximum file size: 100MB per file (configurable). Rotates early if exceeded.

### 14.6 Configuration

```yaml
# ~/.agent/config.yaml (relevant section)
logging:
  level: "info" # Minimum log level
  file: "~/.agent/logs/agent.log" # Log file path
  stdout: true # Also log to stdout
  rotation:
    max_days: 30
    max_size_mb: 100
```

### 14.7 Test Scenarios

- **S14.1**: Agent loop emits `turn_start` and `turn_end` log entries for every turn.
- **S14.2**: Tool calls are logged with tool name, duration, and error status.
- **S14.3**: Token usage (input, output, total) is included in `turn_end` log entries.
- **S14.4**: Cron job execution is logged with `cron_start` and `cron_end` events.
- **S14.5**: Provider errors are logged with provider name, status code, and retry attempt number.
- **S14.6**: Log entries are valid JSON — parseable by `JSON.parse`.
- **S14.7**: Log level filtering works: `debug` events are not written when level is `info`.
- **S14.8**: Blocked tool execution is logged with the reason for rejection.
- **S14.9**: Log rotation creates a new file when the date changes or size limit is exceeded.
- **S14.10**: Log entries pass through redaction — secret-like values are replaced with `[REDACTED]` (see [§11.4](spec-security.md#114-log-redaction)).

---

## 15. Error Handling Strategy

Errors are categorized by source and handled with appropriate retry, backoff, and user-facing behavior.

### 15.1 Error Categories

| Category               | Examples                                                  | Retry                                 | User Surfacing                           |
| ---------------------- | --------------------------------------------------------- | ------------------------------------- | ---------------------------------------- |
| **Provider transient** | 429 rate limit, 503 service unavailable, network timeout  | Yes — exponential backoff             | "Retrying..." status via WebSocket       |
| **Provider permanent** | 401 invalid key, 400 bad request, unsupported model       | No                                    | Error message via WebSocket              |
| **Tool failure**       | Non-zero exit code, timeout, blocked command              | No (returned to LLM as error content) | `tool_result` event with `isError: true` |
| **Config error**       | Invalid YAML, missing required field, bad cron expression | No                                    | Fail startup or log error on reload      |
| **Internal error**     | Uncaught exception, JSONL corruption, OOM                 | No                                    | Error message via WebSocket; logged      |

### 15.2 Provider Retry Strategy

LLM provider errors use exponential backoff with jitter:

```typescript
interface RetryConfig {
	maxRetries: number; // Default: 3
	baseDelayMs: number; // Default: 1000 (1s)
	maxDelayMs: number; // Default: 30000 (30s)
	retryableStatuses: number[]; // [429, 500, 502, 503, 529]
}

function calculateDelay(attempt: number, config: RetryConfig): number {
	const exponential = config.baseDelayMs * Math.pow(2, attempt);
	const capped = Math.min(exponential, config.maxDelayMs);
	const jitter = capped * (0.5 + Math.random() * 0.5);
	return jitter;
}
```

Rate limit responses (429) with a `retry-after` header use the header value instead of the calculated delay.

### 15.3 Error Flow Through WebSocket

When an error occurs during an agent turn, the web UI receives it as a structured event:

```typescript
// Already defined in §10.3 — the "error" server message type
{
	type: "error";
	sessionId: string;
	message: string;
}
```

Retry status is communicated via a new event type:

```typescript
{
	type: "status";
	sessionId: string;
	message: string;
}
// Example: { type: "status", sessionId: "abc", message: "Rate limited. Retrying in 3s..." }
```

### 15.4 Graceful Degradation

- **Provider down**: if all retries fail, the error is returned to the user via WebSocket. The session remains usable — the user can retry by sending another message.
- **Tool timeout**: the tool is killed, and a timeout error is returned to the LLM as tool result content. The LLM can decide to retry or inform the user.
- **Cron job failure**: the error is logged and the job continues on its next scheduled execution. Consecutive failures are tracked in the job's metadata.

### 15.5 Configuration

```yaml
# ~/.agent/config.yaml (relevant section)
retry:
  max_retries: 3
  base_delay_ms: 1000
  max_delay_ms: 30000
  retryable_statuses: [429, 500, 502, 503, 529]
```

### 15.6 Test Scenarios

- **S15.1**: Provider 429 response triggers retry with exponential backoff.
- **S15.2**: Provider 429 with `retry-after` header uses the header value as the delay.
- **S15.3**: Provider 401 (invalid key) fails immediately without retrying.
- **S15.4**: Maximum retries exceeded returns an error to the user via WebSocket.
- **S15.5**: Retry attempts are logged with attempt number and delay.
- **S15.6**: `status` WebSocket event is sent during retry wait periods.
- **S15.7**: Session remains usable after a provider error — user can send another message.
- **S15.8**: Cron job failure is logged; the job fires again on the next schedule.
- **S15.9**: Network timeout (no response) is treated as a retryable error.
