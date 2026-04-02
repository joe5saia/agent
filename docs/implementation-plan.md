# Implementation Plan

Ordered build plan for the AI agent, derived from the spec documents. Each task produces working, testable code and lists its acceptance criteria (spec test scenario IDs).

## Maintenance Updates

- **2026-02-27:** Added persistent container package workflow for Docker runtime/app installs: introduced `deploy/docker/apk-packages.txt` image manifest, startup auto-apply from persisted runtime file `~/.agent/container/apk-packages.txt` in `deploy/docker/entrypoint.sh`, Docker build-time install support in `Dockerfile`, and `scripts/sync-runtime-apk-packages.sh` to promote runtime package changes back into the image manifest for reproducible rebuilds. Updated Docker/deployment docs accordingly. Verification: `npm run check` and shell syntax checks for updated scripts.
- **2026-02-26:** Completed the full Telegram-first channel specification implementation: added transport module split (`polling`, `webhook`) with webhook secret verification and backpressure responses, extracted Telegram normalization/policy/delivery modules, added update watermark persistence and reload-safe channel restart fallback, introduced legacy web chat gating (`server.interactive.ui_enabled` and `server.interactive.ws_enabled`, both default `false`) for phase-based migration away from custom UI, and added Telegram-focused tests (normalize/policy/delivery/polling/webhook plus integration e2e). Verification: `npm run check` and `npm test`.
- **2026-02-26:** Implemented the first Telegram channel delivery slice: added channel runtime contracts and bootstrap wiring (`src/channels/types.ts`, `src/channels/index.ts`, `src/index.ts`), durable conversation mapping and router (`src/channels/mapping-store.ts`, `src/channels/router.ts`), Telegram polling runtime with policy/dedupe/retry/stream-preview behavior (`src/channels/telegram/*`), and `channels.telegram` config schema/defaults/loader merge support. Added focused tests for router and mapping store plus config coverage updates. Verification: `npm run check`, `npm test`, and `npm test -- config channels-mapping-store channels-router`.
- **2026-02-26:** Added `docs/spec-chat-channels.md`, a detailed Telegram-first channel-interface spec inspired by OpenClaw routing/runtime patterns, including deterministic channel routing, session key mapping, policy model, transport reliability, migration phases, and acceptance scenarios `S23.*` through `S26.*`. Updated `docs/README.md` index and added planned implementation tasks below.
- **2026-02-26:** Added a hard guard that blocks generic `write`/`edit` tool mutations to `~/.agent/cron/jobs.yaml`, forcing cron changes through the dedicated validated `cron` tool. Implemented via protected-path validation options in `validatePath` and covered by `test/tools-read.test.ts`, `test/tools-edit.test.ts`, and `test/security.test.ts`. Verification: `npm run check` and `npm test`.
- **2026-02-26:** Added a dedicated built-in `cron` management tool with structured actions (`list`, `get`, `upsert`, `delete`, `enable`, `disable`, `validate`) and safe persistence semantics (full-document validation plus atomic writes). Hardened cron config loading with duplicate-ID detection and schedule/timezone validation at parse time, and added focused tests in `test/tools-cron.test.ts` and `test/cron-loader.test.ts`. Verification: `npm run check` and `npm test -- cron-loader tools-cron tools.test cron.test api-cron.test`.
- **2026-02-26:** Updated container/runtime privilege behavior so `sudo` is no longer hard-blocked by built-in command filtering (it can still be blocked via `security.blocked_commands`), and Docker runtime now installs/configures passwordless sudo for both `agent` and `node` users inside the container. Updated security/tooling specs and tests accordingly. Verification: `npm run check` and `npm test`.
- **2026-02-26:** Updated web UI conversation ergonomics: the sessions sidebar now has independent scroll behavior with sticky/full-height layout, is collapsible via a chat-header toggle with persisted preference (mobile defaults to collapsed), and chat content width is constrained responsively for readability on desktop while remaining full-width usable on mobile. Verification: `npm run check`.
- **2026-02-25:** Implemented universal prompt file control with `system_prompt.system_file`, `system_prompt.soul_file`, and `system_prompt.strict_prompt_files`; added strict/fallback file loading, legacy `identity_file` compatibility mode with deprecation warnings, subordinate soul-style section insertion, runtime warning logs, and test coverage updates for prompt/config behavior. Verification: `npm run check` and `npm test`.
- **2026-02-25:** Extended skills to full three-layer progressive disclosure (Codex-style): layer 1 metadata catalog (`name`, `description`), layer 2 active `SKILL.md` body injection, and layer 3 on-demand bundled resource excerpts from `references/`, `scripts/`, `assets/`, and linked local files. Added per-turn resource selection heuristics and bounded snippet loading with warnings for unreadable/non-text resources. Verification: `npm run check` and `npm test`.
- **2026-02-25:** Updated prompt architecture specs for universal `~/.agent/system.md` + `~/.agent/soul.md` control, including strict file handling (`strict_prompt_files`), compatibility-mode migration from `identity_file`, precedence rules, hot-reload behavior, and expanded test scenarios in `docs/spec-system-prompt.md` and `docs/spec-configuration.md`.
- **2026-02-25:** Added skills support with standard `SKILL.md` frontmatter format (`name`, `description`, markdown body), runtime skill loading from `~/.agent/skills`, per-turn skill activation heuristics (explicit `$skill-name` and relevance overlap), and system-prompt integration for both available-skill catalog and active-skill instructions. Added unit coverage for skill loading/selection and prompt composition. Verification: `npm run check` and `npm test`.
- **2026-02-25:** Updated server/frontend route prefixes for reverse-proxy path hosting: UI now served at `/agent`, health at `/agent_health`, API under `/agent_api/*`, and WebSocket at `/agent_ws`. Updated tests and deployment health checks accordingly. Verification: `npm run check` and `npm test`.
- **2026-02-20:** Added `scripts/deploy-kittenserver.sh` for SSH/rsync-based deployment to the existing Docker Compose runtime on `kittenserver`, with safe defaults (preserve remote compose/env), optional compose sync/delete/no-build flags, and post-deploy health check.
- **2026-02-20:** Completed Pi tool parity implementation across tasks P1-P5: added canonical built-ins (`read`, `write`, `edit`, `bash`, `grep`, `find`, `ls`), compatibility aliases with deprecation warnings and removal milestone, cron policy alias normalization, compaction tool-name normalization, and expanded tool/cron/compaction tests. Verification: `npm run check`, `npm test`, `npm test -- tools`, `npm test -- cron`, `npm test -- sessions`, `npm test -- compaction`.
- **2026-02-20:** Updated tool specs for Pi-style built-ins (`read`, `write`, `edit`, `bash`, `grep`, `find`, `ls`) and migration aliases in `docs/spec-agent-loop.md`, `docs/spec-automation.md`, `docs/spec-sessions.md`, and `docs/spec-project-structure.md`.
- **2026-02-20:** Updated chat composer keyboard behavior so plain Enter inserts a newline and Cmd+Enter submits the message (`public/app.js`).
- **2026-02-20:** Implemented architecture hardening fixes for all findings in `docs/architecture-review-v1.md`: metadata-based session sequencing and cached context rebuild path, async non-blocking logger with decoupled rotation checks, runtime config provider with graceful host/port restart on reload, WS queue backpressure/cleanup hardening, cached prompt/tool schema assembly, shared session message codec across CLI/WS/cron/workflows, and side-effect-free session GET reads. Verification: `npm run check` and `npm test`.
- **2026-02-20:** Completed V1 architecture hardening review and documented prioritized findings in `docs/architecture-review-v1.md` (structure, module coupling, reload semantics, and performance bottlenecks). Updated `docs/README.md` index and `docs/known-bugs.md` with newly identified unresolved defects.
- **2026-02-19:** Added `docs/onboarding-setup.md` with two onboarding tracks (dedicated VM and personal laptop), including Claude OAuth/Codex token setup and Docker Compose bootstrapping. Updated `docs/README.md` index.
- **2026-02-18:** Completed Phase 4 hardening delivery (config hot-reload, execution limit enforcement, token metrics tracking, systemd unit, integration tests, and deployment docs). Verification: `npm run check` and `npm test`.
- **2026-02-18:** Completed Phase 3 automation delivery (cron service and API, workflow engine/tooling/API, session compaction, and log rotation) with full test coverage. Verification: `npm run check` and `npm test`.
- **2026-02-18:** Resolved a strict typing regression in `src/sessions/manager.ts` so reconstructed assistant session messages now use a valid `Api` value and avoid unsafe type assertions. Verification: `npm run tsc` passes.
- **2026-02-18:** Added spec coverage for OAuth subscription credentials (`~/.agent/auth.json`) and env-first credential resolution in `docs/spec-security.md`.
- **2026-02-18:** Completed Phase 2 web interface delivery (`src/server/*`, `public/*`, retry integration, websocket streaming, session naming, and related tests). Verification: `npm test` and `npm run check`.

