/**
 * Spawn Claude Code / Aider / OpenCode for kernel start/session_continue jobs.
 * Fail loudly when the binary is missing — no silent fallback to DSH.
 */
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { appendCliMessage, readCliSession, writeCliSession, } from "./cli-sessions.js";
export { readCliSession } from "./cli-sessions.js";
const CLI_TIMEOUT_MS = 30 * 60_000;
export function isCliExecutorId(id) {
    return id === 'claude-code' || id === 'aider' || id === 'opencode';
}
function binFor(executorId) {
    if (executorId === 'claude-code')
        return process.env.AGENT_KERNEL_CLAUDE_BIN?.trim() || 'claude';
    if (executorId === 'aider')
        return process.env.AGENT_KERNEL_AIDER_BIN?.trim() || 'aider';
    return process.env.AGENT_KERNEL_OPENCODE_BIN?.trim() || 'opencode';
}
function runCommand(command, args, cwd) {
    return new Promise((resolve, reject) => {
        const child = spawn(command, args, {
            cwd,
            env: process.env,
            stdio: ['ignore', 'pipe', 'pipe'],
        });
        let stdout = '';
        let stderr = '';
        const timer = setTimeout(() => {
            child.kill('SIGTERM');
            reject(new Error(`${command} timed out after ${CLI_TIMEOUT_MS}ms`));
        }, CLI_TIMEOUT_MS);
        child.stdout?.on('data', (chunk) => {
            stdout += chunk.toString('utf8');
        });
        child.stderr?.on('data', (chunk) => {
            stderr += chunk.toString('utf8');
        });
        child.on('error', (err) => {
            clearTimeout(timer);
            if (err.code === 'ENOENT') {
                reject(new Error(`${command} not found on PATH — install the CLI or set AGENT_KERNEL_${command.toUpperCase()}_BIN`));
                return;
            }
            reject(err);
        });
        child.on('close', (code) => {
            clearTimeout(timer);
            resolve({ code: code ?? 1, stdout, stderr });
        });
    });
}
function composePrompt(objective, rolePromptText) {
    const role = rolePromptText && rolePromptText.trim()
        ? `\n\n---\n# Role / Lawpack (injected)\n\n${rolePromptText.trim()}\n---\n`
        : '';
    return `${objective}${role}`;
}
function parseClaudeJson(stdout) {
    const trimmed = stdout.trim();
    if (!trimmed.startsWith('{')) {
        return { text: trimmed, sessionId: null };
    }
    try {
        const parsed = JSON.parse(trimmed);
        const text = (typeof parsed.result === 'string' && parsed.result) ||
            (typeof parsed.content === 'string' && parsed.content) ||
            trimmed;
        const sessionId = (typeof parsed.session_id === 'string' && parsed.session_id) ||
            (typeof parsed.sessionId === 'string' && parsed.sessionId) ||
            null;
        return { text, sessionId };
    }
    catch {
        return { text: trimmed, sessionId: null };
    }
}
async function invokeClaude(cwd, prompt, externalSessionId) {
    const bin = binFor('claude-code');
    const args = [
        '--print',
        '--output-format',
        'json',
        '--dangerously-skip-permissions',
    ];
    if (externalSessionId) {
        args.push('--resume', externalSessionId);
    }
    args.push(prompt);
    const { code, stdout, stderr } = await runCommand(bin, args, cwd);
    if (code !== 0) {
        throw new Error(`claude exited ${code}: ${stderr.trim() || stdout.trim() || 'no output'}`);
    }
    const parsed = parseClaudeJson(stdout);
    if (!parsed.text.trim()) {
        throw new Error('claude produced empty output');
    }
    return { text: parsed.text.trim(), externalSessionId: parsed.sessionId ?? externalSessionId };
}
async function invokeAider(cwd, prompt) {
    const bin = binFor('aider');
    const args = [
        '--message',
        prompt,
        '--yes-always',
        '--no-stream',
        '--no-pretty',
        '--no-show-release-notes',
    ];
    const { code, stdout, stderr } = await runCommand(bin, args, cwd);
    if (code !== 0) {
        throw new Error(`aider exited ${code}: ${stderr.trim() || stdout.trim() || 'no output'}`);
    }
    const text = (stdout.trim() || stderr.trim());
    if (!text)
        throw new Error('aider produced empty output');
    return text;
}
async function invokeOpenCode(cwd, prompt, externalSessionId) {
    const bin = binFor('opencode');
    const args = ['run', '--auto'];
    if (externalSessionId) {
        args.push('--session', externalSessionId);
    }
    args.push(prompt);
    const { code, stdout, stderr } = await runCommand(bin, args, cwd);
    if (code !== 0) {
        throw new Error(`opencode exited ${code}: ${stderr.trim() || stdout.trim() || 'no output'}`);
    }
    const text = stdout.trim();
    if (!text)
        throw new Error('opencode produced empty output');
    // OpenCode may print session id on stderr; keep prior id when continuing.
    return { text, externalSessionId };
}
async function invoke(executorId, cwd, prompt, externalSessionId) {
    if (executorId === 'claude-code')
        return invokeClaude(cwd, prompt, externalSessionId);
    if (executorId === 'aider') {
        const text = await invokeAider(cwd, prompt);
        return { text, externalSessionId: null };
    }
    return invokeOpenCode(cwd, prompt, externalSessionId);
}
export async function cliStart(opts) {
    const prompt = composePrompt(opts.objective, opts.rolePromptText);
    const id = randomUUID();
    const now = new Date().toISOString();
    const out = await invoke(opts.executorId, opts.cwd, prompt, null);
    let session = {
        id,
        executorId: opts.executorId,
        cwd: opts.cwd,
        createdAt: now,
        updatedAt: now,
        externalSessionId: out.externalSessionId,
        messages: [],
    };
    session = appendCliMessage(session, 'user', prompt);
    session = appendCliMessage(session, 'assistant', out.text);
    await writeCliSession(session);
    return { executorSessionId: id };
}
export async function cliContinueSession(opts) {
    const session = await readCliSession(opts.executorSessionId);
    if (!session.cwd)
        throw new Error(`cli session ${session.id} missing cwd`);
    const out = await invoke(session.executorId, session.cwd, opts.prompt, session.externalSessionId);
    let next = appendCliMessage(session, 'user', opts.prompt);
    next = appendCliMessage(next, 'assistant', out.text);
    next = { ...next, externalSessionId: out.externalSessionId ?? next.externalSessionId };
    await writeCliSession(next);
    return { executorSessionId: session.id };
}
export async function cliFetchTranscript(executorSessionId) {
    const session = await readCliSession(executorSessionId);
    const messages = session.messages.map((m, i) => ({
        seq: i + 1,
        time: Date.parse(m.at) || 0,
        role: m.role,
        type: m.role === 'user' ? 'user/message' : 'assistant/message',
        text: m.text,
    }));
    return {
        transcript: {
            session: {
                sessionId: session.id,
                running: false,
                blank: messages.length === 0,
                cwd: session.cwd,
                title: `${session.executorId}:${session.id.slice(0, 8)}`,
                updatedAt: session.updatedAt,
                agentPreset: null,
                externalSessionId: session.externalSessionId,
            },
            messages,
            fileOps: [],
            rawEvents: [],
            meta: { executorId: session.executorId, messageCount: messages.length },
        },
    };
}
