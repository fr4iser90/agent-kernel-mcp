/**
 * Per-Session idle nudge: opt-in flag, followup prompt, and optional hour budget
 * under `$DSH_HOME`. Independent of autonomy `state.json` so Header can arm
 * without `/autonomy start`.
 * @module @deepseek-ai/dsh-tool-autonomy/nudge
 */
/** Default followup text when the operator leaves the prompt empty. */
export declare const DEFAULT_NUDGE_PROMPT = "Continue";
/** Max UTF-8 code units accepted for a custom nudge prompt. */
export declare const MAX_NUDGE_PROMPT_CHARS = 8000;
/** Max Session nudge window in hours (30 days). `0` means forever. */
export declare const MAX_NUDGE_ACTIVE_HOURS = 720;
/** Durable per-Session nudge record. */
export interface SessionNudgeState {
    readonly enabled: boolean;
    readonly prompt: string;
    /** Hour budget while armed; `0` = forever. */
    readonly activeHours: number;
    /** ISO time when the current arm window started; empty when disabled. */
    readonly armedAt: string;
    /** ISO time of the last Host idle-check tick for this Session; empty if none. */
    readonly lastPolledAt: string;
    /** ISO time of the last idle followup posted for this Session; empty if none. */
    readonly lastWakeAt: string;
    readonly updatedAt: string;
}
/**
 * Resolve the directory that holds `session-nudge/<sessionId>.json`.
 * Prefers `$DSH_HOME`, else `~/.dsh`.
 * @returns absolute nudge root directory.
 */
export declare function resolveSessionNudgeRoot(): string;
/**
 * Reject session ids that are unsafe as a single path segment.
 * @param sessionId - Session id string.
 * @returns the same id when valid.
 */
export declare function assertNudgeSessionId(sessionId: string): string;
/**
 * Absolute path for one Session's nudge file.
 * @param nudgeRoot - directory from {@link resolveSessionNudgeRoot}.
 * @param sessionId - Session id.
 */
export declare function resolveNudgePath(nudgeRoot: string, sessionId: string): string;
/**
 * Normalize prompt text; empty → default Continue.
 * @param raw - operator input.
 * @returns trimmed prompt or {@link DEFAULT_NUDGE_PROMPT}.
 */
export declare function normalizeNudgePrompt(raw: string): string;
/**
 * Validate active-hours budget (`0` = forever).
 * @param raw - operator input.
 * @returns sanitized hour count.
 */
export declare function normalizeNudgeActiveHours(raw: number): number;
/**
 * Default in-memory nudge when no file exists.
 * @returns disabled Continue record with empty timestamps.
 */
export declare function emptyNudgeState(): SessionNudgeState;
/**
 * Parse a JSON nudge record; invalid shapes throw.
 * @param raw - file UTF-8 contents.
 * @returns durable nudge state.
 */
export declare function parseNudgeState(raw: string): SessionNudgeState;
/**
 * Read nudge state for a Session; missing file → empty defaults.
 * @param nudgeRoot - storage directory.
 * @param sessionId - Session id.
 */
export declare function readSessionNudge(nudgeRoot: string, sessionId: string): Promise<SessionNudgeState>;
/**
 * Persist nudge state for a Session.
 * @param nudgeRoot - storage directory.
 * @param sessionId - Session id.
 * @param state - next record.
 */
export declare function writeSessionNudge(nudgeRoot: string, sessionId: string, state: SessionNudgeState): Promise<void>;
/**
 * Session ids whose durable nudge file is currently enabled (and budget-active).
 * Corrupt or unsafe filenames are skipped so one bad file cannot break the index.
 * @param nudgeRoot - directory from {@link resolveSessionNudgeRoot}.
 * @param nowMs - evaluation clock for hour-budget expiry.
 */
export declare function listEnabledNudgeSessionIds(nudgeRoot: string, nowMs?: number): Promise<readonly string[]>;
/**
 * Remaining ms in a limited arm window; `Infinity` when forever; `0` when expired/off.
 * @param state - durable nudge.
 * @param nowMs - evaluation clock.
 */
export declare function nudgeRemainingMs(state: SessionNudgeState, nowMs: number): number;
/**
 * Whether the arm window is still open.
 * @param state - durable nudge.
 * @param nowMs - evaluation clock.
 */
export declare function isNudgeBudgetActive(state: SessionNudgeState, nowMs: number): boolean;
/**
 * Disable a timed-out nudge; no-op when still active or already off.
 * @param state - durable nudge.
 * @param nowMs - evaluation clock.
 * @param nowIso - write timestamp when expiring.
 * @returns next state and whether an expiry write is needed.
 */
export declare function expireNudgeIfNeeded(state: SessionNudgeState, nowMs: number, nowIso: string): {
    readonly state: SessionNudgeState;
    readonly expired: boolean;
};
/**
 * Whether the Host timer should post a nudge followup.
 * @param state - durable nudge (caller should expire first).
 * @param agentStatus - live agent status (`idle` only).
 * @param nowMs - evaluation clock.
 */
export declare function shouldWakeNudge(state: SessionNudgeState, agentStatus: 'idle' | 'running' | string, nowMs: number): boolean;
/**
 * Merge a partial update into the durable nudge record.
 * @param previous - current state.
 * @param patch - fields to change.
 * @param nowIso - write timestamp (also used as `armedAt` when arming).
 * @returns next state.
 */
export declare function patchSessionNudge(previous: SessionNudgeState, patch: {
    readonly enabled?: boolean;
    readonly prompt?: string;
    readonly activeHours?: number;
}, nowIso: string): SessionNudgeState;
/**
 * Mark that the Host timer just evaluated this Session for an idle nudge.
 * @param state - current armed state.
 * @param nowIso - poll timestamp.
 */
export declare function recordNudgePoll(state: SessionNudgeState, nowIso: string): SessionNudgeState;
/**
 * Mark that this Session just received an idle nudge followup.
 * @param state - current armed state.
 * @param nowIso - wake timestamp.
 */
export declare function recordNudgeWake(state: SessionNudgeState, nowIso: string): SessionNudgeState;
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
export declare function nudgeNextCheckRemainingMs(state: SessionNudgeState, intervalMinutes: number, nowMs: number): number | null;
//# sourceMappingURL=nudge.d.ts.map