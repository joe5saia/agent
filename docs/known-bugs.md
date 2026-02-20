# Known Bugs

Tracked correctness and security bugs.

**Related documents:**

- [Implementation Plan](implementation-plan.md) — active build tasks and status
- [Agent Loop](spec-agent-loop.md) — tool execution flow and message handling
- [Sessions](spec-sessions.md) — persisted message format and context reconstruction

---

## Open Bugs

- None currently.

## Resolved Bugs

### KB-001 — Persisted assistant reasoning leaks into restored context

- **Severity:** P1
- **Status:** Resolved (2026-02-20)
- **Previously reported in:** `src/index.ts:83`
- **Resolution:** Session persistence now uses the shared codec in `src/sessions/message-codec.ts`, which excludes `thinking` blocks from persisted assistant content.

### KB-002 — Tool result reconstruction loses original tool name

- **Severity:** P2
- **Status:** Resolved (2026-02-20)
- **Previously reported in:** `src/sessions/manager.ts:299`
- **Resolution:** `toolName` is now persisted in session message records and restored in runtime messages (`src/sessions/types.ts`, `src/sessions/message-codec.ts`, `src/sessions/manager.ts`).

### KB-003 — Config hot-reload leaves stale security/runtime settings in active server

- **Severity:** P1
- **Status:** Resolved (2026-02-20)
- **Previously reported in:** `src/index.ts:310`, `src/server/app.ts:22`, `src/server/index.ts:22`
- **Resolution:** Runtime now uses a mutable config provider (`src/runtime/config-provider.ts`) consumed at request/run time, and host/port changes trigger a graceful server restart during reload.

### KB-004 — WS active run cleanup can be skipped on pre-loop persistence failure

- **Severity:** P1
- **Status:** Resolved (2026-02-20)
- **Previously reported in:** `src/server/ws.ts:340`, `src/server/ws.ts:347`, `src/server/ws.ts:355`
- **Resolution:** WS run execution now wraps the full turn path in `try/finally` after active-run registration, guaranteeing cleanup and consistent error signaling.