**Related documents:**

- [Project Structure](spec-project-structure.md) — phase overview and dependency graph
- [Technology Stack](spec-technology-stack.md) — runtime, tooling, test framework
- [Agent Loop & Tools](spec-agent-loop.md) — core loop and tool system
- [Sessions](spec-sessions.md) — session persistence and context building
- [Security](spec-security.md) — security model and storage
- [Configuration](spec-configuration.md) — config validation and session naming
- [System Prompt & Observability](spec-system-prompt.md) — prompt assembly, logging, error handling
- [Web Interface](spec-web-interface.md) — HTTP server, REST API, WebSocket
- [Automation](spec-automation.md) — cron and workflows
- [Chat Channels](spec-chat-channels.md) — channel abstraction, Telegram provider, and UI migration

---

## Planned Work: Pi Tool Parity

**Goal:** Replace legacy built-in tools with Pi-style behavior and naming, while keeping a short
migration window for compatibility aliases.

### Task P1 — Tool Surface + Registration Migration

**Status:** Completed (2026-02-20)

**Files to modify:**

- `src/tools/index.ts`
- `src/tools/types.ts` (if details payload typing must expand)
- `src/agent/system-prompt.ts` (if tool docs need richer per-tool usage notes)
- `test/tools.test.ts`

**Behavior:**

- Register Pi-style built-in names: `read`, `write`, `edit`, `bash`, `grep`, `find`, `ls`.
- Keep legacy aliases `read_file`, `write_file`, `list_directory` for one compatibility window.
- Preserve default interactive built-in set as `read`, `bash`, `edit`, `write`.
- Ensure cron/read-only policies can include `grep`, `find`, and `ls`.

**Acceptance criteria:** S6.1, S6.2, S6.15, S6.16, S8.9, S8.10

---

### Task P2 — Read/Write/Edit Tool Implementation

**Status:** Completed (2026-02-20)

**Files to modify/create:**

- `src/tools/builtin/read.ts` (new)
- `src/tools/builtin/write.ts` (new)
- `src/tools/builtin/edit.ts` (new)
- `src/tools/builtin/read-file.ts` (compat alias wrapper)
- `src/tools/builtin/write-file.ts` (compat alias wrapper)
- `test/tools-read.test.ts` (new)
- `test/tools-edit.test.ts` (new)

**Behavior:**

- `read` supports `path`, optional `offset`, optional `limit`, and actionable truncation messages.
- `write` writes UTF-8 content with parent-directory creation and path policy enforcement.
- `edit` performs exact replacement with guarded fuzzy fallback, enforces uniqueness, and returns
  diff details.
- All file-modifying and file-reading operations enforce `allowed_paths`/`denied_paths` and
  symlink boundary checks.

**Acceptance criteria:** S6.3, S6.10, S6.11, S6.12, S6.21, S6.22

---

### Task P3 — Bash Tool Parity

**Status:** Completed (2026-02-20)

**Files to modify/create:**

- `src/tools/builtin/bash.ts`
- `test/tools-bash.test.ts` (new)

**Behavior:**

- Keep command blocklist and environment allowlist enforcement.
- Add streamed output updates during execution.
- On large output, tail-truncate tool result and persist full output to a temp file; include file
  path in result details.
- Maintain timeout and non-zero exit handling semantics.

**Acceptance criteria:** S6.4, S6.5, S6.6, S6.13, S6.20

---

### Task P4 — Discovery Tools (`grep`, `find`, `ls`)

**Status:** Completed (2026-02-20)

**Files to modify/create:**

- `src/tools/builtin/grep.ts` (new)
- `src/tools/builtin/find.ts` (new)
- `src/tools/builtin/ls.ts` (new)
- `src/tools/builtin/list-directory.ts` (compat alias wrapper)
- `test/tools-discovery.test.ts` (new)

**Behavior:**

- `grep` searches content under scoped roots with deterministic, parseable output.
- `find` discovers files/directories under scoped roots with optional glob filtering.
- `ls` lists directory entries with deterministic ordering.
- All discovery tools enforce path boundaries consistently.

**Acceptance criteria:** S6.17, S6.18, S6.19

---

### Task P5 — Integration, Migration Removal Plan, and Verification

**Status:** Completed (2026-02-20)

**Files to modify:**

- `src/cron/service.ts` (if default read-tool filtering needs explicit inclusion updates)
- `src/sessions/compaction.ts` (tool-name normalization for file operation extraction)
- `test/cron.test.ts`
- `test/sessions.test.ts`

**Behavior:**

- Normalize tool names for compaction metadata (`read_file`/`write_file`/`list_directory` aliases).
- Ensure cron `allowed_tools` policies work with new tool names and aliases during migration.
- Add deprecation log warnings for legacy aliases and define a removal milestone.

**Acceptance criteria:** S7.6, S8.9, S8.10, S8.11

---

### Verification Gate

- Run `npm run check`.
- Run `npm test`.
- Run focused tests while iterating: `npm test -- tools`, `npm test -- cron`, `npm test -- sessions`.
- Merge only when all S6.1-S6.22 scenarios are covered by automated tests and green in CI.

---

## Planned Work: Channel Interface (Telegram-first)

**Goal:** Replace the custom browser chat UI with a Telegram bot interface while preserving existing
agent/tool/session behavior and setting a channel abstraction foundation for future providers.

### Task C1 — Channel Abstraction + Core Contracts

**Status:** Completed (2026-02-26)

**Files to modify/create:**

- `src/channels/types.ts` (new)
- `src/channels/index.ts` (new)
- `src/channels/router.ts` (new)
- `src/index.ts`
- `test/channels/router.test.ts` (new)

**Behavior:**

- Define normalized inbound/outbound channel envelopes and runtime lifecycle contracts.
- Add channel runtime bootstrap/start/stop wiring in process lifecycle.
- Add deterministic `conversationKey` routing and `conversationKey -> sessionId` resolution path.

