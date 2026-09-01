# agent-kernel-mcp

One device package for **all** supported executors:

| Piece | Role |
|-------|------|
| **`agent-kernel-runner pair`** | Same pairing for DSH / Claude / Aider / OpenCode → `connect.json` |
| **`agent-kernel-runner`** | Outbound WSS — kernel pushes coding jobs |
| **`agent-kernel-mcp` (stdio)** | Same MCP tools in Claude / Aider / OpenCode / DSH |
| **DSH plugin** (optional) | Session Header UI + Host; still uses the same `connect.json` |

```text
Pair (once) ──▶ connect.json ──▶ MCP tools (any client)
                           └──▶ WSS runner (jobs → dsh | claude | aider | opencode)
```

## Pair (identical everywhere)

```bash
# Kernel UI → Generate pairing code, then:
agent-kernel-runner pair --url https://YOUR_KERNEL --code ABCD-EFGH-IJKL
agent-kernel-runner   # leave running
```

Also writes `~/.dsh/agent-kernel/connect.json` and `~/.agent-kernel/connect.json`.

DSH Session Header → Pair still works (same claim API).

## MCP (same server, client-specific config)

```bash
pnpm build:mcp
bash examples/print-mcp-configs.sh
```

| Client | Config |
|--------|--------|
| **Claude Code** | `.mcp.json` → `examples/claude.mcp.json` |
| **OpenCode** | `opencode.json` → `examples/opencode.json` |
| **Aider** | `--mcp-servers-file examples/aider.mcp.json` |
| **DSH** | `dsh plugin --profile web add file:…` (cordis MCP entry) |

## Coding jobs

`brief.executorId` on the device:

| Id | Spawns |
|----|--------|
| `dsh` | DSH Host session RPC |
| `claude-code` | `claude --print …` |
| `aider` | `aider --message …` |
| `opencode` | `opencode run --auto` |

## Build

```bash
pnpm install
pnpm build          # MCP + runner
pnpm build:runner
# Inside deepseek-harness: rebuild Host/client bundle for `dsh plugin add`
```
