# Specification: Security Model & Storage

Network security, runtime safeguards, credential management, log redaction, and file-based storage.

**Related documents:**

- [Agent Loop & Tools](spec-agent-loop.md#64-tool-execution-safety) — tool-level safety measures
- [Web Interface](spec-web-interface.md#105-authorization-model) — Tailscale auth model
- [System Prompt & Observability](spec-system-prompt.md#144-log-redaction) — log redaction details
- [Configuration](spec-configuration.md) — security config schemas

---

## 11. Security Model

Security is layered: network boundary, authentication, and runtime safeguards.

### 11.1 Network Layer (Tailscale)

- The agent binds to `127.0.0.1` (loopback only).
- Tailscale handles external routing via `tailscale serve` (tailnet-only HTTPS).
- No public internet exposure. Access requires Tailscale network membership.
- Tailscale identity headers provide user identification without a custom auth system.

### 11.2 Runtime Safeguards

**Dangerous command blocklist (defense-in-depth):**

The blocklist is a secondary safety layer. The primary protection is structured command execution ([§6.3](spec-agent-loop.md#63-cli-tool-registration)) for CLI tools and the environment allowlist for subprocesses. The blocklist catches dangerous patterns in the `bash` built-in tool:

- `rm -rf /`, `rm -rf ~`, `rm -rf *` (and variants like `rm -rf /*`)
- `sudo` (any command)
- `shutdown`, `reboot`, `halt`
- `mkfs`, `dd if=`
- `git push --force` (to main/master)
- `chmod 777`

The blocklist uses pattern matching (not exact string match) to catch common evasion attempts. However, it is inherently bypassable — the env allowlist and filesystem boundaries are the real security boundary.

**Environment variable allowlist** — subprocesses receive only explicitly allowed variables (see [§6.4](spec-agent-loop.md#64-tool-execution-safety)). No secret material is inherited.

**Filesystem access boundaries** — file tools enforce allowed/denied path lists (see [§6.4](spec-agent-loop.md#64-tool-execution-safety)). Symlinks are resolved before checking.

**Output limits:**

- Tool output truncated at 200KB (configurable).
- Tool execution timeout at 120s (configurable).

### 11.3 Credential Storage

- API keys (for LLM providers) stored in environment variables on the VM.
- No credentials stored in application config files.
- Agent never logs or outputs credentials.

### 11.4 Log Redaction

All structured log output passes through a redaction layer before being written:

- **Key-based redaction:** values for keys matching `*_KEY`, `*_TOKEN`, `*_SECRET`, `*_PASSWORD`, `authorization` are replaced with `[REDACTED]`.
- **Pattern-based redaction:** strings matching common secret patterns (Bearer tokens, JWT-like strings `eyJ...`, AWS key patterns `AKIA...`) are replaced with `[REDACTED]`.
- **Debug-level tool output** is redacted using the same rules before logging.
- Redaction is applied to log fields, not to the data returned to the LLM (the LLM needs to see full tool output to function).

### 11.5 Test Scenarios

- **S11.1**: Server binds only to `127.0.0.1`, not `0.0.0.0`.
- **S11.2**: Dangerous commands from the blocklist are rejected with an error message.
- **S11.3**: Subprocess environment contains only allowlisted variables (not `process.env`).
- **S11.4**: Tool output exceeding the limit is truncated.
- **S11.5**: API keys in environment variables are not accessible to the agent's bash tool.
- **S11.6**: Tailscale identity headers are parsed and logged for audit.
- **S11.7**: Log entries with secret-like values have those values replaced with `[REDACTED]`.
- **S11.8**: JWT-like strings in tool output are redacted in debug logs.
- **S11.9**: File tool accessing a path outside `allowed_paths` returns an error.
- **S11.10**: Blocklist catches `rm -rf /*` variant (not just `rm -rf /`).

---

## 12. Storage & Persistence

All state is file-based. No database required.

### 12.1 Directory Structure

```
~/.agent/
├── config.yaml              # Global configuration (model defaults, etc.)
├── tools.yaml               # CLI tool definitions
├── cron/
│   └── jobs.yaml            # Cron job definitions
├── workflows/
│   ├── deploy.yaml          # Workflow definitions
│   └── healthcheck.yaml
├── sessions/
│   └── {sessionId}/
│       ├── session.jsonl    # Append-only message log
│       └── metadata.json   # Session metadata
└── logs/
    └── agent.log            # Application logs
```

### 12.2 Configuration

```yaml
# ~/.agent/config.yaml
model:
  provider: anthropic
  name: claude-sonnet-4-20250514

server:
  host: "127.0.0.1"
  port: 8080

tools:
  output_limit: 200000 # bytes
  timeout: 120 # seconds

security:
  blocked_commands:
    - "rm -rf"
    - "sudo"
    - "shutdown"
    - "reboot"
    - "mkfs"
    - "dd if="
    - "chmod 777"
  allowed_env:
    - "PATH"
    - "HOME"
    - "USER"
    - "LANG"
    - "LC_ALL"
    - "TERM"
    - "SHELL"
    - "TMPDIR"
    - "TZ"
  allowed_paths:
    - "~/.agent/workspace"
    - "/tmp/agent"
  denied_paths:
    - "~/.ssh"
    - "~/.gnupg"
    - "/etc/shadow"
    - "/etc/passwd"
  allowed_users: [] # Empty = all tailnet members allowed
```

### 12.3 Test Scenarios

- **S12.1**: Application starts with default config if no `config.yaml` exists.
- **S12.2**: Invalid config file produces a clear error message and fails to start.
- **S12.3**: Session directories are created on demand.
- **S12.4**: JSONL files are append-only — never rewritten during normal operation.
- **S12.5**: Config changes are picked up on reload (no restart required for tools, cron, workflows).
