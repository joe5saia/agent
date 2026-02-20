# Specification: Session & Thread Management

Session persistence, JSONL format, context building, compaction strategy, and concurrency.

**Related documents:**

- [Agent Loop & Tools](spec-agent-loop.md) — core loop that operates on sessions
- [Automation](spec-automation.md) — cron-triggered sessions
- [Web Interface](spec-web-interface.md) — session API and WebSocket events
- [Configuration](spec-configuration.md#182-session-naming) — session naming and listing UX
- [Security](spec-security.md#121-directory-structure) — storage directory layout

---

## 7. Session & Thread Management

Each thread is an isolated conversation with its own context. Sessions are persisted as append-only JSONL files.

### 7.1 Session Structure

```
~/.agent/sessions/{sessionId}/
├── session.jsonl       # Append-only message log (never rewritten)
└── metadata.json       # Session metadata (created, updated, model, etc.)
```

**Session ID format:** ULIDs (Universally Unique Lexicographically Sortable Identifiers), generated server-side only. Session IDs are validated against the pattern `^[0-9A-HJKMNP-TV-Z]{26}$` before use in filesystem operations. Session IDs from API requests are never used raw in path construction — they are validated and joined safely.

### 7.2 JSONL Format

Each line in `session.jsonl` is a JSON object with a `recordType` discriminator and a `schemaVersion` for forward compatibility. The `content` field is always `ContentBlock[]` — never a bare string — for consistency between in-memory and persisted representations.

```typescript
type ContentBlock =
	| { type: "text"; text: string }
	| { type: "toolCall"; id: string; name: string; arguments: Record<string, unknown> };

type SessionRecord =
	| {
			recordType: "message";
			schemaVersion: 1;
			seq: number;
			role: "user" | "assistant" | "toolResult";
			content: ContentBlock[];
			toolCallId?: string; // Present when role is "toolResult"
			isError?: boolean; // Present when role is "toolResult"
			timestamp: string; // ISO 8601
	  }
	| {
			recordType: "compaction";
			schemaVersion: 1;
			seq: number;
			firstKeptSeq: number; // Messages with seq < this are superseded by the summary
			summary: string; // Structured markdown summary (see §7.5)
			tokensBefore: number; // Token count of messages that were summarized
			readFiles: string[]; // Cumulative: files read across all compacted history
			modifiedFiles: string[]; // Cumulative: files written/edited across all compacted history
			timestamp: string;
	  };
```

**Example:**

```jsonl
{"recordType":"message","schemaVersion":1,"seq":1,"role":"user","content":[{"type":"text","text":"What pods are running?"}],"timestamp":"2025-02-11T10:00:00Z"}
{"recordType":"message","schemaVersion":1,"seq":2,"role":"assistant","content":[{"type":"text","text":"Let me check."},{"type":"toolCall","id":"tc_1","name":"bash","arguments":{"command":"kubectl get pods"}}],"timestamp":"2025-02-11T10:00:01Z"}
{"recordType":"message","schemaVersion":1,"seq":3,"role":"toolResult","content":[{"type":"text","text":"NAME   READY   STATUS\nnginx  1/1     Running"}],"toolCallId":"tc_1","isError":false,"timestamp":"2025-02-11T10:00:02Z"}
{"recordType":"message","schemaVersion":1,"seq":4,"role":"assistant","content":[{"type":"text","text":"There is one pod running: nginx, with status Running."}],"timestamp":"2025-02-11T10:00:03Z"}
```

### 7.3 Session Metadata

```typescript
interface SessionMetadata {
	id: string; // ULID, server-generated
	name?: string; // User-provided or auto-generated (see §18)
	createdAt: string; // ISO 8601
	lastMessageAt: string; // ISO 8601
	model: string; // LLM model used
	messageCount: number;
	source: "interactive" | "cron";
	cronJobId?: string; // If triggered by cron
	systemPromptOverride?: string; // Per-session instructions (see §13)
	metrics?: SessionMetrics; // Token usage aggregates (see §14)
}
```

### 7.4 Context Building

When loading a session for the agent loop (follows pi-mono's `buildSessionContext` pattern):

1. Read all lines from `session.jsonl`. Ignore trailing partial lines (crash recovery).
2. Find the latest `compaction` record (if any).
3. If a compaction exists:
   a. Emit the compaction summary as a user message, wrapped in context markers:
   ```
   The conversation history before this point was compacted into the following summary:
   <summary>
   {compaction.summary}
   </summary>
   ```
   b. Emit all `message` records with `seq ≥ compaction.firstKeptSeq` (the kept recent messages).
   c. Emit all `message` records after the compaction record itself.
4. If no compaction exists: emit all `message` records in order.
5. Convert the resulting records to `Message[]` for the LLM.
6. If the context exceeds the model's token limit, trigger compaction (§7.5).

**Token estimation:** Use a conservative heuristic of `chars / 4` for token counting unless `pi-ai` exposes a tokenizer.

### 7.5 Compaction Strategy (Append-Only Overlay)

Compaction follows [pi-mono's compaction strategy](https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/src/core/compaction/compaction.ts). The JSONL file is **never rewritten** — compaction records are appended as overlays.

#### 7.5.1 Configuration

```typescript
interface CompactionSettings {
	enabled: boolean;
	reserveTokens: number; // Default: 16384 — tokens reserved for LLM response
	keepRecentTokens: number; // Default: 20000 — recent tokens to keep uncompacted
}
```

```yaml
# ~/.agent/config.yaml (relevant section)
compaction:
  enabled: true
  reserve_tokens: 16384
  keep_recent_tokens: 20000
```

#### 7.5.2 Trigger

Compaction triggers when:

```
contextTokens > contextWindow - reserveTokens
```

#### 7.5.3 Algorithm

1. **Find cut point.** Walk backward from the newest message, accumulating estimated tokens. Stop when accumulated tokens ≥ `keepRecentTokens`. The cut point is the nearest valid boundary at or after that entry.
2. **Valid cut points.** Never cut in the middle of a tool call / tool result pair. Valid cut points are: user messages, assistant messages (without pending tool results), and compaction records.
3. **Extract file operations.** Scan tool calls in messages being summarized for file operations (`read` → `readFiles`, `write`/`edit` → `modifiedFiles`). During migration, treat `read_file` as `read`, `write_file` as `write`, and `list_directory` as `ls`. If a previous compaction exists, merge its `readFiles` and `modifiedFiles` sets (cumulative tracking). Files that appear in both `readFiles` and `modifiedFiles` are kept only in `modifiedFiles`.
4. **Generate structured summary.** Send the messages being compacted to the LLM with the summarization prompt (§7.5.4). If a previous compaction exists, use the **update prompt** instead, which instructs the LLM to merge new information into the existing summary.
5. **Append compaction record.** Write a `compaction` record to the JSONL file with:
   - `firstKeptSeq` — the `seq` of the first message to keep
   - `summary` — the structured markdown summary
   - `tokensBefore` — estimated tokens in the messages that were summarized
   - `readFiles` / `modifiedFiles` — cumulative file operation history

#### 7.5.4 Summary Format

The LLM generates a structured summary using this prompt:

**System prompt:**

```
You are a context summarization assistant. Your task is to read a conversation between
a user and an AI agent, then produce a structured summary following the exact format
specified. Do NOT continue the conversation. Do NOT respond to any questions in the
conversation. ONLY output the structured summary.
```

**Summarization prompt (initial compaction):**

```
The messages above are a conversation to summarize. Create a structured context
checkpoint summary that another LLM will use to continue the work.

Use this EXACT format:

## Goal
[What is the user trying to accomplish? Can be multiple items.]

## Constraints & Preferences
- [Any constraints, preferences, or requirements mentioned by user]

## Progress
### Done
- [x] [Completed tasks/changes]

### In Progress
- [ ] [Current work]

### Blocked
- [Issues preventing progress, if any]

## Key Decisions
- **[Decision]**: [Brief rationale]

## Next Steps
1. [Ordered list of what should happen next]

## Critical Context
- [Any data, examples, or references needed to continue]

Keep each section concise. Preserve exact file paths, function names, and error messages.
```

**Update prompt (when a previous compaction exists):**

```
The messages above are NEW conversation messages to incorporate into the existing
summary provided in <previous-summary> tags.

Update the existing structured summary with new information. RULES:
- PRESERVE all existing information from the previous summary
- ADD new progress, decisions, and context from the new messages
- UPDATE the Progress section: move items from "In Progress" to "Done" when completed
- UPDATE "Next Steps" based on what was accomplished
- PRESERVE exact file paths, function names, and error messages
- If something is no longer relevant, you may remove it

[Same format sections as initial prompt]
```

File operations are appended to the summary as structured tags:

```markdown
<read-files>
src/config/loader.ts
src/agent/loop.ts
</read-files>

<modified-files>
src/tools/executor.ts
src/sessions/manager.ts
</modified-files>
```

#### 7.5.5 Message Serialization for Summarization

Messages sent to the summarization LLM are serialized to prevent the model from treating them as a conversation to continue:

```
[User]: What pods are running?
[Assistant]: Let me check.
[Assistant tool calls]: bash(command="kubectl get pods")
[Tool result]: NAME   READY   STATUS
nginx  1/1     Running
[Assistant]: There is one pod running: nginx, with status Running.
```

This flat text format ensures the summarization model produces a summary, not a continuation.

### 7.6 Concurrency & Write Safety

Sessions use an **in-process per-session mutex** to prevent concurrent writes:

- Only one agent turn can run per session at a time. A second `send_message` to the same session is queued (see [Web Interface](spec-web-interface.md#104-concurrency-behavior)).
- JSONL writes are atomic at line granularity: each record is written as `JSON.stringify(record) + "\n"` in a single `fs.appendFile` call.
- On crash recovery, the JSONL reader ignores any trailing partial line (incomplete JSON).
- `metadata.json` is written atomically using write-to-temp-then-rename.

### 7.7 Test Scenarios

- **S7.1**: New session creates directory with empty `session.jsonl` and `metadata.json`.
- **S7.2**: Messages are appended to `session.jsonl` — the file is never rewritten.
- **S7.3**: Loading a session reconstructs the full message history from JSONL, applying compaction overlays.
- **S7.4**: Session metadata updates `lastMessageAt` and `messageCount` after each interaction.
- **S7.5**: Listing sessions returns all sessions sorted by `lastMessageAt` descending.
- **S7.6**: Compaction appends a `compaction` record — does not rewrite the file.
- **S7.7**: Cron-triggered sessions are tagged with `source: "cron"` and `cronJobId`.
- **S7.8**: Session ID in API request is validated against ULID pattern — invalid IDs return 400.
- **S7.9**: Crash mid-append produces a partial trailing line that is ignored on reload.
- **S7.10**: Concurrent `send_message` to the same session is queued, not interleaved.
- **S7.11**: Compaction overlay correctly replaces old messages: context after compaction contains the summary + messages from `firstKeptSeq` onward.
- **S7.12**: All `content` fields in persisted records are `ContentBlock[]` — never bare strings.
- **S7.13**: Compaction never cuts between a tool call and its tool result — cut points respect message boundaries.
- **S7.14**: Compaction summary follows the structured format (Goal, Progress, Key Decisions, Next Steps, Critical Context).
- **S7.15**: Cumulative file tracking: second compaction's `readFiles`/`modifiedFiles` include files from the first compaction.
- **S7.16**: Files that appear in both `readFiles` and `modifiedFiles` are listed only in `modifiedFiles`.
- **S7.17**: Update prompt is used when a previous compaction exists — preserves prior summary information.
- **S7.18**: Messages serialized for summarization use flat text format (`[User]:`, `[Assistant]:`, etc.) — not raw JSON.
