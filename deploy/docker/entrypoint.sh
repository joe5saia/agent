#!/bin/sh
set -eu

AGENT_HOME="${HOME:-/home/agent}/.agent"
RUNTIME_CONTAINER_DIR="$AGENT_HOME/container"
RUNTIME_APK_PACKAGES_FILE="$RUNTIME_CONTAINER_DIR/apk-packages.txt"
IMAGE_APK_PACKAGES_FILE="/app/deploy/docker/apk-packages.txt"

mkdir -p "$AGENT_HOME/cron" "$AGENT_HOME/workflows" "$AGENT_HOME/logs" "$AGENT_HOME/sessions" "$RUNTIME_CONTAINER_DIR"

if [ ! -f "$RUNTIME_APK_PACKAGES_FILE" ] && [ -f "$IMAGE_APK_PACKAGES_FILE" ]; then
	cp "$IMAGE_APK_PACKAGES_FILE" "$RUNTIME_APK_PACKAGES_FILE"
fi

if [ -f "$RUNTIME_APK_PACKAGES_FILE" ]; then
	runtime_packages="$(awk '{ sub(/#.*/, "", $0); gsub(/^[ \t]+|[ \t]+$/, "", $0); if ($0 != "" && !seen[$0]++) print $0; }' "$RUNTIME_APK_PACKAGES_FILE")"
	missing_packages=""

	for package in $runtime_packages; do
		if ! apk info -e "$package" >/dev/null 2>&1; then
			missing_packages="$missing_packages $package"
		fi
	done

	if [ -n "$missing_packages" ]; then
		echo "Installing runtime APK packages:$missing_packages"
		# shellcheck disable=SC2086 # We intentionally expand package tokens.
		sudo apk add --no-cache $missing_packages
	fi
fi

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
