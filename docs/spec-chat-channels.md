# Specification: Chat Channels & Telegram Interface

Channel-first interaction architecture with a Telegram bot as the primary user interface, replacing
the custom browser chat UI while preserving the existing agent, tools, and session model.

**Related documents:**

- [Overview](spec-overview.md) — system goals and architecture boundaries
- [Agent Loop & Tools](spec-agent-loop.md) — turn execution and tool-call event stream
- [Sessions](spec-sessions.md) — JSONL persistence and per-session concurrency
- [Web Interface](spec-web-interface.md) — current HTTP/WS interface to be deprecated
- [Security](spec-security.md) — access control and execution boundaries
- [Configuration](spec-configuration.md) — config schema and reload behavior
- [Project Structure](spec-project-structure.md) — module layout and milestones

---

## 23. Channel Interface Architecture

The runtime exposes a **channel abstraction** that accepts inbound user messages from external chat
platforms and emits outbound replies back to the same platform deterministically.

This section is inspired by OpenClaw channel routing and transport hardening patterns, adapted to
this repository's architecture and coding style.

### 23.1 Goals

1. Replace the custom web chat UI with chat-native interfaces, starting with Telegram.
2. Keep core execution logic (`agentLoop`, `toolRegistry`, `sessionManager`) channel-agnostic.
3. Ensure deterministic routing: inbound message channel determines outbound channel.
4. Preserve existing session safety guarantees: serialized per-session turns and durable append-only
   history.
5. Support additional channels later (Slack/Discord/etc.) without changing core agent modules.

### 23.2 Non-Goals

1. Multi-tenant ownership and per-user private session isolation are out of scope for the first
   Telegram release.
2. Cross-channel handoff in a single run (for example Telegram inbound replying on Slack) is not
   supported.
3. Rich custom UI surfaces are out of scope for v1; chat messages and inline controls are enough.

### 23.3 Channel Provider Contract

All channels implement the same runtime contract.

```typescript
export interface ChannelRuntime {
	start(signal?: AbortSignal): Promise<void>;
	stop(): Promise<void>;
	send(event: OutboundEnvelope): Promise<DeliveryResult>;
}

export interface InboundEnvelope {
	channel: "telegram";
	accountId: string;
	conversationKey: string;
	messageId: string;
	user: {
		id: string;
		username?: string;
		displayName?: string;
	};
	content: {
		text: string;
		media?: Array<{ type: "audio" | "document" | "image" | "video"; url: string }>;
	};
	replyTo?: {
		messageId: string;
		senderId?: string;
		text?: string;
	};
	meta: {
		receivedAt: string;
		rawUpdateId?: number;
		threadKey?: string;
	};
}

export interface OutboundEnvelope {
	channel: "telegram";
	accountId: string;
	conversationKey: string;
	runId: string;
	parts: Array<
		| { type: "text"; text: string }
		| { type: "status"; text: string }
		| { type: "tool_event"; text: string }
	>;
	replyToMessageId?: string;
	threadKey?: string;
}
```

### 23.4 Session Keying and Mapping

The channel layer maps `conversationKey` values to internal `SessionManager` session IDs.

Canonical key shape for Telegram:

- DM: `telegram:dm:<userId>`
- DM thread: `telegram:dm:<userId>:thread:<threadId>`
- Group: `telegram:group:<chatId>`
- Forum topic: `telegram:group:<chatId>:topic:<topicId>`

Mapping persistence:

- File: `~/.agent/channels/telegram/conversations.jsonl`
- Atomic append-only updates with periodic compaction (same operational model as sessions JSONL)
- Record fields: `conversationKey`, `sessionId`, `channel`, `chatId`, `threadId`, `updatedAt`

### 23.5 Channel Router

Inbound processing flow:

1. Parse inbound payload into `InboundEnvelope`.
2. Authorize sender based on channel policy.
3. Resolve `conversationKey`.
4. Resolve/create `sessionId` via mapping store.
5. Append user message into session.
6. Run `agentLoop`.
7. Map stream/tool/status events into outbound channel events.
8. Deliver outbound content to same channel + conversation/thread context.

