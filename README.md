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

## DSH plugin (web profile)

```bash
cd ~/Documents/Git/deepseek-harness
pnpm dsh plugin --profile web add github:fr4iser90/agent-kernel-mcp
pnpm dsh plugin --profile web add github:fr4iser90/agent-kernel-github-tools
pnpm dsh web --no-open   # open the printed URL including ?token=...
```

Requires current [deepseek-harness](https://github.com/deepseek-ai/deepseek-harness) (`@deepseek-ai/dsh-client-store`; the removed `dsh-client-runtime` API is no longer used). This repo ships a prebuilt `lib/client.js` — no local harness checkout needed to install.

## Build

```bash
pnpm install
pnpm build          # MCP + runner
pnpm build:runner
pnpm build:dsh      # Host + browser client bundle (needs ../deepseek-harness)
```

`build:dsh` copies this repo into `deepseek-harness/packages/agent-kernel/mcp`, runs `tsc` + `tsdown` there, and syncs `lib/` back. Set `DSH_HARNESS_ROOT` if the harness checkout is not a sibling directory.
