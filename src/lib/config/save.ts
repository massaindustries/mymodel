import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import yaml from 'js-yaml';
import { paths } from './paths.js';
import type { BrickConfig } from './schema.js';

export async function saveConfig(cfg: BrickConfig, path: string = paths.config): Promise<void> {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const dump = yaml.dump(cfg, { lineWidth: 120, noRefs: true, sortKeys: false });
  await writeFile(path, dump, { mode: 0o600 });
}

export async function saveText(content: string, path: string, mode = 0o644): Promise<void> {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  await writeFile(path, content, { mode });
}
