#!/usr/bin/env node
/**
 * Stdio MCP server for agent-kernel.
 * Compatible with VS Code / Cursor MCP hosts and DeepSeek Harness (stdio MCP).
 *
 * Env (checked on each tool call — not at process start):
 *   AGENT_KERNEL_URL   — base URL of the control plane (e.g. https://kernel.example.com)
 *   AGENT_KERNEL_TOKEN — session token (Bearer / same value as ak_session)
 *
 * This is NOT the outbound DSH bridge. It lets an IDE/harness agent call the
 * kernel HTTP API as tools.
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { z } from 'zod';
function readConnectFile() {
    try {
        const home = process.env.DSH_HOME?.trim() || join(homedir(), '.dsh');
        const raw = readFileSync(join(home, 'agent-kernel', 'connect.json'), 'utf8');
        const parsed = JSON.parse(raw);
        return {
            url: typeof parsed.url === 'string' ? parsed.url.trim() : undefined,
            token: typeof parsed.token === 'string' ? parsed.token.trim() : undefined,
        };
    }
    catch {
        return {};
    }
}
function baseUrl() {
    const fromEnv = process.env.AGENT_KERNEL_URL?.trim();
    if (fromEnv)
        return fromEnv.replace(/\/$/, '');
    const fromFile = readConnectFile().url;
    if (fromFile)
        return fromFile.replace(/\/$/, '');
    throw new Error('AGENT_KERNEL_URL is required (env or $DSH_HOME/agent-kernel/connect.json)');
}
function token() {
    const fromEnv = process.env.AGENT_KERNEL_TOKEN?.trim();
    if (fromEnv)
        return fromEnv;
    const fromFile = readConnectFile().token;
    if (fromFile)
        return fromFile;
    throw new Error('AGENT_KERNEL_TOKEN is required (env or Agent Kernel Header → Token)');
}
async function api(method, path, body) {
    const res = await fetch(`${baseUrl()}${path}`, {
        method,
        headers: {
            Authorization: `Bearer ${token()}`,
            Accept: 'application/json',
            ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    let json = null;
    try {
        json = text ? JSON.parse(text) : null;
    }
    catch {
        json = { raw: text };
    }
    if (!res.ok) {
        throw new Error(`agent-kernel ${method} ${path} → ${res.status}: ${typeof json === 'object' ? JSON.stringify(json) : text}`);
    }
    return json;
}
function toolText(data) {
    return {
        content: [{ type: 'text', text: JSON.stringify(data, null, 2) }],
    };
}
const server = new McpServer({
    name: 'agent-kernel',
    version: '0.1.0',
});
server.tool('ak_health', 'Check agent-kernel API health.', {}, async () => toolText(await api('GET', '/health')));
server.tool('ak_me', 'Current authenticated user / setup gaps.', {}, async () => toolText(await api('GET', '/api/auth/me')));
server.tool('ak_list_projects', 'List catalog projects for the current user.', {}, async () => toolText(await api('GET', '/api/projects')));
server.tool('ak_get_project', 'Get one project by id.', { projectId: z.string() }, async ({ projectId }) => toolText(await api('GET', `/api/projects/${encodeURIComponent(projectId)}`)));
server.tool('ak_list_assignments', 'List assignments for the current user.', {}, async () => toolText(await api('GET', '/api/assignments')));
server.tool('ak_nudge', 'Nudge an assignment (kernel starts / continues an executor run). Prefer this over ad-hoc DSH autonomy when the control plane owns the schedule.', { assignmentId: z.string() }, async ({ assignmentId }) => toolText(await api('POST', `/api/assignments/${encodeURIComponent(assignmentId)}/nudge`, {})));
server.tool('ak_scheduler_tick', 'Run one agent-kernel scheduler tick (due assignments / nudges).', {}, async () => toolText(await api('POST', '/api/scheduler/tick', {})));
server.tool('ak_attention', 'List observability attention items from agent-kernel.', {}, async () => toolText(await api('GET', '/api/observability/attention')));
server.tool('ak_list_runs', 'List recent runs.', {}, async () => toolText(await api('GET', '/api/runs')));
server.tool('ak_get_run', 'Get one run by id.', { runId: z.string() }, async ({ runId }) => toolText(await api('GET', `/api/runs/${encodeURIComponent(runId)}`)));
server.tool('ak_test_executor', 'Live-test the configured executor (DSH) from the kernel.', {}, async () => toolText(await api('POST', '/api/settings/test-dsh', {})));
server.tool('ak_executor_settings', 'Read current user executor settings (secrets redacted by API).', {}, async () => toolText(await api('GET', '/api/me/executor')));
async function main() {
    // Do not require TOKEN/URL at process start — DSH/IDE boot before the user
    // logs into agent-kernel. Missing env fails loudly on the first tool call.
    const transport = new StdioServerTransport();
    await server.connect(transport);
}
main().catch((err) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
});