**Acceptance criteria:** S23.1, S23.2, S23.3, S23.5, S26.2

---

### Task C2 — Conversation Mapping Store

**Status:** Completed (2026-02-26)

**Files to modify/create:**

- `src/channels/mapping-store.ts` (new)
- `test/channels/mapping-store.test.ts` (new)

**Behavior:**

- Persist `conversationKey -> sessionId` mapping in durable local storage.
- Provide atomic write semantics and restart-safe continuity.
- Support deterministic lookup, upsert, and compaction-friendly record format.
- Add corruption-tolerant load path (partial-line and invalid-record skip behavior).

**Acceptance criteria:** S23.2, S23.3, S23.13, S23.14, S26.3, S26.6

---

### Task C3 — Telegram Provider Transport (Polling + Webhook)

**Status:** Completed (2026-02-26)

**Files to modify/create:**

- `src/channels/telegram/index.ts` (new)
- `src/channels/telegram/polling.ts` (new)
- `src/channels/telegram/webhook.ts` (new)
- `test/channels-telegram-polling.test.ts` (new)
- `test/channels-telegram-webhook.test.ts` (new)

**Behavior:**

- Implement Telegram long-polling mode as default.
- Implement webhook mode with strict secret validation and startup preflight checks.
- Add transport retry/backoff and graceful shutdown handling.
- Honor Telegram `retry_after` on rate-limit responses.

**Acceptance criteria:** S24.1, S24.2, S24.3, S24.15, S24.18, S24.22

---

### Task C4 — Telegram Normalization, Policy, and Delivery

**Status:** Completed (2026-02-26)

**Files to modify/create:**

- `src/channels/telegram/types.ts` (new)
- `src/channels/telegram/normalize.ts` (new)
- `src/channels/telegram/policy.ts` (new)
- `src/channels/telegram/delivery.ts` (new)
- `test/channels-telegram-normalize.test.ts` (new)
- `test/channels-telegram-policy.test.ts` (new)
- `test/channels-telegram-delivery.test.ts` (new)

**Behavior:**

- Normalize Telegram updates into channel envelopes with thread/topic-aware keys.
- Enforce DM/group policy model and mention-gating behavior.
- Implement streamed preview delivery, debounced status updates, chunking, and parse fallback.
- Implement dedupe/update-watermark guardrails.
- Handle edited/unsupported/bot-authored inbound updates deterministically without accidental runs.

**Acceptance criteria:** S23.4, S23.6, S23.8, S23.11, S23.12, S23.15, S24.4-S24.14, S24.16, S24.17, S24.19, S24.20, S24.21, S24.23

---

### Task C5 — Configuration Schema + Defaults

**Status:** Completed (2026-02-26)

**Files to modify/create:**

- `src/config/schema.ts`
- `src/config/defaults.ts`
- `docs/spec-configuration.md`
- `test/config.test.ts`

**Behavior:**

- Add `channels.telegram` configuration surface (transport, policy, streaming, delivery, retry).
- Validate strict types and defaults for all channel config fields.
- Document YAML snake_case keys and runtime mapping behavior.
- Support safe runtime reload semantics with last-known-good fallback.

**Acceptance criteria:** S26.1, S24.1, S24.2, S24.24, S24.25, S26.7

---

### Task C6 — Web UI Deprecation + Migration

**Status:** Completed (2026-02-26)

**Files to modify/create:**

- `src/server/app.ts`
- `src/server/ws.ts`
- `public/*`
- `docs/spec-web-interface.md`
- `docs/deployment-guide.md`
- `test/server.test.ts`
- `test/ws.test.ts`
- `test/integration/telegram-e2e.test.ts` (new)

**Behavior:**

- Added explicit legacy-mode gating: `server.interactive.ui_enabled` and `server.interactive.ws_enabled`.
- Default runtime behavior is Telegram-first with custom web chat surfaces disabled.
- Health and admin REST surfaces remain available regardless of legacy chat toggle state.
- Preserved optional dual-run/operator fallback by enabling legacy UI/WS flags when required.

**Acceptance criteria:** S25.1-S25.8, S26.4, S26.5

---

## Guiding Principles

1. **Bottom-up build order** — leaf dependencies first (`config`, `logging`, `security`), then modules that depend on them (`tools`, `sessions`, `agent`), then integration layers (`server`, `cron`, `workflows`).
2. **Each task is independently testable** — every task ends with `npm test` passing for its scope.
3. **No forward references** — a task never imports a module built by a later task.
4. **Spec scenarios are acceptance criteria** — a task is done when its listed `S*` scenarios pass as unit tests.

---

## Phase 1: Foundation (MVP Core)

**Goal:** A working agent invocable from a CLI script. No web UI, no cron, no workflows.

### Task 1.1 — Configuration Loader

Build the configuration module that all other modules depend on.

**Status:** Completed (2026-02-18)

**Files to create:**

- `src/config/schema.ts` — TypeBox schemas for `AgentConfig` and all nested sections
- `src/config/defaults.ts` — default values for optional fields
- `src/config/loader.ts` — YAML parsing, `Value.Default()`, `Value.Check()`, error formatting
- `src/config/index.ts` — public API re-export
- `test/config.test.ts`

**Behavior:**

- `loadConfig(path)` reads a YAML file, applies defaults, validates with TypeBox, returns a typed `AgentConfig`.
- Missing optional fields are filled with defaults from the schema.
- Missing required fields (`model.provider`, `model.name`) produce a clear error with the field path.
- Invalid YAML syntax produces a parse error.
- Extra fields are silently ignored (no `additionalProperties` enforcement).
- When no config file exists at the path, a `ConfigNotFoundError` is thrown with a message suggesting the required fields.
- YAML `snake_case` keys map to TypeScript `camelCase` properties at the schema level.

**Acceptance criteria:** S17.1, S17.2, S17.3, S17.4, S17.5, S17.6, S17.7

---

### Task 1.2 — Structured Logger

Build the structured JSON logger with redaction.

**Status:** Completed (2026-02-18)

**Files to create:**

- `src/logging/logger.ts` — `createLogger()` returning a logger with `error`, `warn`, `info`, `debug` methods; outputs JSON Lines to stdout and/or a file
- `src/logging/redaction.ts` — key-based and pattern-based redaction (`*_KEY`, `*_TOKEN`, `*_SECRET`, `*_PASSWORD`, `authorization`; `eyJ...` JWT patterns; `AKIA...` AWS key patterns)
- `src/logging/index.ts` — public API re-export
- `test/logging.test.ts`

**Behavior:**

- Each log entry is a single-line JSON object with `ts` (ISO 8601), `level`, `module`, `event`, and arbitrary extra fields.
- Log level filtering — entries below the configured level are not emitted.
- All field values pass through the redaction layer before serialization.
- The logger accepts a `module` name at creation time (e.g., `createLogger("agent-loop")`).
- File output appends to the configured log file path, creating parent directories as needed.

**Acceptance criteria:** S14.6, S14.7, S11.7, S11.8, S14.10

**Depends on:** Task 1.1 (reads `config.logging` for level, file path, stdout toggle)

---

### Task 1.3 — Security Filters

Build the four security modules: command blocklist, environment allowlist, path filter, and log redaction.

**Status:** Completed (2026-02-18)

**Files to create:**

