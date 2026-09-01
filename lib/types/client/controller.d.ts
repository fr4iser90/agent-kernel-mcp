/** Browser state for Agent Kernel Session Header. */
import { type SnapshotStore } from '@deepseek-ai/dsh-client-store';
import type { SessionId } from '@deepseek-ai/dsh-session/types';
export interface AgentKernelHeaderEntry {
    readonly watchdogEnabled: boolean;
    readonly followupPrompt: string;
    readonly followupActiveHours: number;
    readonly followupArmedAt: string;
    readonly followupLastPolledAt: string;
    readonly followupLastWakeAt: string;
    readonly watchdogIntervalMinutes: number;
    readonly pluginEnabled: boolean;
    readonly kernelUrl: string;
    readonly kernelToken: string;
    readonly kernelConnected: boolean;
    readonly wssConnected: boolean;
    readonly wssLastError: string | null;
    readonly error: string | null;
    readonly busy: boolean;
    readonly settingsOpen: boolean;
}
export interface AgentKernelHeaderState {
    bySession: Record<string, AgentKernelHeaderEntry | undefined>;
}
type Fetch = (input: string | URL, init?: RequestInit) => Promise<Response>;
export declare class AgentKernelHeaderController {
    private readonly fetcher;
    private readonly pollMs;
    readonly store: SnapshotStore<AgentKernelHeaderState>;
    private readonly polls;
    private disposed;
    constructor(fetcher?: Fetch, pollMs?: number);
    watch(sessionId: SessionId): void;
    unwatch(sessionId: SessionId): void;
    setSettingsOpen(sessionId: SessionId, open: boolean): void;
    refresh(sessionId: SessionId): Promise<void>;
    setEnabled(sessionId: SessionId, enabled: boolean): Promise<void>;
    saveSettings(sessionId: SessionId, settings: {
        readonly prompt?: string;
        readonly activeHours?: number;
        readonly kernelUrl?: string;
        readonly kernelToken?: string;
    }): Promise<void>;
    claimPair(sessionId: SessionId, code: string, kernelUrl: string): Promise<void>;
    dispose(): Promise<void>;
    private patch;
    private publish;
}
export {};
//# sourceMappingURL=controller.d.ts.map