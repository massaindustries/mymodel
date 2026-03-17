/**
 * MyModelConfig → vLLM SR native UserConfig translator.
 *
 * The container's Python config_generator.py reads the mounted config.yaml
 * and validates it against the native UserConfig Pydantic model, which expects:
 *   version, listeners, decisions, providers.models
 *
 * This module translates the MyModel abstraction format to the native format
 * so the container can parse it correctly.
 */

import * as yaml from 'js-yaml'
import type {MyModelConfig} from './schema.js'

/* ── Domain metadata ─────────────────────────────────────── */

const DOMAIN_META: Record<string, {description: string; mmlu_categories: string[]}> = {
  computer_science: {description: 'Computer science and programming',            mmlu_categories: ['computer_science']},
  mathematics:      {description: 'Mathematics and quantitative reasoning',      mmlu_categories: ['math']},
  physics:          {description: 'Physics and physical sciences',               mmlu_categories: ['physics']},
  biology:          {description: 'Biology and life sciences',                   mmlu_categories: ['biology']},
  chemistry:        {description: 'Chemistry and chemical sciences',             mmlu_categories: ['chemistry']},
  business:         {description: 'Business and management',                     mmlu_categories: ['business']},
  economics:        {description: 'Economics and financial topics',              mmlu_categories: ['economics']},
  philosophy:       {description: 'Philosophy and ethical questions',            mmlu_categories: ['philosophy']},
  law:              {description: 'Legal questions and law-related topics',      mmlu_categories: ['law']},
  history:          {description: 'Historical questions and cultural topics',    mmlu_categories: ['history']},
  psychology:       {description: 'Psychology and mental health',                mmlu_categories: ['psychology']},
  health:           {description: 'Health and medical information',              mmlu_categories: ['health']},
  engineering:      {description: 'Engineering and technical problem-solving',   mmlu_categories: ['engineering']},
  other:            {description: 'General knowledge and miscellaneous topics',  mmlu_categories: ['other']},
}

/* ── URL → endpoint/protocol ─────────────────────────────── */

function parseBaseUrl(baseUrl: string): {endpoint: string; protocol: string} {
  try {
    const url = new URL(baseUrl)
    const host = url.hostname + (url.port ? `:${url.port}` : '')
    // Strip /v1 (or /v1/) from the path — Envoy's regex_rewrite prepends
    // the path_prefix to the client's request path which already starts with
    // /v1/chat/completions. Keeping /v1 here would cause a double /v1/v1/...
    // Only include path components that come BEFORE /v1 (e.g. /compatible-mode).
    let pathSuffix = url.pathname !== '/' ? url.pathname : ''
    pathSuffix = pathSuffix.replace(/\/v1\/?$/, '')
    return {
      endpoint: host + pathSuffix,
      protocol: url.protocol === 'https:' ? 'https' : 'http',
    }
  } catch {
    // Fallback if URL is malformed
    return {endpoint: baseUrl, protocol: 'http'}
  }
}

/* ── Main translator ─────────────────────────────────────── */

/**
 * Translate MyModelConfig into the native vLLM SR UserConfig dict.
 * The returned object can be serialised to YAML and mounted in the container.
 */
