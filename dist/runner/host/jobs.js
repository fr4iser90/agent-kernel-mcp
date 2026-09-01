/**
 * Outbound control channel: execute kernel jobs on local DSH Host RPC
 * or CLI executors (claude-code / aider / opencode).
 * Transport is WSS (see ws-client.ts) — not HTTP claim polling.
 */
import { mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { listWorkdirCandidates } from "./detect-workdirs.js";
import { cliContinueSession, cliFetchTranscript, cliStart, isCliExecutorId } from "./cli-runners.js";
import { readCliSession } from "./cli-sessions.js";
import { localCreateSession, localHistoryAll, localListSessions, localPrompt, localRpc, } from "./local-rpc.js";
function isRecord(v) {
    return typeof v === 'object' && v !== null;
}
function executorIdFromPayload(payload) {
    const brief = isRecord(payload.brief) ? payload.brief : null;
    if (brief && typeof brief.executorId === 'string' && brief.executorId.trim()) {
        return brief.executorId.trim();
    }
    if (typeof payload.executorId === 'string' && payload.executorId.trim()) {
        return payload.executorId.trim();
    }
    // Legacy payloads / DSH-only installs — Host RPC path.
    return 'dsh';
}
function textFromBlocks(content) {
    if (typeof content === 'string')
        return content;
    if (!Array.isArray(content))
        return '';
    const parts = [];
    for (const block of content) {
        if (!isRecord(block))
            continue;
        if (block.type === 'text' && typeof block.text === 'string')
            parts.push(block.text);
    }
    return parts.join('\n').trim();
}
function mapHistory(events) {
    const messages = [];
    const fileOps = [];
    for (const entry of events) {
        const { event, view } = entry;
        const t = event.type;
        if (t === 'user/message' || t === 'assistant/message') {
            const data = isRecord(event.data) ? event.data : {};
            const msg = isRecord(data.message) ? data.message : data;
            const text = textFromBlocks(msg.content);
            if (text) {
                messages.push({
                    seq: event.seq,
                    time: event.time,
                    role: t.startsWith('user') ? 'user' : 'assistant',
                    type: t,
                    text,
                    toolView: view,
                });
            }
        }
        else {
            messages.push({
                seq: event.seq,
                time: event.time,
                role: 'event',
                type: t,
                text: t,
                toolView: view,
            });
        }
    }
    return { messages, fileOps };
}
async function runStartDsh(payload) {
    const brief = isRecord(payload.brief) ? payload.brief : null;
    if (!brief)
        throw new Error('start job missing brief');
    const cwd = String(brief.executorCwd ?? brief.workdir ?? '').trim();
    if (!cwd)
        throw new Error('start job brief missing workdir/executorCwd');
    const sessionId = await localCreateSession(cwd);
    const roleBlock = typeof brief.rolePromptText === 'string' && brief.rolePromptText.trim()
        ? `\n\n---\n# Role / Lawpack (injected)\n\n${brief.rolePromptText}\n---\n`
        : '';
    const objective = (typeof payload.prompt === 'string' && payload.prompt.trim()) ||
        (typeof brief.initialObjective === 'string' && brief.initialObjective.trim()) ||
        `Obey Lawpack / AGENTS.md. RUN_ID=${String(brief.runId ?? '')}. Continue autonomous work.`;
    await localPrompt(sessionId, `${objective}${roleBlock}`);
    return { executorSessionId: sessionId };
}
async function runStartCli(executorId, payload) {
    const brief = isRecord(payload.brief) ? payload.brief : null;
    if (!brief)
        throw new Error('start job missing brief');
    const cwd = String(brief.executorCwd ?? brief.workdir ?? '').trim();
    if (!cwd)
        throw new Error('start job brief missing workdir/executorCwd');
    const objective = (typeof payload.prompt === 'string' && payload.prompt.trim()) ||
        (typeof brief.initialObjective === 'string' && brief.initialObjective.trim()) ||
        `Obey Lawpack / AGENTS.md. RUN_ID=${String(brief.runId ?? '')}. Continue autonomous work.`;
    const rolePromptText = typeof brief.rolePromptText === 'string' ? brief.rolePromptText : null;
    return cliStart({ executorId, cwd, objective, rolePromptText });
}
async function runStart(payload) {
    const executorId = executorIdFromPayload(payload);
    if (isCliExecutorId(executorId))
        return runStartCli(executorId, payload);
    if (executorId !== 'dsh') {
        throw new Error(`executorId=${executorId} is not implemented on this device — use dsh, claude-code, aider, or opencode`);
    }
    return runStartDsh(payload);
}
async function runSessionContinueDsh(payload) {
    const sessionId = String(payload.executorSessionId ?? '').trim();
    if (!sessionId)
        throw new Error('session_continue job missing executorSessionId');
    const brief = isRecord(payload.brief) ? payload.brief : {};
    const text = (typeof payload.prompt === 'string' && payload.prompt.trim()) ||
        `Continue. RUN_ID=${String(brief.runId ?? '')}. Obey pinned Lawpack / AGENTS.md.`;
    await localPrompt(sessionId, text);
    return { executorSessionId: sessionId };
}
async function runSessionContinue(payload) {
    const sessionId = String(payload.executorSessionId ?? '').trim();
    if (!sessionId)
        throw new Error('session_continue job missing executorSessionId');
    const executorId = executorIdFromPayload(payload);
    const brief = isRecord(payload.brief) ? payload.brief : {};
    const text = (typeof payload.prompt === 'string' && payload.prompt.trim()) ||
        `Continue. RUN_ID=${String(brief.runId ?? '')}. Obey pinned Lawpack / AGENTS.md.`;
    if (isCliExecutorId(executorId)) {
        return cliContinueSession({ executorSessionId: sessionId, prompt: text });
    }
    // Route by session store when brief.executorId omitted (reconnect / old jobs).
    try {
        await readCliSession(sessionId);
        return cliContinueSession({ executorSessionId: sessionId, prompt: text });
    }
    catch (error) {
        const err = error;
        if (err.code !== 'ENOENT' && !String(error).includes('ENOENT')) {
            // Corrupt CLI session or other read error — do not hide behind DSH.
            if (String(error).includes('cli session') || String(error).includes('unsupported executorId')) {
                throw error;
            }
        }
    }
    return runSessionContinueDsh(payload);
}
async function runFetchTranscript(payload) {
    const sessionId = String(payload.executorSessionId ?? '').trim();
    if (!sessionId)
        throw new Error('fetch_transcript missing executorSessionId');
    try {
        await readCliSession(sessionId);
        return await cliFetchTranscript(sessionId);
    }
    catch (error) {
        const err = error;
        const missing = err.code === 'ENOENT' || String(error).includes('ENOENT');
        if (!missing) {
            // Present but unreadable — fail loud.
            throw error;
        }
    }
    const [{ events, pages }, listed] = await Promise.all([
        localHistoryAll(sessionId),
        localListSessions(),
    ]);
    const summary = listed.items.find((i) => i.sessionId === sessionId);
    if (!summary) {
        throw new Error(`executor session not found (cli or DSH): ${sessionId}`);
    }
    const { messages, fileOps } = mapHistory(events);
    return {
        transcript: {
            session: {
                sessionId: summary.sessionId,
                running: summary.running,
                blank: summary.blank,
                cwd: summary.cwd ?? null,
                title: typeof summary.projections?.values?.title === 'string'
                    ? summary.projections.values.title
                    : null,
                updatedAt: summary.updatedAt,
                agentPreset: summary.agentPreset ?? null,
            },
            messages,
            fileOps,
            rawEvents: events,
            meta: { historyPages: pages, eventCount: events.length },
        },
    };
}
async function requireAgentPreset(presetId) {
    const listed = await localRpc('agentPreset.list', {});
    const ok = listed.presets.some((p) => p.id === presetId);
    if (!ok) {
        throw new Error(`DSH agent preset "${presetId}" not found — create it with tool deny (shell/edit) and only agent-kernel MCP tools`);
    }
}
async function waitSessionIdle(sessionId, timeoutMs) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        const listed = await localListSessions();
        const summary = listed.items.find((i) => i.sessionId === sessionId);
        if (!summary)
            throw new Error(`operator session disappeared: ${sessionId}`);
        if (!summary.running)
            return;
        await new Promise((r) => setTimeout(r, 500));
    }
    throw new Error(`operator session still running after ${timeoutMs}ms`);
}
function lastAssistantText(events) {
    for (let i = events.length - 1; i >= 0; i--) {
        const ev = events[i].event;
        if (ev.type !== 'assistant/message')
            continue;
        const data = isRecord(ev.data) ? ev.data : {};
        const msg = isRecord(data.message) ? data.message : data;
        const text = textFromBlocks(msg.content);
        if (text)
            return text;
    }
    return '';
}
async function runOperatorTurn(payload) {
    const message = typeof payload.message === 'string' ? payload.message.trim() : '';
    if (!message)
        throw new Error('operator_turn missing message');
    const agentPreset = typeof payload.agentPreset === 'string' && payload.agentPreset.trim()
        ? payload.agentPreset.trim()
        : 'operator';
    const systemPrompt = typeof payload.systemPrompt === 'string' && payload.systemPrompt.trim()
        ? payload.systemPrompt.trim()
        : 'You are the agent-kernel operator. Use only agent-kernel MCP tools.';
    // Operator chat with MCP tools requires the DSH Host + preset — not a coding CLI.
    await requireAgentPreset(agentPreset);
    const cwd = join(tmpdir(), 'agent-kernel-operator');
    mkdirSync(cwd, { recursive: true });
    const sessionId = await localCreateSession(cwd, agentPreset);
    await localPrompt(sessionId, `${systemPrompt}\n\n---\nOperator request:\n\n${message}`);
    await waitSessionIdle(sessionId, 170_000);
    const { events } = await localHistoryAll(sessionId);
    const reply = lastAssistantText(events);
    if (!reply) {
        throw new Error('operator_turn finished with no assistant reply');
    }
    return { reply, executorSessionId: sessionId, toolResults: [] };
}
/** Run one kernel job via local Host RPC or CLI adapter. */
export async function executeKernelJob(job) {
    if (job.kind === 'start')
        return runStart(job.payload);
    if (job.kind === 'session_continue')
        return runSessionContinue(job.payload);
    if (job.kind === 'fetch_transcript')
        return runFetchTranscript(job.payload);
    if (job.kind === 'operator_turn')
        return runOperatorTurn(job.payload);
    if (job.kind === 'list_workdir_candidates') {
        const rootsRaw = job.payload.roots;
        if (Array.isArray(rootsRaw)) {
            const roots = rootsRaw.filter((r) => typeof r === 'string');
            return listWorkdirCandidates({ roots });
        }
        return listWorkdirCandidates();
    }
    throw new Error(`unknown job kind: ${String(job.kind)}`);
}
