export type ExecutorWsStatus = {
    connected: boolean;
    lastError: string | null;
    lastHelloAt: string | null;
};
export declare function getExecutorWsStatus(): ExecutorWsStatus;
export declare function reconnectExecutorWs(): void;
/**
 * Maintain a single reconnecting WSS to the paired kernel.
 * Returns a dispose function.
 */
export declare function startExecutorWsClient(opts?: {
    deviceLabel?: string;
    enabled?: () => boolean;
}): () => void;
//# sourceMappingURL=ws-client.d.ts.map