/**
 * Universal device CLI for agent-kernel.
 *
 *   agent-kernel-runner pair --url https://kernel.example --code ABCD-EFGH-IJKL
 *   agent-kernel-runner          # keep WSS up (jobs → DSH / claude / aider / opencode)
 *
 * Pair once; MCP tools + WSS both read the same connect.json.
 */
import { claimPairAndSave } from '../host/pair.ts'
import { startExecutorWsClient } from '../host/ws-client.ts'

function usage(): never {
  console.error(`Usage:
  agent-kernel-runner pair --url <https://kernel> --code <XXXX-XXXX-XXXX>
  agent-kernel-runner [--device-label <name>]

After pair, keep this process running so the kernel can push coding jobs.
MCP (Claude / Aider / OpenCode / DSH) uses the same connect.json for tools.`)
  process.exit(2)
}

function argValue(argv: string[], name: string): string | null {
  const i = argv.indexOf(name)
  if (i < 0) return null
  const v = argv[i + 1]
  if (!v || v.startsWith('-')) return null
  return v
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2)
  if (argv[0] === 'pair' || argv[0] === 'claim') {
    const url = argValue(argv, '--url') || process.env.AGENT_KERNEL_URL?.trim() || ''
    const code = argValue(argv, '--code') || argv.find((a, i) => i > 0 && !a.startsWith('-') && a.includes('-')) || ''
    if (!url || !code) usage()
    const result = await claimPairAndSave({ kernelUrl: url, code })
    console.log(
      JSON.stringify(
        {
          ok: true,
          url: result.url,
          connectPath: result.connectPath,
          expiresAt: result.expiresAt,
          tokenPrefix: `${result.token.slice(0, 8)}…`,
        },
        null,
        2,
      ),
    )
    console.error('Paired. Start WSS with: agent-kernel-runner')
    return
  }

  if (argv.includes('-h') || argv.includes('--help')) usage()

  const deviceLabel =
    argValue(argv, '--device-label') ||
    process.env.AGENT_KERNEL_DEVICE_LABEL?.trim() ||
    'cli-runner'

  const stop = startExecutorWsClient({ deviceLabel })
  console.error(`agent-kernel-runner: WSS up as ${deviceLabel} (Ctrl+C to stop)`)

  const shutdown = () => {
    stop()
    process.exit(0)
  }
  process.on('SIGINT', shutdown)
  process.on('SIGTERM', shutdown)
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err))
  process.exit(1)
})
