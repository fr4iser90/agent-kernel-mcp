/**
 * Agent Kernel DSH host plugin: Session Header connect + idle followup.
 */
import type { Context } from '@deepseek-ai/cordis';
export declare const name = "agent-kernel-mcp";
export declare const inject: string[];
export interface Config {
    enabled?: boolean;
    watchdogIntervalMinutes?: number;
    trustedHosts?: string[];
}
export declare function apply(ctx: Context, config?: Config): void;
//# sourceMappingURL=index.d.ts.map