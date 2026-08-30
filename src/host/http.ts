/**
 * Host HTTP for Agent Kernel Session Header (connect + idle nudge).
 */
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { SessionStore } from '@deepseek-ai/dsh-session'
import { SessionId } from '@deepseek-ai/dsh-session'
import { isTrustedApiRequest } from './api-request-trust.ts'
import {
  emptyNudgeState,
  expireNudgeIfNeeded,
  listEnabledNudgeSessionIds,
  patchSessionNudge,
  readSessionNudge,
  writeSessionNudge,
  type SessionNudgeState,
} from './nudge.ts'
import { readAgentKernelConnect, writeAgentKernelConnect } from './connect.ts'

export interface AgentKernelStatusPayload {
  readonly watchdogEnabled: boolean
  readonly nudgePrompt: string
  readonly nudgeActiveHours: number
  readonly nudgeArmedAt: string
  readonly nudgeLastPolledAt: string
  readonly nudgeLastWakeAt: string
  readonly watchdogIntervalMinutes: number
  readonly pluginEnabled: boolean
  readonly kernelUrl: string
  readonly kernelToken: string
  readonly kernelConnected: boolean
}

export interface AgentKernelHttpLimits {
  readonly trustedHosts: readonly string[]
  readonly pluginEnabled: boolean
  readonly nudgeRoot: string
  readonly watchdogIntervalMinutes: number
}

async function readJsonBody(req: IncomingMessage, maxBytes: number): Promise<unknown> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of req) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    size += buf.byteLength
    if (size > maxBytes) throw new Error(`request body exceeds ${String(maxBytes)} bytes`)
    chunks.push(buf)
  }
  const raw = Buffer.concat(chunks).toString('utf8')
  if (raw.trim().length === 0) return {}
  return JSON.parse(raw) as unknown
}

function resolveSession(
  sessions: SessionStore,
  sessionIdRaw: string | null,
): { ok: true; sessionId: string } | { ok: false; status: number; message: string } {
  if (sessionIdRaw === null || sessionIdRaw === '') {
    return { ok: false, status: 400, message: 'missing sessionId' }
  }
  if (sessions.get(SessionId(sessionIdRaw)) === undefined) {
    return { ok: false, status: 404, message: 'session not found' }
  }
  return { ok: true, sessionId: sessionIdRaw }
}

function writeJson(res: ServerResponse, status: number, body: unknown): void {
  const text = `${JSON.stringify(body)}\n`
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Content-Length': Buffer.byteLength(text),
  }).end(text)
}

function statusPayload(
  limits: AgentKernelHttpLimits,
  nudge: SessionNudgeState,
  connect: { url: string; token: string },
): AgentKernelStatusPayload {
  return {
    watchdogEnabled: nudge.enabled,
    nudgePrompt: nudge.prompt,
    nudgeActiveHours: nudge.activeHours,
    nudgeArmedAt: nudge.armedAt,
    nudgeLastPolledAt: nudge.lastPolledAt,
    nudgeLastWakeAt: nudge.lastWakeAt,
    watchdogIntervalMinutes: limits.watchdogIntervalMinutes,
    pluginEnabled: limits.pluginEnabled,
    kernelUrl: connect.url,
    kernelToken: connect.token,
    kernelConnected: connect.token.length > 0 && connect.url.length > 0,
  }
}

async function loadLiveNudge(nudgeRoot: string, sessionId: string): Promise<SessionNudgeState> {
  let nudge: SessionNudgeState
  try {
    nudge = await readSessionNudge(nudgeRoot, sessionId)
  } catch {
    return emptyNudgeState()
  }
  const nowMs = Date.now()
  const { state, expired } = expireNudgeIfNeeded(nudge, nowMs, new Date(nowMs).toISOString())
  if (expired) {
    try {
      await writeSessionNudge(nudgeRoot, sessionId, state)
    } catch {
      // ignore
    }
  }
  return state
}

