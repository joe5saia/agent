#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

REMOTE_HOST="${REMOTE_HOST:-kittenserver}"
REMOTE_DIR="${REMOTE_DIR:-/home/saiaj/agent}"
SYNC_COMPOSE=false
DELETE_REMOTE=false
DRY_RUN=false
NO_BUILD=false

usage() {
	cat <<USAGE
Usage: $(basename "$0") [options]

Deploy this repository to kittenserver and restart the Docker Compose app.

Options:
  --host <ssh-host>     Remote SSH host (default: kittenserver)
  --dir <remote-dir>    Remote deployment directory (default: /home/saiaj/agent)
  --sync-compose        Also sync docker-compose.yml (default: false)
  --delete              Delete remote files not present locally during rsync
  --no-build            Restart without --build
  --dry-run             Preview sync changes; skip remote restart
  -h, --help            Show this help

Environment overrides:
  REMOTE_HOST, REMOTE_DIR
USAGE
}

while [[ $# -gt 0 ]]; do
	case "$1" in
		--host)
			if [[ $# -lt 2 ]]; then
				echo "--host requires a value" >&2
				exit 1
			fi
			REMOTE_HOST="$2"
			shift 2
			;;
		--dir)
			if [[ $# -lt 2 ]]; then
				echo "--dir requires a value" >&2
				exit 1
			fi
			REMOTE_DIR="$2"
			shift 2
			;;
		--sync-compose)
			SYNC_COMPOSE=true
			shift
			;;
		--delete)
			DELETE_REMOTE=true
			shift
			;;
		--no-build)
			NO_BUILD=true
			shift
			;;
		--dry-run)
			DRY_RUN=true
			shift
			;;
		-h|--help)
			usage
			exit 0
			;;
		*)
			echo "Unknown option: $1" >&2
			usage >&2
			exit 1
			;;
	esac
done

for cmd in ssh rsync; do
	if ! command -v "$cmd" >/dev/null 2>&1; then
		echo "Required command not found: $cmd" >&2
		exit 1
	fi
done

if [[ ! -f "${PROJECT_ROOT}/docker-compose.yml" ]]; then
	echo "Could not find docker-compose.yml at ${PROJECT_ROOT}" >&2
	exit 1
fi

LOCAL_REV="$(git -C "$PROJECT_ROOT" rev-parse --short HEAD 2>/dev/null || echo "unknown")"

echo "Deploying ${LOCAL_REV} to ${REMOTE_HOST}:${REMOTE_DIR}"

ssh "$REMOTE_HOST" "mkdir -p '$REMOTE_DIR'"

RSYNC_ARGS=(
	--archive
	--compress
	--human-readable
	--itemize-changes
	--exclude=.git/
	--exclude=.claude/
	--exclude=.entire/
	--exclude=node_modules/
	--exclude=dist/
	--exclude=scratch_docs/
	--exclude=deploy/docker/.env
	--exclude=.env
)

if [[ "$SYNC_COMPOSE" == "false" ]]; then
	# Keep remote host-specific volume/user overrides by default.
	RSYNC_ARGS+=(--exclude=docker-compose.yml)
fi

if [[ "$DELETE_REMOTE" == "true" ]]; then
	RSYNC_ARGS+=(--delete)
fi

if [[ "$DRY_RUN" == "true" ]]; then
	RSYNC_ARGS+=(--dry-run)
fi

rsync "${RSYNC_ARGS[@]}" "${PROJECT_ROOT}/" "${REMOTE_HOST}:${REMOTE_DIR}/"

if [[ "$DRY_RUN" == "true" ]]; then
	echo "Dry run complete. Remote restart skipped."
	exit 0
fi

REMOTE_DIR_Q="$(printf "%q" "$REMOTE_DIR")"
NO_BUILD_FLAG="0"
if [[ "$NO_BUILD" == "true" ]]; then
	NO_BUILD_FLAG="1"
fi

ssh "$REMOTE_HOST" "REMOTE_DIR=${REMOTE_DIR_Q} NO_BUILD=${NO_BUILD_FLAG} bash -s" <<'REMOTE'
set -euo pipefail

cd "$REMOTE_DIR"

COMPOSE_CMD=(docker compose --env-file deploy/docker/.env up -d --remove-orphans)
if [[ "$NO_BUILD" != "1" ]]; then
	COMPOSE_CMD+=(--build)
fi

"${COMPOSE_CMD[@]}"

docker compose ps agent

if command -v curl >/dev/null 2>&1; then
	for attempt in {1..20}; do
		if curl -fsS "http://127.0.0.1:8080/agent_health" >/dev/null 2>&1; then
			echo "Health check passed: http://127.0.0.1:8080/agent_health"
			exit 0
		fi
		sleep 1
	done
	echo "Health check failed: http://127.0.0.1:8080/agent_health" >&2
	exit 1
elif command -v wget >/dev/null 2>&1; then
	for attempt in {1..20}; do
		if wget -q -O /dev/null "http://127.0.0.1:8080/agent_health"; then
			echo "Health check passed: http://127.0.0.1:8080/agent_health"
			exit 0
		fi
		sleep 1
	done
	echo "Health check failed: http://127.0.0.1:8080/agent_health" >&2
	exit 1
else
	echo "Health check skipped (curl/wget not installed on remote host)."
fi
REMOTE

echo "Deployment complete."