- `src/security/command-filter.ts` — `isBlockedCommand(command: string): { blocked: boolean; reason?: string }` using pattern matching against the blocklist
- `src/security/env-filter.ts` — `buildToolEnv(allowedKeys: string[], toolEnv?: Record<string, string>): Record<string, string>` constructing a minimal subprocess environment
- `src/security/path-filter.ts` — `validatePath(target: string, allowedPaths: string[], deniedPaths: string[]): { allowed: boolean; reason?: string }` resolving symlinks and checking boundaries
- `src/security/index.ts` — public API re-export
- `test/security.test.ts`

**Behavior:**

- **Command filter:** pattern-matches against the configured blocklist. Catches `rm -rf /`, `rm -rf /*`, `shutdown`, `reboot`, `mkfs`, `dd if=`, `chmod 777`, `git push --force` to main/master. `sudo` can be included by configuration. Uses regex, not exact string match.
- **Env filter:** constructs a new `Record<string, string>` containing only allowlisted keys from `process.env`, merged with optional tool-specific env vars. Never passes through `process.env` as-is.
- **Path filter:** resolves the target path to an absolute path (following symlinks via `fs.realpathSync`), checks denied paths first (denied takes precedence), then checks allowed paths. Tilde (`~`) is expanded to `$HOME`.

**Acceptance criteria:** S11.2, S11.3, S11.5, S11.9, S11.10, S6.6, S6.10, S6.11, S6.12

**Depends on:** Task 1.1 (reads `config.security` for blocklist, allowlists, path lists)

---

### Task 1.4 — Tool System (Registry, Executor, Built-in Tools)

Build the tool registry, executor with safety checks, and the four built-in tools.

**Status:** Completed (2026-02-18)

**Files to create:**

- `src/tools/types.ts` — `AgentTool`, `ToolCategory`, `ToolResult` type definitions
- `src/tools/registry.ts` — `ToolRegistry` class with `register(tool)`, `get(name)`, `list()`, `toToolSchemas()` (for LLM)
- `src/tools/executor.ts` — `executeTool(registry, name, args, signal?)` with TypeBox validation, timeout, output truncation, and security checks
- `src/tools/builtin/bash.ts` — shell command execution via `spawn(cmd, args, { shell: true })` with command filter, env filter, output truncation, and timeout
- `src/tools/builtin/read-file.ts` — file reading with path filter enforcement
- `src/tools/builtin/write-file.ts` — file writing with path filter enforcement
- `src/tools/builtin/list-directory.ts` — directory listing with path filter enforcement
- `src/tools/index.ts` — public API re-export, `registerBuiltinTools()` helper
- `test/tools.test.ts`

**Behavior:**

- Tools are registered by name. Duplicate names throw at registration time.
- `executeTool` validates arguments against the tool's TypeBox `parameters` schema before calling `execute`. Invalid arguments return a validation error string (not thrown — returned to LLM).
- Output is truncated at `config.tools.output_limit` bytes with an appended `[output truncated]` notice.
- Execution is aborted after `config.tools.timeout` seconds. The subprocess is killed and a timeout error is returned.
- The `bash` tool runs commands via `child_process.spawn` with the filtered environment. Blocked commands are rejected before execution.
- File tools (`read_file`, `write_file`, `list_directory`) call `validatePath()` before any filesystem operation.

**Acceptance criteria:** S6.1, S6.2, S6.3, S6.4, S6.5, S6.6, S6.8, S6.10, S6.11, S6.12, S6.13

**Depends on:** Task 1.1, Task 1.3

---

### Task 1.5 — CLI Tool Loader

Load external CLI tools from `tools.yaml` and register them in the tool registry.

**Status:** Completed (2026-02-18)

**Files to create:**

- `src/tools/cli-loader.ts` — `loadCliTools(path: string): AgentTool[]` parsing YAML, validating schemas, creating tool definitions with structured `spawn(cmd, args, { shell: false })` execution
- `test/cli-loader.test.ts`

**Behavior:**

- Each CLI tool definition in YAML is converted to an `AgentTool` with a TypeBox schema generated from the `parameters` block.
- Template variables (`{{resource}}`, `{{namespace}}`) are interpolated into individual argument positions after parameter validation.
- `optional_args` are appended only when the corresponding parameter is provided.
- Tool-specific `env` vars are passed to `buildToolEnv()`.
- Parameter validation catches injection attempts (e.g., `resource: "pods; rm -rf ~"`) via `enum`/`pattern` constraints.
- Commands execute with `spawn(cmd, args, { shell: false })` — shell metacharacters are literal.

**Acceptance criteria:** S6.7, S6.8, S6.9, S6.13

**Depends on:** Task 1.4, Task 1.3

---

### Task 1.6 — Session Manager

Build session persistence with JSONL append-only storage and context building.

**Status:** Completed (2026-02-18)

**Files to create:**

- `src/sessions/types.ts` — `SessionRecord`, `ContentBlock`, `SessionMetadata`, `SessionListItem`, `CompactionSettings` type definitions
- `src/sessions/jsonl.ts` — `appendRecord(path, record)`, `readRecords(path): SessionRecord[]` with crash-recovery (ignore trailing partial lines)
- `src/sessions/manager.ts` — `SessionManager` class with `create()`, `get(id)`, `list()`, `delete(id)`, `appendMessage()`, `buildContext()`, `updateMetadata()`; includes per-session in-process mutex
- `src/sessions/index.ts` — public API re-export
- `test/sessions.test.ts`

**Behavior:**

- `create()` generates a ULID, creates the session directory, writes empty `session.jsonl` and initial `metadata.json`.
- `appendMessage()` serializes a `SessionRecord` as JSON + `\n` and appends via `fs.appendFile`. Each record has an incrementing `seq` number and ISO 8601 `timestamp`.
- `buildContext()` reads all records, finds the latest compaction (if any), and returns the `Message[]` array for the LLM following the algorithm in §7.4.
- `list()` reads all `metadata.json` files, returns `SessionListItem[]` sorted by `lastMessageAt` descending.
- `delete(id)` removes the session directory.
- Session IDs are validated against `^[0-9A-HJKMNP-TV-Z]{26}$` before use in any filesystem path.
- The per-session mutex ensures only one write operation runs at a time. Concurrent writes to the same session are queued, not interleaved.
- `metadata.json` is written atomically (write to temp file, then rename).
- All `content` fields are `ContentBlock[]` — never bare strings.

**Acceptance criteria:** S7.1, S7.2, S7.3, S7.4, S7.5, S7.8, S7.9, S7.10, S7.12

**Depends on:** Task 1.1

---

### Task 1.7 — System Prompt Assembly

Build the system prompt builder that composes identity, tool descriptions, workflow catalog, session context, and custom instructions.

**Status:** Completed (2026-02-18)

**Files to create:**

- `src/agent/system-prompt.ts` — `buildSystemPrompt(session, tools, workflows, config): string`
- `test/system-prompt.test.ts`

**Behavior:**

- Concatenates prompt layers in order: identity → tool descriptions → workflow catalog → session context → custom instructions.
- Identity is loaded from the file at `config.systemPrompt.identityFile`. If the file does not exist, a sensible default identity block is used.
- Tool descriptions are auto-generated from the registry — each tool's name, description, and parameter schema are formatted.
- Workflow catalog is included only when workflows are loaded (empty list → layer skipped).
- Session-level `systemPromptOverride` is appended when present.
- Custom instructions file is loaded from `config.systemPrompt.customInstructionsFile`. Missing file is silently skipped (no error).

