import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const harnessRoot = process.env.DSH_HARNESS_ROOT ?? join(here, '../deepseek-harness')
const require = createRequire(join(harnessRoot, 'package.json'))
const { clientBundle } = require(join(harnessRoot, 'packages/client/tsdown.client.ts'))

export default clientBundle('agent-kernel-mcp', ['lib/types/index.js'])
