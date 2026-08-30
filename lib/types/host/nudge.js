/**
 * Per-Session idle nudge: opt-in flag, followup prompt, and optional hour budget
 * under `$DSH_HOME`. Independent of autonomy `state.json` so Header can arm
 * without `/autonomy start`.
 * @module @deepseek-ai/dsh-tool-autonomy/nudge
 */
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
/** Default followup text when the operator leaves the prompt empty. */
export const DEFAULT_NUDGE_PROMPT = 'Continue';
/** Max UTF-8 code units accepted for a custom nudge prompt. */
export const MAX_NUDGE_PROMPT_CHARS = 8_000;
/** Max Session nudge window in hours (30 days). `0` means forever. */
export const MAX_NUDGE_ACTIVE_HOURS = 720;
/**
 * Resolve the directory that holds `session-nudge/<sessionId>.json`.
 * Prefers `$DSH_HOME`, else `~/.dsh`.
 * @returns absolute nudge root directory.
 */
export function resolveSessionNudgeRoot() {
    const home = process.env.DSH_HOME?.trim();
    const base = home !== undefined && home.length > 0 ? home : path.join(os.homedir(), '.dsh');
    return path.join(base, 'session-nudge');
}
/**
 * Reject session ids that are unsafe as a single path segment.
 * @param sessionId - Session id string.
 * @returns the same id when valid.
 */
export function assertNudgeSessionId(sessionId) {
    if (!/^[A-Za-z0-9._-]{1,200}$/u.test(sessionId)) {
        throw new Error('sessionId is not a safe nudge filename');
    }
    return sessionId;
}
/**
 * Absolute path for one Session's nudge file.
 * @param nudgeRoot - directory from {@link resolveSessionNudgeRoot}.
 * @param sessionId - Session id.
 */
export function resolveNudgePath(nudgeRoot, sessionId) {
    return path.join(nudgeRoot, `${assertNudgeSessionId(sessionId)}.json`);
}
/**
 * Normalize prompt text; empty → default Continue.
 * @param raw - operator input.
 * @returns trimmed prompt or {@link DEFAULT_NUDGE_PROMPT}.
 */
export function normalizeNudgePrompt(raw) {
    const trimmed = raw.trim();
    if (trimmed.length === 0)
        return DEFAULT_NUDGE_PROMPT;
    if (trimmed.length > MAX_NUDGE_PROMPT_CHARS) {
        throw new Error(`nudge prompt exceeds ${String(MAX_NUDGE_PROMPT_CHARS)} characters`);
    }
    return trimmed;
}
/**
 * Validate active-hours budget (`0` = forever).
 * @param raw - operator input.
 * @returns sanitized hour count.
 */
export function normalizeNudgeActiveHours(raw) {
    if (!Number.isSafeInteger(raw) || raw < 0 || raw > MAX_NUDGE_ACTIVE_HOURS) {
        throw new Error(`nudge activeHours must be an integer from 0 to ${String(MAX_NUDGE_ACTIVE_HOURS)}`);
    }
    return raw;
}
/**
 * Default in-memory nudge when no file exists.
 * @returns disabled Continue record with empty timestamps.
 */
export function emptyNudgeState() {
    return {
        enabled: false,
        prompt: DEFAULT_NUDGE_PROMPT,
        activeHours: 0,
        armedAt: '',
        lastPolledAt: '',
        lastWakeAt: '',
        updatedAt: '',
    };
}
/**
 * Parse a JSON nudge record; invalid shapes throw.
 * @param raw - file UTF-8 contents.
 * @returns durable nudge state.
 */