**Acceptance criteria:** S13.1, S13.2, S13.3, S13.4, S13.5, S13.6, S13.7

**Depends on:** Task 1.1, Task 1.4 (tool types)

---

### Task 1.8 — Agent Loop

Build the core agent loop with streaming, tool execution, and cancellation.

**Status:** Completed (2026-02-18)

**Files to create:**

- `src/agent/types.ts` — `AgentEvent`, `AgentLoopConfig` type definitions
- `src/agent/loop.ts` — `agentLoop(messages, tools, systemPrompt, model, config, signal?, onEvent?): Promise<Message[]>` implementing the stream → tool → stream cycle
- `src/agent/index.ts` — public API re-export
- `test/agent-loop.test.ts`
- `test/helpers/mock-llm.ts` — mock LLM provider that returns canned responses, simulates tool calls, and supports abort signals

**Behavior:**

- The loop calls `streamSimple()` from `pi-ai`, iterates over streaming events (forwarding to `onEvent`), collects the assistant message, and checks `stopReason`.
- If `stopReason === "toolUse"`, the loop executes each `toolCall` content block via `executeTool`, appends tool results, and loops.
- If `stopReason !== "toolUse"`, the loop exits and returns the accumulated messages.
- Tool errors are caught and returned as `{ isError: true }` tool results — never thrown.
- `AbortSignal` is checked before each stream call and each tool execution. When aborted, `signal.throwIfAborted()` throws and the loop exits.
- When `iterations >= maxIterations`, the loop appends a terminal "Stopped: maximum iteration limit reached." message and exits.

**Acceptance criteria:** S5.1, S5.2, S5.3, S5.4, S5.5, S5.6, S5.7, S5.8

**Depends on:** Task 1.4, Task 1.7

---

### Task 1.9 — CLI Entry Point

Wire everything together into a CLI script that loads config, registers tools, and runs the agent loop on a prompt from stdin.

**Status:** Completed (2026-02-18)

**Files to modify:**

- `src/index.ts` — update to load config, create logger, register tools, create a session, read prompt from stdin, run the agent loop, print the result

**Behavior:**

- Reads `~/.agent/config.yaml` (or `AGENT_CONFIG_PATH` env var).
- Creates a `ToolRegistry`, registers built-in tools, loads CLI tools from `~/.agent/tools.yaml` (if it exists).
- Creates a new session via `SessionManager`.
- Reads a prompt from stdin (single line or piped input).
- Builds the system prompt and runs `agentLoop()`.
- Prints the final assistant message to stdout.
- Exits with code 0 on success, 1 on error.

**Acceptance criteria:** Manual verification — run `echo "What is 2+2?" | node dist/index.js` and get a response. All unit tests from tasks 1.1–1.8 pass.

**Depends on:** All prior Phase 1 tasks

---

### Task 1.10 — OAuth Credential Resolver (`auth.json`)

Wire provider OAuth subscriptions into runtime model calls while preserving env-var override behavior.

**Status:** Completed (2026-02-18)

**Files to create:**

- `src/auth/store.ts` — load/save `~/.agent/auth.json`, atomic writes, typed provider credential map
- `src/auth/resolver.ts` — `resolveApiKey(provider, options?): Promise<string | undefined>` with env-first lookup and OAuth refresh fallback
- `src/auth/index.ts` — public API re-export
- `test/auth-resolver.test.ts`

**Files to modify:**

- `src/agent/loop.ts` — inject resolved `apiKey` into `streamSimple()` options
- `src/index.ts` — initialize auth resolver and pass it into `agentLoop()`

**Behavior:**

- For provider `anthropic`, use credential priority:
  1. `ANTHROPIC_OAUTH_TOKEN`
  2. `ANTHROPIC_API_KEY`
  3. OAuth credentials in `~/.agent/auth.json` (via `getOAuthApiKey()`), with persisted refresh updates
- For providers without OAuth credentials, preserve existing env-var behavior.
- `auth.json` read failures are non-fatal when env credentials are present.
- `auth.json` writes use atomic temp-file + rename semantics.
- All auth-path logs redact tokens and never include raw secrets.

**Acceptance criteria:** S11.11, S11.12, S11.13

**Depends on:** Task 1.8, Task 1.9

---

### Phase 1 Verification

```bash
npm test                 # All unit tests pass (tasks 1.1–1.10)
npm run check            # Lint, format, type check pass
```

**Module dependency graph at this point:**

```
index.ts → config/, logging/, agent/, tools/, sessions/, security/
agent/ → tools/, sessions/
tools/ → security/
```

No circular dependencies exist.

---

## Phase 2: Web Interface

**Goal:** Chat UI accessible via Tailscale with real-time streaming.

### Task 2.1 — Hono Server Setup

Build the HTTP server with static file serving and the REST API skeleton.

**Status:** Completed (2026-02-18)

**Files to create:**

- `src/server/app.ts` — Hono app setup, static file middleware, health endpoint
- `src/server/middleware/identity.ts` — Tailscale identity header parsing (`Tailscale-User-Login`, `Tailscale-User-Name`), audit logging, optional `allowed_users` enforcement
- `src/server/index.ts` — `startServer(config, deps): Promise<Server>` binding to configured host:port
- `test/server.test.ts`

**Behavior:**

- Server binds to `config.server.host` (default `127.0.0.1`) on `config.server.port` (default `8080`).
- Static files are served from `./public` under the `/ui/` path.
- Tailscale identity headers are parsed on every request and logged for audit.
- When `config.security.allowed_users` is non-empty, requests without a matching `Tailscale-User-Login` header from non-loopback sources are rejected with 403.
- The server exports the Hono `app` for testing without binding to a port.

**Acceptance criteria:** S11.1, S11.6, S16.1, S16.2

**Depends on:** Task 1.1, Task 1.2

---

### Task 2.2 — Session REST API

Build the REST endpoints for session CRUD.

**Status:** Completed (2026-02-18)

**Files to create:**

- `src/server/routes/sessions.ts` — route handlers for `GET /api/sessions`, `POST /api/sessions`, `GET /api/sessions/:id`, `DELETE /api/sessions/:id`
- `test/api-sessions.test.ts`

**Behavior:**

- `GET /api/sessions` returns `SessionListItem[]` sorted by `lastMessageAt` descending.
- `POST /api/sessions` creates a new session, accepts optional `name` and `systemPrompt` in the body, validates with TypeBox, returns `{ id, name }`.
- `GET /api/sessions/:id` returns the full session history (messages reconstructed via `buildContext()`).
- `DELETE /api/sessions/:id` removes the session directory and returns 204.
- Invalid session IDs return 400. Non-existent session IDs return 404.
- Invalid request bodies return 400 with TypeBox validation error details.

**Acceptance criteria:** S10.1, S10.2, S7.5, S7.8, S16.3, S16.4

**Depends on:** Task 1.6, Task 2.1

---

### Task 2.3 — WebSocket Handler

Build the WebSocket endpoint for real-time agent streaming.

**Status:** Completed (2026-02-18)

**Files to create:**

- `src/server/ws.ts` — WebSocket upgrade handler, message parsing, `runId` generation, agent loop invocation, event forwarding, cancellation, per-session message queue
- `test/ws.test.ts`

**Behavior:**

