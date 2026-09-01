import { jsx as _jsx } from "react/jsx-runtime";
import { IconRefreshOutline14 } from '@deepseek-ai/dsh-client-ui-primitives';
import css from './FollowupRowMark.module.css';
/**
 * Show a refresh glyph left of the relative time when this Session's idle followup is on.
 * @param props - owner `sessionId` + index store + locale.
 */
export function FollowupRowMark({ sessionId, useFollowupIndex, t, }) {
    const enabled = useFollowupIndex(state => state.enabled[String(sessionId)] === true);
    if (!enabled)
        return null;
    return (_jsx("span", { className: css.mark, title: t('followup.rowMarkTitle'), "aria-label": t('followup.rowMarkTitle'), children: _jsx(IconRefreshOutline14, { size: 12 }) }));
}
//# sourceMappingURL=FollowupRowMark.js.map