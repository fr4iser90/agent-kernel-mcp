/**
 * Compact Workspaces-row mark when Session idle followup is armed.
 * @module agent-kernel-mcp/client/FollowupRowMark
 */
import type { ReactNode } from 'react';
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots';
import type { ObservableSnapshot } from '@deepseek-ai/dsh-client-store';
import type { FollowupIndexState } from './followup-index.ts';
import { NS } from './locales.ts';
/** Browser operations for the sidebar followup mark. */
export interface FollowupRowMarkInjected {
    hooks: {
        followupIndex: ObservableSnapshot<FollowupIndexState>;
    };
}
export type FollowupRowMarkProps = PropsRuntime<'sidebar.workspaces.session.trailing'> & PropsLocale<typeof NS> & InjectFace<FollowupRowMarkInjected>;
/**
 * Show a refresh glyph left of the relative time when this Session's idle followup is on.
 * @param props - owner `sessionId` + index store + locale.
 */
export declare function FollowupRowMark({ sessionId, useFollowupIndex, t, }: FollowupRowMarkProps): ReactNode;
//# sourceMappingURL=FollowupRowMark.d.ts.map