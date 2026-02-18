# Deployment Guide

Production deployment steps for running the agent on a VM behind Tailscale.

**Related documents:**

- [implementation-plan.md](implementation-plan.md) - Task tracking and phase completion status
- [spec-project-structure.md](spec-project-structure.md) - Deployment requirements and scenarios
- [spec-security.md](spec-security.md) - Security and storage constraints

---

## 1. Prerequisites

- Ubuntu 22.04+ (or similar Linux distro with systemd)
- Node.js 20+
- Tailscale installed and authenticated
- A dedicated runtime user (recommended: `agent`)

## 2. Install Runtime

```bash
sudo useradd --create-home --shell /bin/bash agent
sudo mkdir -p /opt/agent
sudo chown -R agent:agent /opt/agent
```

Clone and build as the runtime user:

```bash
sudo -u agent -H bash -lc '
cd /opt/agent
git clone <repo-url> .
npm install
npm run build
'
```

## 3. Configure Agent Files

Create runtime directories:

```bash
sudo -u agent -H mkdir -p ~/.agent/{cron,workflows,logs,sessions}
```

Create `~/.agent/config.yaml`:

```yaml
model:
  provider: anthropic
  name: claude-3-5-haiku-latest

security:
  blocked_commands:
    - "rm -rf"
    - "sudo"

server:
  host: 127.0.0.1
  port: 8080
```

Optional files:

- `~/.agent/tools.yaml`
- `~/.agent/cron/jobs.yaml`
- `~/.agent/workflows/*.yaml`

Create `~/.agent/.env` for API credentials:

```bash
ANTHROPIC_API_KEY=...
```

## 4. Install systemd Unit

Install the included unit:

```bash
sudo cp /opt/agent/deploy/agent.service /etc/systemd/system/agent.service
sudo systemctl daemon-reload
sudo systemctl enable --now agent
```

Check status/logs:

```bash
sudo systemctl status agent
sudo journalctl -u agent -f
```

## 5. Expose Over Tailscale

Serve the local port through Tailscale:

```bash
tailscale serve --bg https+insecure://127.0.0.1:8080
```

Open the printed HTTPS URL and visit `/ui/`.

## 6. Operations

- Config hot-reload is enabled for:
  - `~/.agent/config.yaml`
  - `~/.agent/tools.yaml`
  - `~/.agent/cron/jobs.yaml`
  - `~/.agent/workflows/*.yaml`
- Invalid reloads are logged and ignored; the previous runtime state remains active.
- Sessions are append-only JSONL files under `~/.agent/sessions`.

## 7. Troubleshooting

- Service fails on startup:
  - Run `sudo journalctl -u agent -n 200` and fix config validation errors.
- UI not reachable:
  - Verify `agent` service is active and `tailscale serve status` shows port `8080`.
- No model responses:
  - Confirm `~/.agent/.env` contains valid credentials and that provider/model names are valid.
