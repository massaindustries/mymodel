import { Command, Flags } from '@oclif/core';
import { execa } from 'execa';
import { paths } from '../lib/config/paths.js';

export default class Logs extends Command {
  static description = 'Stream container logs';
  static flags = {
    tail: Flags.integer({ default: 100, description: 'number of lines to tail' }),
    follow: Flags.boolean({ char: 'f', default: false, description: 'follow logs' }),
  };
  async run(): Promise<void> {
    const { flags } = await this.parse(Logs);
    const args = ['compose', '-f', paths.compose, 'logs', '--tail', String(flags.tail)];
    if (flags.follow) args.push('-f');
    await execa('docker', args, { stdio: 'inherit', reject: false });
  }
}
