/**
 * Host HTTP for Agent Kernel Session Header (connect + idle nudge).
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { SessionStore } from '@deepseek-ai/dsh-session';
export interface AgentKernelStatusPayload {
    readonly watchdogEnabled: boolean;
    readonly nudgePrompt: string;
    readonly nudgeActiveHours: number;
    readonly nudgeArmedAt: string;
    readonly nudgeLastPolledAt: string;
    readonly nudgeLastWakeAt: string;
    readonly watchdogIntervalMinutes: number;
    readonly pluginEnabled: boolean;
    readonly kernelUrl: string;
    readonly kernelToken: string;
    readonly kernelConnected: boolean;
}
export interface AgentKernelHttpLimits {
    readonly trustedHosts: readonly string[];
    readonly pluginEnabled: boolean;
    readonly nudgeRoot: string;
    readonly watchdogIntervalMinutes: number;
}
export declare function handleAgentKernelStatus(req: IncomingMessage, res: ServerResponse, sessions: SessionStore, limits: AgentKernelHttpLimits): Promise<void>;
export declare function handleAgentKernelNudge(req: IncomingMessage, res: ServerResponse, sessions: SessionStore, limits: AgentKernelHttpLimits): Promise<void>;
export declare function handleAgentKernelNudgeIndex(req: IncomingMessage, res: ServerResponse, limits: AgentKernelHttpLimits): Promise<void>;
//# sourceMappingURL=http.d.ts.map