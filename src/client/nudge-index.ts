/** Browser poll of Host Session ids with idle nudge armed. */

import { createSnapshotStore, type SnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'

/** Snapshot: Session id → armed. */
export interface NudgeIndexState {
  enabled: Record<string, true | undefined>
  error: string | null
}

type Fetch = (input: string | URL, init?: RequestInit) => Promise<Response>

const INITIAL: NudgeIndexState = { enabled: {}, error: null }

function hostBase(): string {
  const origin = (globalThis as { location?: { origin?: string } }).location?.origin
  /* v8 ignore next -- jsdom provides a non-null origin; null appears only under file:// carriers */
  return origin !== undefined && origin !== 'null' ? origin : 'http://dsh.internal'
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * Poll `/api/agent-kernel.nudge-index` for Workspaces sidebar marks.
 */
export class NudgeIndexController {
  /** uSES-safe enabled-id map. */
  readonly store: SnapshotStore<NudgeIndexState> = createSnapshotStore(INITIAL)

  private timer: ReturnType<typeof setInterval> | undefined
  private disposed = false

  /**
   * @param fetcher - HTTP carrier.
   * @param pollMs - refresh interval while the sidebar is mounted.
   */
  constructor(
    private readonly fetcher: Fetch = (input, init) => fetch(input, init),
    private readonly pollMs = 15_000,
  ) {}

  /** Start polling (idempotent) and fetch immediately. */
  start(): void {
    /* v8 ignore next -- dispose races */
    if (this.disposed) return
    if (this.timer !== undefined) return
    void this.refresh()
    this.timer = setInterval(() => { void this.refresh() }, this.pollMs)
  }

  /** Stop polling. */
  stop(): void {
    if (this.timer === undefined) return
    clearInterval(this.timer)
    this.timer = undefined
  }

  /**
   * Optimistically mirror a Header toggle so the sidebar mark updates immediately.
   * @param sessionId - Session id.
   * @param enabled - next armed value.
   */
  setLocal(sessionId: string, enabled: boolean): void {
    /* v8 ignore next -- dispose races */
    if (this.disposed) return
    this.store.update((state) => {
      const next: Record<string, true | undefined> = {}
      for (const [id, on] of Object.entries(state.enabled)) {
        if (id === sessionId || on !== true) continue
        next[id] = true
      }
      if (enabled) next[sessionId] = true
      state.enabled = next
      state.error = null
    })
  }

  /** Fetch Host index. */
  async refresh(): Promise<void> {
    /* v8 ignore next -- dispose races */
    if (this.disposed) return
    try {
      const response = await this.fetcher(new URL('/api/agent-kernel.nudge-index', hostBase()), { method: 'GET' })
      if (!response.ok) {
        /* v8 ignore next -- text() rarely rejects */
        const detail = await response.text().catch(() => '')
        throw new Error(`Nudge index failed: HTTP ${String(response.status)}${detail === '' ? '' : ` ${detail}`}`)
      }
      const body = await response.json() as { enabled?: unknown }
      const list = Array.isArray(body.enabled) ? body.enabled : []
      const enabled: Record<string, true | undefined> = {}
      for (const id of list) {
        if (typeof id === 'string' && id.length > 0) enabled[id] = true
      }
      /* v8 ignore next -- dispose during fetch */
      if (this.disposed) return
      this.store.update((state) => {
        state.enabled = enabled
        state.error = null
      })
    } catch (error) {
      /* v8 ignore next -- dispose during fetch */
      if (this.disposed) return
      this.store.update((state) => {
        state.error = messageOf(error)
      })
    }
  }

  /** Abort polls. */
  dispose(): void {
    this.disposed = true
    this.stop()
  }
}
