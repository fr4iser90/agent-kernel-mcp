#!/usr/bin/env bash
# Build the DSH Host + browser client bundle against a local deepseek-harness checkout.
# tsdown reads workspace manifests via packages/*/*/ — the plugin must live there (real dir, not symlink).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
HARNESS="${DSH_HARNESS_ROOT:-$(cd "$ROOT/../deepseek-harness" && pwd)}"
DEST="$HARNESS/packages/agent-kernel/mcp"

if [[ ! -f "$HARNESS/package.json" ]]; then
  echo "deepseek-harness not found at $HARNESS (set DSH_HARNESS_ROOT)" >&2
  exit 1
fi

mkdir -p "$(dirname "$DEST")"
rsync -a --delete --exclude node_modules --exclude .git "$ROOT/" "$DEST/"

cd "$DEST"
DSH_HARNESS_ROOT="$HARNESS" node --max-old-space-size=4096 "$HARNESS/node_modules/typescript/bin/tsc" -p tsconfig.host.json
DSH_HARNESS_ROOT="$HARNESS" NODE_ENV=production "$HARNESS/node_modules/.bin/tsdown" --env.DSH_BUILD_FACE client

rsync -a "$DEST/lib/" "$ROOT/lib/"

echo "DSH bundle rebuilt: $ROOT/lib/client.js"
