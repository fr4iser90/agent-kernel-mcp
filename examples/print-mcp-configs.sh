#!/usr/bin/env bash
# Print ready-to-paste MCP snippets with this checkout's absolute paths.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
MCP_JS="$ROOT/dist/mcp/index.js"
if [[ ! -f "$MCP_JS" ]]; then
  echo "Build MCP first: (cd $ROOT && pnpm build:mcp)" >&2
  exit 1
fi

cat <<EOF
# === Claude Code (.mcp.json or claude mcp add) ===
{
  "mcpServers": {
    "agent-kernel": {
      "type": "stdio",
      "command": "node",
      "args": ["$MCP_JS"]
    }
  }
}

# === OpenCode (opencode.json) ===
{
  "mcp": {
    "agent-kernel": {
      "type": "local",
      "command": ["node", "$MCP_JS"],
      "enabled": true,
      "timeout": 30000
    }
  }
}

# === Aider (--mcp-servers-file or .aider.conf.yml mcp-servers) ===
{
  "mcpServers": {
    "agent-kernel": {
      "command": "node",
      "args": ["$MCP_JS"]
    }
  }
}

# === DSH ===
# dsh plugin --profile web add file:$ROOT
# dsh web   # MCP via cordis + pair via Header OR:
# node $ROOT/dist/runner/runner/index.js pair --url https://YOUR_KERNEL --code XXXX-XXXX-XXXX
# node $ROOT/dist/runner/runner/index.js
EOF
