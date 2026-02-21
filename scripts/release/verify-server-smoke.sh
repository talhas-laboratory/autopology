#!/usr/bin/env bash
set -euo pipefail

if [[ $# -lt 1 ]]; then
  echo "Usage: $0 /absolute/path/to/target-repo"
  exit 1
fi

TARGET_REPO="$1"
if [[ ! -d "$TARGET_REPO" ]]; then
  echo "Target repo does not exist: $TARGET_REPO"
  exit 1
fi

if [[ "${TARGET_REPO:0:1}" != "/" ]]; then
  echo "Provide an absolute repo path."
  exit 1
fi

echo "[1/7] Node version"
node -e 'const major=Number(process.versions.node.split(".")[0]); if(major<20){process.exit(1)}'

echo "[2/7] Build"
npm run build >/dev/null

echo "[3/7] Doctor"
node packages/cli/dist/index.js doctor --repo "$TARGET_REPO" >/tmp/autopology-doctor.json

echo "[4/7] Full scoped index"
node packages/cli/dist/index.js graph create --repo "$TARGET_REPO" --full >/tmp/autopology-index.json

echo "[5/7] MCP config (cwd mode)"
node packages/cli/dist/index.js mcp configure --client cursor --repo "$TARGET_REPO" >/tmp/autopology-mcp-cwd.json

echo "[6/7] MCP config (pinned mode)"
node packages/cli/dist/index.js mcp configure --client cursor --repo "$TARGET_REPO" --pin-repo >/tmp/autopology-mcp-pin.json
if ! rg -- '--repo' /tmp/autopology-mcp-pin.json >/dev/null; then
  echo "Pinned MCP config does not include --repo."
  exit 1
fi

echo "[7/7] MCP stdio startup smoke"
if command -v timeout >/dev/null 2>&1; then
  if timeout 5s node packages/cli/dist/index.js mcp --repo "$TARGET_REPO" >/tmp/autopology-mcp-smoke.log 2>&1; then
    true
  else
    code=$?
    if [[ "$code" -ne 124 ]]; then
      echo "MCP startup smoke failed."
      cat /tmp/autopology-mcp-smoke.log
      exit "$code"
    fi
  fi
else
  node packages/cli/dist/index.js mcp --repo "$TARGET_REPO" >/tmp/autopology-mcp-smoke.log 2>&1 &
  pid=$!
  sleep 5
  kill "$pid" >/dev/null 2>&1 || true
fi

echo "Server smoke verification passed."
