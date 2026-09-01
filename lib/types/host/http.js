import { SessionId } from '@deepseek-ai/dsh-session';
import { isTrustedApiRequest } from "./api-request-trust.js";
import { emptyFollowupState, expireFollowupIfNeeded, listEnabledFollowupSessionIds, patchSessionFollowup, readSessionFollowup, writeSessionFollowup, } from "./idle-followup.js";
import { readAgentKernelConnect, writeAgentKernelConnect } from "./connect.js";
import { getExecutorWsStatus, reconnectExecutorWs } from "./ws-client.js";
async function readJsonBody(req, maxBytes) {
    const chunks = [];
    let size = 0;
    for await (const chunk of req) {
        const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        size += buf.byteLength;
        if (size > maxBytes)
            throw new Error(`request body exceeds ${String(maxBytes)} bytes`);
        chunks.push(buf);
    }
    const raw = Buffer.concat(chunks).toString('utf8');
    if (raw.trim().length === 0)
        return {};
    return JSON.parse(raw);
}
function resolveSession(sessions, sessionIdRaw) {
    if (sessionIdRaw === null || sessionIdRaw === '') {
        return { ok: false, status: 400, message: 'missing sessionId' };
    }
    if (sessions.get(SessionId(sessionIdRaw)) === undefined) {
        return { ok: false, status: 404, message: 'session not found' };
    }
    return { ok: true, sessionId: sessionIdRaw };
}
function writeJson(res, status, body) {
    const text = `${JSON.stringify(body)}\n`;
    res.writeHead(status, {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store',
        'Content-Length': Buffer.byteLength(text),
    }).end(text);
}
function statusPayload(limits, followup, connect) {
    const wss = getExecutorWsStatus();
    return {
        watchdogEnabled: followup.enabled,
        followupPrompt: followup.prompt,
        followupActiveHours: followup.activeHours,
        followupArmedAt: followup.armedAt,
        followupLastPolledAt: followup.lastPolledAt,
        followupLastWakeAt: followup.lastWakeAt,
        watchdogIntervalMinutes: limits.watchdogIntervalMinutes,
        pluginEnabled: limits.pluginEnabled,
        kernelUrl: connect.url,
        kernelToken: connect.token,
        kernelConnected: connect.token.length > 0 && connect.url.length > 0 && wss.connected,
        wssConnected: wss.connected,
        wssLastError: wss.lastError,
    };
}
async function loadLiveFollowup(followupRoot, sessionId) {
    let followup;
    try {
        followup = await readSessionFollowup(followupRoot, sessionId);
    }
    catch {
        return emptyFollowupState();
    }
    const nowMs = Date.now();
    const { state, expired } = expireFollowupIfNeeded(followup, nowMs, new Date(nowMs).toISOString());
    if (expired) {
        try {
            await writeSessionFollowup(followupRoot, sessionId, state);
        }
        catch {
            // ignore
        }
    }
    return state;
}
export async function handleAgentKernelStatus(req, res, sessions, limits) {
    if (!isTrustedApiRequest(req, limits.trustedHosts)) {
        res.writeHead(403).end('forbidden');
        return;
    }
    if (req.method !== 'GET') {
        res.writeHead(405, { Allow: 'GET' }).end('method not allowed');
        return;
    }
    const url = new URL(req.url ?? '/', 'http://dsh.internal');
    const resolved = resolveSession(sessions, url.searchParams.get('sessionId'));
    if (!resolved.ok) {
        res.writeHead(resolved.status).end(resolved.message);
        return;
    }
    const followup = await loadLiveFollowup(limits.followupRoot, resolved.sessionId);
    const connect = await readAgentKernelConnect();
    writeJson(res, 200, statusPayload(limits, followup, connect));
}
export async function handleAgentKernelFollowup(req, res, sessions, limits) {
    if (!isTrustedApiRequest(req, limits.trustedHosts)) {
        res.writeHead(403).end('forbidden');
        return;
    }
    if (req.method !== 'POST') {
        res.writeHead(405, { Allow: 'POST' }).end('method not allowed');
        return;
    }
    let body;
    try {
        body = await readJsonBody(req, 64 * 1024);
    }
    catch (error) {
        res.writeHead(400).end(error instanceof Error ? error.message : String(error));
        return;
    }
    if (body === null || typeof body !== 'object' || Array.isArray(body)) {
        res.writeHead(400).end('body must be a JSON object');
        return;
    }
    const record = body;
    const sessionIdRaw = typeof record['sessionId'] === 'string' ? record['sessionId'] : null;
    const hasEnabled = typeof record['enabled'] === 'boolean';
    const hasPrompt = typeof record['prompt'] === 'string';
    const hasHours = typeof record['activeHours'] === 'number';
    const hasKernelUrl = typeof record['kernelUrl'] === 'string';
    const hasKernelToken = typeof record['kernelToken'] === 'string';
    if (!hasEnabled && !hasPrompt && !hasHours && !hasKernelUrl && !hasKernelToken) {
        res.writeHead(400).end('enabled, prompt, activeHours, kernelUrl, and/or kernelToken required');
        return;
    }
    const resolved = resolveSession(sessions, sessionIdRaw);
    if (!resolved.ok) {
        res.writeHead(resolved.status).end(resolved.message);
        return;
    }
    const nowIso = new Date().toISOString();
    let connect = await readAgentKernelConnect();
    if (hasKernelUrl || hasKernelToken) {
        try {
            connect = await writeAgentKernelConnect({
                ...hasKernelUrl ? { url: record['kernelUrl'] } : {},
                ...hasKernelToken ? { token: record['kernelToken'] } : {},
            }, nowIso);
            reconnectExecutorWs();
        }
        catch (error) {
            res.writeHead(400).end(error instanceof Error ? error.message : String(error));
            return;
        }
    }
    let next;
    try {
        const previous = await readSessionFollowup(limits.followupRoot, resolved.sessionId);
        if (hasEnabled || hasPrompt || hasHours) {
            const patch = {};
            if (hasEnabled)
                patch.enabled = record['enabled'];
            if (hasPrompt)
                patch.prompt = record['prompt'];
            if (hasHours)
                patch.activeHours = record['activeHours'];
            next = patchSessionFollowup(previous, patch, nowIso);
            await writeSessionFollowup(limits.followupRoot, resolved.sessionId, next);
        }
        else {
            next = previous;
        }
    }
    catch (error) {
        res.writeHead(400).end(error instanceof Error ? error.message : String(error));
        return;
    }
    writeJson(res, 200, statusPayload(limits, next, connect));
}
/**
 * Claim a pairing code from Agent Kernel (proxied so the browser never talks
 * cross-origin to the kernel). Writes `$DSH_HOME/agent-kernel/connect.json`.
 */