- Client sends `{ type: "send_message", sessionId, content }` → server generates a `runId` (ULID), emits `run_start`, runs the agent loop, forwards `stream_delta`, `tool_start`, `tool_result` events, and emits `message_complete` when done.
- Client sends `{ type: "cancel", sessionId, runId }` → server triggers `AbortSignal` for the matching run.
- Two `send_message` to the same session are serialized via the per-session mutex — second waits.
- Multiple clients connected to the same session all receive the same events.
- Client disconnect mid-stream does not crash the server — the run continues, results are persisted.
- `send_message` to a non-existent session returns an `error` event.
- Invalid JSON from the client returns an `error` event.
- All server messages include `sessionId` and `runId` for client correlation.

**Acceptance criteria:** S10.3, S10.4, S10.5, S10.6, S10.7, S10.8, S10.9, S10.10, S10.12, S16.5, S16.6

**Depends on:** Task 1.6, Task 1.8, Task 2.1

---

### Task 2.4 — Session Naming

Build automatic session title generation.

**Status:** Completed (2026-02-18)

**Files to modify:**

- `src/sessions/manager.ts` — add `generateTitle()` method
- `src/server/ws.ts` — trigger title generation after first turn, emit `session_renamed`
- `test/session-naming.test.ts`

**Behavior:**

- After the first assistant response completes, the server calls the LLM with the title generation prompt (first user message + first assistant response → "Generate a concise title, 6 words max").
- Title generation runs asynchronously — does not block the response stream.
- On success, updates `metadata.json` with the new name and emits a `session_renamed` WebSocket event.
- On failure (LLM error), falls back to truncating the first user message at 60 characters on a word boundary with `...`.
- User-provided names (set via `POST /api/sessions` or a future rename endpoint) take precedence and are never overwritten by auto-generation.
- Cron sessions use the format `"[cron] {jobId} — {timestamp}"`.
- Default name before any messages: `"New Session"`.

**Acceptance criteria:** S18.1, S18.2, S18.3, S18.4, S18.5, S18.6, S18.7, S18.8, S18.9

**Depends on:** Task 1.6, Task 2.3

---

### Task 2.5 — Error Handling & Retry

Build the provider retry strategy and error surfacing through WebSocket.

**Status:** Completed (2026-02-18)

**Files to create:**

- `src/agent/retry.ts` — `withRetry(fn, config, signal?, onStatus?)` wrapping a provider call with exponential backoff, jitter, `retry-after` header support, and status callbacks
- `test/retry.test.ts`

**Files to modify:**

- `src/agent/loop.ts` — wrap the `streamSimple()` call with `withRetry()`
- `src/server/ws.ts` — forward `status` events (e.g., "Rate limited. Retrying in 3s...") to the client

**Behavior:**

- Retryable status codes (429, 500, 502, 503, 529) trigger retries up to `config.retry.maxRetries`.
- Delay is `baseDelayMs * 2^attempt`, capped at `maxDelayMs`, with ±50% jitter.
- 429 responses with a `retry-after` header use the header value instead.
- Non-retryable errors (401, 400) fail immediately.
- Each retry attempt is logged with attempt number and delay.
- `status` WebSocket events are emitted during retry waits.
- After max retries, the error is surfaced as a WebSocket `error` event. The session remains usable.

**Acceptance criteria:** S15.1, S15.2, S15.3, S15.4, S15.5, S15.6, S15.7, S15.9

**Depends on:** Task 1.8, Task 1.1

---

### Task 2.6 — HTTP/WS Logging

Add structured logging for HTTP requests, WebSocket connections, and agent loop events.

**Status:** Completed (2026-02-18)

**Files to modify:**

- `src/server/app.ts` — add request logging middleware (method, path, status, duration)
- `src/server/ws.ts` — log `ws_connect`, `ws_disconnect` events
- `src/agent/loop.ts` — log `turn_start`, `turn_end`, `tool_call`, `tool_blocked`, `tool_timeout`, `tool_output_truncated` events
- `test/logging-events.test.ts`

**Behavior:**

- Every HTTP request is logged at `info` level with method, path, status code, and duration.
- WebSocket connect/disconnect events are logged with a client identifier.
- Agent loop events (`turn_start`, `turn_end`) include `sessionId`, `model`, token counts, and duration.
- Tool calls are logged with tool name, duration, and error status.
- Blocked tools are logged at `warn` with the rejection reason.
- All log entries pass through redaction before output.

**Acceptance criteria:** S14.1, S14.2, S14.3, S14.4, S14.5, S14.8

**Depends on:** Task 1.2, Task 2.3

---

### Task 2.7 — Static Chat UI

Build a minimal web-based chat interface.

**Status:** Completed (2026-02-18)

**Files to create:**

- `public/index.html` — chat layout with sidebar (session list) and main panel (message thread, input)
- `public/style.css` — clean, minimal styling
- `public/app.js` — WebSocket client, session list management, message rendering, streaming display, cancel button

**Behavior:**

- Sidebar lists sessions by name and relative timestamp. Clicking a session loads its history.
- "New Session" button creates a session via `POST /api/sessions` and opens it.
- Messages are rendered as a thread. User messages on the right, assistant on the left.
- Streaming text appears incrementally as `stream_delta` events arrive.
- Tool calls show a collapsible section with tool name, arguments, and result.
- A cancel button appears during active runs and sends a `cancel` WebSocket message.
- `session_renamed` events update the sidebar in real time.

**Acceptance criteria:** Manual verification — open `http://127.0.0.1:8080/ui/` and have a multi-turn conversation with tool use.

**Depends on:** Task 2.2, Task 2.3

---

### Task 2.8 — Server Graceful Shutdown

Handle clean server shutdown, closing WebSocket connections.

**Status:** Completed (2026-02-18)

**Files to modify:**

- `src/server/index.ts` — listen for `SIGINT`/`SIGTERM`, close all WebSocket connections, drain active runs, then close the HTTP server

**Acceptance criteria:** S16.7

**Depends on:** Task 2.1, Task 2.3

---

### Phase 2 Verification

```bash
npm test                 # All unit tests pass (phases 1–2)
npm run check            # Lint, format, type check pass
# Manual: open the web UI, create a session, send messages, see streaming, cancel a run
```

---

## Phase 3: Automation

**Goal:** Cron jobs and workflows run unattended.

### Task 3.1 — Cron Service

Build the cron scheduling service with per-job tool policies.

**Status:** Completed (2026-02-18)

**Files to create:**

- `src/cron/types.ts` — `CronJobConfig`, `CronJobStatus` type definitions
- `src/cron/service.ts` — `CronService` class with `start(jobs)`, `pause(id)`, `resume(id)`, `getStatus(): CronJobStatus[]`; uses `croner` with overrun protection
- `src/cron/index.ts` — public API re-export
- `test/cron.test.ts`

**Behavior:**

- Each enabled job is scheduled with `new Cron(schedule, { timezone, protect: true, ... })`.
- Disabled jobs are not scheduled.
- Each run creates an isolated session with `source: "cron"` and `cronJobId`.
- The job's `policy.allowed_tools` restricts the tool registry to only those tools. If `policy` is omitted, only `read`-category tools are available.
- `admin`-category tools are blocked in cron regardless of `allowed_tools`.
- Job errors are caught, logged, and tracked in `consecutiveFailures` (resets on success).
- `pause(id)` / `resume(id)` stop/start the croner job.
- Config reload (adding, removing, editing jobs) takes effect without server restart.

**Acceptance criteria:** S8.1, S8.2, S8.3, S8.4, S8.5, S8.6, S8.7, S8.8, S8.9, S8.10, S8.11, S8.12, S8.13

