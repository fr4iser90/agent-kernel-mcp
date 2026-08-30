import { useEffect, useState, type ReactNode } from 'react'
import type { ObservableSnapshot, SessionId } from '@deepseek-ai/dsh-client-runtime/client'
import { Button, IconSettingsOutline14, Modal } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { MAX_NUDGE_ACTIVE_HOURS, nudgeNextCheckRemainingMs } from '../host/nudge.ts'
import type { AgentKernelHeaderState } from './controller.ts'
import { formatNudgeCountdownLabel, formatNudgeNextCheckLabel } from './format.ts'
import { NS } from './locales.ts'
import css from './HeaderAction.module.css'

export interface AgentKernelHeaderInjected {
  hooks: { agentKernelHeader: ObservableSnapshot<AgentKernelHeaderState> }
  watch: (sessionId: SessionId) => void
  unwatch: (sessionId: SessionId) => void
  setEnabled: (sessionId: SessionId, enabled: boolean) => Promise<void>
  saveSettings: (
    sessionId: SessionId,
    settings: {
      readonly prompt?: string
      readonly activeHours?: number
      readonly kernelUrl?: string
      readonly kernelToken?: string
    },
  ) => Promise<void>
  setSettingsOpen: (sessionId: SessionId, open: boolean) => void
}

export type AgentKernelHeaderProps =
  PropsRuntime<'conversation.session.header.utilities'>
  & PropsLocale<typeof NS>
  & InjectFace<AgentKernelHeaderInjected>

