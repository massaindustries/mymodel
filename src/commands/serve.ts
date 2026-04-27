import { Command, Flags } from '@oclif/core';
import { stat } from 'node:fs/promises';
import { dockerCompose } from '../lib/docker/run.js';
import { defaultImage, imageExists, pullImage } from '../lib/docker/image.js';
import { paths } from '../lib/config/paths.js';
import { banner, err, info, ok, warn } from '../lib/ui/banners.js';
import { loadConfig } from '../lib/config/load.js';

async function waitHealth(port: number, timeoutMs = 90000): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const r = await fetch(`http://localhost:${port}/health`, { signal: AbortSignal.timeout(2000) });
      if (r.ok) return true;
    } catch {}
    await new Promise((r) => setTimeout(r, 1500));
  }
  return false;
}

export default class Serve extends Command {
  static description = 'Start the router container via docker compose';
  static flags = {
    pull: Flags.boolean({ description: 'force docker pull before start' }),
    detach: Flags.boolean({ char: 'd', default: true, description: 'detached mode (default)' }),
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(Serve);
    banner();
    try { await stat(paths.config); } catch { err(`no config at ${paths.config}. run \`mymodel init\` first.`); this.exit(1); }
    try { await stat(paths.compose); } catch { err(`no compose at ${paths.compose}. run \`mymodel init\` first.`); this.exit(1); }
    const cfg = await loadConfig();

    const img = defaultImage();
    if (flags.pull || !(await imageExists(img))) {
      info(`pulling ${img} ...`);
      const r = await pullImage(img);
      if (!r.ok) {
        warn(`pull failed (${r.stderr.split('\n')[0]}). falling back to existing local image if any.`);
        if (!(await imageExists(img))) { err(`image ${img} not found locally and pull failed.`); this.exit(1); }
      } else ok('pulled');
    } else {
      ok(`image ${img} already present`);
    }

    info('docker compose up -d');
    const r = await dockerCompose(['up', '-d']);
    if (r.exitCode !== 0) { err(r.stderr.slice(0, 800)); this.exit(1); }

    info(`waiting for health on http://localhost:${cfg.server_port}/health ...`);
    const okHealth = await waitHealth(cfg.server_port);
    if (!okHealth) { warn('health check did not become OK in 90s — container may still be starting; check `mymodel logs`'); }
    else ok(`router ready at http://localhost:${cfg.server_port}/v1/chat/completions (model: brick)`);
  }
}
