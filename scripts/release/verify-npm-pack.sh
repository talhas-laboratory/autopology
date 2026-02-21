#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT_DIR"

PACKAGES=(
  "packages/core"
  "packages/storage-neo4j"
  "packages/runtime-hooks"
  "packages/indexer"
  "packages/mcp-server"
  "packages/cli"
)

BLOCKLIST='(^|/)(src|tests|tests-node|docs|output)/|(^|/)tsconfig(\.base)?\.json$|\.tsbuildinfo$'
HAS_RG=0
if command -v rg >/dev/null 2>&1; then
  HAS_RG=1
fi

for pkg in "${PACKAGES[@]}"; do
  echo "==> Verifying npm pack output for ${pkg}"
  json="$(npm pack --dry-run --json --workspace "$pkg")"
  paths="$(node -e 'const data = JSON.parse(require("fs").readFileSync(0,"utf8")); for (const f of (data[0]?.files || [])) console.log(f.path);' <<<"$json")"

  if [[ "$HAS_RG" -eq 1 ]]; then
    HAS_DIST_CMD=(rg -q '^dist/')
  else
    HAS_DIST_CMD=(grep -Eq '^dist/')
  fi
  if ! echo "$paths" | "${HAS_DIST_CMD[@]}"; then
    echo "ERROR: ${pkg} tarball does not include dist/ assets"
    exit 1
  fi

  if [[ "$HAS_RG" -eq 1 ]]; then
    blocked="$(echo "$paths" | rg -n "$BLOCKLIST" || true)"
  else
    blocked="$(echo "$paths" | grep -En "$BLOCKLIST" || true)"
  fi
  if [[ -n "$blocked" ]]; then
    echo "ERROR: ${pkg} tarball contains blocked files:"
    echo "$blocked"
    exit 1
  fi
done

echo "All workspace packages passed npm pack verification."
