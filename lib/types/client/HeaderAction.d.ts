import { type ReactNode } from 'react';
import type { ObservableSnapshot, SessionId } from '@deepseek-ai/dsh-client-runtime/client';
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots';
import type { AgentKernelHeaderState } from './controller.ts';
import { NS } from './locales.ts';
export interface AgentKernelHeaderInjected {
    hooks: {
        agentKernelHeader: ObservableSnapshot<AgentKernelHeaderState>;
    };
    watch: (sessionId: SessionId) => void;
    unwatch: (sessionId: SessionId) => void;
    setEnabled: (sessionId: SessionId, enabled: boolean) => Promise<void>;
    saveSettings: (sessionId: SessionId, settings: {
        readonly prompt?: string;
        readonly activeHours?: number;
        readonly kernelUrl?: string;
        readonly kernelToken?: string;
    }) => Promise<void>;
    claimPair: (sessionId: SessionId, code: string, kernelUrl: string) => Promise<void>;
    setSettingsOpen: (sessionId: SessionId, open: boolean) => void;
}
export type AgentKernelHeaderProps = PropsRuntime<'conversation.session.header.utilities'> & PropsLocale<typeof NS> & InjectFace<AgentKernelHeaderInjected>;
export declare function AgentKernelHeaderAction({ sessionId, useAgentKernelHeader, watch, unwatch, setEnabled, saveSettings, claimPair, setSettingsOpen, t, }: AgentKernelHeaderProps): ReactNode;
//# sourceMappingURL=HeaderAction.d.ts.map