### 23.6 Access Policy Layer

Channel auth policy is evaluated before agent execution.

Policy model:

- `dmPolicy`: `pairing | allowlist | open | disabled`
- `groupPolicy`: `open | allowlist | disabled`
- `allowFrom`: DM sender allowlist
- `groupAllowFrom`: group sender allowlist
- per-group and per-topic overrides for mention gating and sender policy

### 23.7 Ordering, Concurrency, and Idempotency

1. Provider-level ordering:

- Process updates concurrently overall, but sequentially for the same conversation key.

2. Session-level ordering:

- Existing session queue in `SessionManager` remains authoritative.

3. Idempotency:

- Store last processed provider update watermark and short-window dedupe keys.

4. Retries:

- Recoverable transport/network errors use exponential backoff with jitter.

### 23.8 Failure Semantics and Backpressure

1. Queue budgets:

- Per-conversation pending update cap (`max_pending_updates_per_conversation`) defaults to `32`.
- Global pending update cap (`max_pending_updates_global`) defaults to `5000`.

2. Overflow handling:

- If a conversation queue is full, newest updates are dropped with structured warning logs.
- If global queue is full, provider pauses intake briefly (polling delay / webhook `503`) until load
  recovers.

3. Router-level hard failures:

- Session append failure, mapping corruption, or unrecoverable provider decode errors produce a
  terminal error event and do not invoke `agentLoop`.

4. Run abort behavior:

- Abort requests stop stream forwarding, cancel tool execution via `AbortSignal`, and prevent any
  new outbound chunks for that run.

### 23.9 Data Integrity and Recovery

1. Mapping-store corruption handling:

- Ignore trailing partial lines.
- Skip invalid records with warning logs.
- Continue startup if at least one valid record remains.

2. Duplicate mapping conflict:

- If two records map the same `conversationKey` to different `sessionId`s, latest valid record by
  `updatedAt` wins and conflict is logged.

3. Provider watermark recovery:

- Watermark persists periodically and on graceful shutdown.
- After restart, provider resumes from persisted watermark and dedupe cache to avoid replay storms.

### 23.10 Test Scenarios

- **S23.1**: Inbound channel envelope maps deterministically to a single `conversationKey`.
- **S23.2**: Existing `conversationKey` reuses the prior `sessionId`.
- **S23.3**: Missing `conversationKey` creates a new session and persists mapping.
- **S23.4**: Two concurrent updates for same key are processed in order.
- **S23.5**: Two concurrent updates for different keys execute independently.
- **S23.6**: Duplicate provider update is ignored without duplicate reply.
- **S23.7**: Network failure in provider send retries with backoff, then surfaces terminal error.
- **S23.8**: Access policy reject path never invokes `agentLoop`.
- **S23.9**: Aborted run emits cancel status and no further outbound chunks.
- **S23.10**: Provider stop drains in-flight handlers and exits cleanly.
- **S23.11**: Per-conversation queue overflow drops newest update and emits structured warning.
- **S23.12**: Global queue saturation pauses intake and recovers without process crash.
- **S23.13**: Mapping store with trailing partial line still loads valid mappings.
- **S23.14**: Conflicting mapping records deterministically resolve to latest record.
- **S23.15**: Router hard failure does not run `agentLoop` and emits terminal failure telemetry.

---

## 24. Telegram Provider Specification

Telegram is the first production channel provider.

### 24.1 Transport Modes

Supported modes:

1. **Long polling** (default).
2. **Webhook** (optional) with required secret verification.

Mode behavior:

- Exactly one mode is active at runtime.
- Startup validates mode-specific required config.
- Webhook mode rejects startup when `webhook_secret` is missing.

### 24.2 Telegram Configuration Model

YAML keys use snake_case and map to camelCase runtime fields.

