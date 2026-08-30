/**
 * Compact Workspaces-row mark when Session idle nudge is armed.
 * @module @deepseek-ai/dsh-tool-autonomy/client/NudgeRowMark
 */

import type { ReactNode } from 'react'
import { IconRefreshOutline14 } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { ObservableSnapshot } from '@deepseek-ai/dsh-client-runtime/client'
import type { NudgeIndexState } from './nudge-index.ts'
import { NS } from './locales.ts'
import css from './NudgeRowMark.module.css'

/** Browser operations for the sidebar nudge mark. */
export interface NudgeRowMarkInjected {
  hooks: { nudgeIndex: ObservableSnapshot<NudgeIndexState> }
}

export type NudgeRowMarkProps =
  PropsRuntime<'sidebar.workspaces.session.trailing'>
  & PropsLocale<typeof NS>
  & InjectFace<NudgeRowMarkInjected>

/**
 * Show a refresh glyph left of the relative time when this Session's nudge is on.
 * @param props - owner `sessionId` + index store + locale.
 */
export function NudgeRowMark({
  sessionId,
  useNudgeIndex,
  t,
}: NudgeRowMarkProps): ReactNode {
  const enabled = useNudgeIndex(state => state.enabled[String(sessionId)] === true)
  if (!enabled) return null
  return (
    <span className={css.mark} title={t('nudge.rowMarkTitle')} aria-label={t('nudge.rowMarkTitle')}>
      <IconRefreshOutline14 size={12} />
    </span>
  )
}
