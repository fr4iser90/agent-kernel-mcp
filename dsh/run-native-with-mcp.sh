#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MCP_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
ROOT="${DSH_REPO:?set DSH_REPO to your deepseek-harness checkout}"
export AGENT_KERNEL_MCP_ROOT="${AGENT_KERNEL_MCP_ROOT:-$MCP_ROOT}"
export AGENT_KERNEL_URL="${AGENT_KERNEL_URL:?set AGENT_KERNEL_URL to your control-plane base URL}"
export AGENT_KERNEL_TOKEN="${AGENT_KERNEL_TOKEN:?set AGENT_KERNEL_TOKEN to ak_session}"
cd "$ROOT"
exec pnpm dsh web \
  --patch "$SCRIPT_DIR/agent-kernel-mcp.native.cordis.yml"
