import { Command } from '@oclif/core';
import { dockerCompose } from '../lib/docker/run.js';
import { err, ok } from '../lib/ui/banners.js';

export default class Stop extends Command {
  static description = 'Stop the router container';
  async run(): Promise<void> {
    const r = await dockerCompose(['down']);
    if (r.exitCode !== 0) { err(r.stderr.slice(0, 500)); this.exit(1); } else ok('stopped');
  }
}
