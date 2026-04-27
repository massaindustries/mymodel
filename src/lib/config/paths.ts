import { homedir } from 'node:os';
import { join } from 'node:path';

const ROOT = process.env.MYMODEL_HOME ?? join(homedir(), '.mymodel');

export const paths = {
  root: ROOT,
  config: join(ROOT, 'config.yaml'),
  compose: join(ROOT, 'docker-compose.yml'),
  env: join(ROOT, '.env'),
  models: join(ROOT, 'models'),
};
