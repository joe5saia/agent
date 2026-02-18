# Specification: Agent Loop & Tool System

The core agent loop and the tool system that provides the agent's capabilities.

**Related documents:**

- [Overview](spec-overview.md) — architecture and design principles
- [Sessions](spec-sessions.md) — session persistence and context building
- [Security](spec-security.md) — command blocklist, env allowlist, path boundaries
- [System Prompt & Observability](spec-system-prompt.md) — prompt assembly and logging

---

## 5. Agent Loop

The agent loop is the core of the system. It follows the pattern established by pi-agent-core but simplified for our needs.

### 5.1 Core Loop

```typescript
interface AgentLoopConfig {
	maxIterations: number; // Default: 20. Hard cap on stream→tool→stream cycles.
}

async function agentLoop(
	messages: Message[],
	tools: Tool[],
	systemPrompt: string,
	model: Model,
	config: AgentLoopConfig,
	signal?: AbortSignal,
	onEvent?: (event: AgentEvent) => void,
): Promise<Message[]> {
	let iterations = 0;

	while (iterations < config.maxIterations) {
		signal?.throwIfAborted();
		iterations++;

		const response = streamSimple(model, {
			systemPrompt,
			messages,
			tools,
			signal,
		});

		// Stream events to caller (for web UI)
		for await (const event of response) {
			onEvent?.({ type: "stream", event });
		}

		const assistantMessage = await response.result();
		messages.push(assistantMessage);

		if (assistantMessage.stopReason !== "toolUse") break;

		// Execute tool calls
		for (const block of assistantMessage.content) {
			if (block.type !== "toolCall") continue;
			signal?.throwIfAborted();

			let result: string;
			let isError = false;

			try {
				result = await executeTool(block.name, block.arguments, signal);
			} catch (e) {
				result = e instanceof Error ? e.message : String(e);
				isError = true;
			}

			const toolResult = {
				role: "toolResult" as const,
				toolCallId: block.id,
				content: [{ type: "text" as const, text: result }],
				isError,
			};

			messages.push(toolResult);
			onEvent?.({ type: "toolResult", toolResult });
		}
	}

	if (iterations >= config.maxIterations) {
		messages.push({
			role: "assistant" as const,
			content: [{ type: "text" as const, text: "Stopped: maximum iteration limit reached." }],
		});
		onEvent?.({ type: "error", message: "Maximum iteration limit reached" });
	}

	return messages;
}
```

### 5.2 Design Principles

1. **Error-as-content** — tool errors are caught and returned to the LLM as error content, never thrown. This lets the LLM retry or try a different approach.
2. **Streaming-first** — partial responses are forwarded to the web UI via the `onEvent` callback as they arrive.
3. **Signal-based cancellation** — `AbortSignal` is passed to both `streamSimple()` and `executeTool()`, propagating through the entire chain for clean cancellation.
4. **Stateless loop** — the loop operates on a `messages` array passed in. Session persistence is handled externally.
5. **Bounded execution** — `maxIterations` prevents infinite tool loops. When the limit is hit, the loop exits with a terminal message. Default is 20 iterations, configurable per session.

### 5.3 Test Scenarios

- **S5.1**: Agent receives a user message with no tools → returns a text response, loop exits after one iteration.
- **S5.2**: Agent calls a tool → tool result is appended → LLM receives tool result and produces final response.
- **S5.3**: Agent calls multiple tools in a single turn → all tool results are collected and sent back.
- **S5.4**: Tool throws an error → error message is returned to LLM with `isError: true` → LLM acknowledges the error.
- **S5.5**: AbortSignal is triggered mid-stream → loop exits cleanly without hanging.
- **S5.6**: Agent enters a multi-turn tool loop (tool → LLM → tool → LLM) → loop continues until LLM produces a text-only response.
- **S5.7**: Agent exceeding `maxIterations` stops and returns a terminal message to the user.
- **S5.8**: AbortSignal is propagated to `streamSimple()` and `executeTool()` — cancelling either aborts the loop.

---

## 6. Tool System

Tools are the agent's capabilities. Each tool is defined with a TypeBox schema for parameter validation and a function for execution.

### 6.1 Tool Definition

```typescript
import { Type, type Static, type TSchema } from "@sinclair/typebox";

type ToolCategory = "read" | "write" | "admin";

interface AgentTool {
	name: string;
	description: string;
	parameters: TSchema;
	category: ToolCategory;
	execute: (args: Record<string, unknown>, signal?: AbortSignal) => Promise<string>;
}
```

**Tool categories** control permission behavior:

| Category | Examples                                           | Interactive                  | Cron                                            |
| -------- | -------------------------------------------------- | ---------------------------- | ----------------------------------------------- |
| `read`   | `read_file`, `list_directory`, `kubectl_get`       | Auto-approved                | Auto-approved                                   |
| `write`  | `write_file`, `bash` (non-destructive)             | Auto-approved                | Allowed only if explicitly listed in job policy |
| `admin`  | `bash` (destructive), `write_file` to system paths | Requires user approval in UI | Blocked by default                              |

TypeBox provides both the JSON Schema (sent to the LLM to describe the tool) and the TypeScript type (for compile-time safety in the execute function) from a single definition.

### 6.2 Built-in Tools

The agent ships with a minimal set of built-in tools:

| Tool             | Category | Description                                                                           |
| ---------------- | -------- | ------------------------------------------------------------------------------------- |
| `bash`           | `write`  | Execute a shell command. Output is truncated at a configurable limit (default 200KB). |
| `read_file`      | `read`   | Read the contents of a file. Path must be within allowed paths.                       |
| `write_file`     | `write`  | Write content to a file. Path must be within allowed paths.                           |
| `list_directory` | `read`   | List files and directories at a given path. Path must be within allowed paths.        |