```yaml
channels:
  telegram:
    enabled: true
    bot_token: "${TELEGRAM_BOT_TOKEN}"
    mode: "polling" # polling | webhook
    polling:
      timeout_seconds: 30
    webhook_url: ""
    webhook_secret: ""
    webhook_path: "/agent_telegram_webhook"
    webhook_host: "127.0.0.1"
    webhook_port: 8787

    dm_policy: "pairing" # pairing | allowlist | open | disabled
    allow_from: [] # numeric Telegram user IDs as strings
    group_policy: "allowlist" # open | allowlist | disabled
    group_allow_from: []

    groups:
      "*":
        require_mention: true
      "-1001234567890":
        group_policy: "open"
        require_mention: false
        topics:
          "42":
            require_mention: false

    streaming:
      mode: "partial" # off | partial | block | progress
      status_debounce_ms: 1000

    inbound:
      allowed_updates: ["message", "edited_message", "callback_query"]
      ignore_bot_messages: true
      dedupe_ttl_seconds: 900

    queue:
      max_pending_updates_per_conversation: 32
      max_pending_updates_global: 5000

    delivery:
      text_chunk_limit: 4000
      parse_mode: "html"
      link_preview: true
      media_max_mb: 5
      retry:
        attempts: 3
        min_delay_ms: 500
        max_delay_ms: 5000
        jitter: 0.2
```

Configuration rules:

1. `bot_token` is required when `enabled=true`.
2. `webhook_secret` is required in webhook mode and must be at least 16 characters.
3. `allowed_updates` defaults to a minimal safe set; unsupported update types are ignored.
4. `allow_from` and `group_allow_from` are numeric Telegram IDs as strings. Usernames are never
   used as an access-control primary key.

### 24.3 Inbound Normalization Rules

1. Text and caption are normalized into `content.text`.
2. Media attachments become typed placeholders plus retrievable references.
3. Reply metadata (`reply_to_message`) is preserved in `replyTo`.
4. Source filtering:

- Ignore messages sent by the bot itself when `inbound.ignore_bot_messages=true`.
- Ignore unsupported or non-message updates with debug-level logging.

5. Edit/delete behavior:

- `edited_message` updates are recorded as system events by default and do not trigger re-runs.
- Message deletions are logged as audit events only.

6. Group/thread semantics:

- Non-forum groups ignore `message_thread_id`.
- Forum groups map topic IDs into `:topic:<id>` session suffixes.
- Private chats with `message_thread_id` map to DM thread suffixes.

7. Text normalization safety:

- Preserve UTF-8 content and reject invalid control characters except newline/tab.
- Treat forwarded text, display names, and quoted text as untrusted input.

### 24.4 Mention Gating and Activation

Group behavior defaults to mention-gated:

- Explicit `@botusername` mention activates reply.
- Reply-to-bot messages count as implicit mention.
- Per-group/per-topic `require_mention` can disable gating.
- Session-level `/activation mention|always` toggles are supported as soft runtime overrides.
- If Telegram privacy mode prevents non-mentioned group visibility, runtime logs a setup warning and
  continues with mention-only behavior.

### 24.5 Outbound Delivery Rules

1. Stream handling:

- `stream_delta` events update a preview message when `streaming.mode != off`.

2. Status handling:

- Tool/status text is debounced to avoid API spam.

3. Finalization:

- Text-only final responses update preview in place when possible.
- Media/mixed payloads send final message and remove preview.

4. Formatting:

- Use HTML parse mode for text delivery.
- On parse failure, retry as plain text.

5. Thread routing:

- Preserve DM thread IDs and forum topic IDs where valid.
- For thread-specific send failures, retry once without thread parameter when safe.

6. Chunking:

- Chunk text deterministically at `text_chunk_limit` while preserving UTF-16-safe boundaries.
- Prefer paragraph boundaries (`\n\n`) before hard splitting.

7. Rate limiting and API recovery:

- On Telegram `429`, honor `retry_after` when provided.
- On transient `5xx`/network errors, retry with configured exponential backoff.
- On permanent `403` (blocked bot / forbidden), mark conversation as delivery-suppressed for the
  current run and emit warning telemetry.

