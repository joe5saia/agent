#!/bin/sh
set -eu

AGENT_HOME="${HOME:-/home/agent}/.agent"
mkdir -p "$AGENT_HOME/cron" "$AGENT_HOME/workflows" "$AGENT_HOME/logs" "$AGENT_HOME/sessions"

if [ ! -f "$AGENT_HOME/config.yaml" ]; then
	cat > "$AGENT_HOME/config.yaml" <<'YAML'
model:
  provider: anthropic
  name: claude-3-5-haiku-latest

security:
  blocked_commands: []

server:
  host: 0.0.0.0
  port: 8080
YAML
fi

exec "$@"
