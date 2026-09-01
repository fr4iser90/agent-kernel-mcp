/**
 * Host HTTP for Agent Kernel Session Header (connect + idle followup).
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { SessionStore } from '@deepseek-ai/dsh-session';
export interface AgentKernelStatusPayload {
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
}
export interface AgentKernelHttpLimits {
    readonly trustedHosts: readonly string[];
    readonly pluginEnabled: boolean;
    readonly followupRoot: string;
    readonly watchdogIntervalMinutes: number;
}
export declare function handleAgentKernelStatus(req: IncomingMessage, res: ServerResponse, sessions: SessionStore, limits: AgentKernelHttpLimits): Promise<void>;
export declare function handleAgentKernelFollowup(req: IncomingMessage, res: ServerResponse, sessions: SessionStore, limits: AgentKernelHttpLimits): Promise<void>;
/**
 * Claim a pairing code from Agent Kernel (proxied so the browser never talks
 * cross-origin to the kernel). Writes `$DSH_HOME/agent-kernel/connect.json`.
 */
export declare function handleAgentKernelPair(req: IncomingMessage, res: ServerResponse, limits: AgentKernelHttpLimits): Promise<void>;
export declare function handleAgentKernelFollowupIndex(req: IncomingMessage, res: ServerResponse, limits: AgentKernelHttpLimits): Promise<void>;
//# sourceMappingURL=http.d.ts.map