import { readFile } from 'node:fs/promises';
import yaml from 'js-yaml';
import { ConfigSchema, type BrickConfig } from './schema.js';
import { paths } from './paths.js';

export async function loadConfig(path: string = paths.config): Promise<BrickConfig> {
  const raw = await readFile(path, 'utf8');
  const parsed = yaml.load(raw);
  return ConfigSchema.parse(parsed);
}

export async function loadConfigRaw(path: string = paths.config): Promise<unknown> {
  const raw = await readFile(path, 'utf8');
  return yaml.load(raw);
}
