/**
 * Ensure `$DSH_HOME/.agent-presets/agent-kernel` exists (copy from package
 * `presets/agent-kernel`). Fail loud when the template is missing or the
 * write fails — never silently skip.
 */
import { cpSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dshHomePath } from '@deepseek-ai/dsh-home-paths';
const COMPOSITION = 'agent.cordis.yml';
export function ensureAgentKernelPreset() {
    const destDir = dshHomePath('.agent-presets', 'agent-kernel');
    const destFile = join(destDir, COMPOSITION);
    if (existsSync(destFile))
        return;
    const here = dirname(fileURLToPath(import.meta.url));
    // lib/index.js → ../presets/agent-kernel ; src/host → ../../presets/agent-kernel
    const candidates = [
        join(here, '..', 'presets', 'agent-kernel'),
        join(here, '..', '..', 'presets', 'agent-kernel'),
    ];
    const src = candidates.find(dir => existsSync(join(dir, COMPOSITION)));
    if (src === undefined) {
        throw new Error(`agent-kernel-mcp: preset template missing (looked in ${candidates.join(', ')}); `
            + 'rebuild the package or copy presets/agent-kernel manually to '
            + destDir);
    }
    mkdirSync(dirname(destDir), { recursive: true });
    cpSync(src, destDir, { recursive: true });
    if (!existsSync(destFile)) {
        throw new Error(`agent-kernel-mcp: failed to install preset at ${destFile}`);
    }
}
//# sourceMappingURL=ensure-preset.js.map