export function translateToNativeConfig(config: MyModelConfig): Record<string, unknown> {
  const port = config.server?.port ?? 8000

  // ── listeners ──────────────────────────────────────────────
  const listeners = [{
    name: `http-${port}`,
    address: '0.0.0.0',
    port,
    timeout: '300s',
  }]

  // ── providers.models ───────────────────────────────────────
  // Collect unique (providerKey, modelName) pairs from text routes.
  // The model name used as the key in the native config MUST match what the
  // upstream API expects (e.g. "qwen3.5-122b", not "regoloai/qwen3.5-122b").
  // The router uses this key both for model_config access_key lookup AND for
  // the model name it forwards to the upstream — so "provider/model" keys
  // would cause a 400 from providers that don't recognise that format.
  const modelKeys = new Map<string, {providerKey: string; modelName: string}>()
  for (const route of config.text_routes) {
    if (!route.provider || !route.model) continue
    // Use just the model name (without provider prefix) as the key
    modelKeys.set(route.model, {providerKey: route.provider, modelName: route.model})
  }

  // Include modality route models so Envoy creates clusters for them.
  // Without clusters, Envoy can't forward to vision/OCR/STT backends.
  const mr = config.modality_routes ?? {}
  for (const route of Object.values(mr)) {
    if (route?.provider && route?.model) {
      modelKeys.set(route.model, {providerKey: route.provider, modelName: route.model})
    }
  }

  // Also include any provider not referenced in routes (so validators pass)
  if (modelKeys.size === 0) {
    for (const [provKey] of Object.entries(config.providers)) {
      modelKeys.set(provKey, {providerKey: provKey, modelName: provKey})
    }
  }

  const models: Record<string, unknown>[] = []
  for (const [modelKey, {providerKey}] of modelKeys) {
    const prov = config.providers[providerKey]
    if (!prov) continue

    const {endpoint, protocol} = parseBaseUrl(prov.base_url)
    const modelEntry: Record<string, unknown> = {
      name: modelKey,
      endpoints: [{
        name: `${providerKey}-ep`,
        weight: 1,
        endpoint,
        protocol,
      }],
    }

    if (prov.api_key) {
      modelEntry.access_key = prov.api_key
    }
    if (prov.type === 'anthropic') {
      modelEntry.api_format = 'anthropic'
    }

    models.push(modelEntry)
  }

  // ── signals ────────────────────────────────────────────────
  const keywordSignals: unknown[] = []
  const referencedDomains = new Set<string>()

  for (const route of config.text_routes) {
    // Collect domains
    for (const d of (route.signals?.domains ?? [])) referencedDomains.add(d)
    // Collect keywords (only non-default routes)
    const kws = route.signals?.keywords ?? []
    if (kws.length > 0) {
      keywordSignals.push({
        name: `${route.name}_keywords`,
        operator: route.operator ?? 'OR',
        keywords: kws,
        case_sensitive: false,
      })
    }
  }

  // Always include "other" domain — the Go router requires at least one
  // category, and the Python merger uses signals.domains as the source.
  referencedDomains.add('other')

  const domainSignals = Array.from(referencedDomains).map(d => {
    const meta = DOMAIN_META[d]
    return meta
      ? {name: d, description: meta.description, mmlu_categories: meta.mmlu_categories}
      : {name: d, description: d, mmlu_categories: [d]}
  })

  const signals: Record<string, unknown> = {}
  if (keywordSignals.length > 0) signals.keywords = keywordSignals
  signals.domains = domainSignals

  // ── decisions + default_model ──────────────────────────────
  const decisions: unknown[] = []
  let defaultModel: string | undefined

  for (const route of config.text_routes) {
    // Use just the model name (matches the key used in providers.models above)
    const modelKey = route.model
    const kws = route.signals?.keywords ?? []
    const doms = route.signals?.domains ?? []

    // Route with no signals → default fallback
    if (kws.length === 0 && doms.length === 0) {
      if (!defaultModel) defaultModel = modelKey
      continue
    }

    const conditions: unknown[] = []
    if (kws.length > 0) {
      conditions.push({type: 'keyword', name: `${route.name}_keywords`})
    }
    for (const d of doms) {
      conditions.push({type: 'domain', name: d})
    }

    decisions.push({
      name: route.name,
      description: `${route.name} route`,
      priority: route.priority,
      rules: {
        operator: route.operator ?? 'OR',
        conditions,
      },
      modelRefs: [{model: modelKey}],
    })
  }

  // Fallback: if no default model found, use first model
  if (!defaultModel && models.length > 0) {
    defaultModel = models[0].name as string
  }

  // ── assemble ───────────────────────────────────────────────
  // The Go proxy reads MyModelExtension (inline) for providers/brick,
  // and native fields (model_config, default_model, vllm_endpoints) for
  // the routing pipeline. We output BOTH.

  // MyModel-format providers (for brick handler's getRegoloProviderInfo)
  const mymodelProviders: Record<string, unknown> = {}
  for (const [provName, prov] of Object.entries(config.providers)) {
    mymodelProviders[provName] = {
      type: prov.type || 'openai-compatible',
      base_url: prov.base_url,
      api_key: prov.api_key,
    }
  }

  // Native model_config (for pipeline model rewriting + auth injection)
  const modelConfig: Record<string, unknown> = {}
  for (const [modelKey, {providerKey}] of modelKeys) {
    const prov = config.providers[providerKey]
    if (!prov) continue
    const entry: Record<string, unknown> = {}
    if (prov.api_key) entry.access_key = prov.api_key
    if (prov.type === 'anthropic') entry.api_format = 'anthropic'
    modelConfig[modelKey] = entry
  }

  // Native vllm_endpoints (for pipeline forwarding)
  const vllmEndpoints: unknown[] = []
  const seenEndpoints = new Set<string>()
  for (const [modelKey, {providerKey}] of modelKeys) {
    const prov = config.providers[providerKey]
    if (!prov) continue
    const {endpoint, protocol} = parseBaseUrl(prov.base_url)
    const host = endpoint.split('/')[0]
    const epKey = `${host}-${modelKey}`
    if (seenEndpoints.has(epKey)) continue
    seenEndpoints.add(epKey)
    vllmEndpoints.push({
      name: providerKey,
      address: host.split(':')[0],
      port: protocol === 'https' ? 443 : (parseInt(host.split(':')[1]) || 80),
      protocol,
      model: modelKey,
      weight: 1,
    })
  }

  const native: Record<string, unknown> = {
    // MyModel-format fields (read by brick handler, provider info)
    providers: mymodelProviders,
    server_port: config.server?.port ?? 8000,

    // Native pipeline fields (read by routing pipeline)
    default_model: defaultModel,
    model_config: modelConfig,
    vllm_endpoints: vllmEndpoints,
    decisions,
  }

  if (Object.keys(signals).length > 0) {
    native.signals = signals
  }

  // ── brick (multimodal gateway) ─────────────────────────────
  // Translate modality_routes into the Go-side BrickConfig so the
  // proxy can detect image/audio content and route accordingly.
  const modalRoutes = config.modality_routes ?? {}
  const hasModality = modalRoutes.audio || modalRoutes.image || modalRoutes.multimodal
  if (hasModality) {
    const brick: Record<string, unknown> = {enabled: true}

    // Helper: resolve provider base_url for a modality route
    const baseUrlFor = (route: {provider: string; model: string}) =>
      config.providers[route.provider]?.base_url ?? 'https://api.regolo.ai/v1'

    if (modalRoutes.audio) {
      brick.stt_model = modalRoutes.audio.model
      brick.stt_endpoint = baseUrlFor(modalRoutes.audio) + '/audio/transcriptions'
    }
    if (modalRoutes.image) {
      brick.ocr_model = modalRoutes.image.model
      brick.ocr_endpoint = baseUrlFor(modalRoutes.image) + '/chat/completions'
    }
    if (modalRoutes.multimodal) {
      brick.vision_model = modalRoutes.multimodal.model
      brick.vision_endpoint = baseUrlFor(modalRoutes.multimodal) + '/chat/completions'
    }

    native.brick = brick
  }

  // ── plugins → native Go config flags ───────────────────────
  // Map MyModel plugin toggles to their native Go config counterparts
  // so user settings (e.g., semantic_cache.enabled: false) are respected.
  const plugins = config.plugins ?? {}
  if (plugins.semantic_cache) {
    native.semantic_cache = {enabled: plugins.semantic_cache.enabled ?? false}
  }
  if (plugins.jailbreak_guard) {
    native.prompt_guard = {enabled: plugins.jailbreak_guard.enabled ?? false}
  }

  return native
}

