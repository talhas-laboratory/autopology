#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
TEMPLATE="${ROOT_DIR}/packaging/homebrew/autopology.rb.tmpl"
OUTPUT="${1:-${ROOT_DIR}/packaging/homebrew/autopology.rb}"

: "${VERSION:?VERSION is required}"
: "${MACOS_ARM64_SHA:?MACOS_ARM64_SHA is required}"
: "${MACOS_X64_SHA:?MACOS_X64_SHA is required}"
: "${LINUX_X64_SHA:?LINUX_X64_SHA is required}"

sed \
  -e "s/__VERSION__/${VERSION}/g" \
  -e "s/__MACOS_ARM64_SHA__/${MACOS_ARM64_SHA}/g" \
  -e "s/__MACOS_X64_SHA__/${MACOS_X64_SHA}/g" \
  -e "s/__LINUX_X64_SHA__/${LINUX_X64_SHA}/g" \
  "$TEMPLATE" > "$OUTPUT"

echo "Rendered Homebrew formula: $OUTPUT"
