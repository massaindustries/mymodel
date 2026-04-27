import * as p from '@clack/prompts';
import { writeFile, mkdir, readFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';
import { paths } from '../config/paths.js';
import { saveConfig, saveText } from '../config/save.js';
import { ConfigSchema, type BrickConfig } from '../config/schema.js';
import { catalog, reasoningFamiliesDefault } from '../catalog/index.js';
import { writeCompose } from '../docker/compose.js';
import { defaultDecisions } from './defaults.js';
import { runDecisionBuilder } from './steps/decisions.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const TEMPLATE_DIR = join(__dirname, '..', '..', '..', 'templates');

export async function runWizard(): Promise<BrickConfig> {
  p.intro('mymodel — guided init');

  const enabledProvidersRaw = await p.multiselect({
    message: 'Which providers do you want to enable?',
    options: [
      { value: 'regolo', label: 'Regolo AI (default)', hint: 'api.regolo.ai' },
      { value: 'openai', label: 'OpenAI', hint: 'api.openai.com' },
      { value: 'local', label: 'Local (vLLM / Ollama)', hint: 'custom endpoint' },
    ],
    initialValues: ['regolo'],
    required: true,
  });
  if (p.isCancel(enabledProvidersRaw)) { p.cancel('aborted'); process.exit(0); }
  const enabledProviders = enabledProvidersRaw as string[];

  const apiKeys: Record<string, string> = {};
  const providers: Record<string, any> = {};
  const providerProfiles: Record<string, any> = {};
  const vllmEndpoints: any[] = [];

  for (const pid of enabledProviders) {
    const cat = catalog[pid];
    let baseUrl = cat.base_url;
    if (pid === 'local') {
      const u = await p.text({ message: 'Local endpoint base_url:', placeholder: cat.base_url, defaultValue: cat.base_url });
      if (p.isCancel(u)) { p.cancel('aborted'); process.exit(0); }
      baseUrl = String(u || cat.base_url);
    }
    const existing = await readEnvKey(cat.env_key);
    let key: string;
    if (existing) {
      key = existing;
    } else {
      const k = await p.password({ message: `${cat.label} API key (will be saved to ~/.mymodel/.env, not in YAML):` });
      if (p.isCancel(k)) { p.cancel('aborted'); process.exit(0); }
      key = String(k);
    }
    apiKeys[cat.env_key] = key;
    providers[pid] = { type: 'openai-compatible', base_url: baseUrl };
    providerProfiles[pid] = { type: 'openai', base_url: baseUrl };
    vllmEndpoints.push({ name: pid, provider_profile: pid, weight: 1 });
  }

  // model selection per enabled provider
  const modelConfig: Record<string, any> = {};
  let selectedModelIds: string[] = [];
  for (const pid of enabledProviders) {
    const cat = catalog[pid];
    if (cat.models.length === 0) {
      const ids = await p.text({ message: `Comma-separated model IDs for ${cat.label}:`, placeholder: 'mistral,llama3' });
      if (p.isCancel(ids)) { p.cancel('aborted'); process.exit(0); }
      const list = String(ids).split(',').map((s) => s.trim()).filter(Boolean);
      for (const id of list) modelConfig[id] = { preferred_endpoints: [pid], param_size: 'unknown' };
      selectedModelIds.push(...list);
    } else {
      const sel = await p.multiselect({
        message: `Select models for ${cat.label}:`,
        options: cat.models.map((m) => ({ value: m.id, label: `${m.label} (${m.param_size})`, hint: m.reasoning_family })),
        required: true,
      });
      if (p.isCancel(sel)) { p.cancel('aborted'); process.exit(0); }
      for (const id of sel as string[]) {
        const m = cat.models.find((x) => x.id === id)!;
        modelConfig[id] = {
          preferred_endpoints: [pid],
          param_size: m.param_size,
          ...(m.reasoning_family ? { reasoning_family: m.reasoning_family } : {}),
        };
        selectedModelIds.push(id);
      }
    }
  }

  const defaultModelChoice = await p.select({
    message: 'Default model (used when no decision matches):',
    options: selectedModelIds.map((id) => ({ value: id, label: id })),
  });
  if (p.isCancel(defaultModelChoice)) { p.cancel('aborted'); process.exit(0); }
  const defaultModel = String(defaultModelChoice);

  // classifier
  const useClassifier = await p.confirm({ message: 'Enable ModernBERT domain classifier (recommended)?', initialValue: true });
  if (p.isCancel(useClassifier)) { p.cancel('aborted'); process.exit(0); }
  const classifier = useClassifier
    ? {
        category_model: {
          model_id: 'models/mom-domain-classifier',
          use_modernbert: true,
          threshold: 0.45,
          use_cpu: true,
          category_mapping_path: 'models/mom-domain-classifier/category_mapping.json',
        },
      }
    : undefined;

  // complexity service
  const useComplexity = await p.confirm({ message: 'Enable external complexity service (Qwen NVIDIA)?', initialValue: true });
  if (p.isCancel(useComplexity)) { p.cancel('aborted'); process.exit(0); }
  let complexityService: any | undefined;
  if (useComplexity) {
    const addr = await p.text({ message: 'complexity_service address:', placeholder: '172.19.0.1', defaultValue: '172.19.0.1' });
    if (p.isCancel(addr)) { p.cancel('aborted'); process.exit(0); }
    const port = await p.text({ message: 'complexity_service port:', placeholder: '8094', defaultValue: '8094' });
    if (p.isCancel(port)) { p.cancel('aborted'); process.exit(0); }
    complexityService = { enabled: true, address: String(addr || '172.19.0.1'), port: Number(port || 8094), timeout_seconds: 5 };
  }

  // multimodal brick
  const useBrick = await p.confirm({ message: 'Enable Brick multimodal (STT/OCR/Vision)?', initialValue: true });
  if (p.isCancel(useBrick)) { p.cancel('aborted'); process.exit(0); }
  let brick: any | undefined;
  if (useBrick) {
    const primaryProvider = enabledProviders.includes('regolo') ? 'regolo' : enabledProviders[0];
    const mm = catalog[primaryProvider].multimodal;
    brick = {
      enabled: true,
      stt_model: mm.stt?.model ?? 'faster-whisper-large-v3',
      stt_endpoint: mm.stt?.endpoint ?? 'https://api.regolo.ai/v1/audio/transcriptions',
      ocr_model: mm.ocr?.model ?? 'deepseek-ocr-2',
      ocr_endpoint: mm.ocr?.endpoint ?? 'https://api.regolo.ai/v1/chat/completions',
      vision_model: mm.vision?.model ?? 'qwen3.5-122b',
      vision_endpoint: mm.vision?.endpoint ?? 'https://api.regolo.ai/v1/chat/completions',
      ocr_min_text_length: 10,
    };
  }

  // keywords
  const tplKw = await readFile(join(TEMPLATE_DIR, 'keywords.default.yaml'), 'utf8');
  const keywordRules = yaml.load(tplKw) as any[];

  // decisions
  const decisionMode = await p.select({
    message: 'How to define routing decisions?',
    options: [
      { value: 'default', label: 'Use 5-decision default template (coding_easy/hard, general_easy/medium/hard)' },
      { value: 'custom', label: 'Build custom decisions interactively' },
    ],
    initialValue: 'default',
  });
  if (p.isCancel(decisionMode)) { p.cancel('aborted'); process.exit(0); }

  let decisions: any[];
  if (decisionMode === 'default') {
    const codingEasyDef = pickDefaultModel(selectedModelIds, ['qwen3-coder-next', 'gpt-4o-mini', 'gpt-oss-20b']);
    const codingHardDef = pickDefaultModel(selectedModelIds, ['minimax-m2.5', 'gpt-4o', 'gpt-4.1', 'qwen3.5-122b']);
    const generalEasyDef = pickDefaultModel(selectedModelIds, ['qwen3.5-9b', 'gpt-4o-mini', 'Llama-3.1-8B-Instruct']);
    const generalMedDef = pickDefaultModel(selectedModelIds, ['qwen3.5-122b', 'gpt-4.1', 'Llama-3.3-70B-Instruct']);
    const generalHardDef = pickDefaultModel(selectedModelIds, ['minimax-m2.5', 'gpt-4o', 'gpt-4.1']);
    const codingHardCfg = modelConfig[codingHardDef];
    const generalHardCfg = modelConfig[generalHardDef];
    decisions = defaultDecisions({
      codingEasyModel: codingEasyDef,
      codingHardModel: codingHardDef,
      generalEasyModel: generalEasyDef,
      generalMediumModel: generalMedDef,
      generalHardModel: generalHardDef,
      codingHardReasoningFamily: codingHardCfg?.reasoning_family,
      generalHardReasoningFamily: generalHardCfg?.reasoning_family,
    });
  } else {
    decisions = await runDecisionBuilder(selectedModelIds);
  }

  // assemble
  const reasoningFamilies: Record<string, any> = {};
  for (const id of selectedModelIds) {
    const fam = modelConfig[id]?.reasoning_family;
    if (fam && (reasoningFamiliesDefault as any)[fam]) {
      reasoningFamilies[fam] = (reasoningFamiliesDefault as any)[fam];
    }
  }

  const cfg: BrickConfig = ConfigSchema.parse({
    model: { name: 'brick', description: 'Virtual multimodal routing model' },
    providers,
    brick,
    server_port: 8000,
    auto_model_name: 'brick',
    provider_profiles: providerProfiles,
    vllm_endpoints: vllmEndpoints,
    default_model: defaultModel,
    model_config: modelConfig,
    reasoning_families: reasoningFamilies,
    default_reasoning_effort: 'medium',
    classifier,
    complexity_service: complexityService,
    keyword_rules: keywordRules,
    decisions,
  });

  // summary
  p.note(
    [
      `providers: ${Object.keys(providers).join(', ')}`,
      `models: ${selectedModelIds.join(', ')}`,
      `default_model: ${defaultModel}`,
      `decisions: ${decisions.length}`,
      `classifier: ${useClassifier ? 'on' : 'off'}`,
      `complexity_service: ${useComplexity ? 'on' : 'off'}`,
      `multimodal brick: ${useBrick ? 'on' : 'off'}`,
    ].join('\n'),
    'summary'
  );

  const ok = await p.confirm({ message: `Write config to ${paths.config}?`, initialValue: true });
  if (p.isCancel(ok) || !ok) { p.cancel('aborted'); process.exit(0); }

  await saveConfig(cfg);
  await writeEnvFile(apiKeys);
  await writeCompose({ port: cfg.server_port });
  p.outro(`done. config=${paths.config} compose=${paths.compose} env=${paths.env}`);
  return cfg;
}

function pickDefaultModel(available: string[], preferred: string[]): string {
  for (const p of preferred) if (available.includes(p)) return p;
  return available[0];
}

async function readEnvKey(envKey: string): Promise<string | null> {
  try {
    const txt = await readFile(paths.env, 'utf8');
    const m = txt.match(new RegExp(`^${envKey}=(.+)$`, 'm'));
    return m ? m[1].trim() : null;
  } catch {
    return process.env[envKey] ?? null;
  }
}

async function writeEnvFile(keys: Record<string, string>): Promise<void> {
  await mkdir(dirname(paths.env), { recursive: true, mode: 0o700 });
  let existing = '';
  try {
    existing = await readFile(paths.env, 'utf8');
  } catch {}
  const lines: string[] = [];
  const seen = new Set<string>();
  for (const [k, v] of Object.entries(keys)) {
    lines.push(`${k}=${v}`);
    seen.add(k);
  }
  for (const line of existing.split('\n')) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=/);
    if (m && !seen.has(m[1])) lines.push(line);
  }
  await writeFile(paths.env, lines.filter(Boolean).join('\n') + '\n', { mode: 0o600 });
}