export function parseNudgeState(raw) {
    const parsed = JSON.parse(raw);
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new Error('nudge state must be a JSON object');
    }
    const record = parsed;
    const enabled = record['enabled'] === true;
    const promptRaw = typeof record['prompt'] === 'string' ? record['prompt'] : DEFAULT_NUDGE_PROMPT;
    const prompt = normalizeNudgePrompt(promptRaw);
    const hoursRaw = record['activeHours'];
    const activeHours = hoursRaw === undefined
        ? 0
        : typeof hoursRaw === 'number'
            ? normalizeNudgeActiveHours(hoursRaw)
            : (() => { throw new Error('nudge state activeHours must be a number'); })();
    const armedAt = typeof record['armedAt'] === 'string' ? record['armedAt'] : '';
    const lastPolledAt = typeof record['lastPolledAt'] === 'string' ? record['lastPolledAt'] : '';
    const lastWakeAt = typeof record['lastWakeAt'] === 'string' ? record['lastWakeAt'] : '';
    const updatedAt = typeof record['updatedAt'] === 'string' ? record['updatedAt'] : '';
    return { enabled, prompt, activeHours, armedAt, lastPolledAt, lastWakeAt, updatedAt };
}
/**
 * Read nudge state for a Session; missing file → empty defaults.
 * @param nudgeRoot - storage directory.
 * @param sessionId - Session id.
 */
export async function readSessionNudge(nudgeRoot, sessionId) {
    const file = resolveNudgePath(nudgeRoot, sessionId);
    let raw;
    try {
        raw = await readFile(file, 'utf8');
    }
    catch (error) {
        if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
            return emptyNudgeState();
        }
        throw error;
    }
    return parseNudgeState(raw);
}
/**
 * Persist nudge state for a Session.
 * @param nudgeRoot - storage directory.
 * @param sessionId - Session id.
 * @param state - next record.
 */
export async function writeSessionNudge(nudgeRoot, sessionId, state) {
    const file = resolveNudgePath(nudgeRoot, sessionId);
    await mkdir(nudgeRoot, { recursive: true });
    await writeFile(file, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
}
/**
 * Session ids whose durable nudge file is currently enabled (and budget-active).
 * Corrupt or unsafe filenames are skipped so one bad file cannot break the index.
 * @param nudgeRoot - directory from {@link resolveSessionNudgeRoot}.
 * @param nowMs - evaluation clock for hour-budget expiry.
 */
export async function listEnabledNudgeSessionIds(nudgeRoot, nowMs = Date.now()) {
    let names;
    try {
        names = await readdir(nudgeRoot);
    }
    catch (error) {
        if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
            return [];
        }
        throw error;
    }
    const enabled = [];
    const iso = new Date(nowMs).toISOString();
    for (const name of names) {
        if (!name.endsWith('.json'))
            continue;
        const sessionId = name.slice(0, -'.json'.length);
        try {
            assertNudgeSessionId(sessionId);
        }
        catch {
            continue;
        }
        let state;
        try {
            state = parseNudgeState(await readFile(resolveNudgePath(nudgeRoot, sessionId), 'utf8'));
        }
        catch {
            continue;
        }
        const { state: live, expired } = expireNudgeIfNeeded(state, nowMs, iso);
        if (expired || !live.enabled)
            continue;
        enabled.push(sessionId);
    }
    return enabled;
}
/**
 * Remaining ms in a limited arm window; `Infinity` when forever; `0` when expired/off.
 * @param state - durable nudge.
 * @param nowMs - evaluation clock.
 */
export function nudgeRemainingMs(state, nowMs) {
    if (!state.enabled)
        return 0;
    if (state.activeHours <= 0)
        return Number.POSITIVE_INFINITY;
    if (state.armedAt.length === 0)
        return 0;
    const started = Date.parse(state.armedAt);
    if (!Number.isFinite(started))
        return 0;
    const budgetMs = state.activeHours * 3_600_000;
    return Math.max(0, started + budgetMs - nowMs);
}
/**
 * Whether the arm window is still open.
 * @param state - durable nudge.
 * @param nowMs - evaluation clock.
 */
export function isNudgeBudgetActive(state, nowMs) {
    const remaining = nudgeRemainingMs(state, nowMs);
    return remaining === Number.POSITIVE_INFINITY || remaining > 0;
}
/**
 * Disable a timed-out nudge; no-op when still active or already off.
 * @param state - durable nudge.
 * @param nowMs - evaluation clock.
 * @param nowIso - write timestamp when expiring.
 * @returns next state and whether an expiry write is needed.
 */
