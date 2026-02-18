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

for pkg in "${PACKAGES[@]}"; do
  echo "==> Verifying npm pack output for ${pkg}"
  json="$(npm pack --dry-run --json --workspace "$pkg")"
  paths="$(node -e 'const data = JSON.parse(require("fs").readFileSync(0,"utf8")); for (const f of (data[0]?.files || [])) console.log(f.path);' <<<"$json")"

  if ! echo "$paths" | rg -q '^dist/'; then
    echo "ERROR: ${pkg} tarball does not include dist/ assets"
    exit 1
  fi

  blocked="$(echo "$paths" | rg -n "$BLOCKLIST" || true)"
  if [[ -n "$blocked" ]]; then
    echo "ERROR: ${pkg} tarball contains blocked files:"
    echo "$blocked"
    exit 1
  fi
done

echo "All workspace packages passed npm pack verification."
