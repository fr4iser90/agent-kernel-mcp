/**
 * Durable session records for CLI executors (claude-code / aider / opencode).
 * DSH sessions stay in the Host; these only exist for non-DSH job routing.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

export type CliExecutorId = 'claude-code' | 'aider' | 'opencode'

export type CliSessionMessage = {
  readonly role: 'user' | 'assistant'
  readonly text: string
  readonly at: string
}

export type CliSession = {
  readonly id: string
  readonly executorId: CliExecutorId
  readonly cwd: string
  readonly createdAt: string
  updatedAt: string
  /** Vendor session id when the CLI supports resume (claude / opencode). */
  externalSessionId: string | null
  messages: CliSessionMessage[]
}

function homeRoot(): string {
  const dsh = process.env.DSH_HOME?.trim()
  if (dsh) return path.join(dsh, 'agent-kernel', 'cli-sessions')
  const ak = process.env.AGENT_KERNEL_HOME?.trim()
  if (ak) return path.join(ak, 'cli-sessions')
  return path.join(os.homedir(), '.agent-kernel', 'cli-sessions')
}

function sessionPath(id: string): string {
  if (!/^[A-Za-z0-9._-]{1,200}$/u.test(id)) {
    throw new Error('cli session id is not a safe filename')
  }
  return path.join(homeRoot(), `${id}.json`)
}

export async function writeCliSession(session: CliSession): Promise<void> {
  const root = homeRoot()
  await mkdir(root, { recursive: true })
  await writeFile(sessionPath(session.id), `${JSON.stringify(session, null, 2)}\n`, 'utf8')
}

export async function readCliSession(id: string): Promise<CliSession> {
  const raw = await readFile(sessionPath(id), 'utf8')
  const parsed: unknown = JSON.parse(raw)
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`corrupt cli session: ${id}`)
  }
  const rec = parsed as Record<string, unknown>
  const executorId = rec.executorId
  if (executorId !== 'claude-code' && executorId !== 'aider' && executorId !== 'opencode') {
    throw new Error(`cli session ${id} has unsupported executorId`)
  }
  return {
    id: String(rec.id ?? id),
    executorId,
    cwd: String(rec.cwd ?? ''),
    createdAt: String(rec.createdAt ?? ''),
    updatedAt: String(rec.updatedAt ?? ''),
    externalSessionId: typeof rec.externalSessionId === 'string' ? rec.externalSessionId : null,
    messages: Array.isArray(rec.messages)
      ? (rec.messages as CliSessionMessage[])
      : [],
  }
}

export function appendCliMessage(
  session: CliSession,
  role: 'user' | 'assistant',
  text: string,
): CliSession {
  const at = new Date().toISOString()
  return {
    ...session,
    updatedAt: at,
    messages: [...session.messages, { role, text, at }],
  }
}
