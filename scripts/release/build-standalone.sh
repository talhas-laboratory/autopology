#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
OUT_DIR="${ROOT_DIR}/dist/standalone"
ENTRYPOINT="${ROOT_DIR}/packages/cli/dist/index.js"
TARGETS="${TARGETS:-node20-macos-arm64,node20-macos-x64,node20-linux-x64}"

cd "$ROOT_DIR"

npm run build
rm -rf "$OUT_DIR"
mkdir -p "$OUT_DIR"

npx --yes pkg "$ENTRYPOINT" --targets "$TARGETS" --output "$OUT_DIR/autopology"

rm -f "$OUT_DIR/SHA256SUMS.txt"
for binary in "$OUT_DIR"/*; do
  if [[ -f "$binary" && "${binary##*.}" != "gz" ]]; then
    base="$(basename "$binary")"
    tarball="$OUT_DIR/${base}.tar.gz"
    tar -czf "$tarball" -C "$OUT_DIR" "$base"
    if command -v shasum >/dev/null 2>&1; then
      checksum="$(shasum -a 256 "$tarball" | awk '{print $1}')"
    else
      checksum="$(sha256sum "$tarball" | awk '{print $1}')"
    fi
    echo "${checksum}  $(basename "$tarball")" >> "$OUT_DIR/SHA256SUMS.txt"
  fi
done

echo "Standalone bundles created in $OUT_DIR"
