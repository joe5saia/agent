# Research Findings: Inspiration Projects

This document captures architectural patterns and design decisions from the three projects referenced in [spec.md](spec.md). The goal is to inform the design of our minimal agent.

---

## Table of Contents

- [1. Craft Agents](#1-craft-agents)
- [2. OpenClaw](#2-openclaw)
- [3. Pi-Mono](#3-pi-mono)
- [4. Cross-Project Comparison](#4-cross-project-comparison)
- [5. Key Takeaways for Our Agent](#5-key-takeaways-for-our-agent)

---

## 1. Craft Agents

**Repository:** [lukilabs/craft-agents-oss](https://github.com/lukilabs/craft-agents-oss)  
**License:** Apache 2.0  
**Stack:** TypeScript, Electron, React, Vite, Tailwind CSS, Claude Agent SDK

### 1.1 Tool Registration & Execution

Craft Agents supports three categories of tools:

1. **Built-in CLI Tools** — Read, Edit, Write, Bash, Glob, Grep, Diff. Registered natively in the Claude SDK via a `tool()` wrapper. Validated for path traversal and command injection.
2. **MCP Servers** — 32+ integrations (GitHub, Linear, Notion, etc.) loaded dynamically from a `SourceManager`. Supports two transports:
   - HTTP/SSE for remote servers with optional OAuth
   - stdio for local subprocesses with environment variable filtering (blocks `ANTHROPIC_API_KEY`, `AWS_*`, etc.)
3. **API Tools** — Dynamically generated from OpenAPI specs or custom configs via `createApiServer()`. Auto-injects credentials (bearer, basic auth, multi-header). Handles binary responses with size limits (500MB max).

### 1.2 Permission & Safety Model

- **PreToolUse Hook** validates tool calls before execution:
  - Bash commands: whitelist/blacklist via regex patterns
  - File writes: glob path allowlists (`~/projects/**`, etc.)
  - API endpoints: method + path pattern matching
  - MCP mutations: by tool name regex
- **PostToolUse Hook** summarizes large responses (>60KB) using Claude Haiku.
- **Three permission modes** per session:
  | Mode | Behavior |
  |------|----------|
  | `safe` | Read-only, blocks all writes |
  | `ask` | Prompts for bash/write/mutation operations (default) |
  | `allow-all` | Auto-approves everything |
- **Dangerous commands** (`rm`, `sudo`, `chmod`, `shutdown`, `git push`) are never auto-allowed, even in `allow-all` mode.
- **Credential encryption** uses AES-256-GCM at rest, key derived via PBKDF2 from machine-unique identifier.

### 1.3 Conversation Threads & Context

Sessions are workspace-scoped containers stored as **JSONL files** (append-only):

```
~/.craft-agent/workspaces/{workspaceId}/sessions/{sessionId}/
├── session.jsonl          # Line 1: header, Lines 2+: messages
├── attachments/
├── plans/
├── long_responses/        # Full tool results (summarized in main)
├── data/
└── downloads/
```

Key design decisions:

- JSONL format optimized for streaming and incremental reads.
- Session metadata includes: `id`, `createdAt`, `lastUsedAt`, `model`, `permissionMode`, `workingDirectory`, `parentSessionId`, `siblingOrder`.
- **Session recovery**: SDK session ID captured after first message; last N user/assistant pairs restored on reload.
- **Multi-session hierarchy**: parent sessions contain child sessions via `parentSessionId` + `siblingOrder`.
- **Persistence queue**: 500ms debounced writes to prevent thrashing.

### 1.4 Structured Workflows

#### Plan System

File-based plans stored per session:

```typescript
interface Plan {
	id: string;
	title: string;
	state: "creating" | "refining" | "ready" | "executing" | "completed" | "cancelled";
	steps: PlanStep[]; // { id, description, status, files, complexity }
	context: string;
	refinementRound: number;
	refinementHistory?: PlanRefinementEntry[];
}
```

Workflow: agent submits plan → persisted to disk → UI displays for review → user refines/approves → agent executes steps and marks them complete.

#### Hooks System (Event-Driven Automation)

Two hook types:

1. **Command hooks** — execute shell commands with event context
2. **Prompt hooks** — create new agent sessions with @mentions

18 supported events, including:

- App events: `LabelAdd`, `LabelRemove`, `PermissionModeChange`, `FlagChange`, `TodoStateChange`
- **`SchedulerTick`** — cron-based with timezone support
- Agent events: `PreToolUse`, `PostToolUse`, `SessionStart`, `SessionEnd`

Configuration stored in `~/.craft-agent/workspaces/{id}/hooks.json`:

```json
{
	"version": 1,
	"hooks": {
		"SchedulerTick": [
			{
				"cron": "0 9 * * 1-5",
				"timezone": "America/New_York",
				"labels": ["Scheduled"],
				"hooks": [{ "type": "prompt", "prompt": "Check @github for new issues assigned to me" }]
			}
		]
	}
}
```

### 1.5 Web Interface & API

Craft Agents is an **Electron desktop app** with three layers:

1. **Main Process** — Electron lifecycle, IPC handlers, file I/O, process management
2. **Preload Bridge** — context-isolated IPC wrapper with 100+ channels
3. **Renderer** — Vite + React 18 + shadcn/ui + Tailwind CSS v4

Communication is IPC-based (not HTTP). Event stream from agent to UI includes: `TextDelta`, `ToolStart`, `ToolResult`, `MessageStop`, `PermissionRequest`, `Error`.

### 1.6 Storage Architecture

Layered, file-based:

```
~/.craft-agent/
├── config.json              # Global app state
├── credentials.enc          # AES-256-GCM encrypted secrets
├── preferences.json         # User settings
├── workspaces/
│   └── {workspaceId}/
│       ├── config.json      # Workspace settings
│       ├── hooks.json       # Event automation
│       ├── permissions.json # Permission overrides
│       ├── skills/          # Agent instructions
│       ├── sources/         # MCP/API configs
│       └── sessions/        # JSONL conversation logs
```

All paths stored in portable format (`~/` prefix) for cross-machine compatibility.

---

## 2. OpenClaw

**Repository:** [openclaw/openclaw](https://github.com/openclaw/openclaw)  
**Docs:** [docs.openclaw.ai](https://docs.openclaw.ai)  
**Stack:** TypeScript, Node.js ≥22, pi-agent-core, Lit (web UI), Docker  
**Built on:** pi-mono's agent core library

### 2.1 Tool Registration & Execution

Tools conform to a unified schema-based interface using TypeBox for validation. Results stream back via `onUpdate` callbacks.

**CLI execution** (`bash-tools.exec.ts`):

- Commands execute via PTY or spawn depending on terminal capability.
- **Environment sanitization**: blocks dangerous vars (`LD_PRELOAD`, `DYLD_*`, `NODE_OPTIONS`).
- **Output chunking**: 200KB default max output (configurable via `PI_BASH_MAX_OUTPUT_CHARS`).
- **Approval system**: long-running or risky commands require approval with configurable timeouts (120s default).
- **Node routing**: can execute on gateway host or delegate to paired device nodes.

Tool categories: browser (CDP), image/media, sessions management, Discord/Slack/Telegram/WhatsApp actions, canvas, memory/knowledge base, cron scheduling, TTS/voice.

### 2.2 Conversation Threads & Context

**Session model:**

- Session keys follow format: `agent:<agentId>:<rest>`
  - `agent:default:main` — default direct chat
  - `agent:default:thread:<threadId>` — topic isolation
  - `agent:default:cron:<jobId>:run:<runId>` — scheduled execution
- Transcripts stored in `~/.openclaw/sessions/` (file-based, not DB).
- **Context window management** via session pruning and a compaction tool that summarizes old messages.
- **Per-session state**: thinking level, verbose level, model selection, elevated access toggle.
- `ChatRunRegistry` maintains queued runs per session for ordered execution, prevents duplicate concurrent runs.

### 2.3 Structured Workflows

#### Lobster (Workflow Engine)

- JSON-first pipelines with YAML/JSON declarative definitions.
- Features: approval gates, resumability, deterministic composition.
- Accessed via `sessions_spawn` tool for composable agent orchestration.

#### Cron Jobs

- Stored in `~/.openclaw/cron/jobs.json` (JSON5 with atomic writes).
- Uses **croner** library for cron expression parsing.
- Each job run creates an isolated agent execution with per-session Docker sandbox support.
- Delivery tracking with retry logic and status reporting.
- Session reaper cleans up completed jobs.

#### Skills Platform

Three tiers:

1. **Bundled skills** — shipped with OpenClaw
2. **Managed skills** — downloaded from ClawHub at runtime
3. **Workspace skills** — user-defined in `~/.openclaw/workspace/skills/<skill>`

Skills define tools and inject instructions via `SKILL.md` prompt files.

### 2.4 Web Interface & API

**Control UI:** Lit-based, served from the gateway on the same WebSocket port. Includes dashboard, session status, model tracking, usage metrics, webchat, device pairing UI, exec approval management.

**Gateway WebSocket API:**

- Single control plane on `127.0.0.1:18789` (default).
- JSON-RPC style protocol with request/response/event frames.
- First frame must be `connect` handshake with auth + device identity.
- Methods grouped by scope: `operator.admin`, `operator.read`, `operator.write`, `operator.approvals`, `operator.pairing`.
- Server-push events: `agent`, `chat`, `presence`, `health`, `tick`, `cron`, `node.event`, `heartbeat`.

**HTTP REST Endpoints:**

- `/v1/responses` — OpenResponses API with streaming
- `/v1/chat/` — legacy chat
- `/v1/config/*` — configuration management

### 2.5 Security Model

- **Host access** for `main` sessions (single-user assumption).
- **Non-main sessions** (groups/channels) run in per-session Docker sandboxes.
- **DM pairing**: unknown senders receive a pairing code, blocked until approved.
- **Gateway auth**: token or password mode (loopback auto-allows if disabled).
- **Tool allowlists/denylists**: per-session or global. Sandbox defaults allow `bash`, `process`, `read`, `write`, `edit`, `sessions_*` but deny `browser`, `canvas`, `nodes`, `cron`.
- **Exec approvals**: large/dangerous commands require interactive approval with time limit.

### 2.6 Tailscale Integration

OpenClaw has **first-class Tailscale support** via `gateway.tailscale.mode`:

| Mode     | Behavior                                                                   |
| -------- | -------------------------------------------------------------------------- |
| `off`    | No Tailscale automation (default)                                          |
| `serve`  | Tailnet-only HTTPS via `tailscale serve` (uses Tailscale identity headers) |
| `funnel` | Public HTTPS via `tailscale funnel` (requires password auth)               |

Key constraints:

- Gateway stays bound to loopback; Tailscale handles external routing.
- `serve` mode can optionally require password by setting `gateway.auth.allowTailscale: false`.
- `funnel` refuses to start unless `gateway.auth.mode: "password"` is set.
- Optional `gateway.tailscale.resetOnExit` to undo serve/funnel on shutdown.

### 2.7 Storage Architecture

File-based:

```
~/.openclaw/
├── openclaw.json            # Main config (JSON5 with env fallback)
├── cron/jobs.json           # Cron definitions and run logs
├── agents/<agentId>/        # Per-agent workspace and auth profiles
├── sessions/<agentId>/      # Transcripts and session state
├── credentials/             # Channel allowlists and OAuth
└── logs/                    # Operation logs
```

Configuration loaded from `openclaw.json` with env var overrides, runtime validated against Zod schema, hot-reloadable without restart.

---

## 3. Pi-Mono

**Repository:** [badlogic/pi-mono](https://github.com/badlogic/pi-mono)  
**Stack:** TypeScript monorepo, Node.js, TypeBox, mini-lit (web UI)  
**Note:** OpenClaw is built on pi-mono's core libraries

### 3.1 Tool Registration & Execution

Tools are defined via the `AgentTool` interface with TypeBox schemas:

```typescript
interface AgentTool {
	name: string;
	description: string;
	parameters: TSchema; // TypeBox JSON Schema
	execute(toolCallId, params, signal, onUpdate): Promise<AgentToolResult>;
}
```

Execution flow:

1. Agent streams LLM response.
2. `agentLoop` validates arguments against schema.
3. Tools execute with optional streaming via `onUpdate()`.
4. Results converted to `toolResult` messages and sent back to LLM.

**CLI execution** uses a **pluggable `BashOperations` interface** — implementations exist for local shell, SSH, Docker, or custom execution. Output is truncated to prevent context explosion.

**Key pattern**: tools are composable and extensible. `createAllTools()` assembles tools at runtime; extensions can register custom tools.

### 3.2 Conversation Threads & Context

Sessions stored as **JSONL files** with entries forming a **tree via `id`/`parentId`** fields:

Entry types:

- `message` — user/assistant/toolResult
- `model_change` — model switches mid-session
- `thinking_level_change` — reasoning level adjustments
- `compaction` — context summaries (lossy compression)
- `branch_summary` — summaries when switching branches
- `custom` — extension state (not sent to LLM)
- `custom_message` — extension-injected messages (sent to LLM)
- `label` — user bookmarks
- `session_info` — session metadata

**Context building**: `buildSessionContext()` walks current branch from leaf → root, skips compacted messages and includes summaries instead.

**Thread/branch support**:

- `/tree` command — navigate to any point in history
- `/fork` command — extract a branch to new session
- Branch summarization injects context when switching branches
- All branches preserved in a single JSONL file

### 3.3 Structured Workflows

Three levels of structure:

1. **Skills** — Markdown files with frontmatter + instructions in `~/.pi/agent/skills/` or `.pi/skills/`. Invoked via `/skill:name`.
2. **Prompt Templates** — Markdown files with Handlebars-style variables (`{{focus}}`). Expanded via `/templatename`.
3. **Extensions** — TypeScript modules in `~/.pi/agent/extensions/` providing full API for:
   - Custom tools (`pi.registerTool()`)
   - Custom commands (`pi.registerCommand()`)
   - Event hooks (lifecycle events)
   - Custom compaction/summarization
   - UI components (overlays, status lines)

### 3.4 Web Interface & API

Three output modes:

1. **Interactive TUI** — built on `pi-tui`, differential terminal rendering with editor, message display, markdown rendering, model selector.
2. **Print Mode** (`-p`) — non-interactive, prints response and exits. Useful for scripting.
3. **RPC Mode** (`--mode rpc`) — stdin/stdout JSON protocol for embedding pi agent in other apps.

**Web UI library** (`@mariozechner/pi-web-ui`):

- Browser-based chat interface built with mini-lit web components.
- Core components: `ChatPanel`, `AgentInterface`, `ArtifactsPanel`.
- Built-in tools: JavaScript REPL, document extraction, artifacts management.
- Storage: IndexedDB-backed (sessions, settings, provider keys, custom providers).

### 3.5 Security Model

Primarily designed for local/single-user operation:

- Interactive CLI has full file system access.
- Docker isolation recommended for multi-user scenarios (e.g., "mom" Slack bot variant runs in Docker).
- OAuth flow with `getOAuthApiKey()` handles token refresh.
- API keys via environment variables.
- CORS proxy for browser-based requests to protected APIs.

### 3.6 Scheduled Triggers (Event System)

The "mom" implementation uses a file-based event system in `data/events/`:

Three event types:

1. **Immediate** — triggers instantly when file is created
2. **One-shot** — triggers at specific timestamp
3. **Periodic** — triggers on cron schedule

```json
{
	"type": "periodic",
	"channelId": "C123ABC",
	"text": "Check inbox",
	"schedule": "0 9 * * 1-5",
	"timezone": "Europe/Vienna"
}
```

Integration pattern:

1. Cron job (or external trigger) writes event JSON to `data/events/`.
2. Harness detects and schedules.
3. Agent wakes up and processes.
4. Agent can write new events (chaining workflows).

### 3.7 Compaction Strategy

Triggers when `contextTokens > contextWindow - 16384`:

1. Walk backward from newest message, accumulating tokens.
2. When `keepRecentTokens` threshold reached, mark cut point.
3. LLM generates structured summary.
4. `CompactionEntry` appended with `firstKeptEntryId`.
5. On reload, summary + messages from `firstKeptEntryId` sent to LLM.

Summary format includes: goal, progress (done/in-progress), key decisions, critical context, read/modified files.

### 3.8 Storage Architecture

```
~/.pi/agent/
├── sessions/
│   └── --path--to--project--/
│       └── <timestamp>_<uuid>.jsonl   # Append-only, tree-structured
├── skills/          # Markdown skill files
├── prompts/         # Prompt templates
└── extensions/      # TypeScript extension modules
```

Sessions are append-only JSONL with tree structure via `id`/`parentId`. Compaction tracks `readFiles` and `modifiedFiles` cumulatively. Extensible message types via TypeScript declaration merging.

---

## 4. Cross-Project Comparison

| Aspect                 | Craft Agents                                | OpenClaw                                        | Pi-Mono                                                   |
| ---------------------- | ------------------------------------------- | ----------------------------------------------- | --------------------------------------------------------- |
| **Primary Interface**  | Electron desktop app                        | Multi-channel (WhatsApp, Slack, etc.) + WebChat | CLI (TUI) + Web UI + RPC                                  |
| **Tool System**        | Claude SDK native + MCP + API tools         | TypeBox schema + streaming                      | TypeBox schema + pluggable BashOperations                 |
| **Session Format**     | JSONL (flat)                                | File-based transcripts                          | JSONL (tree with branches)                                |
| **Workflow Engine**    | Plans + Hooks                               | Lobster + Cron + Skills                         | Skills + Templates + Extensions                           |
| **Cron Support**       | `SchedulerTick` hook event                  | First-class cron service with croner            | File-based event system                                   |
| **Security**           | AES-256-GCM credentials, 3 permission modes | Docker sandboxes, DM pairing, exec approvals    | Local-first, Docker for multi-user                        |
| **Tailscale**          | None                                        | First-class (`serve`/`funnel` modes)            | None (VM deployment documented)                           |
| **LLM Providers**      | Anthropic + OpenAI/Codex + Copilot          | Multi-provider via pi-agent-core                | Multi-provider (OpenAI, Anthropic, Google, Mistral, etc.) |
| **Persistence**        | Layered file-based + encrypted credentials  | File-based + JSON5 config + Zod validation      | JSONL + IndexedDB (web)                                   |
| **Context Management** | Session recovery (last N pairs)             | Compaction + pruning                            | Compaction + branch summaries                             |

---

## 5. Key Takeaways for Our Agent

### Architecture Patterns to Adopt

1. **JSONL for session persistence** — All three projects use append-only file formats. Pi-mono's tree-structured JSONL is the most sophisticated but Craft's flat JSONL is simpler and sufficient for our needs.

2. **TypeBox/JSON Schema for tool definitions** — Both pi-mono and OpenClaw use TypeBox schemas for tool validation. This provides runtime type checking without heavy dependencies.

3. **Pluggable bash execution** — Pi-mono's `BashOperations` interface is the cleanest pattern. It allows swapping between local shell, SSH, and Docker execution without changing tool code.

4. **File-based configuration** — All three use the filesystem as the primary store. No databases required. JSON/JSON5 for config, JSONL for sessions.

5. **Compaction for context management** — Pi-mono's compaction strategy (structured LLM-generated summary when context exceeds threshold) is essential for long-running conversations.

6. **Skills as markdown files** — All three support markdown-based skill/instruction files. Simple, versionable, human-readable.

### Tailscale-Specific Learnings

OpenClaw's Tailscale integration is directly relevant:

- Gateway binds to loopback only; Tailscale handles external routing.
- `tailscale serve` for tailnet-only access (uses Tailscale identity headers for auth).
- `tailscale funnel` for public access (requires password auth).
- This means our agent can rely on Tailscale for the network security boundary and auth, keeping our implementation simple.

### Cron/Scheduling Patterns

Three approaches observed:

1. **Hook-based** (Craft) — `SchedulerTick` event fires on cron schedule, triggers prompt hooks.
2. **Service-based** (OpenClaw) — Dedicated cron service with croner library, isolated agent execution per job.
3. **File-based** (Pi-mono) — External process writes event JSON files, harness watches directory and triggers agent.

For simplicity, the file-based approach (pi-mono) or a simple cron service (OpenClaw) are the best fits.

### Workflow Definition Patterns

For repeatable structured workflows:

- **Craft's Plan system** provides a good UX model (create → refine → approve → execute → track).
- **Pi-mono's Extensions** provide the most flexibility (custom TypeScript modules).
- **OpenClaw's Lobster** is the most workflow-engine-like (YAML/JSON pipelines with approval gates).

For our needs, a simple markdown or YAML-based workflow definition (similar to skills files) with step tracking is likely sufficient.

### Security Considerations

Minimum viable security for a Tailscale-isolated VM:

- Tailscale handles network-level auth (no public internet exposure).
- Dangerous command blocklist (never auto-allow `rm -rf`, `sudo`, `git push --force`).
- Environment variable filtering when spawning subprocesses.
- Encrypted credential storage (AES-256-GCM pattern from Craft).
- Per-session permission modes (at minimum: `ask` and `allow-all`).

### What to Avoid (Complexity Traps)

- **Electron/desktop app** — Craft's approach is overkill for a VM agent. A simple HTTP server with a web UI is sufficient.
- **Multi-channel messaging** — OpenClaw's WhatsApp/Telegram/Slack integration is impressive but far beyond scope. WebChat only.
- **MCP server ecosystem** — Start with CLI tools only. MCP can be added later.
- **OAuth flows** — For a single-user Tailscale agent, API keys in encrypted config are sufficient.
- **Multi-provider LLM support** — Pick one provider initially. Abstract the interface for future expansion.

---

## 6. Deep Dive: Croner (Cron Scheduling Library)

**Package:** [croner](https://www.npmjs.com/package/croner) (npm)  
**Repository:** [Hexagon/croner](https://github.com/Hexagon/croner)  
**Docs:** [croner.56k.guru](https://croner.56k.guru)  
**License:** MIT  
**Version:** 10.0.1  
**Dependencies:** Zero  
**Used by:** OpenClaw, pm2, Uptime Kuma, ZWave JS, TrueNAS

### 6.1 Why Croner Over Alternatives

Croner is the clear winner among JavaScript cron libraries. Both OpenClaw and Craft Agents chose it. The comparison:

| Feature               | croner | node-cron | cron | node-schedule |
| --------------------- | ------ | --------- | ---- | ------------- |
| Zero dependencies     | ✓      |           |      |               |
| Browser + Deno + Bun  | ✓      |           |      |               |
| Overrun protection    | ✓      |           |      |               |
| Error handling        | ✓      |           |      | ✓             |
| TypeScript typings    | ✓      |           | ✓    |               |
| Seconds field         | ✓      |           |      |               |
| Year field            | ✓      |           |      |               |
| Last day of month (L) | ✓      |           |      |               |
| Nth weekday (#)       | ✓      |           |      |               |
| Nearest weekday (W)   | ✓      |           |      |               |
| Next N runs           | ✓      |           | ✓    |               |
| Timezone support      | ✓      | ✓         | ✓    | ✓             |
| Pause/Resume/Stop     | ✓      | ✓         | ✓    | ✓             |
| Minimum interval      | ✓      |           |      |               |

Key advantages for our agent:

- **Overrun protection** — prevents a slow job from stacking on top of itself
- **Timezone support** — critical for scheduling in user's local time
- **Error handling** — built-in catch handler keeps the scheduler alive
- **Context passing** — pass data to the scheduled function
- **Named jobs** — accessible throughout the application via `scheduledJobs`
- **In-memory** — no database required

### 6.2 Core API

```typescript
import { Cron } from "croner";

// Basic: run every 5 minutes
const job = new Cron("*/5 * * * *", () => {
	console.log("Running task");
});

// With options: timezone, error handling, overrun protection
const job = new Cron(
	"0 9 * * 1-5",
	{
		timezone: "America/New_York",
		catch: (err) => console.error("Job failed:", err),
		protect: (job) => console.log(`Blocked by run started at ${job.currentRun()}`),
		maxRuns: 100,
		context: { agentId: "default" },
	},
	async (self, context) => {
		// Async supported natively
		await runAgentTask(context.agentId, "Check inbox");
	},
);

// Controls
job.pause(); // Suspend scheduling
job.resume(); // Resume scheduling
job.stop(); // Stop permanently (removed from scheduledJobs)

// Inspection
job.nextRun(); // Next Date or null
job.nextRuns(10); // Next 10 run dates
job.previousRun(); // Last run Date
job.previousRuns(5); // Last 5 run dates
job.isRunning(); // Currently executing?
job.isBusy(); // Has active async execution?

// Fire once at specific time
new Cron("2025-06-01T09:00:00", { timezone: "US/Pacific" }, () => {
	console.log("One-shot task");
});

// Named jobs (globally accessible)
new Cron("* * * * *", { name: "healthcheck" }, () => {
	/* ... */
});
// Later, from anywhere:
import { scheduledJobs } from "croner";
const hc = scheduledJobs.find((j) => j.name === "healthcheck");
hc?.pause();
```

### 6.3 Pattern for Our Agent's Cron System

Based on how OpenClaw uses croner:

```typescript
// Job definition stored in ~/.agent/cron/jobs.json
interface CronJob {
	id: string;
	schedule: string; // Cron expression
	timezone?: string; // IANA timezone
	prompt: string; // What to tell the agent
	enabled: boolean;
	lastRun?: string; // ISO timestamp
	lastStatus?: "success" | "error";
}

// Cron service loads jobs and schedules them
function startCronService(jobs: CronJob[]) {
	for (const job of jobs) {
		if (!job.enabled) continue;
		new Cron(
			job.schedule,
			{
				timezone: job.timezone,
				name: job.id,
				protect: true, // Prevent overrun
				catch: (err) => logJobError(job.id, err),
				context: job,
			},
			async (_self, ctx) => {
				// Create isolated agent session for this cron run
				await runAgentSession({
					sessionId: `cron:${ctx.id}:${Date.now()}`,
					prompt: ctx.prompt,
				});
			},
		);
	}
}
```

---

## 7. Deep Dive: The Agent Loop Pattern (pi-agent-core)

**Source:** [badlogic/pi-mono — packages/agent/src/agent-loop.ts](https://github.com/badlogic/pi-mono/blob/main/packages/agent/src/agent-loop.ts)  
**Used by:** pi-mono, OpenClaw

This is the canonical agent loop implementation that both pi-mono and OpenClaw build on. Understanding it is essential since we'll be building our own.

### 7.1 Architecture Overview

The agent loop has two entry points:

```typescript
// Start a new conversation turn
function agentLoop(
	prompts: AgentMessage[],
	context: AgentContext,
	config: AgentLoopConfig,
	signal?: AbortSignal,
	streamFn?: StreamFn,
): EventStream<AgentEvent, AgentMessage[]>;

// Continue from existing context (retry without adding a new message)
function agentLoopContinue(
	context: AgentContext,
	config: AgentLoopConfig,
	signal?: AbortSignal,
	streamFn?: StreamFn,
): EventStream<AgentEvent, AgentMessage[]>;
```

Both return an `EventStream` — an async iterable that yields granular events and can be awaited for the final result.

### 7.2 The Nested Loop Structure

The core is a **double loop**:

```
OUTER LOOP (continues if follow-up messages arrive)
└── INNER LOOP (continues while tool calls or steering messages exist)
    ├── 1. Emit turn_start
    ├── 2. Process pending/steering messages
    ├── 3. Stream assistant response from LLM
    │   ├── transformContext() — prune/inject context (optional)
    │   ├── convertToLlm() — filter to LLM-compatible messages (required)
    │   └── Stream response, update partial message in context
    ├── 4. Check stopReason (error/aborted → exit)
    ├── 5. Execute tool calls (if any)
    │   ├── For each tool call:
    │   │   ├── Validate args against TypeBox schema
    │   │   ├── Execute tool with signal + onUpdate callback
    │   │   ├── Catch errors → return as error content to LLM
    │   │   ├── Check for steering messages (user interruption)
    │   │   └── Skip remaining tools if steering detected
    │   └── Inject tool results into context
    ├── 6. Emit turn_end
    └── 7. Check for steering/follow-up messages → continue or exit
```

### 7.3 Message Transformation Pipeline

A key design insight — messages go through a pipeline before reaching the LLM:

```
AgentMessage[] (may include custom types, UI-only messages)
    ↓
transformContext() — optional hook to prune old messages, inject external context
    ↓
AgentMessage[] (context-optimized)
    ↓
convertToLlm() — required hook to filter/transform to LLM-compatible format
    ↓
Message[] (only user, assistant, toolResult — what the LLM sees)
    ↓
LLM Provider (streaming)
    ↓
AssistantMessage (with text, thinking, toolCalls, stopReason)
```

This separation is critical: it lets you store rich application-specific messages (UI metadata, extension state, labels) in the session while only sending clean messages to the LLM.

### 7.4 Streaming & Partial Messages

The loop continuously updates the partial message in context as streaming events arrive:

```typescript
for await (const event of response) {
  switch (event.type) {
    case "start":
      partialMessage = event.partial;
      context.messages.push(partialMessage);
      stream.push({ type: "message_start", ... });
      break;
    case "text_delta":
    case "toolcall_delta":
      partialMessage = event.partial;
      context.messages[last] = partialMessage;  // Update in place
      stream.push({ type: "message_update", ... });
      break;
    case "done":
      finalMessage = await response.result();
      context.messages[last] = finalMessage;
      stream.push({ type: "message_end", ... });
      return finalMessage;
  }
}
```

### 7.5 Tool Execution Design

Tool errors are **never thrown** — they're caught and returned to the LLM as error content:

```typescript
try {
	const tool = tools.find((t) => t.name === toolCall.name);
	const validatedArgs = validateToolArguments(tool, toolCall);
	result = await tool.execute(toolCallId, validatedArgs, signal, onUpdate);
	isError = false;
} catch (e) {
	result = {
		content: [{ type: "text", text: e.message }],
		details: {},
	};
	isError = true;
}
```

This allows the LLM to see failures and retry or try a different approach — a fundamental design principle of robust agent loops.

### 7.6 Steering (User Interruption)

After each tool completes, the loop checks `getSteeringMessages()`. If the user has queued a message:

- Remaining tool calls are skipped with "Skipped due to queued user message" error results
- The user's message is injected into context
- The inner loop continues, giving the LLM the new instruction

This enables mid-execution course correction without aborting the entire session.

### 7.7 EventStream Implementation

The `EventStream` class is both an async iterable and a promise:

```typescript
class EventStream<T, R> implements AsyncIterable<T> {
	push(event: T): void; // Producer pushes events
	end(result?: R): void; // Signal completion
	[Symbol.asyncIterator](); // Consumer iterates
	result(): Promise<R>; // Await final result
}
```

Usage:

```typescript
// Consumer can iterate events...
for await (const event of stream) {
	handleEvent(event); // message_start, tool_execution_start, etc.
}

// ...or just await the final result
const messages = await stream.result();
```

### 7.8 Key Design Principles

1. **Message-centric** — everything is an `AgentMessage`; LLM conversion is a transformation step
2. **Streaming-first** — partial responses update context immediately
3. **Event-driven** — fine-grained events enable responsive UIs
4. **Interruption-aware** — steering allows mid-execution user intervention
5. **Error-resilient** — tool errors inform the LLM, enabling autonomous recovery
6. **Signal-based cancellation** — `AbortSignal` flows through the entire chain
7. **Pluggable transforms** — `convertToLlm` and `transformContext` enable extensibility without core changes

### 7.9 Implications for Our Agent

For a minimal agent, we can simplify this pattern:

- Skip steering messages initially (single-user, one request at a time)
- Skip `transformContext` (handle compaction separately)
- Keep `convertToLlm` (we'll need custom message types eventually)
- Keep the error-as-content pattern (essential for robust tool use)
- Keep the EventStream pattern (needed for streaming to web UI)

The minimal loop is approximately:

```
while (stopReason === "toolUse") {
  response = await streamLLM(messages)
  if (response.stopReason !== "toolUse") break
  for (toolCall of response.toolCalls) {
    result = await executeTool(toolCall)  // catch errors → error content
    messages.push(toolResult)
  }
}
```

---

## 8. Deep Dive: Claude Agent SDK

**Package:** `@anthropic-ai/claude-agent-sdk`  
**Used by:** Craft Agents (lukilabs/craft-agents-oss)

### 8.1 What It Actually Is

The Claude Agent SDK is **not** a simple API wrapper. It's a **managed subprocess wrapper around Claude Code CLI**:

```
Your Application
    ↓
Claude Agent SDK (TypeScript)
    ↓
Claude Code CLI (subprocess)
    ↓
Anthropic API
```

This is a crucial architectural distinction. The SDK spawns and manages a Claude Code subprocess, communicating via stdio. It provides a high-level async generator interface over the subprocess events.

### 8.2 Core API: `query()`

The primary abstraction is the `query()` function:

```typescript
import { query } from "@anthropic-ai/claude-agent-sdk";

const response = query({
	prompt: "Read the config file and summarize it",
	options: {
		tools: { type: "preset", preset: "claude_code" }, // Built-in tools
		includePartialMessages: true, // Stream text chunks
		maxThinkingTokens: 10000, // Extended thinking
		mcpServers: {
			/* MCP server configs */
		},
		permissionMode: "bypassPermissions",
	},
});

// Async generator — yields SDK messages
for await (const message of response) {
	if (message.type === "stream_event") {
		// Real-time: text_delta, tool_start, tool_result, etc.
	}
	if (message.type === "result") {
		// End of turn
	}
}
```

### 8.3 Three Layers of Tools

1. **Built-in (preset)** — Bash, Read, Write, Edit, Glob, Grep, Diff. Handled internally by the subprocess.
2. **MCP Servers** — HTTP/SSE, stdio subprocess, or in-process via `createSdkMcpServer()`. Tool names are prefixed: `mcp__servername__toolname`.
3. **Custom tools** via `tool()` helper:

   ```typescript
   import { tool } from "@anthropic-ai/claude-agent-sdk";
   import { z } from "zod";

   const myTool = tool(
   	"deploy",
   	"Deploy the application to the specified environment",
   	{ env: z.enum(["dev", "staging", "prod"]) },
   	async (args) => {
   		const result = await deploy(args.env);
   		return { content: [{ type: "text", text: result }] };
   	},
   );
   ```

### 8.4 What You Get vs. Raw API

| Feature             | Claude Agent SDK                  | Raw Anthropic API           |
| ------------------- | --------------------------------- | --------------------------- |
| Tool execution      | Automatic (subprocess)            | Manual — you call each tool |
| Tool dispatch loop  | Managed                           | You build the loop          |
| Permission system   | Built-in hooks (PreToolUse, etc.) | Build from scratch          |
| Session persistence | Automatic to disk                 | Build storage layer         |
| MCP integration     | Built-in                          | Implement MCP client        |
| Streaming           | Async generator yields events     | Manually iterate SSE stream |
| Extended thinking   | Pass `maxThinkingTokens` option   | Configure via API parameter |
| Context compaction  | Built-in `/compact` command       | Manual summarization        |
| Subagents (Task)    | Built-in                          | Custom implementation       |
| Error recovery      | Process restarts, config repair   | Handle yourself             |

### 8.5 Hidden Costs & Tradeoffs

Craft Agents' implementation reveals several pain points:

1. **Subprocess management complexity:**
   - Must handle stderr capture for diagnostics
   - Must detect and recover from silent failures
   - `.claude.json` corruption handling (BOM encoding on Windows, empty files, invalid JSON)
   - CLI version compatibility issues

2. **Session resurrection is fragile:**

   ```typescript
   // Craft-agents-oss must detect when resume silently fails:
   if (wasResuming && !receivedAssistantContent && !_isRetry) {
   	this.sessionId = null;
   	const recoveryContext = this.buildRecoveryContext();
   	yield * this.chat(recoveryContext + userMessage, attachments, { isRetry: true });
   }
   ```

3. **Message conversion overhead:**
   - SDK emits its own event types → convert to internal format → emit to UI
   - ~200 lines of complex state tracking per turn in Craft's implementation

4. **Opinionated architecture:**
   - Tightly coupled to Claude Code's tool set
   - Subprocess model adds memory overhead
   - Harder to customize low-level behavior

### 8.6 When to Use SDK vs. Custom Loop

**Use the SDK if:**

- You want rapid development with Claude as the sole provider
- You need MCP integration out of the box
- Advanced features matter (subagents, extended thinking, built-in file tools)
- Building a desktop/IDE-like application

**Build custom loop if:**

- You want multi-provider support (our case — abstract the interface)
- You need maximum control over tool execution
- You want to avoid subprocess overhead on a VM
- You're building a server-side agent (not a desktop app)
- You want simpler debugging (no subprocess layer)

### 8.7 Recommendation for Our Agent

**Build a custom loop**, inspired by pi-agent-core's pattern. Reasons:

1. **Simplicity** — No subprocess management, direct API calls
2. **Multi-provider** — Abstract the LLM interface; start with one provider, add more later
3. **Server-native** — Our agent runs on a VM, not a desktop; subprocess model adds unnecessary complexity
4. **Transparency** — Direct control over tool execution, context management, and error handling
5. **Lightweight** — No Claude Code CLI dependency on the VM

The pi-agent-core pattern gives us everything we need: streaming, tool dispatch, error handling, and cancellation — in ~200 lines of core loop logic rather than managing a subprocess.

---

## 9. Deep Dive: pi-mono as a Dependency

**Monorepo:** [badlogic/pi-mono](https://github.com/badlogic/pi-mono)  
**Published packages:** 6 on npm under `@mariozechner/` scope

### 9.1 Published Packages

| Package      | npm Name                        | Purpose                              | Designed as Library |
| ------------ | ------------------------------- | ------------------------------------ | ------------------- |
| ai           | `@mariozechner/pi-ai`           | Unified LLM API across 20+ providers | ✅ Yes              |
| agent        | `@mariozechner/pi-agent-core`   | General-purpose agent framework      | ✅ Yes              |
| tui          | `@mariozechner/pi-tui`          | Terminal UI components               | ✅ Yes              |
| web-ui       | `@mariozechner/pi-web-ui`       | Web chat UI components               | ✅ Yes              |
| coding-agent | `@mariozechner/pi-coding-agent` | Coding agent CLI + SDK               | ⚠️ Partial          |
| mom          | `@mariozechner/pi-mom`          | Slack bot runtime                    | ❌ Not reusable     |

### 9.2 `@mariozechner/pi-ai` — Unified LLM API

This is the core library we plan to use as a dependency.

**What it provides:**

- Unified streaming API across 20+ LLM providers (OpenAI, Anthropic, Google, Mistral, AWS Bedrock, etc.)
- Automatic model discovery with full type safety
- Tool calling (function calling) with TypeBox schemas
- Thinking/reasoning support across providers with unified interface
- Token usage tracking and cost calculation
- OAuth provider integration
- Cross-provider message handoff support

**Public API surface:**

```typescript
// Core functions
export { streamSimple, completeSimple }; // Unified interface for thinking
export { stream, complete }; // Full provider-specific options
export { getModel, getModels, getProviders }; // Model & provider discovery
export { validateToolCall }; // Tool argument validation

// Types & re-exports
export { Type, Static, TSchema }; // TypeBox re-exports
export { Tool, Message, Model, Context }; // Core types
export { AssistantMessageEventStream }; // Streaming event types
```

**Dependency footprint (11 direct):**

- Provider SDKs: `@anthropic-ai/sdk`, `@aws-sdk/client-bedrock-runtime`, `@google/genai`, `openai`, `@mistralai/mistralai`
- Utilities: `@sinclair/typebox`, `ajv`, `chalk`, `partial-json`, `proxy-agent`, `undici`, `zod-to-json-schema`
- Tree-shakeable — unused providers don't ship
- Node.js 20+ required

**Stability:**

- Pre-1.0 versioning (currently 0.52.x) — no formal semver commitment
- Core APIs (`stream`, `complete`, `getModel`, `Context`) appear stable across commits
- Churn is in provider-specific options and new model additions
- Mitigation: pin to a specific version

### 9.3 `@mariozechner/pi-agent-core` — Agent Framework

**What it provides:**

- `Agent` class with message history and tool execution
- `agentLoop` / `agentLoopContinue` low-level functions
- Event streaming for UI updates (agent_start, turn_end, message_update, tool_execution_start, etc.)
- Message transformation abstraction (`convertToLlm`)
- Steering (interrupt during tool execution) and follow-up message queuing
- Proxy support for browser/remote execution

**Public API surface:**

```typescript
export class Agent {
	constructor(options: AgentOptions);
	prompt(message: string | AgentMessage): Promise<void>;
	continue(): Promise<void>;
	subscribe(listener: (event: AgentEvent) => void): () => void;
	setModel(model: Model): void;
	setSystemPrompt(text: string): void;
	setTools(tools: AgentTool[]): void;
	steer(message: AgentMessage): void;
	followUp(message: AgentMessage): void;
}

export { agentLoop, agentLoopContinue }; // Raw loop control
export { streamProxy }; // Browser/server proxying
```

**Dependency footprint:** Only `@mariozechner/pi-ai` — extremely lightweight.

### 9.4 Decision: Use `pi-ai`, Build Our Own Agent Loop

**Use `pi-ai` for the LLM provider layer.** Reasons:

1. **Eliminates boilerplate** — wrapping 20+ provider SDKs behind a unified streaming API is hundreds of lines of per-provider plumbing with no architectural value.
2. **Provider flexibility** — start with one provider, switch or add others without touching our code.
3. **Reasonable footprint** — 11 dependencies, all official provider SDKs. No bloat.
4. **Battle-tested** — used by both pi-mono and OpenClaw in production.
5. **TypeBox integration** — tool schemas work natively with the same library we'd use for our own tool definitions.

**Build our own agent loop (don't use `pi-agent-core`).** Reasons:

1. **The loop is simple** — the core logic is ~50 lines (stream → detect tool calls → execute → loop). Writing it ourselves means we fully understand and own it.
2. **Unnecessary abstraction** — `pi-agent-core` brings steering, follow-up queuing, proxy support, and declaration merging we don't need. It's not heavy, but it's abstraction we'd learn and work around rather than just writing the straightforward version.
3. **The loop is the heart** — the agent loop is where workflow execution, cron session isolation, permission checks, and tool validation live. Owning it means these features slot in naturally instead of fighting someone else's extension points.
4. **Spec alignment** — our spec calls for a minimal agent. A custom loop shaped exactly to our needs is simpler than extending a generic framework.

**Risk mitigation for `pi-ai`:**

- Pin to a specific version (e.g., `0.52.9`)
- The core API (`stream`, `complete`, `getModel`) is stable; churn is in provider options
- If it ever becomes unmaintained, replacing it means swapping one streaming function per provider — the agent loop doesn't change

### 9.5 What Our Architecture Looks Like

```
┌─────────────────────────────────────────────────────┐
│                    Our Code (owned)                  │
├─────────────────────────────────────────────────────┤
│                                                      │
│  ┌──────────────┐  ┌──────────────┐  ┌───────────┐  │
│  │  Agent Loop   │  │  Tool System │  │  Sessions  │  │
│  │  (custom)     │  │  (TypeBox)   │  │  (JSONL)   │  │
│  └──────┬───────┘  └──────────────┘  └───────────┘  │
│         │                                            │
│  ┌──────┴───────┐  ┌──────────────┐  ┌───────────┐  │
│  │  Cron Service │  │  Web Server  │  │  Workflows │  │
│  │  (croner)     │  │  (HTTP + WS) │  │  (files)   │  │
│  └──────────────┘  └──────────────┘  └───────────┘  │
│                                                      │
├─────────────────────────────────────────────────────┤
│              Dependency (not owned)                  │
├─────────────────────────────────────────────────────┤
│                                                      │
│  ┌──────────────────────────────────────────────┐   │
│  │  @mariozechner/pi-ai                          │   │
│  │  stream() / complete() / getModel()           │   │
│  │  → Anthropic, OpenAI, Google, Mistral, etc.   │   │
│  └──────────────────────────────────────────────┘   │
│                                                      │
└─────────────────────────────────────────────────────┘
```

### 9.6 Example: Our Agent Loop Using `pi-ai`

```typescript
import { streamSimple, getModel, type Tool, type Message } from "@mariozechner/pi-ai";
import { Type, type Static } from "@sinclair/typebox";

// Define a tool with TypeBox schema
const bashTool: Tool = {
	name: "bash",
	description: "Execute a shell command",
	parameters: Type.Object({
		command: Type.String({ description: "The command to run" }),
	}),
};

// Our minimal agent loop
async function agentLoop(
	messages: Message[],
	tools: Tool[],
	signal?: AbortSignal,
): Promise<Message[]> {
	const model = getModel("anthropic", "claude-sonnet-4-20250514");

	while (true) {
		// Stream LLM response
		const response = streamSimple(model, {
			systemPrompt: "You are a helpful agent.",
			messages,
			tools,
		});

		// Collect the assistant message
		const assistantMessage = await response.result();
		messages.push(assistantMessage);

		// If no tool calls, we're done
		if (assistantMessage.stopReason !== "toolUse") break;

		// Execute each tool call
		for (const block of assistantMessage.content) {
			if (block.type !== "toolCall") continue;

			let result: string;
			let isError = false;

			try {
				result = await executeTool(block.name, block.arguments);
			} catch (e) {
				result = e.message;
				isError = true;
			}

			messages.push({
				role: "toolResult",
				toolCallId: block.id,
				content: [{ type: "text", text: result }],
				isError,
			});
		}
	}

	return messages;
}
```

This is the entire agent loop — roughly 40 lines. Everything else (session persistence, streaming to web UI, cron integration, workflow execution) layers on top without modifying this core.
