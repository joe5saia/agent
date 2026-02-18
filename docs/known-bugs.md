# Known Bugs

Tracked correctness and security bugs that are currently unresolved.

**Related documents:**

- [Implementation Plan](implementation-plan.md) — active build tasks and status
- [Agent Loop](spec-agent-loop.md) — tool execution flow and message handling
- [Sessions](spec-sessions.md) — persisted message format and context reconstruction

---

## Open Bugs

### KB-001 — Persisted assistant reasoning leaks into restored context

- **Severity:** P1
- **Status:** Open
- **Reported in:** `src/index.ts:83`
- **Summary:** Assistant `thinking` blocks are converted to regular text during session persistence, then replayed into model context on resume.
- **Impact:** Can leak reasoning content and inflate prompt token usage in follow-up turns.
- **Expected behavior:** Do not persist reasoning/thinking blocks as user-visible assistant text.

### KB-002 — Tool result reconstruction loses original tool name

- **Severity:** P2
- **Status:** Open
- **Reported in:** `src/sessions/manager.ts:299`
- **Summary:** Reconstructed `toolResult` messages force `toolName: "tool"` instead of preserving the original tool name.
- **Impact:** Session replay loses tool provenance and reduces multi-tool context fidelity.
- **Expected behavior:** Persist and restore the original `toolName` for each tool result record.
