import { jsx as _jsx } from "react/jsx-runtime";
import { IconRefreshOutline14 } from '@deepseek-ai/dsh-client-ui-primitives';
import css from './NudgeRowMark.module.css';
/**
 * Show a refresh glyph left of the relative time when this Session's nudge is on.
 * @param props - owner `sessionId` + index store + locale.
 */
export function NudgeRowMark({ sessionId, useNudgeIndex, t, }) {
    const enabled = useNudgeIndex(state => state.enabled[String(sessionId)] === true);
    if (!enabled)
        return null;
    return (_jsx("span", { className: css.mark, title: t('nudge.rowMarkTitle'), "aria-label": t('nudge.rowMarkTitle'), children: _jsx(IconRefreshOutline14, { size: 12 }) }));
}
//# sourceMappingURL=NudgeRowMark.js.map