**Depends on:** Task 1.6, Task 1.8, Task 1.4

---

### Task 3.2 — Cron REST API

Build the REST endpoints for cron job management.

**Status:** Completed (2026-02-18)

**Files to create:**

- `src/server/routes/cron.ts` — route handlers for `GET /api/cron`, `POST /api/cron/:id/pause`, `POST /api/cron/:id/resume`
- `test/api-cron.test.ts`

**Behavior:**

- `GET /api/cron` returns `CronJobStatus[]` including `id`, `schedule`, `enabled`, `lastRunAt`, `lastStatus`, `consecutiveFailures`, `nextRunAt`.
- `POST /api/cron/:id/pause` pauses a running job. Returns 404 for unknown IDs.
- `POST /api/cron/:id/resume` resumes a paused job. Returns 404 for unknown IDs.

**Acceptance criteria:** S8.7, S8.13

**Depends on:** Task 3.1, Task 2.1

---

### Task 3.3 — Workflow Engine

Build the workflow execution engine with condition evaluation, templating, and step failure handling.

**Status:** Completed (2026-02-18)

**Files to create:**

- `src/workflows/types.ts` — `WorkflowDefinition`, `WorkflowStep`, `StepStatus`, `WorkflowRunResult` type definitions
- `src/workflows/loader.ts` — `loadWorkflows(dir: string): WorkflowDefinition[]` parsing YAML files, validating template variables, generating TypeBox parameter schemas
- `src/workflows/condition.ts` — safe recursive descent expression evaluator (~50 lines) supporting boolean literals, parameter references, negation, equality, `&&`, `||`, parentheses
- `src/workflows/template.ts` — `expandTemplate(template: string, parameters: Record<string, unknown>): string` with validation for unknown variables
- `src/workflows/engine.ts` — `runWorkflow(name, parameters, deps): Promise<WorkflowRunResult>` executing steps sequentially, evaluating conditions, handling `on_failure` policies
- `src/workflows/index.ts` — public API re-export
- `test/workflows.test.ts`
- `test/condition-evaluator.test.ts`

**Behavior:**

- Workflow files are loaded from `~/.agent/workflows/` and validated at load time.
- Parameters are validated against TypeBox schemas before execution begins.
- Each step runs as a separate agent turn within a dedicated workflow session.
- Conditions are evaluated by the safe expression evaluator — `false` skips the step. Unparseable conditions skip the step with a warning.
- Template variables are expanded from parameters. Unknown variables cause a load-time validation error.
- Step status progresses: `pending` → `running` → `completed` | `skipped` | `failed`.
- `on_failure: halt` (default) stops the workflow. `continue` logs and proceeds. `skip_remaining` skips all remaining steps.
- The condition evaluator is implemented as a recursive descent parser. It does **not** use `eval()`.

**Acceptance criteria:** S9.1, S9.2, S9.3, S9.4, S9.5, S9.6, S9.8, S9.9, S9.10, S9.11, S9.12, S9.13

**Depends on:** Task 1.6, Task 1.8

---

### Task 3.4 — Workflows as Tools

Expose loaded workflows as agent tools so the LLM can trigger them.

**Status:** Completed (2026-02-18)

**Files to modify:**

- `src/workflows/engine.ts` — add `workflowToTool(workflow): AgentTool` converting a `WorkflowDefinition` to a callable tool
- `src/tools/registry.ts` — register workflow tools at startup and on reload
- `test/workflows.test.ts` — add test for tool invocation

**Acceptance criteria:** S9.7

**Depends on:** Task 3.3, Task 1.4

---

### Task 3.5 — Workflow REST API

Build the REST endpoints for workflow management.

**Status:** Completed (2026-02-18)

**Files to create:**

- `src/server/routes/workflows.ts` — route handlers for `GET /api/workflows`, `POST /api/workflows/:name/run`
- `test/api-workflows.test.ts`

**Behavior:**

- `GET /api/workflows` returns workflow definitions (name, description, parameters).
- `POST /api/workflows/:name/run` validates parameters, triggers execution, returns the run result. Returns 404 for unknown workflow names. Returns 400 for invalid parameters.

**Depends on:** Task 3.3, Task 2.1

---

### Task 3.6 — Session Compaction

Build the context compaction strategy with append-only overlay records.

**Status:** Completed (2026-02-18)

**Files to create:**

- `src/sessions/compaction.ts` — `compactSession(sessionId, model, config): Promise<void>` implementing the algorithm from §7.5

**Files to modify:**

- `src/sessions/manager.ts` — call `compactSession()` when `buildContext()` detects context exceeding `contextWindow - reserveTokens`
- `test/compaction.test.ts`

**Behavior:**

- Compaction triggers when estimated context tokens exceed `contextWindow - reserveTokens`.
- Walk backward to find the cut point, keeping at least `keepRecentTokens` worth of recent messages.
- Never cut between a tool call and its tool result.
- Extract `readFiles` / `modifiedFiles` from tool calls in the compacted messages. Merge with previous compaction's file sets (cumulative). Files in both sets are kept only in `modifiedFiles`.
- Serialize compacted messages to flat text format (`[User]:`, `[Assistant]:`, etc.) and send to the LLM with the summarization system prompt.
- Use the update prompt when a previous compaction exists.
- Append a `compaction` record to the JSONL file — never rewrite the file.
- The structured summary follows the format: Goal, Constraints & Preferences, Progress, Key Decisions, Next Steps, Critical Context.

**Acceptance criteria:** S7.6, S7.11, S7.13, S7.14, S7.15, S7.16, S7.17, S7.18

**Depends on:** Task 1.6

---

### Task 3.7 — Log Rotation

Build the log file rotation mechanism.

**Status:** Completed (2026-02-18)

**Files to create:**

- `src/logging/rotation.ts` — `rotateIfNeeded(logPath, config): void` checking date and file size, renaming current log to `agent.{date}.log`

**Files to modify:**

- `src/logging/logger.ts` — call `rotateIfNeeded()` before each write (or on a timer)
- `test/log-rotation.test.ts`

**Behavior:**

- Rotates daily: `agent.log` → `agent.2025-02-11.log`.
- Rotates early if the file exceeds `config.logging.rotation.maxSizeMb`.
- Deletes rotated files older than `config.logging.rotation.maxDays`.

**Acceptance criteria:** S14.9

**Depends on:** Task 1.2

---

### Phase 3 Verification

```bash
npm test                 # All unit tests pass (phases 1–3)
npm run check            # Lint, format, type check pass
# Manual: configure a cron job, verify it fires and creates a session
# Manual: trigger a workflow from the UI, verify step execution
```

---

## Phase 4: Hardening

**Goal:** Production-ready deployment on the VM.

### Task 4.1 — Config Hot-Reload

Watch configuration files and reload tools, cron jobs, and workflows without restarting.

**Status:** Completed (2026-02-18)

**Files to modify:**

- `src/config/loader.ts` — add `watchConfig(paths, onChange)` using `fs.watch`
- `src/index.ts` — wire up config watchers for `config.yaml`, `tools.yaml`, `cron/jobs.yaml`, `workflows/*.yaml`

**Behavior:**

- File changes trigger a reload: parse the new file, validate it, and swap the active configuration.
- Invalid new configuration is logged as an error but does not crash the server — the previous configuration remains active.
- Reload events are logged at `info` level with the changed sections.

