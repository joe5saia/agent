#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
RUNTIME_AGENT_HOME="${AGENT_HOME:-${HOME}/.agent}"
RUNTIME_APK_PACKAGES_FILE="${RUNTIME_AGENT_HOME}/container/apk-packages.txt"
IMAGE_APK_PACKAGES_FILE="${PROJECT_ROOT}/deploy/docker/apk-packages.txt"

if [[ ! -f "${RUNTIME_APK_PACKAGES_FILE}" ]]; then
	echo "Runtime package file not found: ${RUNTIME_APK_PACKAGES_FILE}" >&2
	echo "Create it first by starting the container at least once." >&2
	exit 1
fi

TMP_FILE="$(mktemp)"
trap 'rm -f "${TMP_FILE}"' EXIT

awk '{ sub(/#.*/, "", $0); gsub(/^[ \t]+|[ \t]+$/, "", $0); if ($0 != "" && !seen[$0]++) print $0; }' \
	"${RUNTIME_APK_PACKAGES_FILE}" > "${TMP_FILE}"

cat > "${IMAGE_APK_PACKAGES_FILE}" <<'HEADER'
# One package name per line.
# These packages are installed into the image at build time.
# The runtime copy lives at ~/.agent/container/apk-packages.txt.
#
# Example:
# ripgrep
# git
HEADER

cat "${TMP_FILE}" >> "${IMAGE_APK_PACKAGES_FILE}"

echo "Synced runtime packages to ${IMAGE_APK_PACKAGES_FILE}"
