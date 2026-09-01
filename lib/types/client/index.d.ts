/** Browser plugin: Agent Kernel Session Header + sidebar mark. */
import type { ClientContext, SessionId } from '@deepseek-ai/dsh-client-runtime/client';
import { AgentKernelHeaderController } from './controller.ts';
import { FollowupIndexController } from './followup-index.ts';
import { type AgentKernelHeaderKey } from './locales.ts';
declare module '@deepseek-ai/cordis' {
    interface Context {
        agentKernelHeader: AgentKernelHeaderController;
        followupIndex: FollowupIndexController;
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
export type { FollowupIndexState } from './followup-index.ts';
export declare const inject: string[];
export declare function apply(ctx: ClientContext): void;
//# sourceMappingURL=index.d.ts.map