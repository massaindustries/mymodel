import { Command, Flags } from '@oclif/core';
import { runWizard } from '../lib/wizard/run.js';
import { dockerInstalled } from '../lib/docker/run.js';
import { banner, err, ok, warn } from '../lib/ui/banners.js';
import { paths } from '../lib/config/paths.js';
import { stat } from 'node:fs/promises';

export default class Init extends Command {
  static description = 'Run guided wizard and write ~/.mymodel/{config.yaml,docker-compose.yml,.env}';
  static flags = {
    force: Flags.boolean({ char: 'f', description: 'overwrite existing config without confirmation' }),
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(Init);
    banner();
    if (!(await dockerInstalled())) {
      err('docker not found in PATH. install Docker first.');
      this.exit(1);
    } else {
      ok('docker available');
    }
    try {
      const s = await stat(paths.config);
      if (s.isFile() && !flags.force) {
        warn(`existing config at ${paths.config}. running wizard will overwrite on confirm.`);
      }
    } catch {}
    await runWizard();
  }
}
