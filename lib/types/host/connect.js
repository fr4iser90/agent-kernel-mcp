/**
 * Global agent-kernel connection for DSH Header, MCP stdio, and standalone runner.
 * Prefer `$AGENT_KERNEL_HOME/connect.json`, then `$DSH_HOME/agent-kernel/connect.json`,
 * then `~/.dsh/agent-kernel/connect.json`, then `~/.agent-kernel/connect.json`.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
function candidatePaths() {
    const out = [];
    const ak = process.env.AGENT_KERNEL_HOME?.trim();
    if (ak)
        out.push(path.join(ak, 'connect.json'));
    const dsh = process.env.DSH_HOME?.trim();
    if (dsh)
        out.push(path.join(dsh, 'agent-kernel', 'connect.json'));
    out.push(path.join(os.homedir(), '.dsh', 'agent-kernel', 'connect.json'));
    out.push(path.join(os.homedir(), '.agent-kernel', 'connect.json'));
    return [...new Set(out)];
}
/** Default write path (DSH layout when available, else ~/.agent-kernel). */
export function resolveAgentKernelConnectPath() {
    return candidatePaths()[0];
}
export function emptyAgentKernelConnect() {
    return { url: '', token: '', updatedAt: '' };
}
export function parseAgentKernelConnect(raw) {
    const parsed = JSON.parse(raw);
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new Error('agent-kernel connect must be a JSON object');
    }
    const record = parsed;
    return {
        url: typeof record['url'] === 'string' ? record['url'].trim().replace(/\/$/, '') : '',
        token: typeof record['token'] === 'string' ? record['token'].trim() : '',
        updatedAt: typeof record['updatedAt'] === 'string' ? record['updatedAt'] : '',
    };
}
export async function readAgentKernelConnect() {
    let lastErr;
    for (const file of candidatePaths()) {
        try {
            const parsed = parseAgentKernelConnect(await readFile(file, 'utf8'));
            if (parsed.url || parsed.token)
                return parsed;
        }
        catch (error) {
            if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
                continue;
            }
            lastErr = error;
        }
    }
    if (lastErr)
        throw lastErr;
    return emptyAgentKernelConnect();
}
export async function writeAgentKernelConnect(next, nowIso) {
    const previous = await readAgentKernelConnect();
    const url = next.url !== undefined ? next.url.trim().replace(/\/$/, '') : previous.url;
    const token = next.token !== undefined ? next.token.trim() : previous.token;
    if (url.length > 0) {
        try {
            // eslint-disable-next-line no-new
            new URL(url);
        }
        catch {
            throw new Error('agent-kernel url must be an absolute http(s) URL');
        }
    }
    const state = { url, token, updatedAt: nowIso };
    const body = `${JSON.stringify(state, null, 2)}\n`;
    // Write every known path so DSH Header, Claude/Aider/OpenCode MCP, and runner share state.
    const written = new Set();
    for (const file of candidatePaths()) {
        if (written.has(file))
            continue;
        written.add(file);
        await mkdir(path.dirname(file), { recursive: true });
        await writeFile(file, body, 'utf8');
    }
    return state;
}
//# sourceMappingURL=connect.js.map