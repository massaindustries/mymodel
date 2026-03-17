/**
 * `mymodel config edit` — interactively edit any part of the configuration.
 *
 * Presents a top-level menu to choose what to edit, then shows current
 * values as defaults so the user only needs to change what matters.
 */

import * as p from '@clack/prompts'
import {BaseCommand} from '../../base-command.js'
import {saveConfig} from '../../lib/config/loader.js'
import {requireTty} from '../../lib/ui/output.js'
import {askText, askChoice, askMultiChoice, askNumber, askConfirm, pickModel} from '../../lib/ui/prompts.js'
import {DOMAIN_CATEGORIES} from '../../lib/presets.js'
import {ACCENT, ACCENT_BOLD, DIM} from '../../lib/ui/theme.js'
import type {MyModelConfig} from '../../lib/config/schema.js'

type EditTarget = 'model' | 'provider' | 'route' | 'modality' | 'plugin' | 'server'

export default class ConfigEdit extends BaseCommand {
  static summary = 'Interactively edit your configuration'
  static description = 'Edit providers, routes, modalities, plugins or model identity.'

  static examples = [
    '<%= config.bin %> config edit',
    '<%= config.bin %> config edit --config ./my-config.yaml',
  ]

  async run(): Promise<void> {
    const {flags} = await this.parse(ConfigEdit)
    requireTty()

    const config = this.loadConfigOrExit(flags.config)

    p.intro(ACCENT(' config edit '))

    const target = await askChoice<EditTarget>('What would you like to edit?', [
      {name: 'Model info',     value: 'model',    description: 'Name and description'},
      {name: 'Provider',       value: 'provider', description: `${Object.keys(config.providers).length} configured`},
      {name: 'Text route',     value: 'route',    description: `${config.text_routes.length} configured`},
      {name: 'Modality route', value: 'modality', description: `${Object.keys(config.modality_routes).length} configured`},
      {name: 'Plugin',         value: 'plugin',   description: `${Object.keys(config.plugins).length} configured`},
      {name: 'Server port',    value: 'server',   description: `Currently ${config.server.port}`},
    ])

    switch (target) {
      case 'model':    await editModel(config); break
      case 'provider': await editProvider(config); break
      case 'route':    await editRoute(config); break
      case 'modality': await editModality(config); break
      case 'plugin':   await editPlugin(config); break
      case 'server':   await editServer(config); break
    }

    saveConfig(config, flags.config)
    p.outro(`Configuration saved to ${ACCENT(flags.config)}`)
  }
}

/* ── Model identity ─────────────────────────────────────── */

async function editModel(config: MyModelConfig): Promise<void> {
  p.log.step(ACCENT_BOLD('Model Identity'))

  config.model.name = await askText('Model name:', {
    default: config.model.name,
    required: true,
  })
  config.model.description = await askText('Description:', {
    default: config.model.description,
  })
}

/* ── Provider ────────────────────────────────────────────── */

async function editProvider(config: MyModelConfig): Promise<void> {
  const providerNames = Object.keys(config.providers)
  if (providerNames.length === 0) {
    p.log.warn('No providers configured. Use mymodel add provider first.')
    return
  }

  const name = await askChoice('Select provider to edit:', providerNames.map(n => ({
    name: n,
    value: n,
    description: DIM(config.providers[n].base_url),
  })))

  const prov = config.providers[name]
  p.log.step(ACCENT_BOLD(`Editing provider: ${name}`))

  // Allow renaming (creates new key, deletes old one)
  const newName = await askText('Provider name:', {default: name, required: true})
  prov.type = await askChoice('Provider type:', [
    {name: 'openai-compatible', value: 'openai-compatible'},
    {name: 'anthropic',         value: 'anthropic'},
    {name: 'vllm',              value: 'vllm'},
  ])
  prov.base_url = await askText('Base URL:', {default: prov.base_url, required: true})
  prov.api_key  = await askText('API key (${ENV_VAR} syntax supported):', {default: prov.api_key})

  if (newName !== name) {
    config.providers[newName] = prov
    delete config.providers[name]
    // Update references in routes
    for (const route of config.text_routes) {
      if (route.provider === name) route.provider = newName
    }
    for (const mod of Object.values(config.modality_routes)) {
      if (mod.provider === name) mod.provider = newName
    }
    p.log.info(`Renamed provider ${ACCENT(name)} → ${ACCENT(newName)}`)
  }
}

