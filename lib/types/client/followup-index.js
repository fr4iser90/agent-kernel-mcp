/** Browser poll of Host Session ids with idle followup armed. */
import { createSnapshotStore } from '@deepseek-ai/dsh-client-runtime/client';
const INITIAL = { enabled: {}, error: null };
function hostBase() {
    const origin = globalThis.location?.origin;
    /* v8 ignore next -- jsdom provides a non-null origin; null appears only under file:// carriers */
    return origin !== undefined && origin !== 'null' ? origin : 'http://dsh.internal';
}
function messageOf(error) {
    return error instanceof Error ? error.message : String(error);
}
/**
 * Poll `/api/agent-kernel.followup-index` for Workspaces sidebar marks.
 */
export class FollowupIndexController {
    fetcher;
    pollMs;
    /** uSES-safe enabled-id map. */
    store = createSnapshotStore(INITIAL);
    timer;
    disposed = false;
    /**
     * @param fetcher - HTTP carrier.
     * @param pollMs - refresh interval while the sidebar is mounted.
     */
    constructor(fetcher = (input, init) => fetch(input, init), pollMs = 15_000) {
        this.fetcher = fetcher;
        this.pollMs = pollMs;
    }
    /** Start polling (idempotent) and fetch immediately. */
    start() {
        /* v8 ignore next -- dispose races */
        if (this.disposed)
            return;
        if (this.timer !== undefined)
            return;
        void this.refresh();
        this.timer = setInterval(() => { void this.refresh(); }, this.pollMs);
    }
    /** Stop polling. */
    stop() {
        if (this.timer === undefined)
            return;
        clearInterval(this.timer);
        this.timer = undefined;
    }
    /**
     * Optimistically mirror a Header toggle so the sidebar mark updates immediately.
     * @param sessionId - Session id.
     * @param enabled - next armed value.
     */
    setLocal(sessionId, enabled) {
        /* v8 ignore next -- dispose races */
        if (this.disposed)
            return;
        this.store.update((state) => {
            const next = {};
            for (const [id, on] of Object.entries(state.enabled)) {
                if (id === sessionId || on !== true)
                    continue;
                next[id] = true;
            }
            if (enabled)
                next[sessionId] = true;
            state.enabled = next;
            state.error = null;
        });
    }
    /** Fetch Host index. */
    async refresh() {
        /* v8 ignore next -- dispose races */
        if (this.disposed)
            return;
        try {
            const response = await this.fetcher(new URL('/api/agent-kernel.followup-index', hostBase()), { method: 'GET' });
            if (!response.ok) {
                /* v8 ignore next -- text() rarely rejects */
                const detail = await response.text().catch(() => '');
                throw new Error(`Followup index failed: HTTP ${String(response.status)}${detail === '' ? '' : ` ${detail}`}`);
            }
            const body = await response.json();
            const list = Array.isArray(body.enabled) ? body.enabled : [];
            const enabled = {};
            for (const id of list) {
                if (typeof id === 'string' && id.length > 0)
                    enabled[id] = true;
            }
            /* v8 ignore next -- dispose during fetch */
            if (this.disposed)
                return;
            this.store.update((state) => {
                state.enabled = enabled;
                state.error = null;
            });
        }
        catch (error) {
            /* v8 ignore next -- dispose during fetch */
            if (this.disposed)
                return;
            this.store.update((state) => {
                state.error = messageOf(error);
            });
        }
    }
    /** Abort polls. */
    dispose() {
        this.disposed = true;
        this.stop();
    }
}
//# sourceMappingURL=followup-index.js.map