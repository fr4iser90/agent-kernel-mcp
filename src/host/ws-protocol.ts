/**
 * Wire protocol copy for DSH ↔ kernel control channel (WSS).
 * Keep in sync with agent-kernel `domain/executor/ws-protocol.ts`.
 */

export type ServerToDeviceMessage =
  | {
      type: 'hello'
      ownerId: string
      serverTime: string
    }
  | {
      type: 'job.created'
      jobId: string
      runId: string
      kind: 'start' | 'session_continue' | 'fetch_transcript' | 'operator_turn' | 'list_workdir_candidates'
      payload: Record<string, unknown>
      createdAt: string
    }
  | {
      type: 'error'
      message: string
    }

export type DeviceToServerMessage =
  | {
      type: 'hello'
      deviceLabel?: string
    }
  | {
      type: 'heartbeat'
      deviceLabel?: string
    }
  | {
      type: 'job.started'
      jobId: string
    }
  | {
      type: 'job.completed'
      jobId: string
      ok: boolean
      result?: Record<string, unknown>
      error?: string
    }

/** Derive `wss://…/api/executor/ws?token=` from HTTPS kernel URL + pair token. */
export function executorWsUrl(kernelBaseUrl: string, token: string): string {
  const base = kernelBaseUrl.trim()
  if (!base) throw new Error('AGENT_KERNEL_URL / connect.json url is required for WSS')
  if (!token.trim()) throw new Error('AGENT_KERNEL_TOKEN / connect.json token is required for WSS')
  const u = new URL(base)
  if (u.protocol === 'https:') u.protocol = 'wss:'
  else if (u.protocol === 'http:') u.protocol = 'ws:'
  else throw new Error(`unsupported kernel URL protocol: ${u.protocol}`)
  u.pathname = '/api/executor/ws'
  u.search = ''
  u.hash = ''
  u.searchParams.set('token', token.trim())
  return u.toString()
}
