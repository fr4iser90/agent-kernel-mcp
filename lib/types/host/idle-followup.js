/**
 * Per-Session idle followup: opt-in flag, followup prompt, and optional hour budget
 * under `$DSH_HOME`. Independent of autonomy `state.json` so Header can arm
 * without `/autonomy start`.
 * @module agent-kernel-mcp/idle-followup
 */
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
/** Default followup text when the operator leaves the prompt empty. */
export const DEFAULT_FOLLOWUP_PROMPT = 'Continue';
/** Max UTF-8 code units accepted for a custom followup prompt. */
export const MAX_FOLLOWUP_PROMPT_CHARS = 8_000;
/** Max Session followup window in hours (30 days). `0` means forever. */
export const MAX_FOLLOWUP_ACTIVE_HOURS = 720;
/**
 * Resolve the directory that holds `session-followup/<sessionId>.json`.
 * Prefers `$DSH_HOME`, else `~/.dsh`.
 * @returns absolute followup root directory.
 */
export function resolveSessionFollowupRoot() {
    const home = process.env.DSH_HOME?.trim();
    const base = home !== undefined && home.length > 0 ? home : path.join(os.homedir(), '.dsh');
    return path.join(base, 'session-followup');
}
/**
 * Reject session ids that are unsafe as a single path segment.
 * @param sessionId - Session id string.
 * @returns the same id when valid.
 */
export function assertFollowupSessionId(sessionId) {
    if (!/^[A-Za-z0-9._-]{1,200}$/u.test(sessionId)) {
        throw new Error('sessionId is not a safe followup filename');
    }
    return sessionId;
}
/**
 * Absolute path for one Session's followup file.
 * @param followupRoot - directory from {@link resolveSessionFollowupRoot}.
 * @param sessionId - Session id.
 */
export function resolveFollowupPath(followupRoot, sessionId) {
    return path.join(followupRoot, `${assertFollowupSessionId(sessionId)}.json`);
}
/**
 * Normalize prompt text; empty → default Continue.
 * @param raw - operator input.
 * @returns trimmed prompt or {@link DEFAULT_FOLLOWUP_PROMPT}.
 */
export function normalizeFollowupPrompt(raw) {
    const trimmed = raw.trim();
    if (trimmed.length === 0)
        return DEFAULT_FOLLOWUP_PROMPT;
    if (trimmed.length > MAX_FOLLOWUP_PROMPT_CHARS) {
        throw new Error(`followup prompt exceeds ${String(MAX_FOLLOWUP_PROMPT_CHARS)} characters`);
    }
    return trimmed;
}
/**
 * Validate active-hours budget (`0` = forever).
 * @param raw - operator input.
 * @returns sanitized hour count.
 */
export function normalizeFollowupActiveHours(raw) {
    if (!Number.isSafeInteger(raw) || raw < 0 || raw > MAX_FOLLOWUP_ACTIVE_HOURS) {
        throw new Error(`followup activeHours must be an integer from 0 to ${String(MAX_FOLLOWUP_ACTIVE_HOURS)}`);
    }
    return raw;
}
/**
 * Default in-memory followup when no file exists.
 * @returns disabled Continue record with empty timestamps.
 */
export function emptyFollowupState() {
    return {
        enabled: false,
        prompt: DEFAULT_FOLLOWUP_PROMPT,
        activeHours: 0,
        armedAt: '',
        lastPolledAt: '',
        lastWakeAt: '',
        updatedAt: '',
    };
}
/**
 * Parse a JSON followup record; invalid shapes throw.
 * @param raw - file UTF-8 contents.
 * @returns durable followup state.
 */
export function parseFollowupState(raw) {
    const parsed = JSON.parse(raw);
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new Error('followup state must be a JSON object');
    }
    const record = parsed;
    const enabled = record['enabled'] === true;
    const promptRaw = typeof record['prompt'] === 'string' ? record['prompt'] : DEFAULT_FOLLOWUP_PROMPT;
    const prompt = normalizeFollowupPrompt(promptRaw);
    const hoursRaw = record['activeHours'];
    const activeHours = hoursRaw === undefined
        ? 0
        : typeof hoursRaw === 'number'
            ? normalizeFollowupActiveHours(hoursRaw)
            : (() => { throw new Error('followup state activeHours must be a number'); })();
    const armedAt = typeof record['armedAt'] === 'string' ? record['armedAt'] : '';
    const lastPolledAt = typeof record['lastPolledAt'] === 'string' ? record['lastPolledAt'] : '';
    const lastWakeAt = typeof record['lastWakeAt'] === 'string' ? record['lastWakeAt'] : '';
    const updatedAt = typeof record['updatedAt'] === 'string' ? record['updatedAt'] : '';
    return { enabled, prompt, activeHours, armedAt, lastPolledAt, lastWakeAt, updatedAt };
}
/**
 * Read followup state for a Session; missing file → empty defaults.
 * @param followupRoot - storage directory.
 * @param sessionId - Session id.
 */
