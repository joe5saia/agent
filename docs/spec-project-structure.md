# Specification: Project Structure, Milestones & Deployment

Source directory layout, implementation phases, deployment, and project inspirations.

**Related documents:**

- [Overview](spec-overview.md) — architecture and design principles
- [Technology Stack](spec-technology-stack.md) — runtime, testing, tooling
- [Agent Loop & Tools](spec-agent-loop.md) — agent and tool modules
- [Sessions](spec-sessions.md) — session management module
- [Automation](spec-automation.md) — cron and workflow modules
- [Web Interface](spec-web-interface.md) — server and routes modules
- [Security](spec-security.md) — security module
- [System Prompt & Observability](spec-system-prompt.md) — logging module
- [Configuration](spec-configuration.md) — config module

---

## 19. Source Directory Structure

The `src/` directory follows a flat module structure. Each top-level directory maps to a core concern.

### 19.1 Layout

```
src/
├── index.ts                    # Entry point — starts server, cron, loads config
├── config/
│   ├── schema.ts               # TypeBox schemas for config validation
│   ├── loader.ts               # YAML parsing, validation, defaults
│   └── defaults.ts             # Default configuration values
├── agent/
│   ├── loop.ts                 # Core agent loop (stream → tools → loop)
│   ├── system-prompt.ts        # System prompt assembly
│   └── types.ts                # AgentEvent, AgentMessage, etc.
├── tools/
│   ├── registry.ts             # Tool registration and lookup
│   ├── executor.ts             # Tool execution with safety checks
│   ├── builtin/
│   │   ├── bash.ts             # Shell command execution
│   │   ├── read-file.ts        # File reading
│   │   ├── write-file.ts       # File writing
│   │   └── list-directory.ts   # Directory listing
│   └── cli-loader.ts           # Load CLI tools from tools.yaml
├── sessions/
│   ├── manager.ts              # Session CRUD operations
│   ├── jsonl.ts                # JSONL read/write/append
│   ├── compaction.ts           # Context compaction strategy
│   └── types.ts                # SessionMetadata, SessionListItem
├── cron/
│   ├── service.ts              # Cron job scheduling with croner
│   └── types.ts                # CronJobConfig, CronJobStatus
├── workflows/
│   ├── engine.ts               # Workflow execution engine
│   ├── loader.ts               # YAML workflow file loading
│   └── types.ts                # WorkflowDefinition, WorkflowStep
├── server/
│   ├── app.ts                  # Hono app setup, routes, middleware
│   ├── routes/
│   │   ├── sessions.ts         # /api/sessions routes
│   │   ├── cron.ts             # /api/cron routes
│   │   └── workflows.ts        # /api/workflows routes
│   └── ws.ts                   # WebSocket handler for agent streaming
├── security/
│   ├── command-filter.ts       # Dangerous command blocklist (pattern matching)
│   ├── env-filter.ts           # Environment variable allowlist
│   ├── path-filter.ts          # Filesystem access boundary enforcement
│   └── redaction.ts            # Log redaction rules for secrets
└── logging/
    ├── logger.ts               # Structured JSON logger (with redaction)
    └── rotation.ts             # Log file rotation
```

### 19.2 Design Principles

- **One concern per directory** — each directory owns its types, logic, and tests.
- **No circular dependencies** — the dependency graph flows downward: `server → agent → tools → security`. The `config` and `logging` modules are leaf dependencies used by everything.
- **Types colocated** — each module defines its own types in a `types.ts` file rather than a central types package.
- **Flat by default** — no unnecessary nesting. Only `tools/builtin/` and `server/routes/` have subdirectories because they contain multiple independent implementations.

### 19.3 Dependency Graph

```
index.ts
  ├── config/
  ├── logging/
  ├── server/
  │     ├── agent/
  │     │     ├── tools/
  │     │     │     └── security/
  │     │     └── sessions/
  │     ├── cron/
  │     └── workflows/
  └── cron/
```

### 19.4 Test Scenarios

- **S19.1**: No circular dependencies exist between modules (verified by import analysis).
- **S19.2**: Each module directory has a corresponding test file in `test/`.
- **S19.3**: The entry point (`index.ts`) imports only top-level modules — no deep imports.

---

## 20. Implementation Milestones

The project is built in four phases. Each phase produces a working, testable artifact. No phase depends on a future phase.

### 20.1 Phase 1: Foundation (MVP Core)

**Goal:** A working agent you can interact with via the terminal. No web UI, no cron.

| Task                                                               | Spec Documents                                                       | Test Scenarios            |
| ------------------------------------------------------------------ | -------------------------------------------------------------------- | ------------------------- |
| Project scaffold (package.json, tsconfig, oxlint, oxfmt, vitest)   | [Technology Stack](spec-technology-stack.md)                         | —                         |
| Configuration loader with TypeBox validation                       | [Security](spec-security.md), [Configuration](spec-configuration.md) | S12.1, S12.2, S17.1–S17.8 |
| Structured JSON logger                                             | [System Prompt & Observability](spec-system-prompt.md)               | S14.6, S14.7              |
| Security: command filter + env allowlist + path filter + redaction | [Security](spec-security.md)                                         | S11.1–S11.10              |
| Tool system: registry, executor, built-in tools                    | [Agent Loop & Tools](spec-agent-loop.md)                             | S6.1–S6.14                |
| Agent loop with streaming                                          | [Agent Loop & Tools](spec-agent-loop.md)                             | S5.1–S5.8                 |
| System prompt assembly                                             | [System Prompt & Observability](spec-system-prompt.md)               | S13.1–S13.7               |
| Session manager (JSONL persistence + concurrency)                  | [Sessions](spec-sessions.md)                                         | S7.1–S7.12                |

