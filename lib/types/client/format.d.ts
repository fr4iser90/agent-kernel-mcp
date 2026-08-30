/**
 * Format a non-negative duration as a compact elapsed label.
 * @param ms - elapsed milliseconds (clamped at 0).
 * @returns labels like `45s`, `14m`, `2h 14m`, or `3d 2h`.
 */
export declare function formatAutonomyDuration(ms: number): string;
/**
 * Build the Header time label from status fields.
 * @param runStartedAt - ISO start or empty.
 * @param maxDurationMinutes - 0 means unlimited (elapsed only).
 * @param nowMs - clock for elapsed.
 * @returns `elapsed / max`, elapsed only, or empty when not started.
 */
export declare function formatAutonomyTimeLabel(runStartedAt: string, maxDurationMinutes: number, nowMs: number): string;
/**
 * Remaining Session-nudge window label for the Header capsule.
 * @param enabled - whether nudge is armed.
 * @param armedAt - ISO arm start.
 * @param activeHours - `0` = forever.
 * @param nowMs - clock.
 * @param foreverLabel - copy when unlimited.
 * @returns remaining label, forever label, or empty when off.
 */
export declare function formatNudgeCountdownLabel(enabled: boolean, armedAt: string, activeHours: number, nowMs: number, foreverLabel: string): string;
/**
 * Compact "next Host idle check" label for the Header capsule.
 * @param remainingMs - ms until estimated next check, or `null` when off.
 * @param soonLabel - fallback when remaining is non-positive (should not occur for a cycling countdown).
 * @returns `↓ 3m`, soon label, or empty when not armed.
 */
export declare function formatNudgeNextCheckLabel(remainingMs: number | null, soonLabel: string): string;
//# sourceMappingURL=format.d.ts.map