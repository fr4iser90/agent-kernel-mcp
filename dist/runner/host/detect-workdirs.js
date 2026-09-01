/**
 * Device-side workdir discovery for catalog "Detect".
 * Sources: DSH session cwds, CLI session cwds, job payload roots / AGENT_KERNEL_DETECT_ROOTS (git children).
 */
import { readdir, readFile, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { localListSessions } from "./local-rpc.js";
function basenameOf(p) {
    const parts = p.split(/[/\\]/).filter(Boolean);
    return parts[parts.length - 1] || p;
}
function pushUnique(out, seen, candidate) {
    const key = candidate.path.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
    if (!key || seen.has(key))
        return;
    seen.add(key);
    out.push(candidate);
}
async function readOriginRemote(workdir) {
    try {
        const cfg = await readFile(path.join(workdir, '.git', 'config'), 'utf8');
        const m = cfg.match(/\[remote\s+"origin"\][^\[]*?url\s*=\s*(\S+)/s);
        return m?.[1]?.trim() || null;
    }
    catch {
        return null;
    }
}
async function enrich(candidate) {
    return { ...candidate, gitRemote: await readOriginRemote(candidate.path) };
}
async function fromDshSessions() {
    const listed = await localListSessions();
    const out = [];
    const seen = new Set();
    for (const item of listed.items) {
        const cwd = typeof item.cwd === 'string' ? item.cwd.trim() : '';
        if (!cwd)
            continue;
        const titleRaw = item.projections?.values?.['title'];
        const title = typeof titleRaw === 'string' ? titleRaw.trim() : '';
        pushUnique(out, seen, await enrich({
            path: cwd,
            name: title || basenameOf(cwd),
            source: 'dsh-session',
        }));
    }
    return out;
}
async function fromCliSessions() {
    const roots = [
        process.env.DSH_HOME?.trim()
            ? path.join(process.env.DSH_HOME.trim(), 'agent-kernel', 'cli-sessions')
            : '',
        process.env.AGENT_KERNEL_HOME?.trim()
            ? path.join(process.env.AGENT_KERNEL_HOME.trim(), 'cli-sessions')
            : '',
        path.join(os.homedir(), '.agent-kernel', 'cli-sessions'),
        path.join(os.homedir(), '.dsh', 'agent-kernel', 'cli-sessions'),
    ].filter(Boolean);
    const out = [];
    const seen = new Set();
    for (const root of roots) {
        let names;
        try {
            names = await readdir(root);
        }
        catch {
            continue;
        }
        for (const name of names) {
            if (!name.endsWith('.json'))
                continue;
            try {
                const parsed = JSON.parse(await readFile(path.join(root, name), 'utf8'));
                if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
                    continue;
                const rec = parsed;
                const cwd = typeof rec.cwd === 'string' ? rec.cwd.trim() : '';
                if (!cwd)
                    continue;
                const executorId = typeof rec.executorId === 'string' ? rec.executorId : 'cli';
                pushUnique(out, seen, await enrich({
                    path: cwd,
                    name: basenameOf(cwd),
                    source: `cli:${executorId}`,
                }));
            }
            catch {
                continue;
            }
        }
    }
    return out;
}
function rootsFromPayloadAndEnv(payloadRoots) {
    const out = [];
    const seen = new Set();
    const push = (raw) => {
        const t = raw.trim();
        if (!t || seen.has(t))
            return;
        seen.add(t);
        out.push(t);
    };
    if (payloadRoots) {
        for (const r of payloadRoots) {
            if (typeof r === 'string')
                push(r);
        }
    }
    const envRaw = process.env.AGENT_KERNEL_DETECT_ROOTS?.trim();
    if (envRaw) {
        for (const part of envRaw.split(/[:;]/))
            push(part);
    }
    return out;
}
async function fromDetectRoots(roots) {
    if (roots.length === 0)
        return [];
    const out = [];
    const seen = new Set();
    for (const root of roots) {
        let entries;
        try {
            entries = await readdir(root);
        }
        catch (error) {
            throw new Error(`detect root unreadable: ${root} (${error instanceof Error ? error.message : String(error)})`);
        }
        for (const name of entries) {
            if (name.startsWith('.'))
                continue;
            const full = path.join(root, name);
            try {
                const st = await stat(full);
                if (!st.isDirectory())
                    continue;
                await stat(path.join(full, '.git'));
            }
            catch {
                continue;
            }
            pushUnique(out, seen, await enrich({ path: full, name, source: 'detect-roots' }));
        }
    }
    return out;
}
export async function listWorkdirCandidates(opts) {
    const seen = new Set();
    const candidates = [];
    const errors = [];
    const roots = rootsFromPayloadAndEnv(opts?.roots);
    try {
        for (const c of await fromDshSessions())
            pushUnique(candidates, seen, c);
    }
    catch (error) {
        errors.push(`dsh-sessions: ${error instanceof Error ? error.message : String(error)}`);
    }
    try {
        for (const c of await fromCliSessions())
            pushUnique(candidates, seen, c);
    }
    catch (error) {
        errors.push(`cli-sessions: ${error instanceof Error ? error.message : String(error)}`);
    }
    try {
        for (const c of await fromDetectRoots(roots))
            pushUnique(candidates, seen, c);
    }
    catch (error) {
        // Explicit roots misconfig must fail loud.
        throw error;
    }
    if (candidates.length === 0) {
        const hint = roots.length
            ? `No git children under detect roots (${roots.join(', ')}) and no session cwds.`
            : 'Open a DSH/Claude/Aider/OpenCode session on a repo, or set detectRoots in Setup / AGENT_KERNEL_DETECT_ROOTS';
        const detail = errors.length ? ` Attempts: ${errors.join('; ')}` : '';
        throw new Error(`No workdir candidates.${detail} ${hint}`);
    }
    candidates.sort((a, b) => a.name.localeCompare(b.name));
    return { candidates };
}
