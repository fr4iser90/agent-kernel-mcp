/**
 * Outbound WSS control channel to agent-kernel.
 * Pairing writes connect.json; this opens wss://…/api/executor/ws?token=…
 */
import WebSocket from 'ws';
import { readAgentKernelConnect } from "./connect.js";
import { executeKernelJob } from "./jobs.js";
import { executorWsUrl } from "./ws-protocol.js";
let status = {
    connected: false,
    lastError: null,
    lastHelloAt: null,
};
export function getExecutorWsStatus() {
    return { ...status };
}
/** Force reconnect (e.g. after pair writes a new token). */
let forceReconnect = null;
export function reconnectExecutorWs() {
    forceReconnect?.();
}
function sendJson(ws, msg) {
    if (ws.readyState === WebSocket.OPEN)
        ws.send(JSON.stringify(msg));
}
async function handleJob(ws, job) {
    sendJson(ws, { type: 'job.started', jobId: job.jobId });
    try {
        const result = await executeKernelJob({
            id: job.jobId,
            runId: job.runId,
            kind: job.kind,
            payload: job.payload,
            createdAt: job.createdAt,
        });
        sendJson(ws, { type: 'job.completed', jobId: job.jobId, ok: true, result });
    }
    catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        sendJson(ws, { type: 'job.completed', jobId: job.jobId, ok: false, error: message });
    }
}
/**
 * Maintain a single reconnecting WSS to the paired kernel.
 * Returns a dispose function.
 */
export function startExecutorWsClient(opts) {
    const deviceLabel = opts?.deviceLabel ?? 'dsh-host';
    let stopped = false;
    let ws = null;
    let heartbeatTimer;
    let reconnectTimer;
    let backoffMs = 1000;
    const inFlight = new Set();
    const clearTimers = () => {
        if (heartbeatTimer)
            clearInterval(heartbeatTimer);
        heartbeatTimer = undefined;
        if (reconnectTimer)
            clearTimeout(reconnectTimer);
        reconnectTimer = undefined;
    };
    const scheduleReconnect = () => {
        if (stopped)
            return;
        if (reconnectTimer)
            clearTimeout(reconnectTimer);
        const wait = backoffMs;
        backoffMs = Math.min(backoffMs * 2, 30_000);
        reconnectTimer = setTimeout(() => {
            void connect();
        }, wait);
    };
    const connect = async () => {
        if (stopped)
            return;
        if (opts?.enabled && !opts.enabled()) {
            status = { connected: false, lastError: null, lastHelloAt: status.lastHelloAt };
            scheduleReconnect();
            return;
        }
        let connectFile;
        try {
            connectFile = await readAgentKernelConnect();
        }
        catch (error) {
            status = {
                connected: false,
                lastError: error instanceof Error ? error.message : String(error),
                lastHelloAt: null,
            };
            scheduleReconnect();
            return;
        }
        if (!connectFile.url || !connectFile.token) {
            status = { connected: false, lastError: 'not paired (missing connect.json)', lastHelloAt: null };
            scheduleReconnect();
            return;
        }
        let url;
        try {
            url = executorWsUrl(connectFile.url, connectFile.token);
        }
        catch (error) {
            status = {
                connected: false,
                lastError: error instanceof Error ? error.message : String(error),
                lastHelloAt: null,
            };
            scheduleReconnect();
            return;
        }
        try {
            ws?.close();
        }
        catch {
            /* ignore */
        }
        const socket = new WebSocket(url);
        ws = socket;
        socket.on('open', () => {
            backoffMs = 1000;
            status = { connected: true, lastError: null, lastHelloAt: status.lastHelloAt };
            sendJson(socket, { type: 'hello', deviceLabel });
            clearTimers();
            heartbeatTimer = setInterval(() => {
                sendJson(socket, { type: 'heartbeat', deviceLabel });
            }, 25_000);
        });
        socket.on('message', (data) => {
            let msg;
            try {
                msg = JSON.parse(String(data));
            }
            catch {
                return;
            }
            if (msg.type === 'hello') {
                status = {
                    connected: true,
                    lastError: null,
                    lastHelloAt: new Date().toISOString(),
                };
                return;
            }
            if (msg.type === 'error') {
                status = {
                    connected: status.connected,
                    lastError: String(msg.message ?? 'server error'),
                    lastHelloAt: status.lastHelloAt,
                };
                return;
            }
            if (msg.type === 'job.created') {
                const job = msg;
                if (!job.jobId || inFlight.has(job.jobId))
                    return;
                inFlight.add(job.jobId);
                void handleJob(socket, job).finally(() => {
                    inFlight.delete(job.jobId);
                });
            }
        });
        socket.on('close', () => {
            status = { connected: false, lastError: status.lastError, lastHelloAt: status.lastHelloAt };
            clearTimers();
            if (!stopped)
                scheduleReconnect();
        });
        socket.on('error', (err) => {
            status = {
                connected: false,
                lastError: err instanceof Error ? err.message : 'WebSocket error',
                lastHelloAt: status.lastHelloAt,
            };
        });
    };
    void connect();
    forceReconnect = () => {
        if (stopped)
            return;
        backoffMs = 1000;
        try {
            ws?.close();
        }
        catch {
            /* ignore */
        }
    };
    return () => {
        stopped = true;
        forceReconnect = null;
        clearTimers();
        try {
            ws?.close();
        }
        catch {
            /* ignore */
        }
        ws = null;
        status = { connected: false, lastError: null, lastHelloAt: status.lastHelloAt };
    };
}
//# sourceMappingURL=ws-client.js.map