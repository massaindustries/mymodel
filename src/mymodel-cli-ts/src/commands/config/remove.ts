/**
 * `mymodel config remove` — interactively remove a provider, route, or modality.
 *
 * Unified entry point under the config namespace. Presents a menu,
 * then delegates to the appropriate removal logic.
 */

import * as fs from 'node:fs'
import * as p from '@clack/prompts'
import {BaseCommand} from '../../base-command.js'
import {saveConfig, getRoutesForProvider} from '../../lib/config/loader.js'
import {requireTty} from '../../lib/ui/output.js'
import {askChoice, askConfirm} from '../../lib/ui/prompts.js'
import {ACCENT, DIM, ERROR} from '../../lib/ui/theme.js'
import type {MyModelConfig} from '../../lib/config/schema.js'

type RemoveTarget = 'provider' | 'route' | 'modality' | 'plugin' | 'all'

export default class ConfigRemove extends BaseCommand {
  static summary = 'Remove a provider, route, modality, plugin, or the entire config'
  static description = 'Interactively select and remove configuration elements.\nThe "all" option deletes the config file entirely.'

  static examples = [
    '<%= config.bin %> config remove',
    '<%= config.bin %> config remove --config ./my-config.yaml',
  ]

  async run(): Promise<void> {
    const {flags} = await this.parse(ConfigRemove)
    requireTty()

    const config = this.loadConfigOrExit(flags.config)

    p.intro(ACCENT(' config remove '))

    const target = await askChoice<RemoveTarget>('What would you like to remove?', [
      {name: 'Provider',       value: 'provider', description: `${Object.keys(config.providers).length} configured`},
      {name: 'Text route',     value: 'route',    description: `${config.text_routes.length} configured`},
      {name: 'Modality route', value: 'modality', description: `${Object.keys(config.modality_routes).length} configured`},
      {name: 'Plugin',         value: 'plugin',   description: `${Object.keys(config.plugins).length} configured`},
      {name: 'All (delete profile)', value: 'all', description: `permanently delete ${flags.config}`},
    ])

    if (target === 'all') {
      await removeAll(flags.config)
      return
    }

    let removed: string | null = null

    switch (target) {
      case 'provider': removed = await removeProvider(config); break
      case 'route':    removed = await removeRoute(config); break
      case 'modality': removed = await removeModality(config); break
      case 'plugin':   removed = await removePlugin(config); break
    }

    if (removed) {
      saveConfig(config, flags.config)
      p.outro(`${ACCENT(removed)} removed from ${flags.config}`)
    } else {
      p.outro('Nothing removed.')
    }
  }
}

/* ── Delete entire profile ───────────────────────────────── */

async function removeAll(configPath: string): Promise<void> {
  p.note(
    [
      `This will permanently delete:`,
      `  ${ERROR('✕')}  ${configPath}`,
      ``,
      `The server will stop working until you run ${ACCENT('mymodel init')} again.`,
    ].join('\n'),
    'Warning',
  )

  const confirmed = await askConfirm('Delete the entire config file?')
  if (!confirmed) {
    p.outro('Cancelled.')
    return
  }

  fs.unlinkSync(configPath)
  p.outro(`${ACCENT(configPath)} deleted. Run ${ACCENT('mymodel init')} to start fresh.`)
}

/* ── Provider ────────────────────────────────────────────── */

async function removeProvider(config: MyModelConfig): Promise<string | null> {
  const names = Object.keys(config.providers)
  if (names.length === 0) {
    p.log.warn('No providers configured.')
    return null
  }

  const name = await askChoice('Select provider to remove:', names.map(n => ({
    name: n,
    value: n,
    description: DIM(config.providers[n].base_url),
  })))

  // Warn about orphaned routes
  const orphaned = getRoutesForProvider(config, name)
  if (orphaned.length > 0) {
    p.log.warn(`These routes reference "${name}" and will be orphaned:`)
    for (const r of orphaned) p.log.warn(`  ${r}`)
    const proceed = await askConfirm('Remove provider anyway?')
    if (!proceed) return null
  }

  delete config.providers[name]
  return name
}

/* ── Text route ──────────────────────────────────────────── */

async function removeRoute(config: MyModelConfig): Promise<string | null> {
  if (config.text_routes.length === 0) {
    p.log.warn('No text routes configured.')
    return null
  }

  const name = await askChoice('Select route to remove:', config.text_routes.map(r => ({
    name: r.name,
    value: r.name,
    description: DIM(`${r.provider}/${r.model}  P${r.priority}`),
  })))

  const confirmed = await askConfirm(`Remove route "${name}"?`)
  if (!confirmed) return null

  config.text_routes = config.text_routes.filter(r => r.name !== name)
  return name
}

/* ── Modality route ──────────────────────────────────────── */

async function removeModality(config: MyModelConfig): Promise<string | null> {
  const modalities = Object.keys(config.modality_routes)
  if (modalities.length === 0) {
    p.log.warn('No modality routes configured.')
    return null
  }

  const mod = await askChoice('Select modality to remove:', modalities.map(m => ({
    name: m,
    value: m,
    description: DIM(`${config.modality_routes[m].provider}/${config.modality_routes[m].model}`),
  })))

  const confirmed = await askConfirm(`Remove modality route "${mod}"?`)
  if (!confirmed) return null

  delete config.modality_routes[mod]
  return mod
}

/* ── Plugin ──────────────────────────────────────────────── */

async function removePlugin(config: MyModelConfig): Promise<string | null> {
  const names = Object.keys(config.plugins)
  if (names.length === 0) {
    p.log.warn('No plugins configured.')
    return null
  }

  const name = await askChoice('Select plugin to remove:', names.map(n => ({
    name: n.replace(/_/g, ' '),
    value: n,
    description: config.plugins[n].enabled ? ACCENT('enabled') : DIM('disabled'),
  })))

  const confirmed = await askConfirm(`Remove plugin "${name.replace(/_/g, ' ')}"?`)
  if (!confirmed) return null

  delete config.plugins[name]
  return name
}
