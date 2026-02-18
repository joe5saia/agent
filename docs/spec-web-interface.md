# Specification: Web Interface & Framework

HTTP server, REST API, WebSocket protocol, and the Hono web framework.

**Related documents:**

- [Agent Loop & Tools](spec-agent-loop.md) — agent execution streamed via WebSocket
- [Sessions](spec-sessions.md) — session CRUD and concurrency
- [Automation](spec-automation.md) — cron/workflow REST endpoints
- [Security](spec-security.md) — Tailscale auth headers
- [System Prompt & Observability](spec-system-prompt.md#153-error-flow-through-websocket) — error handling and retry surfacing
- [Configuration](spec-configuration.md#182-session-naming) — session naming and listing UX

---

## 10. Web Interface

A lightweight web application provides the chat interface. It runs on the VM and is accessible only within the Tailscale network.

### 10.1 Architecture

- **HTTP server** — serves the web UI static files and provides a REST API for session management.
- **WebSocket** — provides real-time streaming of agent responses to the browser.
- **Static UI** — minimal chat interface (HTML/CSS/JS or lightweight framework).

### 10.2 REST API

| Method   | Path                       | Description                        |
| -------- | -------------------------- | ---------------------------------- |
| `GET`    | `/api/sessions`            | List all sessions                  |
| `POST`   | `/api/sessions`            | Create a new session               |
| `GET`    | `/api/sessions/:id`        | Get session history                |
| `DELETE` | `/api/sessions/:id`        | Delete a session                   |
| `GET`    | `/api/cron`                | List cron jobs and their status    |
| `POST`   | `/api/cron/:id/pause`      | Pause a cron job                   |
| `POST`   | `/api/cron/:id/resume`     | Resume a cron job                  |
| `GET`    | `/api/workflows`           | List available workflows           |
| `POST`   | `/api/workflows/:name/run` | Trigger a workflow with parameters |

### 10.3 WebSocket Protocol

Each agent turn is assigned a unique `runId` (ULID). All events for that turn include the `runId`, allowing the client to correlate events and cancel specific runs.

```typescript
// Client → Server
type ClientMessage =
	| { type: "send_message"; sessionId: string; content: string }
	| { type: "cancel"; sessionId: string; runId: string };

// Server → Client
type ServerMessage =
	| { type: "run_start"; sessionId: string; runId: string }
	| { type: "stream_delta"; sessionId: string; runId: string; text: string }
	| { type: "tool_start"; sessionId: string; runId: string; toolName: string; args: unknown }
	| {
			type: "tool_result";
			sessionId: string;
			runId: string;
			toolName: string;
			result: string;
			isError: boolean;
	  }
	| { type: "message_complete"; sessionId: string; runId: string }
	| { type: "status"; sessionId: string; runId: string; message: string }
	| { type: "session_renamed"; sessionId: string; name: string }
	| { type: "error"; sessionId: string; message: string };
```

### 10.4 Concurrency Behavior

| Scenario                                  | Server Behavior                                                        |
| ----------------------------------------- | ---------------------------------------------------------------------- |
| Two `send_message` to the same session    | Second message is queued; processed after the first run completes      |
| Two clients connected to the same session | Both receive all events; only one can have an active run               |
| Client disconnects mid-stream             | The active run continues to completion; results are persisted to JSONL |
| `cancel` message received                 | Server triggers `AbortSignal` for the active run; loop exits cleanly   |
| `send_message` to a non-existent session  | Error event returned immediately                                       |

The per-session mutex ([§7.6](spec-sessions.md#76-concurrency--write-safety)) ensures serialized access. The server maintains a message queue per session.

### 10.5 Authorization Model

The agent operates in **single-user mode**: all Tailnet members with access to the machine are trusted equally.

- Tailscale identity headers (`Tailscale-User-Login`, `Tailscale-User-Name`) are parsed and logged for audit on every request.
- An optional `security.allowed_users` list in config restricts access to specific Tailnet identities. If empty or omitted, all Tailnet members are allowed.
- Sessions are shared — any authorized user can view, send messages to, or delete any session.
- Multi-user session ownership is a future extension if needed.

```yaml
# ~/.agent/config.yaml (relevant section)
security:
  allowed_users: [] # Empty = all tailnet members allowed
  # allowed_users: ["alice@example.com", "bob@example.com"]
```

### 10.6 Test Scenarios

- **S10.1**: `GET /api/sessions` returns a list of sessions sorted by last message time.
- **S10.2**: `POST /api/sessions` creates a new session and returns its ID.
- **S10.3**: Sending a message via WebSocket streams the response back as `stream_delta` events with a `runId`.
- **S10.4**: Tool execution emits `tool_start` and `tool_result` events over WebSocket.
- **S10.5**: `message_complete` is sent after the agent finishes responding.
- **S10.6**: Multiple concurrent WebSocket connections to different sessions work independently.
- **S10.7**: WebSocket connection to a non-existent session returns an error.
- **S10.8**: Two `send_message` to the same session are serialized — second waits for first to complete.
- **S10.9**: `cancel` message triggers `AbortSignal` and stops the active run.
- **S10.10**: Client disconnect mid-stream does not crash the server — the run continues and results are persisted.
- **S10.11**: Request without Tailscale identity header from a non-loopback source is rejected (when `allowed_users` is configured).
- **S10.12**: `run_start` event includes the `runId` for client correlation.

---

## 16. Web Framework

### 16.1 Choice: Hono

We use **Hono** with `@hono/node-server` as the HTTP framework.

**Why Hono over alternatives:**

| Aspect        | Hono                                     | Fastify                                   | Raw `node:http` + `ws`         |
| ------------- | ---------------------------------------- | ----------------------------------------- | ------------------------------ |
| Dependencies  | 2 packages (`hono`, `@hono/node-server`) | 5+ packages (core + plugins)              | 1 package (`ws`)               |
| API style     | Web Standards (`Request`/`Response`)     | Node.js native (req/res)                  | Node.js native                 |
| WebSocket     | Built-in (`hono/ws`)                     | Plugin (`@fastify/websocket`)             | Manual                         |
| Static files  | Built-in middleware                      | Plugin (`@fastify/static`)                | Manual                         |
| TypeScript DX | Excellent (typed routes)                 | Good (with type providers)                | Manual typing                  |
| Bundle size   | ~14KB                                    | ~250KB                                    | 0 (+ ws ~50KB)                 |
| Complexity    | Minimal                                  | Moderate (plugin system, lifecycle hooks) | Very low but boilerplate-heavy |

**Rationale:** Hono provides the smallest useful abstraction for our ~10 REST endpoints + 1 WebSocket endpoint. It avoids the plugin ecosystem overhead of Fastify and the boilerplate cost of raw `node:http`. Its Web Standards API aligns with modern TypeScript patterns.

### 16.2 Server Skeleton

```typescript
import { Hono } from "hono";
import { serve } from "@hono/node-server";
import { createNodeWebSocket } from "@hono/node-ws";
import { serveStatic } from "@hono/node-server/serve-static";

const app = new Hono();
const { injectWebSocket, upgradeWebSocket } = createNodeWebSocket({ app });

// Static UI
app.use("/ui/*", serveStatic({ root: "./public" }));

// REST API
app.get("/api/sessions", listSessions);
app.post("/api/sessions", createSession);
app.get("/api/sessions/:id", getSession);
app.delete("/api/sessions/:id", deleteSession);
app.get("/api/cron", listCronJobs);
app.post("/api/cron/:id/pause", pauseCronJob);
app.post("/api/cron/:id/resume", resumeCronJob);
app.get("/api/workflows", listWorkflows);
app.post("/api/workflows/:name/run", runWorkflow);

// WebSocket for agent streaming
app.get("/ws", upgradeWebSocket(handleAgentWebSocket));

// Bind to loopback only
const server = serve({ fetch: app.fetch, hostname: "127.0.0.1", port: 8080 }, (info) =>
	console.log(`Agent listening on ${info.address}:${info.port}`),
);
injectWebSocket(server);
```

### 16.3 Request Validation

Request bodies are validated using TypeBox (`@sinclair/typebox/value`), the same library used for tool schemas:

```typescript
import { Type } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";

const CreateSessionSchema = Type.Object({
	name: Type.Optional(Type.String()),
	systemPrompt: Type.Optional(Type.String()),
});

app.post("/api/sessions", async (c) => {
	const body = await c.req.json();
	if (!Value.Check(CreateSessionSchema, body)) {
		const errors = [...Value.Errors(CreateSessionSchema, body)];
		return c.json({ error: "Validation failed", details: errors }, 400);
	}
	// ... create session
});
```

### 16.4 Test Scenarios

- **S16.1**: Server binds to `127.0.0.1` and rejects connections from other interfaces.
- **S16.2**: Static files are served from the `/ui/` path.
- **S16.3**: REST API endpoints return correct JSON responses with appropriate status codes.
- **S16.4**: Invalid request bodies return 400 with validation error details.
- **S16.5**: WebSocket upgrade succeeds and streams agent events.
- **S16.6**: WebSocket message with invalid JSON returns an error frame.
- **S16.7**: Server gracefully shuts down, closing all WebSocket connections.
