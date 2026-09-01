/**
 * Wire protocol copy for DSH ↔ kernel control channel (WSS).
 * Keep in sync with agent-kernel `domain/executor/ws-protocol.ts`.
 */
export type ServerToDeviceMessage = {
    type: 'hello';
    ownerId: string;
    serverTime: string;
} | {
    type: 'job.created';
    jobId: string;
    runId: string;
    kind: 'start' | 'session_continue' | 'fetch_transcript' | 'operator_turn' | 'list_workdir_candidates';
    payload: Record<string, unknown>;
    createdAt: string;
} | {
    type: 'error';
    message: string;
};
export type DeviceToServerMessage = {
    type: 'hello';
    deviceLabel?: string;
} | {
    type: 'heartbeat';
    deviceLabel?: string;
} | {
    type: 'job.started';
    jobId: string;
} | {
    type: 'job.completed';
    jobId: string;
    ok: boolean;
    result?: Record<string, unknown>;
    error?: string;
};
/** Derive `wss://…/api/executor/ws?token=` from HTTPS kernel URL + pair token. */
export declare function executorWsUrl(kernelBaseUrl: string, token: string): string;
//# sourceMappingURL=ws-protocol.d.ts.map