### 24.6 Security and Abuse Controls

1. Pairing code approval flow for unknown DM senders (`dm_policy=pairing`).
2. Allowlist-only mode for production group deployments.
3. Explicit rejection responses for unauthorized users (optional, rate-limited).
4. Log redaction for bot tokens, webhook secrets, and sensitive payload fragments.
5. Webhook verification compares secret token in constant time and rejects missing/invalid headers.
6. Access policy is always evaluated on numeric sender IDs, never mutable usernames.

### 24.7 Observability

Emit structured events:

- `telegram_inbound_received`
- `telegram_inbound_rejected`
- `telegram_session_resolved`
- `telegram_stream_started`
- `telegram_stream_chunk_sent`
- `telegram_delivery_retry`
- `telegram_delivery_failed`
- `telegram_delivery_completed`

Metrics:

- inbound updates/sec
- median and p95 end-to-end turn latency
- delivery retry rate
- dedupe drop count
- mention-gating drop count

Every log event must include: `channel`, `accountId`, `conversationKey`, and when available
`runId`, `sessionId`, `rawUpdateId`, and `telegramChatId`.

### 24.8 Runtime Reload and Token Rotation

1. Config reload updates policy, mention gating, and delivery settings without process restart.
2. Bot token change triggers provider restart with bounded downtime.
3. Reload failure keeps last-known-good provider config active.
4. Webhook-mode config change re-registers webhook atomically (`setWebhook`/`deleteWebhook` flow).

### 24.9 Test Scenarios

- **S24.1**: Polling mode starts with valid token and processes message updates.
- **S24.2**: Webhook mode fails fast without `webhook_secret`.
- **S24.3**: Webhook request with invalid secret is rejected.
- **S24.4**: DM sender blocked by policy gets no agent execution.
- **S24.5**: DM sender approved by pairing is persisted and can message subsequently.
- **S24.6**: Group mention gating prevents reply when message has no mention.
- **S24.7**: Reply-to-bot in group triggers response without explicit mention.
- **S24.8**: Forum topic messages isolate context per topic ID.
- **S24.9**: Non-forum group reply threads do not create isolated sessions.
- **S24.10**: DM `message_thread_id` preserves thread-specific session routing.
- **S24.11**: Stream preview updates are debounced by configured interval.
- **S24.12**: Final text-only response edits preview instead of sending duplicate final message.
- **S24.13**: HTML parse error falls back to plain-text delivery.
- **S24.14**: Over-limit text is chunked deterministically by `text_chunk_limit`.
- **S24.15**: Recoverable outbound API failure retries and then succeeds.
- **S24.16**: Exhausted retries emit terminal delivery failure log with run/session context.
- **S24.17**: Duplicate update IDs are deduped and do not emit second response.
- **S24.18**: Provider shutdown drains in-flight deliveries and stops cleanly.
- **S24.19**: `edited_message` update logs system event and does not trigger new agent run.
- **S24.20**: Unsupported update type is ignored with debug log and no run side effects.
- **S24.21**: Bot-authored inbound message is ignored when `ignore_bot_messages=true`.
- **S24.22**: Telegram `429` with `retry_after` waits specified duration before retry.
- **S24.23**: Permanent `403` delivery error marks run delivery-suppressed and stops retries.
- **S24.24**: Config reload updates policy without dropping in-flight runs.
- **S24.25**: Invalid reload config preserves last-known-good Telegram runtime.

---

## 25. Migration: Web UI to Telegram UI

Migration is phased to avoid operational regressions.

### 25.1 Phase A — Dual Run (Safe Introduction)

1. Introduce `channels/telegram` runtime while keeping existing web UI.
2. Keep REST + WS operational for debugging and operational fallback.
3. Add feature flag: `channels.telegram.enabled`.
4. Validate policy, routing, streaming, and observability in production-like traffic.

### 25.2 Phase B — Telegram Primary

1. Set Telegram as primary user interface in runbooks and onboarding docs.
2. Keep web routes but mark as operator-only and non-default.
3. Route normal interactive usage through Telegram.