### 6.3 CLI Tool Registration

Additional tools are registered via configuration. CLI tools use **structured command execution** (`cmd` + `args[]`) — never shell strings — to prevent injection attacks.

```yaml
# ~/.agent/tools.yaml
tools:
  - name: kubectl_get
    description: "Get Kubernetes resources"
    category: read
    cmd: kubectl
    args: ["get", "{{resource}}"]
    optional_args:
      namespace: ["-n", "{{namespace}}"]
    parameters:
      resource:
        type: string
        enum: [pods, services, deployments, configmaps, secrets, nodes, namespaces]
        description: "The resource type"
      namespace:
        type: string
        description: "The Kubernetes namespace"
        pattern: "^[a-z0-9-]+$"
        optional: true

  - name: kubectl_apply
    description: "Apply a Kubernetes manifest"
    category: write
    cmd: kubectl
    args: ["apply", "-f", "{{file}}"]
    parameters:
      file:
        type: string
        description: "Path to the manifest file"
        pattern: "^[a-zA-Z0-9_./-]+$"
```

**Structured execution rules:**

- Commands are executed with `spawn(cmd, args, { shell: false })` — no shell interpretation.
- Template variables are interpolated into individual argument positions, never concatenated into shell strings.
- Parameter values are validated against TypeBox schemas (including `pattern`, `enum`, `maxLength`) before interpolation.
- Each tool declares a `category` for permission enforcement.

### 6.4 Tool Execution Safety

**Subprocess environment (allowlist-based):**

When spawning subprocesses, the agent constructs a **minimal environment** rather than inheriting `process.env`:

```typescript
const ALLOWED_ENV_KEYS = [
	"PATH",
	"HOME",
	"USER",
	"LANG",
	"LC_ALL",
	"TERM",
	"SHELL",
	"TMPDIR",
	"TZ",
];

function buildToolEnv(toolEnv?: Record<string, string>): Record<string, string> {
	const env: Record<string, string> = {};
	for (const key of ALLOWED_ENV_KEYS) {
		if (process.env[key] !== undefined) {
			env[key] = process.env[key];
		}
	}
	// Merge tool-specific env declared in tool definition
	if (toolEnv) {
		Object.assign(env, toolEnv);
	}
	return env;
}
```

Tools may declare additional environment variables they need in the tool definition:

```yaml
tools:
  - name: deploy_app
    category: admin
    cmd: deploy
    args: ["--env", "{{environment}}"]
    env:
      DEPLOY_TOKEN: "${DEPLOY_TOKEN}" # Explicitly passed from host env
```

**Additional safety measures:**

- **Output truncation** — tool output is capped at a configurable limit (default 200KB) to prevent context explosion.
- **Dangerous command blocklist** — commands like `rm`, `sudo`, `shutdown`, `reboot`, `mkfs`, `dd`, `chmod 777` are blocked for the `bash` tool regardless of category. The blocklist is a defense-in-depth layer, not the primary protection (structured execution is). See [Security](spec-security.md#112-runtime-safeguards) for details.
- **Timeout** — tool execution has a configurable timeout (default 120s).

**Filesystem access boundaries:**

Built-in file tools (`read_file`, `write_file`, `list_directory`) enforce path boundaries:

```yaml
# ~/.agent/config.yaml (relevant section)
security:
  allowed_paths:
    - "~/.agent/workspace" # Default workspace
    - "/tmp/agent" # Temporary files
  denied_paths:
    - "~/.ssh" # SSH keys
    - "~/.gnupg" # GPG keys
    - "/etc/shadow" # System credentials
    - "/etc/passwd"
```

- Paths are resolved to absolute paths and checked against allowed/denied lists.
- Denied paths take precedence over allowed paths.
- Symlinks are resolved before checking (prevents symlink escapes).
- Default allowed root: `~/.agent/workspace/**` and `/tmp/agent/**`.
- Cron sessions have the same filesystem restrictions; no elevation.

### 6.5 Test Scenarios

- **S6.1**: Tool with valid parameters executes and returns output.
- **S6.2**: Tool with invalid parameters (fails TypeBox validation) returns a validation error to the LLM.
- **S6.3**: Tool exceeding output limit truncates output with a notice.
- **S6.4**: Tool exceeding timeout is killed and returns a timeout error.
- **S6.5**: Dangerous command (`rm -rf /`) is blocked and returns a rejection message.
- **S6.6**: Subprocess environment contains only allowlisted variables — no API keys, tokens, or secrets leak.
- **S6.7**: CLI tool defined in YAML config is registered and callable by the agent.
- **S6.8**: CLI tool executes with `spawn(cmd, args, { shell: false })` — shell metacharacters in arguments are treated as literal strings.
- **S6.9**: Template injection attempt via parameter value (e.g., `resource: "pods; rm -rf ~"`) is rejected by parameter validation (enum/pattern).
- **S6.10**: `read_file` on a path outside `allowed_paths` returns a permission error.
- **S6.11**: `write_file` on a path in `denied_paths` returns a permission error even if it matches `allowed_paths`.
- **S6.12**: Symlink pointing outside `allowed_paths` is rejected.
- **S6.13**: Tool-specific environment variables declared in the tool definition are passed to the subprocess.
- **S6.14**: `admin`-category tool in cron session is blocked unless explicitly listed in job policy.