export function expireNudgeIfNeeded(state, nowMs, nowIso) {
    if (!state.enabled || isNudgeBudgetActive(state, nowMs)) {
        return { state, expired: false };
    }
    return {
        state: {
            ...state,
            enabled: false,
            armedAt: '',
            lastPolledAt: '',
            lastWakeAt: '',
            updatedAt: nowIso,
        },
        expired: true,
    };
}
/**
 * Whether the Host timer should post a nudge followup.
 * @param state - durable nudge (caller should expire first).
 * @param agentStatus - live agent status (`idle` only).
 * @param nowMs - evaluation clock.
 */
export function shouldWakeNudge(state, agentStatus, nowMs) {
    return state.enabled && agentStatus === 'idle' && isNudgeBudgetActive(state, nowMs);
}
/**
 * Merge a partial update into the durable nudge record.
 * @param previous - current state.
 * @param patch - fields to change.
 * @param nowIso - write timestamp (also used as `armedAt` when arming).
 * @returns next state.
 */
export function patchSessionNudge(previous, patch, nowIso) {
    if (patch.enabled === undefined && patch.prompt === undefined && patch.activeHours === undefined) {
        throw new Error('nudge patch requires enabled, prompt, and/or activeHours');
    }
    const enabled = patch.enabled ?? previous.enabled;
    const activeHours = patch.activeHours !== undefined
        ? normalizeNudgeActiveHours(patch.activeHours)
        : previous.activeHours;
    const prompt = patch.prompt !== undefined ? normalizeNudgePrompt(patch.prompt) : previous.prompt;
    let armedAt = previous.armedAt;
    let lastPolledAt = previous.lastPolledAt;
    let lastWakeAt = previous.lastWakeAt;
    if (!enabled) {
        armedAt = '';
        lastPolledAt = '';
        lastWakeAt = '';
    }
    else if (!previous.enabled
        || patch.activeHours !== undefined
        || previous.armedAt.length === 0) {
        // Fresh arm, or hours changed while on: restart the countdown window.
        armedAt = nowIso;
        lastPolledAt = '';
        lastWakeAt = '';
    }
    return {
        enabled,
        prompt,
        activeHours,
        armedAt,
        lastPolledAt,
        lastWakeAt,
        updatedAt: nowIso,
    };
}
/**
 * Mark that the Host timer just evaluated this Session for an idle nudge.
 * @param state - current armed state.
 * @param nowIso - poll timestamp.
 */
export function recordNudgePoll(state, nowIso) {
    return { ...state, lastPolledAt: nowIso, updatedAt: nowIso };
}
/**
 * Mark that this Session just received an idle nudge followup.
 * @param state - current armed state.
 * @param nowIso - wake timestamp.
 */
export function recordNudgeWake(state, nowIso) {
    return { ...state, lastPolledAt: nowIso, lastWakeAt: nowIso, updatedAt: nowIso };
}
/**
 * Ms until the next Host idle-check opportunity for this Session.
 * Cycles on the full poll interval from `lastPolledAt` (else `armedAt`) so the
 * Header never sticks at overdue after the first window elapses. After a wake,
 * the in-memory anti-spam half-interval still applies before another followup.
 * @param state - durable nudge.
 * @param intervalMinutes - Host poll interval (`watchdogIntervalMinutes`).
 * @param nowMs - evaluation clock.
 * @returns remaining ms in `(0, intervalMs]`, or `null` when not armed / interval off.
 */
export function nudgeNextCheckRemainingMs(state, intervalMinutes, nowMs) {
    if (!state.enabled || !Number.isSafeInteger(intervalMinutes) || intervalMinutes <= 0)
        return null;
    const baseIso = state.lastPolledAt.length > 0 ? state.lastPolledAt : state.armedAt;
    if (baseIso.length === 0)
        return null;
    const base = Date.parse(baseIso);
    if (!Number.isFinite(base))
        return null;
    const intervalMs = intervalMinutes * 60_000;
    const elapsed = Math.max(0, nowMs - base);
    const mod = elapsed % intervalMs;
    // Exact boundary (just armed, just polled, or wrap): show a full interval again.
    if (mod === 0)
        return intervalMs;
    return intervalMs - mod;
}
//# sourceMappingURL=nudge.js.map