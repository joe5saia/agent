# Specification: Configuration & Session UX

Configuration validation with TypeBox schemas, and session naming and listing UX.

**Related documents:**

- [Technology Stack](spec-technology-stack.md) — TypeBox and YAML dependencies
- [Security](spec-security.md#122-configuration) — full config.yaml example
- [Sessions](spec-sessions.md) — session metadata and listing
- [Web Interface](spec-web-interface.md) — session list API and WebSocket rename events
- [System Prompt & Observability](spec-system-prompt.md#146-configuration) — logging and retry config

---

## 17. Configuration Validation

All YAML configuration files are validated at load time using TypeBox schemas. Invalid configuration fails fast with clear error messages.

### 17.1 Config Schema

```typescript
import { Type, type Static } from "@sinclair/typebox";

const ModelConfigSchema = Type.Object({
	provider: Type.String(),
	name: Type.String(),
});

const ServerConfigSchema = Type.Object({
	host: Type.String({ default: "127.0.0.1" }),
	port: Type.Number({ minimum: 1, maximum: 65535, default: 8080 }),
});

const ToolLimitsSchema = Type.Object({
	output_limit: Type.Number({ minimum: 1024, default: 200000 }),
	timeout: Type.Number({ minimum: 5, default: 120 }),
	max_iterations: Type.Number({ minimum: 1, default: 20 }),
});

const LoggingConfigSchema = Type.Object({
	level: Type.Union(
		[Type.Literal("error"), Type.Literal("warn"), Type.Literal("info"), Type.Literal("debug")],
		{ default: "info" },
	),
	file: Type.String({ default: "~/.agent/logs/agent.log" }),
	stdout: Type.Boolean({ default: true }),
	rotation: Type.Object({
		max_days: Type.Number({ minimum: 1, default: 30 }),
		max_size_mb: Type.Number({ minimum: 1, default: 100 }),
	}),
});

const RetryConfigSchema = Type.Object({
	max_retries: Type.Number({ minimum: 0, default: 3 }),
	base_delay_ms: Type.Number({ minimum: 100, default: 1000 }),
	max_delay_ms: Type.Number({ minimum: 1000, default: 30000 }),
	retryable_statuses: Type.Array(Type.Number(), { default: [429, 500, 502, 503, 529] }),
});

const SecurityConfigSchema = Type.Object({
	blocked_commands: Type.Array(Type.String()),
	allowed_env: Type.Array(Type.String(), {
		default: ["PATH", "HOME", "USER", "LANG", "LC_ALL", "TERM", "SHELL", "TMPDIR", "TZ"],
	}),
	allowed_paths: Type.Array(Type.String(), {
		default: ["~/.agent/workspace", "/tmp/agent"],
	}),
	denied_paths: Type.Array(Type.String(), {
		default: ["~/.ssh", "~/.gnupg", "/etc/shadow", "/etc/passwd"],
	}),
	allowed_users: Type.Array(Type.String(), { default: [] }),
});

const SystemPromptConfigSchema = Type.Object({
	identity_file: Type.String({ default: "~/.agent/system-prompt.md" }),
	custom_instructions_file: Type.Optional(Type.String()),
});

const CompactionConfigSchema = Type.Object({
	enabled: Type.Boolean({ default: true }),
	reserve_tokens: Type.Number({ minimum: 1024, default: 16384 }),
	keep_recent_tokens: Type.Number({ minimum: 1024, default: 20000 }),
});

const AgentConfigSchema = Type.Object({
	model: ModelConfigSchema,
	server: ServerConfigSchema,
	tools: ToolLimitsSchema,
	logging: LoggingConfigSchema,
	retry: RetryConfigSchema,
	security: SecurityConfigSchema,
	system_prompt: SystemPromptConfigSchema,
	compaction: CompactionConfigSchema,
});

type AgentConfig = Static<typeof AgentConfigSchema>;
```

### 17.2 Validation Flow

```typescript
import { Value } from "@sinclair/typebox/value";
import { parse as parseYaml } from "yaml";

function loadConfig(path: string): AgentConfig {
	const raw = fs.readFileSync(path, "utf-8");
	const parsed = parseYaml(raw);

	// Apply defaults
	const withDefaults = Value.Default(AgentConfigSchema, parsed);

	// Validate
	if (!Value.Check(AgentConfigSchema, withDefaults)) {
		const errors = [...Value.Errors(AgentConfigSchema, withDefaults)];
		const formatted = errors.map((e) => `  - ${e.path}: ${e.message}`).join("\n");
		throw new Error(`Invalid configuration:\n${formatted}`);
	}

	return withDefaults as AgentConfig;
}
```

### 17.3 Default Configuration

When no `config.yaml` exists, the agent starts with sensible defaults:

| Setting              | Default                 |
| -------------------- | ----------------------- |
| `model.provider`     | (required — no default) |
| `model.name`         | (required — no default) |
| `server.host`        | `127.0.0.1`             |
| `server.port`        | `8080`                  |
| `tools.output_limit` | `200000` (bytes)        |
| `tools.timeout`      | `120` (seconds)         |
| `logging.level`      | `info`                  |
| `retry.max_retries`  | `3`                     |

Model provider and name are required — the agent cannot start without knowing which LLM to use.

### 17.4 Test Scenarios

- **S17.1**: Valid config file loads and returns a typed `AgentConfig` object.
- **S17.2**: Missing optional fields are filled with defaults.
- **S17.3**: Invalid port number (e.g., 99999) produces a clear error message.
- **S17.4**: Missing required field (`model.provider`) produces a clear error message.
- **S17.5**: Extra fields in the YAML are ignored (no strict object validation).
- **S17.6**: Config with invalid YAML syntax produces a parse error with line number.
- **S17.7**: Default config is used when no config file exists, except for required fields.
- **S17.8**: Config reload validates the new config before applying it.

---

## 18. Session Naming & Listing UX

Sessions need human-readable names for the web UI sidebar. Names are generated automatically and can be overridden by the user.

### 18.1 Naming Strategy

Sessions get their titles through a priority cascade:

1. **User-provided name** — if the user sets a name explicitly (via API or UI), it is used as-is.
2. **LLM-generated summary** — after the first assistant response completes, the agent asks the LLM to generate a short title (≤ 6 words) from the first user message and assistant response.
3. **Truncated first message** — fallback if LLM summarization fails. The first 60 characters of the first user message, truncated at word boundary, with `...` appended.
4. **Default** — `"New Session"` until the first user message arrives.

### 18.2 Title Generation

```typescript
async function generateSessionTitle(
	firstUserMessage: string,
	firstAssistantResponse: string,
	model: Model,
): Promise<string> {
	const response = await complete(model, {
		systemPrompt:
			"Generate a concise title (6 words max) for this conversation. " +
			"Return only the title text, nothing else.",
		messages: [
			{ role: "user", content: firstUserMessage },
			{ role: "assistant", content: firstAssistantResponse },
		],
	});
	return response.content.trim();
}
```

Title generation:

- Runs asynchronously after the first turn completes — does not block the response.
- Uses the same model as the session (no separate cheap model needed; the call is trivially small).
- Updates `metadata.json` with the generated name.
- Fires a `session_renamed` WebSocket event so the UI updates in real time.

### 18.3 Session Listing

`GET /api/sessions` returns sessions sorted by `lastMessageAt` descending:

```typescript
interface SessionListItem {
	id: string;
	name: string;
	lastMessageAt: string; // ISO 8601
	messageCount: number;
	source: "interactive" | "cron";
	model: string;
}
```

The web UI sidebar displays the session list with the name and a relative timestamp (e.g., "2 hours ago").

### 18.4 Cron Session Naming

Cron-triggered sessions are named automatically using the job ID and timestamp:

```
"[cron] daily-report — 2025-02-11 09:00"
```

These sessions are visually distinguished in the UI (e.g., prefixed with a clock icon or tagged as "Scheduled").

### 18.5 Test Scenarios

- **S18.1**: New session has name `"New Session"` before any messages.
- **S18.2**: After the first turn, session name is updated with an LLM-generated title.
- **S18.3**: LLM-generated title is ≤ 6 words.
- **S18.4**: If LLM title generation fails, the truncated first message is used.
- **S18.5**: User-provided name overrides the auto-generated name.
- **S18.6**: Cron sessions are named with the job ID and timestamp.
- **S18.7**: Session list is sorted by `lastMessageAt` descending.
- **S18.8**: `session_renamed` WebSocket event is emitted when a session name changes.
- **S18.9**: Title generation does not block the first assistant response.
