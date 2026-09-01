import { boundContextSummary, createUserMessage } from '@deepseek-ai/dsh-llm';
import { DEFAULT_FOLLOWUP_PROMPT, expireFollowupIfNeeded, isFollowupBudgetActive, readSessionFollowup, recordFollowupPoll, recordFollowupWake, resolveSessionFollowupRoot, shouldWakeFollowup, writeSessionFollowup, } from "./idle-followup.js";
import { handleAgentKernelFollowup, handleAgentKernelFollowupIndex, handleAgentKernelPair, handleAgentKernelStatus, } from "./http.js";
import { startExecutorWsClient } from "./ws-client.js";
export const name = 'agent-kernel-mcp';
export const inject = ['webServer', 'sessions'];
function resolveConfig(config) {
    const watchdogIntervalMinutes = config.watchdogIntervalMinutes ?? 5;
    if (!Number.isSafeInteger(watchdogIntervalMinutes) || watchdogIntervalMinutes < 0) {
        throw new TypeError('watchdogIntervalMinutes must be a non-negative safe integer');
    }
    return {
        enabled: config.enabled !== false,
        watchdogIntervalMinutes,
        trustedHosts: config.trustedHosts ?? [],
    };
}
function wakeIdleFollowup(agent, prompt) {
    const text = prompt.trim().length > 0 ? prompt.trim() : DEFAULT_FOLLOWUP_PROMPT;
    agent.followup(createUserMessage({
        content: [{ type: 'text', text }],
        source: {
            kind: 'plugin',
            plugin: name,
            form: 'notice',
            summary: boundContextSummary('Agent Kernel idle followup'),
        },
    }));
}
export function apply(ctx, config = {}) {
    const current = () => resolveConfig(config);
    const limitsOf = () => ({
        trustedHosts: current().trustedHosts,
        pluginEnabled: current().enabled,
        followupRoot: resolveSessionFollowupRoot(),
        watchdogIntervalMinutes: current().watchdogIntervalMinutes,
    });
    ctx.effect(() => ctx.webServer.register({
        kind: 'exact',
        path: '/api/agent-kernel.status',
        handler: (req, res) => handleAgentKernelStatus(req, res, ctx.sessions, limitsOf()),
    }), 'agent-kernel: status');
    ctx.effect(() => ctx.webServer.register({
        kind: 'exact',
        path: '/api/agent-kernel.followup',
        handler: (req, res) => handleAgentKernelFollowup(req, res, ctx.sessions, limitsOf()),
    }), 'agent-kernel: followup');
    ctx.effect(() => ctx.webServer.register({
        kind: 'exact',
        path: '/api/agent-kernel.pair',
        handler: (req, res) => handleAgentKernelPair(req, res, limitsOf()),
    }), 'agent-kernel: pair');
    ctx.effect(() => ctx.webServer.register({
        kind: 'exact',
        path: '/api/agent-kernel.followup-index',
        handler: (req, res) => handleAgentKernelFollowupIndex(req, res, limitsOf()),
    }), 'agent-kernel: followup-index');
    const lastWakeAt = new Map();
    const intervalMinutes = current().watchdogIntervalMinutes;
    if (intervalMinutes > 0) {
        const intervalMs = intervalMinutes * 60_000;
        const tick = () => {
            void (async () => {
                const resolved = current();
                if (!resolved.enabled || resolved.watchdogIntervalMinutes <= 0)
                    return;
                const agents = ctx.get('agents')?.list() ?? [];
                const nowMs = Date.now();
                const iso = new Date(nowMs).toISOString();
                const followupRoot = resolveSessionFollowupRoot();
                for (const agent of agents) {
                    let followup;
                    try {
                        followup = await readSessionFollowup(followupRoot, String(agent.id));
                    }
                    catch {
                        continue;
                    }
                    const expired = expireFollowupIfNeeded(followup, nowMs, iso);
                    if (expired.expired) {
                        try {
                            await writeSessionFollowup(followupRoot, String(agent.id), expired.state);
                        }
                        catch {
                            // ignore
                        }
                        continue;
                    }
                    if (!expired.state.enabled || !isFollowupBudgetActive(expired.state, nowMs))
                        continue;
                    const agentKey = String(agent.id);
                    const polled = recordFollowupPoll(expired.state, iso);
                    try {
                        await writeSessionFollowup(followupRoot, agentKey, polled);
                    }
                    catch {
                        // ignore
                    }
                    if (!shouldWakeFollowup(polled, agent.status, nowMs))
                        continue;
                    const previous = lastWakeAt.get(agentKey) ?? 0;
                    if (nowMs - previous < intervalMs / 2)
                        continue;
                    lastWakeAt.set(agentKey, nowMs);
                    const woken = recordFollowupWake(polled, iso);
                    try {
                        await writeSessionFollowup(followupRoot, agentKey, woken);
                    }
                    catch {
                        // ignore
                    }
                    wakeIdleFollowup(agent, woken.prompt);
                }
            })();
        };
        const timer = setInterval(tick, intervalMs);
        ctx.effect(() => () => {
            clearInterval(timer);
            lastWakeAt.clear();
        }, 'agent-kernel: idle timer');
    }
    // Outbound control channel: persistent WSS to kernel (no HTTP job polling).
    {
        const stop = startExecutorWsClient({
            deviceLabel: 'dsh-host',
            enabled: () => current().enabled,
        });
        ctx.effect(() => () => {
            stop();
        }, 'agent-kernel: executor wss');
    }
}
//# sourceMappingURL=index.js.map