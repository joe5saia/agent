# Deployment Guide

Production deployment for the agent using an Alpine-based Docker container.

**Related documents:**

- [implementation-plan.md](implementation-plan.md) - Task tracking and phase completion status
- [spec-project-structure.md](spec-project-structure.md) - Deployment requirements and scenarios
- [spec-security.md](spec-security.md) - Security and storage constraints

---

## 1. Prerequisites

- Docker Engine 24+ and Docker Compose
- Optional: Tailscale installed on the host for private exposure
- API credentials for your provider (for example `ANTHROPIC_API_KEY`)

## 2. Configure Environment

```bash
cp deploy/docker/.env.example deploy/docker/.env
```

Set credentials in `deploy/docker/.env`:

```bash
ANTHROPIC_API_KEY=...
```

## 3. Build and Run

```bash
docker compose --env-file deploy/docker/.env up -d --build
```

The container uses:

- Alpine-based image (`node:20-alpine`)
- Persistent volume at `/home/agent/.agent`
- Non-root runtime users (`agent` and `node`) with passwordless `sudo` inside the container

If no config exists yet, the entrypoint creates a starter config at
`/home/agent/.agent/config.yaml`.

## 4. Configure Runtime Files

Mount and edit runtime files inside the persisted volume:

- `/home/agent/.agent/config.yaml`
- `/home/agent/.agent/tools.yaml`
- `/home/agent/.agent/cron/jobs.yaml`
- `/home/agent/.agent/workflows/*.yaml`

Example `config.yaml`:

```yaml
model:
  provider: anthropic
  name: claude-3-5-haiku-latest

security:
  blocked_commands: [] # Keep sudo unblocked inside container

server:
  host: 0.0.0.0
  port: 8080
  interactive:
    ui_enabled: false
    ws_enabled: false

channels:
  telegram:
    enabled: true
    bot_token: "${TELEGRAM_BOT_TOKEN}"
    mode: polling
    dm_policy: open
```

## 5. Operate the Container

```bash
docker compose ps
docker compose logs -f agent
docker compose restart agent
docker compose down
```

## 6. Expose Over Tailscale (Optional)

```bash
tailscale serve --bg https+insecure://127.0.0.1:8080
```

Open the printed HTTPS URL. For legacy browser chat fallback, explicitly enable
`server.interactive.ui_enabled=true` (and `ws_enabled=true`) and use `/agent`.

## 7. Hot-Reload Behavior

- Runtime reload watches:
  - `~/.agent/config.yaml`
  - `~/.agent/tools.yaml`
  - `~/.agent/cron/jobs.yaml`
  - `~/.agent/workflows/*.yaml`
- Invalid reloads are logged and ignored; the previous runtime state remains active.

## 8. Troubleshooting

- Container fails to start:
  - `docker compose logs agent` and fix config validation errors.
- UI unreachable on host:
  - Check `docker compose ps` and ensure `8080:8080` is mapped.
- No model responses:
  - Confirm credentials in `deploy/docker/.env`.

## 9. Optional systemd Host Wrapper

If you want systemd-level startup for Docker itself, install a wrapper unit:

```bash
sudo cp deploy/agent.service /etc/systemd/system/agent.service
sudo systemctl daemon-reload
sudo systemctl enable --now agent
```
