/** Browser poll of Host Session ids with idle followup armed. */
import { type SnapshotStore } from '@deepseek-ai/dsh-client-runtime/client';
/** Snapshot: Session id → armed. */
export interface FollowupIndexState {
    enabled: Record<string, true | undefined>;
    error: string | null;
}
type Fetch = (input: string | URL, init?: RequestInit) => Promise<Response>;
/**
 * Poll `/api/agent-kernel.followup-index` for Workspaces sidebar marks.
 */
export declare class FollowupIndexController {
    private readonly fetcher;
    private readonly pollMs;
    /** uSES-safe enabled-id map. */
    readonly store: SnapshotStore<FollowupIndexState>;
    private timer;
    private disposed;
    /**
     * @param fetcher - HTTP carrier.
     * @param pollMs - refresh interval while the sidebar is mounted.
     */
    constructor(fetcher?: Fetch, pollMs?: number);
    /** Start polling (idempotent) and fetch immediately. */
    start(): void;
    /** Stop polling. */
    stop(): void;
    /**
     * Optimistically mirror a Header toggle so the sidebar mark updates immediately.
     * @param sessionId - Session id.
     * @param enabled - next armed value.
     */
    setLocal(sessionId: string, enabled: boolean): void;
    /** Fetch Host index. */
    refresh(): Promise<void>;
    /** Abort polls. */
    dispose(): void;
}
export {};
//# sourceMappingURL=followup-index.d.ts.map