**Deliverable:** CLI script that loads config, registers tools, and runs the agent loop on a user prompt read from stdin. All unit tests pass.

### 20.2 Phase 2: Web Interface

**Goal:** Chat UI accessible via Tailscale. Interactive sessions with real-time streaming.

| Task                                                               | Spec Documents                                         | Test Scenarios            |
| ------------------------------------------------------------------ | ------------------------------------------------------ | ------------------------- |
| Hono server setup (REST + static files)                            | [Web Interface](spec-web-interface.md)                 | S10.1, S10.2, S16.1–S16.4 |
| WebSocket handler for agent streaming (runId, cancel, concurrency) | [Web Interface](spec-web-interface.md)                 | S10.3–S10.12, S16.5–S16.7 |
| Session naming (LLM-generated titles)                              | [Configuration](spec-configuration.md)                 | S18.1–S18.9               |
| REST API: session CRUD, listing                                    | [Web Interface](spec-web-interface.md)                 | S10.1, S10.2              |
| Static chat UI (HTML/CSS/JS)                                       | [Web Interface](spec-web-interface.md)                 | —                         |
| Tailscale identity header parsing                                  | [Security](spec-security.md)                           | S11.1, S11.6              |
| Logging: HTTP/WS events                                            | [System Prompt & Observability](spec-system-prompt.md) | S14.1–S14.5               |
| Error handling: retry + WebSocket surfacing                        | [System Prompt & Observability](spec-system-prompt.md) | S15.1–S15.9               |

**Deliverable:** Web-based chat interface accessible from any device on the Tailscale network. Multiple threads, real-time streaming, session history.

### 20.3 Phase 3: Automation

**Goal:** Cron jobs and workflows run unattended.

| Task                                                       | Spec Documents                                         | Test Scenarios |
| ---------------------------------------------------------- | ------------------------------------------------------ | -------------- |
| Cron service (croner integration + per-job policy)         | [Automation](spec-automation.md)                       | S8.1–S8.13     |
| REST API: cron pause/resume + status                       | [Web Interface](spec-web-interface.md)                 | —              |
| Workflow engine (YAML loading, conditions, step execution) | [Automation](spec-automation.md)                       | S9.1–S9.13     |
| REST API: workflow listing + triggering                    | [Web Interface](spec-web-interface.md)                 | —              |
| Session compaction                                         | [Sessions](spec-sessions.md)                           | S7.6           |
| Log rotation                                               | [System Prompt & Observability](spec-system-prompt.md) | S14.9          |

**Deliverable:** Scheduled tasks run on cron. Workflows are triggerable from the UI. Long-running sessions compact automatically.

### 20.4 Phase 4: Hardening

**Goal:** Production-ready deployment on the VM.

| Task                                       | Spec Documents                                                         | Test Scenarios    |
| ------------------------------------------ | ---------------------------------------------------------------------- | ----------------- |
| Config hot-reload (tools, cron, workflows) | [Security](spec-security.md)                                           | S12.5             |
| Systemd service file                       | [Deployment](#21-deployment)                                           | S21.1–S21.4       |
| Output truncation + timeout enforcement    | [Agent Loop & Tools](spec-agent-loop.md), [Security](spec-security.md) | S6.3, S6.4, S11.4 |
| Token usage tracking + metrics in UI       | [System Prompt & Observability](spec-system-prompt.md)                 | S14.3             |
| Integration tests with real LLM providers  | [Technology Stack](spec-technology-stack.md)                           | —                 |
| Documentation (README, deployment guide)   | —                                                                      | —                 |

**Deliverable:** Production deployment on the VM with process supervision, monitoring, and hot-reloadable configuration.

---

## 21. Deployment

### 21.1 VM Setup

1. Provision a VM with Node.js ≥ 20 installed.
2. Install Tailscale and join the tailnet.
3. Clone the agent repository and install dependencies.
4. Configure `~/.agent/config.yaml` with LLM provider credentials (via env vars).
5. Start the agent service.
6. Run `tailscale serve --bg https+insecure://127.0.0.1:8080` to expose via Tailscale.

### 21.2 Process Management

- The agent runs as a single Node.js process.
- Use systemd (or similar) for process supervision and auto-restart.
- Logs written to `~/.agent/logs/agent.log` and stdout.

### 21.3 Test Scenarios

- **S21.1**: Agent starts and binds to the configured host:port.
- **S21.2**: Agent is accessible via Tailscale HTTPS URL from another device on the tailnet.
- **S21.3**: Agent recovers gracefully after a crash (sessions are not lost).
- **S21.4**: Agent starts with no sessions, no cron jobs, and no workflows — serves an empty UI.

---

## 22. Inspirations

The following projects were studied during the research phase. Detailed findings are documented in [research_findings.md](research_findings.md).

- **Craft Agents** — [lukilabs/craft-agents-oss](https://github.com/lukilabs/craft-agents-oss) — Permission model, hooks system, plan-based workflows, JSONL session format.
- **OpenClaw** — [openclaw/openclaw](https://github.com/openclaw/openclaw) — Tailscale integration, cron service with croner, session isolation, gateway architecture.
- **Pi-Mono** — [badlogic/pi-mono](https://github.com/badlogic/pi-mono) — Agent loop pattern, `pi-ai` unified LLM API, TypeBox tool schemas, JSONL tree-structured sessions, compaction strategy.
