/**
 * Global agent-kernel connection for DSH Header + MCP stdio.
 * `$DSH_HOME/agent-kernel/connect.json`
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
export function resolveAgentKernelConnectPath() {
    const home = process.env.DSH_HOME?.trim();
    const base = home !== undefined && home.length > 0 ? home : path.join(os.homedir(), '.dsh');
    return path.join(base, 'agent-kernel', 'connect.json');
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
    try {
        return parseAgentKernelConnect(await readFile(resolveAgentKernelConnectPath(), 'utf8'));
    }
    catch (error) {
        if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
            return emptyAgentKernelConnect();
        }
        throw error;
    }
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
    const file = resolveAgentKernelConnectPath();
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
    return state;
}
//# sourceMappingURL=connect.js.map