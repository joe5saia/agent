# Architecture Review: V1 Launch Readiness

Deep architectural review of code structure, module organization, and runtime performance risk
for late-beta hardening before a V1 launch.

**Related documents:**

- [Implementation Plan](implementation-plan.md) - delivery status and phase history
- [Known Bugs](known-bugs.md) - unresolved correctness/security defects
- [Project Structure](spec-project-structure.md) - intended module boundaries
- [System Prompt](spec-system-prompt.md) - prompt and observability expectations
- [Sessions](spec-sessions.md) - persistence and compaction design

---

## 1. Scope and Method

This review used source-level and test-level analysis across `src/` and `test/`, with emphasis on:

1. Runtime-critical paths (`server/ws`, `sessions`, `agent`, `logging`)
2. Dependency boundaries and coupling
3. Hot-reload behavior and operational safety
4. Code duplication that can create behavior drift

Summary signal from the current architecture:

- Strong base: strict typing, module separation, no cross-module cycles.
- Main launch risk: a few high-impact hotspots around state reload semantics and I/O-heavy hot paths.

---

## 2. What Is Working Well

1. The dependency graph is mostly clean and acyclic across top-level modules.
2. Tool execution, workflows, cron, and sessions are separated into clear directories.
3. Type strictness and validation discipline are strong (`TypeBox`, strict TS config).
4. Test coverage breadth is good (unit + API + integration slices).

---

## 2.1 Resolution Status (2026-02-20)

| Finding | Status   | Implemented in                                                                                                                                   |
| ------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| AR-001  | Resolved | `src/sessions/manager.ts`, `src/sessions/types.ts`                                                                                               |
| AR-002  | Resolved | `src/logging/logger.ts`, `src/logging/rotation.ts`                                                                                               |
| AR-003  | Resolved | `src/runtime/config-provider.ts`, `src/index.ts`, `src/server/app.ts`, `src/server/index.ts`, `src/server/ws.ts`                                 |
| AR-004  | Resolved | `src/server/ws.ts`                                                                                                                               |
| AR-005  | Resolved | `src/agent/system-prompt.ts`, `src/tools/registry.ts`, `src/agent/loop.ts`, `src/index.ts`                                                       |
| AR-006  | Resolved | `src/sessions/message-codec.ts`, `src/index.ts`, `src/server/ws.ts`, `src/cron/service.ts`, `src/workflows/engine.ts`                            |
| AR-007  | Resolved | `src/sessions/manager.ts`, `src/server/routes/sessions.ts`, `src/index.ts`, `src/server/ws.ts`, `src/cron/service.ts`, `src/workflows/engine.ts` |
| AR-008  | Resolved | `src/sessions/message-codec.ts`, `src/runtime/config-provider.ts`, `src/agent/system-prompt.ts`, `src/server/ws.ts`, `src/index.ts`              |

---

## 3. Findings

### AR-001 (P0) - Session persistence has O(n) write behavior and O(n^2) growth risk

**Details**

- Every `appendMessage` call reads the full JSONL file to compute `seq`.
- Context rebuild also re-reads full history and scans for compaction overlays.
- Session list reads metadata in a serial N+1 pattern.

**Why this is an issue**

- Latency scales with session size.
- Large sessions increase CPU and memory pressure for normal chat operations.
- Under concurrent usage, disk I/O becomes a limiting factor.

**High-level direction to fix**

1. Move `seq` source of truth to `metadata.json` (or a dedicated per-session index) to avoid full
   history reads on append.
2. Introduce segmented session logs or snapshots so context rebuild reads only active windows.
3. Parallelize metadata reads in `list()` with bounded concurrency.

**Evidence**

- `src/sessions/manager.ts:228`
- `src/sessions/manager.ts:229`
- `src/sessions/manager.ts:298`
- `src/sessions/manager.ts:196`
- `src/sessions/jsonl.ts:14`

### AR-002 (P0) - Logging path performs synchronous filesystem work on every log entry

**Details**

- Logger writes use `appendFileSync`.
- Rotation checks run per log event and call sync FS operations (`statSync`, `readdirSync`,
  `unlinkSync`).

**Why this is an issue**

- Blocks the Node event loop in request/streaming code paths.
- Can inflate WS/API tail latency and reduce throughput during busy runs.

**High-level direction to fix**

1. Replace sync writes with a buffered async writer (single append stream + flush interval).
2. Decouple rotation from each log write; run rotation on timer or size checkpoints.
3. Keep stdout logging independent from file persistence queue.

**Evidence**

- `src/logging/logger.ts:99`
- `src/logging/logger.ts:100`
- `src/logging/rotation.ts:35`
- `src/logging/rotation.ts:59`
- `src/logging/rotation.ts:69`

### AR-003 (P0) - Config hot-reload is partial and can leave stale runtime behavior

**Details**

- Reload updates `state.config` and selected deps, but server app and WS runtime are initialized
  with a startup config snapshot.
- Middleware uses `context.var.config` from that captured object.
- WS retry and iteration options are also captured at server construction time.

**Why this is an issue**

- Security and runtime policy can drift from on-disk config after reload.
- Operators may think reload applied when behavior remains stale until process restart.

**High-level direction to fix**

