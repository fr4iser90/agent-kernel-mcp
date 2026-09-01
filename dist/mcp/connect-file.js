/**
 * Shared connect.json lookup for MCP stdio + WSS runner.
 * Same paths as host/connect.ts (kept local — MCP bundle must not import host).
 */
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
export function readConnectFile() {
    const candidates = [];
    const ak = process.env.AGENT_KERNEL_HOME?.trim();
    if (ak)
        candidates.push(join(ak, 'connect.json'));
    const dsh = process.env.DSH_HOME?.trim();
    if (dsh)
        candidates.push(join(dsh, 'agent-kernel', 'connect.json'));
    candidates.push(join(homedir(), '.dsh', 'agent-kernel', 'connect.json'));
    candidates.push(join(homedir(), '.agent-kernel', 'connect.json'));
    for (const file of candidates) {
        try {
            const parsed = JSON.parse(readFileSync(file, 'utf8'));
            const url = typeof parsed.url === 'string' ? parsed.url.trim() : undefined;
            const token = typeof parsed.token === 'string' ? parsed.token.trim() : undefined;
            if (url || token)
                return { url, token };
        }
        catch {
            /* try next */
        }
    }
    return {};
}
