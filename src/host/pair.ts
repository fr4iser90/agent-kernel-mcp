/**
 * Universal pair: claim code → write connect.json (same file MCP + WSS use).
 * Works for DSH, Claude Code, Aider, OpenCode — no Header required.
 */
import { writeAgentKernelConnect, resolveAgentKernelConnectPath } from './connect.ts'

export async function claimPairAndSave(opts: {
  kernelUrl: string
  code: string
}): Promise<{ url: string; token: string; expiresAt: string; connectPath: string }> {
  const base = opts.kernelUrl.trim().replace(/\/$/, '')
  if (!base) throw new Error('kernel URL required')
  try {
    // eslint-disable-next-line no-new
    new URL(base)
  } catch {
    throw new Error('kernel URL must be absolute http(s)')
  }
  const code = opts.code.trim().toUpperCase().replace(/\s+/g, '')
  if (!/^[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/.test(code)) {
    throw new Error('invalid pairing code (expected XXXX-XXXX-XXXX)')
  }

  const res = await fetch(`${base}/api/pair/claim`, {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({ code }),
  })
  const json = (await res.json().catch(() => ({}))) as {
    error?: string
    url?: string
    token?: string
    expiresAt?: string
  }
  if (!res.ok) {
    throw new Error(typeof json.error === 'string' ? json.error : `pair claim HTTP ${res.status}`)
  }
  if (typeof json.url !== 'string' || typeof json.token !== 'string') {
    throw new Error('pair claim response missing url/token')
  }

  const nowIso = new Date().toISOString()
  await writeAgentKernelConnect({ url: json.url, token: json.token }, nowIso)
  return {
    url: json.url,
    token: json.token,
    expiresAt: typeof json.expiresAt === 'string' ? json.expiresAt : '',
    connectPath: resolveAgentKernelConnectPath(),
  }
}
