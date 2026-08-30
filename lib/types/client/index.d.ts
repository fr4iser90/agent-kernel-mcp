/** Browser plugin: Agent Kernel Session Header + sidebar mark. */
import type { ClientContext, SessionId } from '@deepseek-ai/dsh-client-runtime/client';
import { AgentKernelHeaderController } from './controller.ts';
import { NudgeIndexController } from './nudge-index.ts';
import { type AgentKernelHeaderKey } from './locales.ts';
declare module '@deepseek-ai/cordis' {
    interface Context {
        agentKernelHeader: AgentKernelHeaderController;
        nudgeIndex: NudgeIndexController;
    }
}
declare module '@deepseek-ai/dsh-client-ui-slots' {
    interface LocaleNamespaceMap {
        'agent-kernel-mcp': AgentKernelHeaderKey;
    }
    interface SlotMap {
        'sidebar.workspaces.session.trailing': {
            kind: 'list';
            scope: 'root';
            owner: {
                sessionId: SessionId;
            };
        };
    }
}
export type { AgentKernelHeaderEntry, AgentKernelHeaderState } from './controller.ts';
export type { NudgeIndexState } from './nudge-index.ts';
export declare const inject: string[];
export declare function apply(ctx: ClientContext): void;
//# sourceMappingURL=index.d.ts.map