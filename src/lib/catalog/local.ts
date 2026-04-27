import type { CatalogProvider } from './index.js';

export const localCatalog: CatalogProvider = {
  id: 'local',
  label: 'Local (vLLM / Ollama / custom)',
  type: 'openai-compatible',
  base_url: 'http://host.docker.internal:11434/v1',
  env_key: 'LOCAL_API_KEY',
  models: [],
  multimodal: {},
};
