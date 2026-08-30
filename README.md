# agent-kernel-mcp

Installable **DeepSeek Harness** bundle: Session Header (Target URL / Token / idle nudge) + stdio **MCP** tools for [agent-kernel](https://github.com/fr4iser90/agent-kernel).

Also works as a plain MCP server in VS Code / Cursor.

## Install into DSH

```bash
dsh plugin --profile web add file:/absolute/path/to/agent-kernel-mcp
# or: dsh plugin --profile web add github:fr4iser90/agent-kernel-mcp

dsh web
```

The bundle mounts:

1. Agent Kernel host + client (Header slot `agent-kernel-nudge`)
2. MCP server `agent_kernel` (`mcp__agent_kernel__ak_*`)

Open a session → Header **Agent Kernel** (checkbox + gear): Target URL, Token, idle message, duration. Saved under `$DSH_HOME/agent-kernel/connect.json`.

## MCP tools

| Tool | Role |
|------|------|
| `ak_nudge` | Kernel assignment nudge |
| `ak_scheduler_tick` | One scheduler pass |
| `ak_attention` | Observability attention queue |
| `ak_list_assignments` / `ak_list_runs` | Inspect schedule & outcomes |

Env (optional — Header / `connect.json` can supply URL + token):

| Variable | Meaning |
|----------|---------|
| `AGENT_KERNEL_URL` | Control-plane base URL |
| `AGENT_KERNEL_TOKEN` | `ak_session` / Bearer |

## Build from source

```bash
pnpm install
pnpm build
```

Workspace copy (for peer resolve while developing against harness): `deepseek-harness/packages/agent-kernel/mcp`. Publishable tree: [agent-kernel-mcp](https://github.com/fr4iser90/agent-kernel-mcp).
