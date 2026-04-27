import { Command } from '@oclif/core';
import { dockerCompose } from '../lib/docker/run.js';
import { loadConfig } from '../lib/config/load.js';
import { info, ok, warn, err } from '../lib/ui/banners.js';

export default class Status extends Command {
  static description = 'Show container + health status';
  async run(): Promise<void> {
    const ps = await dockerCompose(['ps']);
    info('container state:');
    console.log(ps.stdout || '(no compose project up)');
    try {
      const cfg = await loadConfig();
      const r = await fetch(`http://localhost:${cfg.server_port}/health`, { signal: AbortSignal.timeout(3000) });
      if (r.ok) ok(`/health → ${r.status}`);
      else warn(`/health → ${r.status}`);
    } catch (e: any) { err(`health probe failed: ${e?.message ?? e}`); }
  }
}
