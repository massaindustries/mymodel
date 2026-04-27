import Handlebars from 'handlebars';
import { readFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { saveText } from '../config/save.js';
import { paths } from '../config/paths.js';
import { defaultImage } from './image.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const TEMPLATE_DIR = join(__dirname, '..', '..', '..', 'templates');

export async function writeCompose(opts: { port: number; image?: string; projectName?: string }): Promise<void> {
  const tplPath = join(TEMPLATE_DIR, 'docker-compose.yaml.hbs');
  const tpl = await readFile(tplPath, 'utf8');
  const compiled = Handlebars.compile(tpl)({
    port: opts.port,
    image: opts.image ?? defaultImage(),
    projectName: opts.projectName ?? 'mymodel',
    configPath: paths.config,
    envPath: paths.env,
    modelsPath: paths.models,
  });
  await saveText(compiled, paths.compose);
}
