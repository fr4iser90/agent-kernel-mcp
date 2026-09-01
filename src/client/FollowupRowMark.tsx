/**
 * Compact Workspaces-row mark when Session idle followup is armed.
 * @module agent-kernel-mcp/client/FollowupRowMark
 */

import type { ReactNode } from 'react'
import { IconRefreshOutline14 } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { ObservableSnapshot } from '@deepseek-ai/dsh-client-runtime/client'
import type { FollowupIndexState } from './followup-index.ts'
import { NS } from './locales.ts'
import css from './FollowupRowMark.module.css'

/** Browser operations for the sidebar followup mark. */
export interface FollowupRowMarkInjected {
  hooks: { followupIndex: ObservableSnapshot<FollowupIndexState> }
}

export type FollowupRowMarkProps =
  PropsRuntime<'sidebar.workspaces.session.trailing'>
  & PropsLocale<typeof NS>
  & InjectFace<FollowupRowMarkInjected>

/**
 * Show a refresh glyph left of the relative time when this Session's idle followup is on.
 * @param props - owner `sessionId` + index store + locale.
 */
export function FollowupRowMark({
  sessionId,
  useFollowupIndex,
  t,
}: FollowupRowMarkProps): ReactNode {
  const enabled = useFollowupIndex(state => state.enabled[String(sessionId)] === true)
  if (!enabled) return null
  return (
    <span className={css.mark} title={t('followup.rowMarkTitle')} aria-label={t('followup.rowMarkTitle')}>
      <IconRefreshOutline14 size={12} />
    </span>
  )
}
