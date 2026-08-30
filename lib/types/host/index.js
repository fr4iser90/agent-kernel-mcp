import { boundContextSummary, createUserMessage } from '@deepseek-ai/dsh-llm';
import { DEFAULT_NUDGE_PROMPT, expireNudgeIfNeeded, isNudgeBudgetActive, readSessionNudge, recordNudgePoll, recordNudgeWake, resolveSessionNudgeRoot, shouldWakeNudge, writeSessionNudge, } from "./nudge.js";
import { handleAgentKernelNudge, handleAgentKernelNudgeIndex, handleAgentKernelStatus, } from "./http.js";
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
function wakeNudge(agent, prompt) {
    const text = prompt.trim().length > 0 ? prompt.trim() : DEFAULT_NUDGE_PROMPT;
    agent.followup(createUserMessage({
        content: [{ type: 'text', text }],
        source: {
            kind: 'plugin',
            plugin: name,
            form: 'notice',
            summary: boundContextSummary('Agent Kernel idle nudge'),
        },
    }));
}
export function apply(ctx, config = {}) {
    const current = () => resolveConfig(config);
    const limitsOf = () => ({
        trustedHosts: current().trustedHosts,
        pluginEnabled: current().enabled,
        nudgeRoot: resolveSessionNudgeRoot(),
        watchdogIntervalMinutes: current().watchdogIntervalMinutes,
    });
    ctx.effect(() => ctx.webServer.register({
        kind: 'exact',
        path: '/api/agent-kernel.status',
        handler: (req, res) => handleAgentKernelStatus(req, res, ctx.sessions, limitsOf()),
    }), 'agent-kernel: status');
    ctx.effect(() => ctx.webServer.register({
        kind: 'exact',
        path: '/api/agent-kernel.nudge',
        handler: (req, res) => handleAgentKernelNudge(req, res, ctx.sessions, limitsOf()),
    }), 'agent-kernel: nudge');
    ctx.effect(() => ctx.webServer.register({
        kind: 'exact',
        path: '/api/agent-kernel.nudge-index',
        handler: (req, res) => handleAgentKernelNudgeIndex(req, res, limitsOf()),
    }), 'agent-kernel: nudge-index');
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
                const nudgeRoot = resolveSessionNudgeRoot();
                for (const agent of agents) {
                    let nudge;
                    try {
                        nudge = await readSessionNudge(nudgeRoot, String(agent.id));
                    }
                    catch {
                        continue;
                    }
                    const expired = expireNudgeIfNeeded(nudge, nowMs, iso);
                    if (expired.expired) {
                        try {
                            await writeSessionNudge(nudgeRoot, String(agent.id), expired.state);
                        }
                        catch {
                            // ignore
                        }
                        continue;
                    }
                    if (!expired.state.enabled || !isNudgeBudgetActive(expired.state, nowMs))
                        continue;
                    const agentKey = String(agent.id);
                    const polled = recordNudgePoll(expired.state, iso);
                    try {
                        await writeSessionNudge(nudgeRoot, agentKey, polled);
                    }
                    catch {
                        // ignore
                    }
                    if (!shouldWakeNudge(polled, agent.status, nowMs))
                        continue;
                    const previous = lastWakeAt.get(agentKey) ?? 0;
                    if (nowMs - previous < intervalMs / 2)
                        continue;
                    lastWakeAt.set(agentKey, nowMs);
                    const woken = recordNudgeWake(polled, iso);
                    try {
                        await writeSessionNudge(nudgeRoot, agentKey, woken);
                    }
                    catch {
                        // ignore
                    }
                    wakeNudge(agent, woken.prompt);
                }
            })();
        };
        const timer = setInterval(tick, intervalMs);
        ctx.effect(() => () => {
            clearInterval(timer);
            lastWakeAt.clear();
        }, 'agent-kernel: idle timer');
    }
}
//# sourceMappingURL=index.js.map