1. Introduce a runtime config provider (single mutable snapshot with versioning).
2. Read config-dependent values from provider at request/run time where safe.
3. For immutable-at-start concerns (host/port, WS runtime options), perform graceful server
   restart on config changes.

**Evidence**

- `src/index.ts:310`
- `src/index.ts:339`
- `src/server/index.ts:21`
- `src/server/index.ts:22`
- `src/server/app.ts:22`
- `src/server/middleware/identity.ts:62`

### AR-004 (P1) - WebSocket run lifecycle has cleanup and backpressure gaps

**Details**

- `activeRuns` is created before persistence calls that can throw, but the guarding `try/finally`
  starts later.
- Session queueing is unbounded and no queue-depth policy exists.

**Why this is an issue**

- Failed pre-loop persistence can leave leaked active-run state and incomplete terminal signaling.
- Burst traffic can grow in-memory queues without a hard cap.

**High-level direction to fix**

1. Expand `try/finally` to wrap the full turn path after `activeRuns` insertion.
2. Add per-session queue limits and reject/debounce policy (`busy`, `queue_full`, etc.).
3. Add explicit queue error handling and telemetry for dropped/failed queued work.

**Evidence**

- `src/server/ws.ts:223`
- `src/server/ws.ts:230`
- `src/server/ws.ts:340`
- `src/server/ws.ts:347`
- `src/server/ws.ts:355`
- `src/server/ws.ts:473`

### AR-005 (P1) - Prompt assembly recomputes heavy content on every turn

**Details**

- System prompt assembly reads identity/custom-instructions files synchronously each call.
- Tool and workflow schemas are re-serialized into prompt text each turn.
- Agent loop also rebuilds tool schemas each iteration.

**Why this is an issue**

- Adds avoidable CPU and I/O per request.
- Increases prompt size and token cost at runtime.

**High-level direction to fix**

1. Cache static prompt fragments (identity/custom instructions/tool/workflow catalog).
2. Invalidate caches only when config/tools/workflows change.
3. Reduce schema verbosity in prompt (compact descriptors over full pretty JSON where possible).

**Evidence**

- `src/agent/system-prompt.ts:47`
- `src/agent/system-prompt.ts:73`
- `src/agent/system-prompt.ts:84`
- `src/index.ts:299`
- `src/server/ws.ts:357`
- `src/agent/loop.ts:53`

### AR-006 (P1) - Message normalization logic is duplicated across runtime surfaces

**Details**

- `toSessionAppendInput` and assistant-text helpers are duplicated in CLI, WS, cron, and workflow
  code paths.
- Implementations are not identical (for example, treatment of `thinking` blocks).

**Why this is an issue**

- Behavior drift risk is high and already visible in known bug tracking.
- Future message-type changes require updates in multiple places.

**High-level direction to fix**

1. Centralize session message codec in one shared module.
2. Reuse codec everywhere (CLI, WS, cron, workflows).
3. Add parity tests that enforce identical behavior across all run entrypoints.

**Evidence**

- `src/index.ts:101`
- `src/server/ws.ts:61`
- `src/cron/service.ts:34`
- `src/workflows/engine.ts:11`
- `docs/known-bugs.md:14`

### AR-007 (P2) - Read endpoint has write side effects via compaction

**Details**

- `GET /api/sessions/:id` calls `buildContext`.
- `buildContext` can trigger compaction and append a compaction record.

**Why this is an issue**

- A read request can mutate persistent state and increase latency unpredictably.
- Harder to reason about idempotency and operational behavior under polling/UIs.

**High-level direction to fix**

1. Split context fetch into a pure-read API and a maintenance path.
2. Trigger compaction on write path or background maintenance worker.
3. Keep GET handlers side-effect free for predictable latency.

**Evidence**

- `src/server/routes/sessions.ts:59`
- `src/sessions/manager.ts:275`
- `src/sessions/manager.ts:277`

### AR-008 (P2) - Large orchestration files increase change coupling

**Details**

- Core orchestration code is concentrated in a few very large files:
  `src/sessions/manager.ts`, `src/server/ws.ts`, `src/index.ts`.
- Each file blends multiple responsibilities (transport, persistence, orchestration, policy).

**Why this is an issue**

- Regression risk rises as features expand.
- Onboarding and ownership boundaries become less clear.

**High-level direction to fix**

1. Split orchestration into smaller services with explicit interfaces:
   `SessionRepository`, `ContextBuilder`, `RunCoordinator`, `WsProtocolAdapter`,
   `RuntimeReloader`.
2. Keep data models near repositories and move policies into dedicated modules.
3. Enforce module boundary tests (import contracts + architectural lint rules).

**Evidence**

- `src/sessions/manager.ts`
- `src/server/ws.ts`
- `src/index.ts`

---

## 4. Recommended Launch Order

1. Fix AR-001 and AR-002 first (they directly affect latency and throughput).
2. Resolve AR-003 before launch so config reload behavior is trustworthy.
3. Address AR-004 and AR-006 next to reduce correctness drift and runtime fragility.
4. Schedule AR-005, AR-007, and AR-008 as immediate post-launch hardening if time is tight.

---

## 5. Suggested Success Criteria

1. P95 and P99 WS turn latency stable with 10x larger session histories.
2. Config reload acceptance tests prove policy/runtime option updates take effect.
3. No duplicated message codec logic across entrypoints.
4. Read-only API calls do not mutate session storage.