/* ── Text route ──────────────────────────────────────────── */

async function editRoute(config: MyModelConfig): Promise<void> {
  if (config.text_routes.length === 0) {
    p.log.warn('No text routes configured. Use mymodel add route first.')
    return
  }

  const routeName = await askChoice('Select route to edit:', config.text_routes.map(r => ({
    name: r.name,
    value: r.name,
    description: DIM(`${r.provider}/${r.model}  P${r.priority}`),
  })))

  const route = config.text_routes.find(r => r.name === routeName)!
  p.log.step(ACCENT_BOLD(`Editing route: ${routeName}`))

  route.name = await askText('Route name:', {default: route.name, required: true})
  route.provider = await askChoice('Provider:', Object.keys(config.providers).map(n => ({
    name: n, value: n,
  })))

  const prov = config.providers[route.provider]
  route.model = await pickModel(route.provider, prov.base_url, prov.api_key, prov.type)

  route.priority = await askNumber('Priority (0-100):', {
    default: route.priority,
    min: 0,
    max: 100,
  })

  const keywordsStr = await askText('Keywords (comma-separated):', {
    default: route.signals.keywords.join(', '),
  })
  route.signals.keywords = keywordsStr
    ? keywordsStr.split(',').map(k => k.trim()).filter(Boolean)
    : []

  route.signals.domains = await askMultiChoice(
    'Domain triggers:',
    DOMAIN_CATEGORIES.map(d => ({name: d, value: d})),
  )

  route.operator = await askChoice('Signal operator:', [
    {name: 'OR — match any signal', value: 'OR' as const},
    {name: 'AND — match all signals', value: 'AND' as const},
  ])
}

/* ── Modality route ──────────────────────────────────────── */

async function editModality(config: MyModelConfig): Promise<void> {
  const modalities = Object.keys(config.modality_routes)
  if (modalities.length === 0) {
    p.log.warn('No modality routes configured. Use mymodel add modality first.')
    return
  }

  const mod = await askChoice('Select modality to edit:', modalities.map(m => ({
    name: m,
    value: m,
    description: DIM(`${config.modality_routes[m].provider}/${config.modality_routes[m].model}`),
  })))

  const route = config.modality_routes[mod]
  p.log.step(ACCENT_BOLD(`Editing modality: ${mod}`))

  route.provider = await askChoice('Provider:', Object.keys(config.providers).map(n => ({
    name: n, value: n,
  })))

  const prov = config.providers[route.provider]
  route.model = await pickModel(route.provider, prov.base_url, prov.api_key, prov.type)
}

/* ── Plugin ──────────────────────────────────────────────── */

async function editPlugin(config: MyModelConfig): Promise<void> {
  const pluginNames = Object.keys(config.plugins)
  if (pluginNames.length === 0) {
    p.log.warn('No plugins configured.')
    return
  }

  const pluginName = await askChoice('Select plugin to edit:', pluginNames.map(n => ({
    name: n.replace(/_/g, ' '),
    value: n,
    description: config.plugins[n].enabled ? ACCENT('enabled') : DIM('disabled'),
  })))

  const plugin = config.plugins[pluginName]
  p.log.step(ACCENT_BOLD(`Editing plugin: ${pluginName.replace(/_/g, ' ')}`))

  plugin.enabled = await askConfirm('Enable this plugin?', plugin.enabled)

  if (plugin.enabled && pluginName !== 'semantic_cache') {
    plugin.action = await askChoice('Action on detection:', [
      {name: 'redact — replace sensitive content', value: 'redact'},
      {name: 'mask — obscure sensitive content',   value: 'mask'},
      {name: 'block — reject the request',         value: 'block'},
    ])
  }
}

/* ── Server ──────────────────────────────────────────────── */

async function editServer(config: MyModelConfig): Promise<void> {
  p.log.step(ACCENT_BOLD('Server Settings'))

  config.server.port = await askNumber('Port:', {
    default: config.server.port,
    min: 1,
    max: 65535,
  })
}
