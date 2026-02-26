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

The system prompt defines agent behavior and voice. It is assembled per turn from universal Markdown files stored in `~/.agent/`, then enriched with runtime-generated capability context.

### 13.1 Universal Prompt Files

The runtime uses one universal prompt pair for all sessions:

- **System document** — `~/.agent/system.md`
- **Soul document** — `~/.agent/soul.md`

This model intentionally removes profile-level prompt variants. Every session uses the same baseline instruction set unless a per-session override is explicitly provided.

### 13.2 Prompt Layers

The system prompt is constructed by concatenating these layers in order:

```
┌────────────────────────────────────────────────────────┐
│  1. System Document      (capabilities + hard rules)  │
│  2. Tool Descriptions    (auto-generated)             │
│  3. Workflow Catalog     (auto-generated)             │
│  4. Skills Catalog       (auto-generated)             │
│  5. Active Skills        (selected skill bodies)      │
│  6. Active Skill Resources (selected excerpts)        │
│  7. Soul Document        (interaction style)          │
│  8. Session Context      (per-session override)       │
│  9. Custom Instructions  (optional compatibility)     │
└────────────────────────────────────────────────────────┘
```

Layer responsibilities:

1. **System Document** — non-negotiable operating constraints, capability framing, tool-use policy, and completion criteria.
2. **Tool Descriptions** — generated from registered tools (`name`, `description`, parameter schema).
3. **Workflow Catalog** — generated from loaded workflows so the model knows what can be invoked structurally.
4. **Skills Catalog** — generated from loaded `SKILL.md` frontmatter metadata.
5. **Active Skills** — instruction bodies for explicitly requested or relevant skills only.
6. **Active Skill Resources** — on-demand excerpts from bundled resources (`references/`, `scripts/`, linked local files) selected per-turn from active skills.
7. **Soul Document** — personality and communication style constraints that do not loosen system or safety rules.
8. **Session Context** — optional session-specific instructions (`systemPromptOverride`).
9. **Custom Instructions** — optional compatibility layer for existing installs using `custom_instructions_file`.

### 13.3 System vs Soul Contract

`system.md` and `soul.md` are both required by default, but they have different purposes:

| File                 | Required content                                                                     | Forbidden content                                                                |
| -------------------- | ------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------- |
| `~/.agent/system.md` | Task execution rules, tool behavior expectations, safety boundaries, output contract | Personality embellishments that weaken clarity of hard constraints               |
| `~/.agent/soul.md`   | Tone, interpersonal behavior, pacing, concision style, collaboration posture         | Any instruction that overrides safety, policy, tool constraints, or system rules |

### 13.4 Precedence Rules

Prompt precedence is strict:

1. System/safety/tool constraints win over all lower layers.
2. Runtime capability sections (tools/workflows/skills) win over soul/style instructions when they conflict.
3. Soul/style instructions apply only when they do not conflict with layers 1-2.
4. Session overrides may add context but may not disable safety/tool policy constraints.

The runtime inserts a fixed delimiter before the soul layer:

```markdown
## Style Directives (Subordinate to System Rules)

If style guidance conflicts with system, safety, or tool constraints above, follow the constraints above.
```

### 13.5 Configuration

```yaml
# ~/.agent/config.yaml (relevant section)
system_prompt:
  system_file: "~/.agent/system.md" # Universal system prompt file
  soul_file: "~/.agent/soul.md" # Universal personality prompt file
  strict_prompt_files: true # Missing/unreadable prompt files are fatal when true
  custom_instructions_file: "~/.agent/instructions.md" # Optional compatibility layer
  identity_file: "~/.agent/system-prompt.md" # Deprecated fallback key
```

Compatibility and precedence:

- If `system_file`/`soul_file` are configured (or defaulted), universal file mode is active.
- If legacy `identity_file` is configured without universal keys, runtime enters compatibility mode and maps `identity_file` to the system layer.
- If both new and legacy keys exist, new keys win and a deprecation warning is logged for legacy keys.