/**
 * Translate and serialise to YAML string.
 */
export function translateToNativeYaml(config: MyModelConfig): string {
  const native = translateToNativeConfig(config)
  return yaml.dump(native, {sortKeys: false, lineWidth: 120})
}

/**
 * Build a YAML patch for the Go router-config.yaml.
 *
 * The container's Python merger generates router-config.yaml from defaults +
 * the user config, but it doesn't pass through brick, semantic_cache, or
 * prompt_guard settings. This patch is applied after startup to inject them.
 * Returns null if no patch is needed.
 */
export function buildRouterConfigPatch(config: MyModelConfig): string | null {
  const patch: Record<string, unknown> = {}

  // brick (multimodal gateway)
  const native = translateToNativeConfig(config)
  if (native.brick) patch.brick = native.brick

  // semantic_cache override
  const plugins = config.plugins ?? {}
  if (plugins.semantic_cache && !plugins.semantic_cache.enabled) {
    patch.semantic_cache = {enabled: false}
  }

  // prompt_guard override
  if (plugins.jailbreak_guard && !plugins.jailbreak_guard.enabled) {
    patch.prompt_guard = {enabled: false}
  }

  if (Object.keys(patch).length === 0) return null
  return yaml.dump(patch, {sortKeys: false, lineWidth: 120})
}
