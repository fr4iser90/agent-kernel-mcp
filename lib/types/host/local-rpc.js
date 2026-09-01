/**
 * Local DSH Host HTTP RPC (loopback). Used by the outbound job worker so the
 * kernel never dials this machine — we execute session.* against ourselves.
 */
import { randomUUID } from 'node:crypto';
function resolveLocalHost() {
    const endpoint = (process.env.DSH_HOST_URL?.trim() ||
        process.env.AGENT_KERNEL_DSH_LOCAL_URL?.trim() ||
        'http://127.0.0.1:3080').replace(/\/$/, '');
    let trustedHost = process.env.TRUSTED_HOST?.trim() || '';
    if (!trustedHost) {
        try {
            trustedHost = new URL(endpoint).host;
        }
        catch {
            trustedHost = '127.0.0.1:3080';
        }
    }
    return { endpoint, trustedHost };
}
export async function localRpc(method, payload) {
    const cfg = resolveLocalHost();
    const body = JSON.stringify({
        type: 'client-request',
        rpcId: randomUUID(),
        method,
        payload,
    });
    const res = await fetch(`${cfg.endpoint}/api/${method}`, {
        method: 'POST',
        headers: {
            Host: cfg.trustedHost,
            Accept: 'application/json',
            'Content-Type': 'application/json',
        },
        body,
    });
    const text = await res.text();
    if (!res.ok) {
        throw new Error(`local DSH RPC HTTP ${String(res.status)} ${method}: ${text}`);
    }
    const json = JSON.parse(text);
    if (!json.result || json.result.ok !== true) {
        throw new Error(`local DSH RPC failed ${method}: ${JSON.stringify(json.result)}`);
    }
    return json.result.value;
}
export async function localCreateSession(cwd, agentPreset = 'standard') {
    const value = await localRpc('session.create', {
        cwd,
        agentPreset,
    });
    const sessionId = value.sessionId ?? value.id;
    if (!sessionId)
        throw new Error(`session.create missing sessionId: ${JSON.stringify(value)}`);
    return sessionId;
}
export async function localPrompt(sessionId, text) {
    await localRpc('session.prompt', {
        sessionId,
        mode: 'queue',
        content: [{ type: 'text', text }],
    });
}
export async function localListSessions() {
    return localRpc('session.list', {});
}
export async function localHistoryAll(sessionId, maxPages = 20) {
    const collected = [];
    let beforeSeq;
    let pages = 0;
    for (let i = 0; i < maxPages; i++) {
        const page = await localRpc('session.history', {
            sessionId,
            maxMessages: 100,
            ...(beforeSeq !== undefined ? { beforeSeq } : {}),
        });
        pages += 1;
        collected.push(...page.events);
        if (!page.hasMore || page.events.length === 0)
            break;
        const oldest = page.events.reduce((min, e) => Math.min(min, e.event.seq), Number.POSITIVE_INFINITY);
        if (!Number.isFinite(oldest))
            break;
        beforeSeq = oldest;
    }
    collected.sort((a, b) => a.event.seq - b.event.seq);
    return { events: collected, pages };
}
//# sourceMappingURL=local-rpc.js.map