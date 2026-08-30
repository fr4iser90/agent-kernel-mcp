export interface AgentKernelConnect {
    readonly url: string;
    readonly token: string;
    readonly updatedAt: string;
}
export declare function resolveAgentKernelConnectPath(): string;
export declare function emptyAgentKernelConnect(): AgentKernelConnect;
export declare function parseAgentKernelConnect(raw: string): AgentKernelConnect;
export declare function readAgentKernelConnect(): Promise<AgentKernelConnect>;
export declare function writeAgentKernelConnect(next: {
    readonly url?: string;
    readonly token?: string;
}, nowIso: string): Promise<AgentKernelConnect>;
//# sourceMappingURL=connect.d.ts.map