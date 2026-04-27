import { execa } from 'execa';
import { paths } from '../config/paths.js';

export async function dockerCompose(args: string[]): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const r = await execa('docker', ['compose', '-f', paths.compose, ...args], { reject: false });
  return { stdout: r.stdout, stderr: r.stderr, exitCode: r.exitCode ?? 1 };
}

export async function dockerCmd(args: string[]): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const r = await execa('docker', args, { reject: false });
  return { stdout: r.stdout, stderr: r.stderr, exitCode: r.exitCode ?? 1 };
}

export async function dockerInstalled(): Promise<boolean> {
  try {
    const r = await execa('docker', ['--version'], { reject: false });
    return r.exitCode === 0;
  } catch {
    return false;
  }
}
