/**
 * Per-Session idle followup: opt-in flag, followup prompt, and optional hour budget
 * under `$DSH_HOME`. Independent of autonomy `state.json` so Header can arm
 * without `/autonomy start`.
 * @module agent-kernel-mcp/idle-followup
 */
/** Default followup text when the operator leaves the prompt empty. */
export declare const DEFAULT_FOLLOWUP_PROMPT = "Continue";
/** Max UTF-8 code units accepted for a custom followup prompt. */
export declare const MAX_FOLLOWUP_PROMPT_CHARS = 8000;
/** Max Session followup window in hours (30 days). `0` means forever. */
export declare const MAX_FOLLOWUP_ACTIVE_HOURS = 720;
/** Durable per-Session followup record. */
export interface SessionFollowupState {
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
 * Resolve the directory that holds `session-followup/<sessionId>.json`.
 * Prefers `$DSH_HOME`, else `~/.dsh`.
 * @returns absolute followup root directory.
 */
export declare function resolveSessionFollowupRoot(): string;
/**
 * Reject session ids that are unsafe as a single path segment.
 * @param sessionId - Session id string.
 * @returns the same id when valid.
 */
export declare function assertFollowupSessionId(sessionId: string): string;
/**
 * Absolute path for one Session's followup file.
 * @param followupRoot - directory from {@link resolveSessionFollowupRoot}.
 * @param sessionId - Session id.
 */
export declare function resolveFollowupPath(followupRoot: string, sessionId: string): string;
/**
 * Normalize prompt text; empty → default Continue.
 * @param raw - operator input.
 * @returns trimmed prompt or {@link DEFAULT_FOLLOWUP_PROMPT}.
 */
export declare function normalizeFollowupPrompt(raw: string): string;
/**
 * Validate active-hours budget (`0` = forever).
 * @param raw - operator input.
 * @returns sanitized hour count.
 */
export declare function normalizeFollowupActiveHours(raw: number): number;
/**
 * Default in-memory followup when no file exists.
 * @returns disabled Continue record with empty timestamps.
 */
export declare function emptyFollowupState(): SessionFollowupState;
/**
 * Parse a JSON followup record; invalid shapes throw.
 * @param raw - file UTF-8 contents.
 * @returns durable followup state.
 */
export declare function parseFollowupState(raw: string): SessionFollowupState;
/**
 * Read followup state for a Session; missing file → empty defaults.
 * @param followupRoot - storage directory.
 * @param sessionId - Session id.
 */
export declare function readSessionFollowup(followupRoot: string, sessionId: string): Promise<SessionFollowupState>;
/**
 * Persist followup state for a Session.
 * @param followupRoot - storage directory.
 * @param sessionId - Session id.
 * @param state - next record.
 */
export declare function writeSessionFollowup(followupRoot: string, sessionId: string, state: SessionFollowupState): Promise<void>;
/**
 * Session ids whose durable followup file is currently enabled (and budget-active).
 * Corrupt or unsafe filenames are skipped so one bad file cannot break the index.
 * @param followupRoot - directory from {@link resolveSessionFollowupRoot}.
 * @param nowMs - evaluation clock for hour-budget expiry.
 */
export declare function listEnabledFollowupSessionIds(followupRoot: string, nowMs?: number): Promise<readonly string[]>;
/**
 * Remaining ms in a limited arm window; `Infinity` when forever; `0` when expired/off.
 * @param state - durable followup.
 * @param nowMs - evaluation clock.
 */
export declare function followupRemainingMs(state: SessionFollowupState, nowMs: number): number;
/**
 * Whether the arm window is still open.
 * @param state - durable followup.
 * @param nowMs - evaluation clock.
 */
export declare function isFollowupBudgetActive(state: SessionFollowupState, nowMs: number): boolean;
/**
 * Disable a timed-out followup; no-op when still active or already off.
 * @param state - durable followup.
 * @param nowMs - evaluation clock.
 * @param nowIso - write timestamp when expiring.
 * @returns next state and whether an expiry write is needed.
 */
export declare function expireFollowupIfNeeded(state: SessionFollowupState, nowMs: number, nowIso: string): {
    readonly state: SessionFollowupState;
    readonly expired: boolean;
};
/**
 * Whether the Host timer should post an idle followup.
 * @param state - durable followup (caller should expire first).
 * @param agentStatus - live agent status (`idle` only).
 * @param nowMs - evaluation clock.
 */
export declare function shouldWakeFollowup(state: SessionFollowupState, agentStatus: 'idle' | 'running' | string, nowMs: number): boolean;
/**
 * Merge a partial update into the durable followup record.
 * @param previous - current state.
 * @param patch - fields to change.
 * @param nowIso - write timestamp (also used as `armedAt` when arming).
 * @returns next state.
 */
export declare function patchSessionFollowup(previous: SessionFollowupState, patch: {
    readonly enabled?: boolean;
    readonly prompt?: string;
    readonly activeHours?: number;
}, nowIso: string): SessionFollowupState;
/**
 * Mark that the Host timer just evaluated this Session for an idle followup.
 * @param state - current armed state.
 * @param nowIso - poll timestamp.
 */
export declare function recordFollowupPoll(state: SessionFollowupState, nowIso: string): SessionFollowupState;
/**
 * Mark that this Session just received an idle followup followup.
 * @param state - current armed state.
 * @param nowIso - wake timestamp.
 */
export declare function recordFollowupWake(state: SessionFollowupState, nowIso: string): SessionFollowupState;
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
export declare function followupNextCheckRemainingMs(state: SessionFollowupState, intervalMinutes: number, nowMs: number): number | null;
//# sourceMappingURL=idle-followup.d.ts.map