export async function handleAgentKernelPair(req, res, limits) {
    if (!isTrustedApiRequest(req, limits.trustedHosts)) {
        res.writeHead(403).end('forbidden');
        return;
    }
    if (req.method !== 'POST') {
        res.writeHead(405, { Allow: 'POST' }).end('method not allowed');
        return;
    }
    let body;
    try {
        body = await readJsonBody(req, 16 * 1024);
    }
    catch (error) {
        res.writeHead(400).end(error instanceof Error ? error.message : String(error));
        return;
    }
    if (body === null || typeof body !== 'object' || Array.isArray(body)) {
        res.writeHead(400).end('body must be a JSON object');
        return;
    }
    const record = body;
    const code = typeof record['code'] === 'string' ? record['code'].trim() : '';
    if (code.length === 0) {
        res.writeHead(400).end('code required');
        return;
    }
    const previous = await readAgentKernelConnect();
    const kernelUrlRaw = typeof record['kernelUrl'] === 'string' ? record['kernelUrl'].trim() : previous.url;
    if (kernelUrlRaw.length === 0) {
        res.writeHead(400).end('kernelUrl required (set Target URL once)');
        return;
    }
    let kernelUrl;
    try {
        kernelUrl = new URL(kernelUrlRaw.replace(/\/$/, '')).origin;
    }
    catch {
        res.writeHead(400).end('kernelUrl must be an absolute http(s) URL');
        return;
    }
    let claimRes;
    try {
        claimRes = await fetch(`${kernelUrl}/api/pair/claim`, {
            method: 'POST',
            headers: { 'content-type': 'application/json', accept: 'application/json' },
            body: JSON.stringify({ code }),
        });
    }
    catch (error) {
        res.writeHead(502).end(error instanceof Error ? error.message : String(error));
        return;
    }
    const claimJson = await claimRes.json().catch(() => ({}));
    if (!claimRes.ok) {
        res.writeHead(claimRes.status >= 400 && claimRes.status < 600 ? claimRes.status : 502)
            .end(typeof claimJson.error === 'string' ? claimJson.error : `pair claim HTTP ${String(claimRes.status)}`);
        return;
    }
    if (typeof claimJson.url !== 'string' || typeof claimJson.token !== 'string') {
        res.writeHead(502).end('pair claim response missing url/token');
        return;
    }
    const nowIso = new Date().toISOString();
    let connect;
    try {
        connect = await writeAgentKernelConnect({ url: claimJson.url, token: claimJson.token }, nowIso);
    }
    catch (error) {
        res.writeHead(400).end(error instanceof Error ? error.message : String(error));
        return;
    }
    reconnectExecutorWs();
    const wss = getExecutorWsStatus();
    writeJson(res, 200, {
        ok: true,
        kernelUrl: connect.url,
        kernelConnected: connect.url.length > 0 && connect.token.length > 0,
        wssConnected: wss.connected,
        updatedAt: connect.updatedAt,
    });
}
export async function handleAgentKernelFollowupIndex(req, res, limits) {
    if (!isTrustedApiRequest(req, limits.trustedHosts)) {
        res.writeHead(403).end('forbidden');
        return;
    }
    if (req.method !== 'GET') {
        res.writeHead(405, { Allow: 'GET' }).end('method not allowed');
        return;
    }
    try {
        writeJson(res, 200, { enabled: await listEnabledFollowupSessionIds(limits.followupRoot) });
    }
    catch (error) {
        res.writeHead(500).end(error instanceof Error ? error.message : String(error));
    }
}
//# sourceMappingURL=http.js.map