### 25.3 Phase C — Remove Custom Chat UI

1. Remove static chat assets and WS chat protocol endpoints.
2. Keep minimal HTTP surfaces:

- health endpoint
- cron/workflow admin API (if still required)

3. Preserve all existing session files and metadata formats.

### 25.4 Backward Compatibility

1. Existing sessions remain readable and writable.
2. Session naming behavior remains unchanged.
3. Cron/workflow jobs that currently run without UI continue unaffected.

### 25.5 Rollback and Kill Switch

1. Global kill switch: setting `channels.telegram.enabled=false` disables intake immediately.
2. Dual-run rollback: if Telegram error budget exceeds threshold (for example >5% delivery failure
   over 15 minutes), switch traffic guidance back to web UI while keeping Telegram disabled.
3. Data rollback is not required because session storage format is unchanged.

### 25.6 Test Scenarios

- **S25.1**: Enabling Telegram channel does not break existing web UI operation.
- **S25.2**: Same session continues across Telegram and WS during dual-run phase when mapped to
  same session ID.
- **S25.3**: Disabling Telegram at runtime stops inbound processing cleanly.
- **S25.4**: Removing chat UI assets does not affect cron/workflow APIs.
- **S25.5**: Historical sessions created pre-migration remain listable and executable.
- **S25.6**: Kill switch disables Telegram intake without process restart.
- **S25.7**: Rollback to web-primary preserves session continuity.
- **S25.8**: Dual-run rollback leaves cron/workflow execution behavior unchanged.

---

## 26. Implementation Scope & File Plan

### 26.1 New Modules

```
src/channels/
├── index.ts                      # channel runtime bootstrap + lifecycle
├── types.ts                      # provider contracts and envelope types
├── router.ts                     # conversationKey -> sessionId resolution
├── mapping-store.ts              # persistent conversation mapping store
└── telegram/
    ├── index.ts                  # provider factory + startup
    ├── polling.ts                # long-poll transport
    ├── webhook.ts                # webhook transport + secret validation
    ├── normalize.ts              # Telegram update -> InboundEnvelope mapping
    ├── delivery.ts               # OutboundEnvelope -> Telegram API calls
    ├── policy.ts                 # dm/group/mention policy enforcement
    └── types.ts                  # Telegram-specific parsed types
```

### 26.2 Required Existing-Module Changes

- `src/config/schema.ts` and `src/config/defaults.ts` — add `channels.telegram` config.
- `src/index.ts` — start/stop channel runtimes with server lifecycle.
- `src/server/*` — deprecate and then remove interactive WS/static UI surfaces in phase C.
- `src/sessions/manager.ts` — no breaking format change; optional helper for external key
  metadata tagging.
- `src/logging/*` — add channel event helpers and redaction coverage for Telegram secrets.
- `docs/spec-security.md` and `docs/spec-configuration.md` — align policy/reload/security fields.

### 26.3 Test Suite Additions

```
test/channels/router.test.ts
test/channels/mapping-store.test.ts
test/channels/telegram/policy.test.ts
test/channels/telegram/normalize.test.ts
test/channels/telegram/delivery.test.ts
test/channels/telegram/polling.test.ts
test/channels/telegram/webhook.test.ts
test/integration/telegram-e2e.test.ts
```

### 26.4 Test Scenarios

- **S26.1**: New channel config validates with defaults and strict typing.
- **S26.2**: Channel runtime start/stop is integrated into process lifecycle.
- **S26.3**: Mapping store survives restart and preserves conversation continuity.
- **S26.4**: End-to-end Telegram message produces persisted user/assistant session records.
- **S26.5**: Removing web chat UI routes does not regress health/admin APIs.
- **S26.6**: Mapping store conflict recovery chooses deterministic winner and logs conflict.
- **S26.7**: Reloaded token restarts Telegram provider and resumes intake.
- **S26.8**: Queue limits enforce bounded memory under synthetic update floods.
