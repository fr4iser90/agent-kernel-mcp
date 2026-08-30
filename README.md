# agent-kernel-mcp

Stdio **MCP server** for the [agent-kernel](https://github.com/fr4iser90/agent-kernel) HTTP API.

Works in:

- **VS Code / Cursor** (MCP host)
- **DeepSeek Harness** (stdio MCP client)

This is **not** the outbound DSH bridge. It exposes control-plane tools to an IDE or harness agent.

## Install

```bash
npm i -g agent-kernel-mcp
# or run without install:
npx -y agent-kernel-mcp
```

From source:

```bash
pnpm install
pnpm build
pnpm start
```

## Config (env)

| Variable | Required | Meaning |
|----------|----------|---------|
| `AGENT_KERNEL_URL` | yes | Control-plane base URL, e.g. `https://YOUR_WEB_HOST` (not `localhost` when the API is remote) |
| `AGENT_KERNEL_TOKEN` | yes* | Session token (`ak_session` / Bearer) |
| `AGENT_KERNEL_MCP_ROOT` | native DSH only | Absolute path to this repo (set automatically by `dsh/run-native-with-mcp.sh`) |
| `DSH_REPO` | native helper script | Absolute path to your deepseek-harness checkout (no default) |

\* DSH overlays allow an empty token at boot so you can log in first; the MCP process itself still requires a token for API calls.

Use `http://127.0.0.1:8787` only when the agent-kernel API runs on the same machine (L-native / L-docker).

## Autonomy / nudge

Kernel scheduling tools live in this MCP (alongside DSH’s own autonomy, if you leave that enabled):

| Tool | Role |
|------|------|
| `ak_nudge` | Kernel assignment nudge (executor run) |
| `ak_scheduler_tick` | One scheduler pass |
| `ak_attention` | Observability attention queue |
| `ak_list_assignments` / `ak_list_runs` | Inspect schedule & outcomes |

MCP tools appear as **`mcp__agent_kernel__ak_*`**. DSH Session Header **Watchdog** is a separate plugin (`dsh-tool-autonomy`).

## DeepSeek Harness install

Cordis overlays that **add** a server must use `- insert:` (see `examples/mcp-memory/*.cordis.yml`).
A bare `- id:` only patches an existing row — MCP never starts.

### Docker (agent-kernel compose)

```bash
export AGENT_KERNEL_URL='https://YOUR_WEB_HOST'
export AGENT_KERNEL_TOKEN='…'   # ak_session
docker compose -f deploy/compose.dsh-local.yml up -d --force-recreate
```

### Native

```bash
export DSH_REPO='/path/to/deepseek-harness'
export AGENT_KERNEL_URL='https://YOUR_WEB_HOST'
export AGENT_KERNEL_TOKEN='…'
./dsh/run-native-with-mcp.sh
# or from deepseek-harness:
# AGENT_KERNEL_URL=… AGENT_KERNEL_MCP_ROOT=… AGENT_KERNEL_TOKEN=… \
#   pnpm dsh web --patch /path/to/agent-kernel-mcp/dsh/agent-kernel-mcp.native.cordis.yml
```

Without `AGENT_KERNEL_URL`, the MCP overlay fails to load. Without `AGENT_KERNEL_TOKEN`, DSH can still boot (overlays allow empty token); tool calls fail until you set `ak_session` and restart.

## Tools

| Tool | Action |
|------|--------|
| `ak_health` | `GET /health` |
| `ak_me` | `GET /api/auth/me` |
| `ak_list_projects` | `GET /api/projects` |
| `ak_get_project` | `GET /api/projects/:id` |
| `ak_list_assignments` | `GET /api/assignments` |
| `ak_nudge` | `POST /api/assignments/:id/nudge` |
| `ak_list_runs` | `GET /api/runs` |
| `ak_get_run` | `GET /api/runs/:id` |
| `ak_test_executor` | `POST /api/settings/test-dsh` |
| `ak_executor_settings` | `GET /api/me/executor` |

## VS Code / Cursor

```json
{
  "mcp": {
    "servers": {
      "agent-kernel": {
        "command": "npx",
        "args": ["-y", "agent-kernel-mcp"],
        "env": {
          "AGENT_KERNEL_URL": "https://YOUR_WEB_HOST",
          "AGENT_KERNEL_TOKEN": "YOUR_SESSION_TOKEN"
        }
      }
    }
  }
}
```

## DeepSeek Harness (stdio MCP)

```yaml
transport: stdio
serverName: agent_kernel
command: npx
args:
  - -y
  - agent-kernel-mcp
env:
  AGENT_KERNEL_URL: https://YOUR_WEB_HOST
  AGENT_KERNEL_TOKEN: YOUR_SESSION_TOKEN
cwd: .
toolCallTimeoutMs: 60000
failOnStartupError: true
```

## License

MIT
