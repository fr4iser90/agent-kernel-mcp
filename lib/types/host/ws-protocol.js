/**
 * Wire protocol copy for DSH ↔ kernel control channel (WSS).
 * Keep in sync with agent-kernel `domain/executor/ws-protocol.ts`.
 */
/** Derive `wss://…/api/executor/ws?token=` from HTTPS kernel URL + pair token. */
export function executorWsUrl(kernelBaseUrl, token) {
    const base = kernelBaseUrl.trim();
    if (!base)
        throw new Error('AGENT_KERNEL_URL / connect.json url is required for WSS');
    if (!token.trim())
        throw new Error('AGENT_KERNEL_TOKEN / connect.json token is required for WSS');
    const u = new URL(base);
    if (u.protocol === 'https:')
        u.protocol = 'wss:';
    else if (u.protocol === 'http:')
        u.protocol = 'ws:';
    else
        throw new Error(`unsupported kernel URL protocol: ${u.protocol}`);
    u.pathname = '/api/executor/ws';
    u.search = '';
    u.hash = '';
    u.searchParams.set('token', token.trim());
    return u.toString();
}
//# sourceMappingURL=ws-protocol.js.map