export function AgentKernelHeaderAction({
  sessionId,
  useAgentKernelHeader,
  watch,
  unwatch,
  setEnabled,
  saveSettings,
  setSettingsOpen,
  t,
}: AgentKernelHeaderProps): ReactNode {
  const entry = useAgentKernelHeader(state => state.bySession[String(sessionId)])
  const [nowMs, setNowMs] = useState(() => Date.now())
  const [draftPrompt, setDraftPrompt] = useState('')
  const [draftForever, setDraftForever] = useState(true)
  const [draftHours, setDraftHours] = useState('8')
  const [draftUrl, setDraftUrl] = useState('')
  const [draftToken, setDraftToken] = useState('')

  useEffect(() => {
    watch(sessionId)
    return () => { unwatch(sessionId) }
  }, [sessionId, watch, unwatch])

  const enabled = entry?.watchdogEnabled === true
  useEffect(() => {
    if (!enabled) return
    const timer = setInterval(() => { setNowMs(Date.now()) }, 1_000)
    return () => { clearInterval(timer) }
  }, [enabled])

  const busy = entry?.busy === true
  const settingsOpen = entry?.settingsOpen === true
  const savedPrompt = entry?.nudgePrompt ?? 'Continue'
  const savedHours = entry?.nudgeActiveHours ?? 0
  const savedUrl = entry?.kernelUrl ?? ''
  const savedToken = entry?.kernelToken ?? ''
  const nextCheck = formatNudgeNextCheckLabel(
    enabled
      ? nudgeNextCheckRemainingMs(
        {
          enabled: true,
          prompt: savedPrompt,
          activeHours: savedHours,
          armedAt: entry?.nudgeArmedAt ?? '',
          lastPolledAt: entry?.nudgeLastPolledAt ?? '',
          lastWakeAt: entry?.nudgeLastWakeAt ?? '',
          updatedAt: '',
        },
        entry?.watchdogIntervalMinutes ?? 5,
        nowMs,
      )
      : null,
    t('nudge.nextSoon'),
  )
  const nudgeClock = formatNudgeCountdownLabel(
    enabled,
    entry?.nudgeArmedAt ?? '',
    savedHours,
    nowMs,
    t('nudge.forever'),
  )

  useEffect(() => {
    if (!settingsOpen) return
    setDraftPrompt(savedPrompt)
    setDraftForever(savedHours <= 0)
    setDraftHours(savedHours > 0 ? String(savedHours) : '8')
    setDraftUrl(savedUrl)
    setDraftToken(savedToken)
  }, [settingsOpen, savedPrompt, savedHours, savedUrl, savedToken])

  return (
    <>
      <div className={css.capsule} title={t('watchdog.title')}>
        <label className={css.label}>
          <input
            className={css.checkbox}
            type="checkbox"
            checked={enabled}
            disabled={busy}
            aria-label={t('watchdog.label')}
            onChange={(event) => {
              void setEnabled(sessionId, event.target.checked)
            }}
          />
          <span>{t('watchdog.label')}</span>
        </label>
        <button
          type="button"
          className={css.gear}
          disabled={busy}
          aria-label={t('settings.open')}
          onClick={() => { setSettingsOpen(sessionId, true) }}
        >
          <IconSettingsOutline14 size={14} />
        </button>
        {nextCheck.length > 0 ? (
          <span className={css.time} aria-live="polite">{nextCheck}</span>
        ) : null}
        {nudgeClock.length > 0 ? (
          <span className={css.timeSecondary} aria-live="polite">{nudgeClock}</span>
        ) : null}
      </div>
      <Modal
        open={settingsOpen}
        onClose={() => { setSettingsOpen(sessionId, false) }}
        title={t('dialog.title')}
        description={t('dialog.description')}
        closeLabel={t('dialog.close')}
        footer={(
          <div className={css.footer}>
            <Button variant="outline" onClick={() => { setSettingsOpen(sessionId, false) }}>
              {t('dialog.close')}
            </Button>
            <Button
              variant="primary"
              disabled={busy}
              onClick={() => {
                void (async () => {
                  const hours = draftForever
                    ? 0
                    : Math.min(MAX_NUDGE_ACTIVE_HOURS, Math.max(1, Math.trunc(Number(draftHours)) || 1))
                  await saveSettings(sessionId, {
                    prompt: draftPrompt,
                    activeHours: hours,
                    kernelUrl: draftUrl,
                    kernelToken: draftToken,
                  })
                  setSettingsOpen(sessionId, false)
                })()
              }}
            >
              {t('dialog.save')}
            </Button>
          </div>
        )}
      >
        <label className={css.promptField}>
          <span className={css.promptLabel}>{t('dialog.targetLabel')}</span>
          <input
            className={css.hoursInput}
            style={{ width: '100%' }}
            type="url"
            value={draftUrl}
            disabled={busy}
            placeholder="https://agent-kernel.example.com"
            aria-label={t('dialog.targetLabel')}
            onChange={(event) => { setDraftUrl(event.target.value) }}
          />
        </label>
        <label className={css.promptField}>
          <span className={css.promptLabel}>{t('dialog.tokenLabel')}</span>
          <input
            className={css.hoursInput}
            style={{ width: '100%' }}
            type="password"
            autoComplete="off"
            value={draftToken}
            disabled={busy}
            aria-label={t('dialog.tokenLabel')}
            onChange={(event) => { setDraftToken(event.target.value) }}
          />
        </label>
        <label className={css.promptField}>
          <span className={css.promptLabel}>{t('dialog.promptLabel')}</span>
          <textarea
            className={css.prompt}
            value={draftPrompt}
            rows={5}
            disabled={busy}
            aria-label={t('dialog.promptLabel')}
            onChange={(event) => { setDraftPrompt(event.target.value) }}
          />
        </label>
        <fieldset className={css.durationField} disabled={busy}>
          <legend className={css.promptLabel}>{t('dialog.durationLabel')}</legend>
          <label className={css.radioRow}>
            <input
              type="radio"
              name={`ak-nudge-duration-${String(sessionId)}`}
              checked={draftForever}
              onChange={() => { setDraftForever(true) }}
            />
            <span>{t('dialog.durationForever')}</span>
          </label>
          <label className={css.radioRow}>
            <input
              type="radio"
              name={`ak-nudge-duration-${String(sessionId)}`}
              checked={!draftForever}
              onChange={() => { setDraftForever(false) }}
            />
            <span>{t('dialog.durationHours')}</span>
          </label>
          {!draftForever ? (
            <label className={css.hoursRow}>
              <span className={css.promptLabel}>{t('dialog.hoursLabel')}</span>
              <input
                className={css.hoursInput}
                type="number"
                min={1}
                max={MAX_NUDGE_ACTIVE_HOURS}
                step={1}
                value={draftHours}
                aria-label={t('dialog.hoursLabel')}
                onChange={(event) => { setDraftHours(event.target.value) }}
              />
            </label>
          ) : null}
        </fieldset>
        {entry?.error !== null && entry?.error !== undefined && entry.error.length > 0 ? (
          <p className={css.error} role="alert">{t('dialog.error')}: {entry.error}</p>
        ) : null}
      </Modal>
    </>
  )
}
