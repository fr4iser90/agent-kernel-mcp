/**
 * Format a non-negative duration as a compact elapsed label.
 * @param ms - elapsed milliseconds (clamped at 0).
 * @returns labels like `45s`, `14m`, `2h 14m`, or `3d 2h`.
 */
export function formatAutonomyDuration(ms) {
    const totalSec = Math.max(0, Math.floor(ms / 1000));
    const days = Math.floor(totalSec / 86_400);
    const hours = Math.floor((totalSec % 86_400) / 3600);
    const minutes = Math.floor((totalSec % 3600) / 60);
    const seconds = totalSec % 60;
    if (days > 0) {
        return hours > 0 ? `${String(days)}d ${String(hours)}h` : `${String(days)}d`;
    }
    if (hours > 0) {
        return minutes > 0 ? `${String(hours)}h ${String(minutes)}m` : `${String(hours)}h`;
    }
    if (minutes > 0)
        return `${String(minutes)}m`;
    return `${String(seconds)}s`;
}
/**
 * Build the Header time label from status fields.
 * @param runStartedAt - ISO start or empty.
 * @param maxDurationMinutes - 0 means unlimited (elapsed only).
 * @param nowMs - clock for elapsed.
 * @returns `elapsed / max`, elapsed only, or empty when not started.
 */
export function formatAutonomyTimeLabel(runStartedAt, maxDurationMinutes, nowMs) {
    if (runStartedAt.length === 0)
        return '';
    const started = Date.parse(runStartedAt);
    if (!Number.isFinite(started))
        return '';
    const elapsed = formatAutonomyDuration(nowMs - started);
    if (!Number.isSafeInteger(maxDurationMinutes) || maxDurationMinutes <= 0)
        return elapsed;
    return `${elapsed} / ${formatAutonomyDuration(maxDurationMinutes * 60_000)}`;
}
/**
 * Remaining Session-followup window label for the Header capsule.
 * @param enabled - whether followup is armed.
 * @param armedAt - ISO arm start.
 * @param activeHours - `0` = forever.
 * @param nowMs - clock.
 * @param foreverLabel - copy when unlimited.
 * @returns remaining label, forever label, or empty when off.
 */
export function formatFollowupCountdownLabel(enabled, armedAt, activeHours, nowMs, foreverLabel) {
    if (!enabled)
        return '';
    if (!Number.isSafeInteger(activeHours) || activeHours <= 0)
        return foreverLabel;
    if (armedAt.length === 0)
        return '';
    const started = Date.parse(armedAt);
    if (!Number.isFinite(started))
        return '';
    const remaining = Math.max(0, started + activeHours * 3_600_000 - nowMs);
    return formatAutonomyDuration(remaining);
}
/**
 * Compact "next Host idle check" label for the Header capsule.
 * @param remainingMs - ms until estimated next check, or `null` when off.
 * @param soonLabel - fallback when remaining is non-positive (should not occur for a cycling countdown).
 * @returns `↓ 3m`, soon label, or empty when not armed.
 */
export function formatFollowupNextCheckLabel(remainingMs, soonLabel) {
    if (remainingMs === null)
        return '';
    if (remainingMs <= 0)
        return soonLabel;
    return `↓ ${formatAutonomyDuration(remainingMs)}`;
}
//# sourceMappingURL=format.js.map