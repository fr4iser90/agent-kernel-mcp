/** Browser plugin: Agent Kernel Session Header + sidebar mark. */
import { AgentKernelHeaderController } from "./controller.js";
import { AgentKernelHeaderAction } from "./HeaderAction.js";
import { FollowupIndexController } from "./followup-index.js";
import { FollowupRowMark } from "./FollowupRowMark.js";
import { en, NS, zh } from "./locales.js";
export const inject = ['slots', 'locale'];
export function apply(ctx) {
    const controller = new AgentKernelHeaderController();
    const followupIndex = new FollowupIndexController();
    ctx.provide('agentKernelHeader', controller);
    ctx.provide('followupIndex', followupIndex);
    ctx.effect(() => {
        followupIndex.start();
        return () => { followupIndex.dispose(); };
    }, 'agent-kernel: followup-index poll');
    ctx.effect(() => async () => {
        await controller.dispose();
        followupIndex.dispose();
    }, 'agent-kernel: browser lifecycle');
    ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'agent-kernel: dictionaries');
    ctx.slots.inject('conversation.session.header.utilities', () => ctx.slots.register({
        name: 'conversation.session.header.utilities',
        id: 'agent-kernel-followup',
        locale: NS,
        inject: () => ({
            hooks: { agentKernelHeader: controller.store },
            watch: (sessionId) => { controller.watch(sessionId); },
            unwatch: (sessionId) => { controller.unwatch(sessionId); },
            setEnabled: async (sessionId, enabled) => {
                followupIndex.setLocal(String(sessionId), enabled);
                await controller.setEnabled(sessionId, enabled);
                void followupIndex.refresh();
            },
            saveSettings: (sessionId, settings) => controller.saveSettings(sessionId, settings),
            claimPair: (sessionId, code, kernelUrl) => controller.claimPair(sessionId, code, kernelUrl),
            setSettingsOpen: (sessionId, open) => { controller.setSettingsOpen(sessionId, open); },
        }),
    }, AgentKernelHeaderAction));
    ctx.slots.inject('sidebar.workspaces.session.trailing', () => ctx.slots.register({
        name: 'sidebar.workspaces.session.trailing',
        id: 'agent-kernel-followup-mark',
        order: 10,
        locale: NS,
        inject: () => ({
            hooks: { followupIndex: followupIndex.store },
        }),
    }, FollowupRowMark));
}
//# sourceMappingURL=index.js.map