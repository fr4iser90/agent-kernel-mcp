export type LocalHostConfig = {
    endpoint: string;
    trustedHost: string;
};
export declare function localRpc<T>(method: string, payload: Record<string, unknown>): Promise<T>;
export declare function localCreateSession(cwd: string, agentPreset?: string): Promise<string>;
export declare function localPrompt(sessionId: string, text: string): Promise<void>;
export declare function localListSessions(): Promise<{
    items: Array<{
        sessionId: string;
        updatedAt: number;
        running: boolean;
        blank: boolean;
        cwd?: string;
        agentPreset?: string;
        projections?: {
            asOfSeq: number;
            values: Record<string, unknown>;
        };
    }>;
}>;
export declare function localHistoryAll(sessionId: string, maxPages?: number): Promise<{
    events: Array<{
        event: {
            type: string;
            seq: number;
            time: number;
            data: unknown;
        };
        view?: unknown;
    }>;
    pages: number;
}>;
//# sourceMappingURL=local-rpc.d.ts.map