export async function readSessionFollowup(followupRoot, sessionId) {
    const file = resolveFollowupPath(followupRoot, sessionId);
    let raw;
    try {
        raw = await readFile(file, 'utf8');
    }
    catch (error) {
        if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
            return emptyFollowupState();
        }
        throw error;
    }
    return parseFollowupState(raw);
}
/**
 * Persist followup state for a Session.
 * @param followupRoot - storage directory.
 * @param sessionId - Session id.
 * @param state - next record.
 */
export async function writeSessionFollowup(followupRoot, sessionId, state) {
    const file = resolveFollowupPath(followupRoot, sessionId);
    await mkdir(followupRoot, { recursive: true });
    await writeFile(file, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
}
/**
 * Session ids whose durable followup file is currently enabled (and budget-active).
 * Corrupt or unsafe filenames are skipped so one bad file cannot break the index.
 * @param followupRoot - directory from {@link resolveSessionFollowupRoot}.
 * @param nowMs - evaluation clock for hour-budget expiry.
 */
export async function listEnabledFollowupSessionIds(followupRoot, nowMs = Date.now()) {
    let names;
    try {
        names = await readdir(followupRoot);
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
            assertFollowupSessionId(sessionId);
        }
        catch {
            continue;
        }
        let state;
        try {
            state = parseFollowupState(await readFile(resolveFollowupPath(followupRoot, sessionId), 'utf8'));
        }
        catch {
            continue;
        }
        const { state: live, expired } = expireFollowupIfNeeded(state, nowMs, iso);
        if (expired || !live.enabled)
            continue;
        enabled.push(sessionId);
    }
    return enabled;
}
/**
 * Remaining ms in a limited arm window; `Infinity` when forever; `0` when expired/off.
 * @param state - durable followup.
 * @param nowMs - evaluation clock.
 */
export function followupRemainingMs(state, nowMs) {
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
 * @param state - durable followup.
 * @param nowMs - evaluation clock.
 */
export function isFollowupBudgetActive(state, nowMs) {
    const remaining = followupRemainingMs(state, nowMs);
    return remaining === Number.POSITIVE_INFINITY || remaining > 0;
}
/**
 * Disable a timed-out followup; no-op when still active or already off.
 * @param state - durable followup.
 * @param nowMs - evaluation clock.
 * @param nowIso - write timestamp when expiring.
 * @returns next state and whether an expiry write is needed.
 */
export function expireFollowupIfNeeded(state, nowMs, nowIso) {
    if (!state.enabled || isFollowupBudgetActive(state, nowMs)) {
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
 * Whether the Host timer should post an idle followup.
 * @param state - durable followup (caller should expire first).
 * @param agentStatus - live agent status (`idle` only).
 * @param nowMs - evaluation clock.
 */
export function shouldWakeFollowup(state, agentStatus, nowMs) {
    return state.enabled && agentStatus === 'idle' && isFollowupBudgetActive(state, nowMs);
}
/**
 * Merge a partial update into the durable followup record.
 * @param previous - current state.
 * @param patch - fields to change.
 * @param nowIso - write timestamp (also used as `armedAt` when arming).
 * @returns next state.
 */
export function patchSessionFollowup(previous, patch, nowIso) {
    if (patch.enabled === undefined && patch.prompt === undefined && patch.activeHours === undefined) {
        throw new Error('followup patch requires enabled, prompt, and/or activeHours');
    }
    const enabled = patch.enabled ?? previous.enabled;
    const activeHours = patch.activeHours !== undefined
        ? normalizeFollowupActiveHours(patch.activeHours)
        : previous.activeHours;
    const prompt = patch.prompt !== undefined ? normalizeFollowupPrompt(patch.prompt) : previous.prompt;
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
 * Mark that the Host timer just evaluated this Session for an idle followup.
 * @param state - current armed state.
 * @param nowIso - poll timestamp.
 */
export function recordFollowupPoll(state, nowIso) {
    return { ...state, lastPolledAt: nowIso, updatedAt: nowIso };
}
/**
 * Mark that this Session just received an idle followup.
 * @param state - current armed state.
 * @param nowIso - wake timestamp.
 */
export function recordFollowupWake(state, nowIso) {
    return { ...state, lastPolledAt: nowIso, lastWakeAt: nowIso, updatedAt: nowIso };
}
/**
 * Ms until the next Host idle-check opportunity for this Session.
 * Cycles on the full poll interval from `lastPolledAt` (else `armedAt`) so the
 * Header never sticks at overdue after the first window elapses. After a wake,
 * the in-memory anti-spam half-interval still applies before another followup.
 * @param state - durable followup.
 * @param intervalMinutes - Host poll interval (`watchdogIntervalMinutes`).
 * @param nowMs - evaluation clock.
 * @returns remaining ms in `(0, intervalMs]`, or `null` when not armed / interval off.
 */
export function followupNextCheckRemainingMs(state, intervalMinutes, nowMs) {
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
//# sourceMappingURL=idle-followup.js.map