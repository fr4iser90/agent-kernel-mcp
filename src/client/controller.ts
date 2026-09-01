/** Browser state for Agent Kernel Session Header. */

import { createSnapshotStore, type SnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { DEFAULT_FOLLOWUP_PROMPT } from '../host/idle-followup.ts'

export interface AgentKernelHeaderEntry {
  readonly watchdogEnabled: boolean
  readonly followupPrompt: string
  readonly followupActiveHours: number
  readonly followupArmedAt: string
  readonly followupLastPolledAt: string
  readonly followupLastWakeAt: string
  readonly watchdogIntervalMinutes: number
  readonly pluginEnabled: boolean
  readonly kernelUrl: string
  readonly kernelToken: string
  readonly kernelConnected: boolean
  readonly wssConnected: boolean
  readonly wssLastError: string | null
  readonly error: string | null
  readonly busy: boolean
  readonly settingsOpen: boolean
}

export interface AgentKernelHeaderState {
  bySession: Record<string, AgentKernelHeaderEntry | undefined>
}

type Fetch = (input: string | URL, init?: RequestInit) => Promise<Response>

const INITIAL: AgentKernelHeaderState = { bySession: {} }

const EMPTY: AgentKernelHeaderEntry = {
  watchdogEnabled: false,
  followupPrompt: DEFAULT_FOLLOWUP_PROMPT,
  followupActiveHours: 0,
  followupArmedAt: '',
  followupLastPolledAt: '',
  followupLastWakeAt: '',
  watchdogIntervalMinutes: 5,
  pluginEnabled: true,
  kernelUrl: '',
  kernelToken: '',
  kernelConnected: false,
  wssConnected: false,
  wssLastError: null,
  error: null,
  busy: false,
  settingsOpen: false,
}

function hostBase(): string {
  const origin = (globalThis as { location?: { origin?: string } }).location?.origin
  return origin !== undefined && origin !== 'null' ? origin : 'http://dsh.internal'
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function parseEntry(body: Partial<AgentKernelHeaderEntry>, settingsOpen: boolean): AgentKernelHeaderEntry {
  return {
    watchdogEnabled: body.watchdogEnabled === true,
    followupPrompt: typeof body.followupPrompt === 'string' && body.followupPrompt.trim().length > 0
      ? body.followupPrompt
      : DEFAULT_FOLLOWUP_PROMPT,
    followupActiveHours: typeof body.followupActiveHours === 'number' && Number.isSafeInteger(body.followupActiveHours)
      ? Math.max(0, body.followupActiveHours)
      : 0,
    followupArmedAt: typeof body.followupArmedAt === 'string' ? body.followupArmedAt : '',
    followupLastPolledAt: typeof body.followupLastPolledAt === 'string' ? body.followupLastPolledAt : '',
    followupLastWakeAt: typeof body.followupLastWakeAt === 'string' ? body.followupLastWakeAt : '',
    watchdogIntervalMinutes:
      typeof body.watchdogIntervalMinutes === 'number' && Number.isSafeInteger(body.watchdogIntervalMinutes)
        ? Math.max(0, body.watchdogIntervalMinutes)
        : 5,
    pluginEnabled: body.pluginEnabled !== false,
    kernelUrl: typeof body.kernelUrl === 'string' ? body.kernelUrl : '',
    kernelToken: typeof body.kernelToken === 'string' ? body.kernelToken : '',
    kernelConnected: body.kernelConnected === true,
    wssConnected: body.wssConnected === true,
    wssLastError: typeof body.wssLastError === 'string' ? body.wssLastError : null,
    error: null,
    busy: false,
    settingsOpen,
  }
}

export class AgentKernelHeaderController {
  readonly store: SnapshotStore<AgentKernelHeaderState> = createSnapshotStore(INITIAL)
  private readonly polls = new Map<SessionId, ReturnType<typeof setInterval>>()
  private disposed = false

  constructor(
    private readonly fetcher: Fetch = (input, init) => fetch(input, init),
    private readonly pollMs = 5_000,
  ) {}

  watch(sessionId: SessionId): void {
    if (this.disposed) return
    if (this.polls.has(sessionId)) return
    void this.refresh(sessionId)
    this.polls.set(sessionId, setInterval(() => { void this.refresh(sessionId) }, this.pollMs))
  }

  unwatch(sessionId: SessionId): void {
    const timer = this.polls.get(sessionId)
    if (timer === undefined) return
    clearInterval(timer)
    this.polls.delete(sessionId)
  }

  setSettingsOpen(sessionId: SessionId, open: boolean): void {
    if (this.disposed) return
    const prev = this.store.getSnapshot().bySession[String(sessionId)] ?? EMPTY
    this.publish(sessionId, { ...prev, settingsOpen: open })
  }

  async refresh(sessionId: SessionId): Promise<void> {
    if (this.disposed) return
    const prev = this.store.getSnapshot().bySession[String(sessionId)] ?? EMPTY
    try {
      const url = new URL('/api/agent-kernel.status', hostBase())
      url.searchParams.set('sessionId', sessionId)
      const response = await this.fetcher(url, { method: 'GET' })
      if (!response.ok) {
        const detail = await response.text().catch(() => '')
        throw new Error(`Status failed: HTTP ${String(response.status)}${detail === '' ? '' : ` ${detail}`}`)
      }
      const body = await response.json() as Partial<AgentKernelHeaderEntry>
      if (this.disposed) return
      this.publish(sessionId, parseEntry(body, prev.settingsOpen))
    } catch (error) {
      if (this.disposed) return
      this.publish(sessionId, { ...prev, error: messageOf(error), busy: false })
    }
  }

  async setEnabled(sessionId: SessionId, enabled: boolean): Promise<void> {
    await this.patch(sessionId, { enabled })
  }

  async saveSettings(
    sessionId: SessionId,
    settings: {
      readonly prompt?: string
      readonly activeHours?: number
      readonly kernelUrl?: string
      readonly kernelToken?: string
    },
  ): Promise<void> {
    await this.patch(sessionId, settings)
  }

  async claimPair(sessionId: SessionId, code: string, kernelUrl: string): Promise<void> {
    if (this.disposed) return
    const prev = this.store.getSnapshot().bySession[String(sessionId)] ?? EMPTY
    this.publish(sessionId, { ...prev, busy: true, error: null })
    try {
      const response = await this.fetcher(new URL('/api/agent-kernel.pair', hostBase()), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code, kernelUrl }),
      })
      if (!response.ok) {
        const detail = await response.text().catch(() => '')
        throw new Error(`Pair failed: HTTP ${String(response.status)}${detail === '' ? '' : ` ${detail}`}`)
      }
      if (this.disposed) return
      await this.refresh(sessionId)
    } catch (error) {
      if (this.disposed) return
      const current = this.store.getSnapshot().bySession[String(sessionId)] ?? prev
      this.publish(sessionId, { ...current, busy: false, error: messageOf(error) })
    }
  }

  async dispose(): Promise<void> {
    this.disposed = true
    for (const sessionId of [...this.polls.keys()]) this.unwatch(sessionId)
  }

  private async patch(
    sessionId: SessionId,
    patch: {
      readonly enabled?: boolean
      readonly prompt?: string
      readonly activeHours?: number
      readonly kernelUrl?: string
      readonly kernelToken?: string
    },
  ): Promise<void> {
    if (this.disposed) return
    const prev = this.store.getSnapshot().bySession[String(sessionId)] ?? EMPTY
    this.publish(sessionId, { ...prev, busy: true, error: null })
    try {
      const response = await this.fetcher(new URL('/api/agent-kernel.followup', hostBase()), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId, ...patch }),
      })
      if (!response.ok) {
        const detail = await response.text().catch(() => '')
        throw new Error(`Save failed: HTTP ${String(response.status)}${detail === '' ? '' : ` ${detail}`}`)
      }
      const body = await response.json() as Partial<AgentKernelHeaderEntry>
      if (this.disposed) return
      this.publish(sessionId, parseEntry(body, prev.settingsOpen))
    } catch (error) {
      if (this.disposed) return
      const current = this.store.getSnapshot().bySession[String(sessionId)] ?? prev
      this.publish(sessionId, { ...current, busy: false, error: messageOf(error) })
    }
  }

  private publish(sessionId: SessionId, entry: AgentKernelHeaderEntry): void {
    this.store.update((state) => {
      state.bySession = { ...state.bySession, [String(sessionId)]: entry }
    })
  }
}
