/** Browser plugin: Agent Kernel Session Header + sidebar mark. */
import { AgentKernelHeaderController } from "./controller.js";
import { AgentKernelHeaderAction } from "./HeaderAction.js";
import { NudgeIndexController } from "./nudge-index.js";
import { NudgeRowMark } from "./NudgeRowMark.js";
import { en, NS, zh } from "./locales.js";
export const inject = ['slots', 'locale'];
export function apply(ctx) {
    const controller = new AgentKernelHeaderController();
    const nudgeIndex = new NudgeIndexController();
    ctx.provide('agentKernelHeader', controller);
    ctx.provide('nudgeIndex', nudgeIndex);
    ctx.effect(() => {
        nudgeIndex.start();
        return () => { nudgeIndex.dispose(); };
    }, 'agent-kernel: nudge-index poll');
    ctx.effect(() => async () => {
        await controller.dispose();
        nudgeIndex.dispose();
    }, 'agent-kernel: browser lifecycle');
    ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'agent-kernel: dictionaries');
    ctx.slots.inject('conversation.session.header.utilities', () => ctx.slots.register({
        name: 'conversation.session.header.utilities',
        id: 'agent-kernel-nudge',
        locale: NS,
        inject: () => ({
            hooks: { agentKernelHeader: controller.store },
            watch: (sessionId) => { controller.watch(sessionId); },
            unwatch: (sessionId) => { controller.unwatch(sessionId); },
            setEnabled: async (sessionId, enabled) => {
                nudgeIndex.setLocal(String(sessionId), enabled);
                await controller.setEnabled(sessionId, enabled);
                void nudgeIndex.refresh();
            },
            saveSettings: (sessionId, settings) => controller.saveSettings(sessionId, settings),
            setSettingsOpen: (sessionId, open) => { controller.setSettingsOpen(sessionId, open); },
        }),
    }, AgentKernelHeaderAction));
    ctx.slots.inject('sidebar.workspaces.session.trailing', () => ctx.slots.register({
        name: 'sidebar.workspaces.session.trailing',
        id: 'agent-kernel-nudge-mark',
        order: 10,
        locale: NS,
        inject: () => ({
            hooks: { nudgeIndex: nudgeIndex.store },
        }),
    }, NudgeRowMark));
}
//# sourceMappingURL=index.js.map