### 13.6 Prompt Assembly Algorithm

```typescript
function buildPromptLayers(input: PromptBuildInput): string {
	const systemText = readRequiredOrFallback({
		fallback: defaultSystemPrompt,
		path: input.config.systemPrompt.systemFile,
		strict: input.config.systemPrompt.strictPromptFiles,
	});
	const soulText = readRequiredOrFallback({
		fallback: defaultSoulPrompt,
		path: input.config.systemPrompt.soulFile,
		strict: input.config.systemPrompt.strictPromptFiles,
	});

	const parts = [
		systemText,
		buildToolsSection(input.tools),
		buildWorkflowsSection(input.workflows),
		buildSkillsCatalogSection(input.skills),
		buildActiveSkillsSection(input.activeSkills),
		buildActiveSkillResourcesSection(input.activeSkillResources),
		[
			"## Style Directives (Subordinate to System Rules)",
			"If style guidance conflicts with system, safety, or tool constraints above, follow the constraints above.",
			soulText,
		].join("\n"),
		buildSessionOverrideSection(input.session.systemPromptOverride),
		readOptionalFile(input.config.systemPrompt.customInstructionsFile),
	].filter((part) => part !== undefined && part.trim() !== "");

	return `${parts.join("\n\n")}\n`;
}
```

### 13.7 File Reload and Runtime Behavior

- Prompt files are loaded during startup and on runtime config reload.
- Changes to `~/.agent/system.md` or `~/.agent/soul.md` are picked up by the existing debounced file-watch reload pipeline.
- Reload semantics:
  - **Success path:** new prompt fragments become active for the next turn.
  - **Failure path (`strict_prompt_files=true`):** reload is rejected, last known-good prompt state remains active, and `config_reload_failed` is logged.
  - **Failure path (`strict_prompt_files=false`):** missing/unreadable files fall back to defaults, and a warning is logged.

### 13.8 Migration Strategy

Migration is additive and non-breaking:

1. Introduce new config keys and defaults (`system_file`, `soul_file`, `strict_prompt_files`).
2. Keep legacy `identity_file` and `custom_instructions_file` support for one compatibility window.
3. Emit warning logs on legacy key usage with a documented removal milestone.
4. Remove legacy keys after the compatibility window and release-note the breaking change.

### 13.9 Test Scenarios

Unit tests (`test/system-prompt.test.ts`):

- **S13.1**: Prompt includes text from `system_file`.
- **S13.2**: Prompt includes text from `soul_file`.
- **S13.3**: Prompt includes the style-precedence delimiter before the soul document.
- **S13.4**: Tool descriptions are included for all registered tools.
- **S13.5**: Workflow catalog appears when workflows are present.
- **S13.6**: Skills catalog appears when valid skills are loaded.
- **S13.7**: Active skill bodies are included only for selected skills.
- **S13.8**: Active skill resource excerpts are included only for selected resources.
- **S13.9**: Session override appears after soul/style directives.
- **S13.10**: Custom instructions append last when configured and present.

Failure and compatibility tests (`test/system-prompt.test.ts`, `test/config.test.ts`):

- **S13.11**: `strict_prompt_files=true` + missing `system_file` fails prompt preparation.
- **S13.12**: `strict_prompt_files=true` + missing `soul_file` fails prompt preparation.
- **S13.12**: `strict_prompt_files=false` + missing file uses default fallback and logs warning.
- **S13.13**: Legacy `identity_file`-only config still builds prompts in compatibility mode.
- **S13.14**: New keys override `identity_file` when both are configured.
- **S13.15**: Legacy key usage emits deprecation warning logs.

Runtime reload tests (`test/index.test.ts`, `test/server.test.ts`):

- **S13.16**: Editing `~/.agent/system.md` triggers debounced reload and updates next-turn prompt.
- **S13.17**: Editing `~/.agent/soul.md` triggers debounced reload and updates next-turn prompt.
- **S13.18**: Reload failure in strict mode retains last known-good prompt state and logs `config_reload_failed`.

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