**Acceptance criteria:** S12.5, S17.8

**Depends on:** Task 1.1

---

### Task 4.2 — Output Truncation & Timeout Enforcement

Harden tool execution limits and verify enforcement across all tool types.

**Status:** Completed (2026-02-18)

**Files to modify:**

- `src/tools/executor.ts` — verify truncation and timeout apply to all tools (built-in and CLI)
- `test/tools.test.ts` — add edge-case tests for large outputs and long-running commands

**Acceptance criteria:** S6.3, S6.4, S11.4

**Depends on:** Task 1.4

---

### Task 4.3 — Token Usage Tracking

Track and aggregate token usage per turn and per session.

**Status:** Completed (2026-02-18)

**Files to modify:**

- `src/agent/loop.ts` — extract token counts from `pi-ai` response metadata
- `src/sessions/manager.ts` — aggregate `SessionMetrics` in `metadata.json`

**Files to create:**

- `test/token-tracking.test.ts`

**Behavior:**

- Each `turn_end` log entry includes `inputTokens`, `outputTokens`, `totalTokens`.
- `SessionMetrics` in `metadata.json` accumulates `totalTurns`, `totalTokens`, `totalToolCalls`, `totalDurationMs`.

**Acceptance criteria:** S14.3

**Depends on:** Task 1.8, Task 1.6

---

### Task 4.4 — Systemd Service File

Create a systemd unit file for process management.

**Status:** Completed (2026-02-18)

**Files to create:**

- `deploy/agent.service` — systemd unit file with auto-restart, environment file, working directory, logging to journal

**Behavior:**

- The service runs `node dist/index.js` as a dedicated user.
- Auto-restarts on crash with a 5-second delay.
- Environment variables (API keys) are loaded from an env file (`~/.agent/.env`).
- Logs are forwarded to the systemd journal.

**Acceptance criteria:** S21.1, S21.3

**Depends on:** Task 1.9

---

### Task 4.5 — Integration Tests

Write integration tests that exercise the full stack with a real LLM provider.

**Status:** Completed (2026-02-18)

**Files to create:**

- `test/integration/agent-e2e.test.ts` — end-to-end test: create session → send message → receive streamed response → verify JSONL persistence
- `test/integration/cron-e2e.test.ts` — cron job fires → session created → verify metadata

**Behavior:**

- Tests are gated behind `describe.skipIf(!process.env.ANTHROPIC_API_KEY)`.
- Each test creates a fresh session, sends a simple prompt, and verifies the response and persistence.
- Tests use `{ retry: 3 }` for flaky API resilience.

**Acceptance criteria:** S21.4

**Depends on:** All prior tasks

---

### Task 4.6 — Deployment Documentation

Write deployment and operations documentation.

**Status:** Completed (2026-02-18)

**Files to create:**

- `docs/deployment-guide.md` — VM setup, Tailscale configuration, systemd installation, config file examples, troubleshooting

**Files to modify:**

- `README.md` — update with project description, quickstart, and link to deployment guide
- `docs/README.md` — add `deployment-guide.md` to the index table

**Acceptance criteria:** S21.1, S21.2 (documentation covers these scenarios)

---

### Phase 4 Verification

```bash
npm test                 # All unit tests pass
npm run check            # Lint, format, type check pass
ANTHROPIC_API_KEY=... npm test  # Integration tests pass
```

---

## Dependency Graph

```
Phase 1 (Foundation)
  1.1 Config ─────────────────┬─── 1.2 Logger
                               ├─── 1.3 Security ──── 1.4 Tools ──── 1.5 CLI Loader
                               ├─── 1.6 Sessions
                               └─── 1.7 System Prompt
                                          │
  1.4 Tools ──────────────────────────── 1.8 Agent Loop
  1.7 System Prompt ──────────────────────┘
                                          │
  All Phase 1 ───────────────────────── 1.9 CLI Entry Point

Phase 2 (Web Interface)
  1.1 + 1.2 ──────────── 2.1 Server Setup
  1.6 + 2.1 ──────────── 2.2 Session API
  1.6 + 1.8 + 2.1 ───── 2.3 WebSocket
  1.6 + 2.3 ──────────── 2.4 Session Naming
  1.8 + 1.1 ──────────── 2.5 Retry
  1.2 + 2.3 ──────────── 2.6 Logging Events
  2.2 + 2.3 ──────────── 2.7 Chat UI
  2.1 + 2.3 ──────────── 2.8 Graceful Shutdown

Phase 3 (Automation)
  1.6 + 1.8 + 1.4 ───── 3.1 Cron Service
  3.1 + 2.1 ──────────── 3.2 Cron API
  1.6 + 1.8 ──────────── 3.3 Workflow Engine
  3.3 + 1.4 ──────────── 3.4 Workflows as Tools
  3.3 + 2.1 ──────────── 3.5 Workflow API
  1.6 ────────────────── 3.6 Compaction
  1.2 ────────────────── 3.7 Log Rotation

Phase 4 (Hardening)
  1.1 ────────────────── 4.1 Config Hot-Reload
  1.4 ────────────────── 4.2 Truncation & Timeout
  1.8 + 1.6 ──────────── 4.3 Token Tracking
  1.9 ────────────────── 4.4 Systemd Service
  All ────────────────── 4.5 Integration Tests
                          4.6 Deployment Docs
```

---

## Test Scenario Coverage

Every spec test scenario ID is mapped to a task. Cross-reference:

| Scenario Range | Task(s)             | Spec Document                                              |
| -------------- | ------------------- | ---------------------------------------------------------- |
| S5.1–S5.8      | 1.8                 | [Agent Loop](spec-agent-loop.md#53-test-scenarios)         |
| S6.1–S6.22     | P1, P2, P3, P4, 1.5 | [Tool System](spec-agent-loop.md#65-test-scenarios)        |
| S7.1–S7.18     | 1.6, 3.6            | [Sessions](spec-sessions.md#77-test-scenarios)             |
| S8.1–S8.13     | 3.1, 3.2            | [Cron](spec-automation.md#85-test-scenarios)               |
| S9.1–S9.13     | 3.3, 3.4, 3.5       | [Workflows](spec-automation.md#97-test-scenarios)          |
| S10.1–S10.12   | 2.2, 2.3            | [Web Interface](spec-web-interface.md#106-test-scenarios)  |
| S11.1–S11.10   | 1.3, 2.1            | [Security](spec-security.md#115-test-scenarios)            |
| S12.1–S12.5    | 1.1, 1.6, 4.1       | [Storage](spec-security.md#123-test-scenarios)             |
| S13.1–S13.7    | 1.7                 | [System Prompt](spec-system-prompt.md#135-test-scenarios)  |
| S14.1–S14.10   | 1.2, 2.6, 3.7       | [Logging](spec-system-prompt.md#147-test-scenarios)        |
| S15.1–S15.9    | 2.5                 | [Error Handling](spec-system-prompt.md#156-test-scenarios) |
| S16.1–S16.7    | 2.1, 2.3, 2.8       | [Web Framework](spec-web-interface.md#164-test-scenarios)  |
| S17.1–S17.8    | 1.1, 4.1            | [Configuration](spec-configuration.md#174-test-scenarios)  |
| S18.1–S18.9    | 2.4                 | [Session Naming](spec-configuration.md#185-test-scenarios) |
| S21.1–S21.4    | 4.4, 4.5, 4.6       | [Deployment](spec-project-structure.md#213-test-scenarios) |
