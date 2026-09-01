/** Browser plugin: Agent Kernel Session Header + sidebar mark. */

import type { ClientContext, SessionId } from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import { AgentKernelHeaderController } from './controller.ts'
import { AgentKernelHeaderAction, type AgentKernelHeaderInjected } from './HeaderAction.tsx'
import { FollowupIndexController } from './followup-index.ts'
import { FollowupRowMark, type FollowupRowMarkInjected } from './FollowupRowMark.tsx'
import { en, NS, zh, type AgentKernelHeaderKey } from './locales.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    agentKernelHeader: AgentKernelHeaderController
    followupIndex: FollowupIndexController
  }
}

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    'agent-kernel-mcp': AgentKernelHeaderKey
  }
  interface SlotMap {
    'sidebar.workspaces.session.trailing': {
      kind: 'list'
      scope: 'root'
      owner: { sessionId: SessionId }
    }
  }
}

export type { AgentKernelHeaderEntry, AgentKernelHeaderState } from './controller.ts'
export type { FollowupIndexState } from './followup-index.ts'

export const inject = ['slots', 'locale']

export function apply(ctx: ClientContext): void {
  const controller = new AgentKernelHeaderController()
  const followupIndex = new FollowupIndexController()
  ctx.provide('agentKernelHeader', controller)
  ctx.provide('followupIndex', followupIndex)
  ctx.effect(() => {
    followupIndex.start()
    return () => { followupIndex.dispose() }
  }, 'agent-kernel: followup-index poll')
  ctx.effect(() => async () => {
    await controller.dispose()
    followupIndex.dispose()
  }, 'agent-kernel: browser lifecycle')
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'agent-kernel: dictionaries')
  ctx.slots.inject('conversation.session.header.utilities', () => ctx.slots.register({
    name: 'conversation.session.header.utilities',
    id: 'agent-kernel-followup',
    locale: NS,
    inject: (): AgentKernelHeaderInjected => ({
      hooks: { agentKernelHeader: controller.store },
      watch: (sessionId: SessionId) => { controller.watch(sessionId) },
      unwatch: (sessionId: SessionId) => { controller.unwatch(sessionId) },
      setEnabled: async (sessionId, enabled) => {
        followupIndex.setLocal(String(sessionId), enabled)
        await controller.setEnabled(sessionId, enabled)
        void followupIndex.refresh()
      },
      saveSettings: (sessionId, settings) => controller.saveSettings(sessionId, settings),
      claimPair: (sessionId, code, kernelUrl) => controller.claimPair(sessionId, code, kernelUrl),
      setSettingsOpen: (sessionId, open) => { controller.setSettingsOpen(sessionId, open) },
    }),
  }, AgentKernelHeaderAction))
  ctx.slots.inject('sidebar.workspaces.session.trailing', () => ctx.slots.register({
    name: 'sidebar.workspaces.session.trailing',
    id: 'agent-kernel-followup-mark',
    order: 10,
    locale: NS,
    inject: (): FollowupRowMarkInjected => ({
      hooks: { followupIndex: followupIndex.store },
    }),
  }, FollowupRowMark))
}