export async function handleAgentKernelStatus(
  req: IncomingMessage,
  res: ServerResponse,
  sessions: SessionStore,
  limits: AgentKernelHttpLimits,
): Promise<void> {
  if (!isTrustedApiRequest(req, limits.trustedHosts)) {
    res.writeHead(403).end('forbidden')
    return
  }
  if (req.method !== 'GET') {
    res.writeHead(405, { Allow: 'GET' }).end('method not allowed')
    return
  }
  const url = new URL(req.url ?? '/', 'http://dsh.internal')
  const resolved = resolveSession(sessions, url.searchParams.get('sessionId'))
  if (!resolved.ok) {
    res.writeHead(resolved.status).end(resolved.message)
    return
  }
  const nudge = await loadLiveNudge(limits.nudgeRoot, resolved.sessionId)
  const connect = await readAgentKernelConnect()
  writeJson(res, 200, statusPayload(limits, nudge, connect))
}

export async function handleAgentKernelNudge(
  req: IncomingMessage,
  res: ServerResponse,
  sessions: SessionStore,
  limits: AgentKernelHttpLimits,
): Promise<void> {
  if (!isTrustedApiRequest(req, limits.trustedHosts)) {
    res.writeHead(403).end('forbidden')
    return
  }
  if (req.method !== 'POST') {
    res.writeHead(405, { Allow: 'POST' }).end('method not allowed')
    return
  }
  let body: unknown
  try {
    body = await readJsonBody(req, 64 * 1024)
  } catch (error: unknown) {
    res.writeHead(400).end(error instanceof Error ? error.message : String(error))
    return
  }
  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    res.writeHead(400).end('body must be a JSON object')
    return
  }
  const record = body as Record<string, unknown>
  const sessionIdRaw = typeof record['sessionId'] === 'string' ? record['sessionId'] : null
  const hasEnabled = typeof record['enabled'] === 'boolean'
  const hasPrompt = typeof record['prompt'] === 'string'
  const hasHours = typeof record['activeHours'] === 'number'
  const hasKernelUrl = typeof record['kernelUrl'] === 'string'
  const hasKernelToken = typeof record['kernelToken'] === 'string'
  if (!hasEnabled && !hasPrompt && !hasHours && !hasKernelUrl && !hasKernelToken) {
    res.writeHead(400).end('enabled, prompt, activeHours, kernelUrl, and/or kernelToken required')
    return
  }
  const resolved = resolveSession(sessions, sessionIdRaw)
  if (!resolved.ok) {
    res.writeHead(resolved.status).end(resolved.message)
    return
  }
  const nowIso = new Date().toISOString()
  let connect = await readAgentKernelConnect()
  if (hasKernelUrl || hasKernelToken) {
    try {
      connect = await writeAgentKernelConnect({
        ...hasKernelUrl ? { url: record['kernelUrl'] as string } : {},
        ...hasKernelToken ? { token: record['kernelToken'] as string } : {},
      }, nowIso)
    } catch (error: unknown) {
      res.writeHead(400).end(error instanceof Error ? error.message : String(error))
      return
    }
  }
  let next: SessionNudgeState
  try {
    const previous = await readSessionNudge(limits.nudgeRoot, resolved.sessionId)
    if (hasEnabled || hasPrompt || hasHours) {
      const patch: { enabled?: boolean; prompt?: string; activeHours?: number } = {}
      if (hasEnabled) patch.enabled = record['enabled'] as boolean
      if (hasPrompt) patch.prompt = record['prompt'] as string
      if (hasHours) patch.activeHours = record['activeHours'] as number
      next = patchSessionNudge(previous, patch, nowIso)
      await writeSessionNudge(limits.nudgeRoot, resolved.sessionId, next)
    } else {
      next = previous
    }
  } catch (error: unknown) {
    res.writeHead(400).end(error instanceof Error ? error.message : String(error))
    return
  }
  writeJson(res, 200, statusPayload(limits, next, connect))
}

export async function handleAgentKernelNudgeIndex(
  req: IncomingMessage,
  res: ServerResponse,
  limits: AgentKernelHttpLimits,
): Promise<void> {
  if (!isTrustedApiRequest(req, limits.trustedHosts)) {
    res.writeHead(403).end('forbidden')
    return
  }
  if (req.method !== 'GET') {
    res.writeHead(405, { Allow: 'GET' }).end('method not allowed')
    return
  }
  try {
    writeJson(res, 200, { enabled: await listEnabledNudgeSessionIds(limits.nudgeRoot) })
  } catch (error: unknown) {
    res.writeHead(500).end(error instanceof Error ? error.message : String(error))
  }
}
