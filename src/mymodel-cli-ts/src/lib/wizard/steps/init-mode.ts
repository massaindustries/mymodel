/**
 * Wizard initial step: choose how to start configuration.
 *
 * Presented immediately after the welcome banner, before any other step.
 * Three modes:
 *   - new:     Start the full interactive wizard from scratch
 *   - premade: Pick from curated pre-made configurations
 *   - import:  Load an existing config.yaml from a file path
 */

import * as fs from 'node:fs'
import * as p from '@clack/prompts'
import {askChoice, askText} from '../../ui/prompts.js'
import {ACCENT, DIM} from '../../ui/theme.js'
import {loadConfig, saveConfig} from '../../config/loader.js'
import type {MyModelConfig} from '../../config/schema.js'

export type InitMode = 'new' | 'premade' | 'import'

export interface InitModeResult {
  mode: InitMode
  /** If mode is 'import' or 'premade', the loaded config ready to save. */
  config?: MyModelConfig
  /** Env vars to write to .env.example */
  envVars?: Record<string, string>
}

/* ── Pre-made configurations ───────────────────────────── */

interface PresetOption {
  name: string
  description: string
  config: MyModelConfig
  envVars: Record<string, string>
}

const PREMADE_CONFIGS: PresetOption[] = [
  {
    name: 'Regolo.ai — Single provider',
    description: 'All requests routed to Regolo.ai',
    envVars: {REGOLO_API_KEY: ''},
    config: {
      model: {name: 'MyModel', description: 'Powered by Regolo.ai'},
      providers: {
        regolo: {
          type: 'openai-compatible',
          base_url: 'https://api.regolo.ai/v1',
          api_key: '${REGOLO_API_KEY}',
        },
      },
      modality_routes: {},
      text_routes: [
        {
          name: 'default',
          priority: 0,
          signals: {keywords: [], domains: []},
          operator: 'OR',
          provider: 'regolo',
          model: 'deepseek-v3-0324',
        },
      ],
      server: {port: 8000, cors: ''},
      plugins: {},
      classifier: {},
    },
  },
  {
    name: 'OpenAI — Single provider',
    description: 'All requests routed to OpenAI',
    envVars: {OPENAI_API_KEY: ''},
    config: {
      model: {name: 'MyModel', description: 'Powered by OpenAI'},
      providers: {
        openai: {
          type: 'openai-compatible',
          base_url: 'https://api.openai.com/v1',
          api_key: '${OPENAI_API_KEY}',
        },
      },
      modality_routes: {},
      text_routes: [
        {
          name: 'default',
          priority: 0,
          signals: {keywords: [], domains: []},
          operator: 'OR',
          provider: 'openai',
          model: 'gpt-4o',
        },
      ],
      server: {port: 8000, cors: ''},
      plugins: {},
      classifier: {},
    },
  },
  {
    name: 'Multi-provider — Smart routing',
    description: 'Regolo + OpenAI with domain-based routing',
    envVars: {REGOLO_API_KEY: '', OPENAI_API_KEY: ''},
    config: {
      model: {name: 'MyModel', description: 'Multi-provider smart routing'},
      providers: {
        regolo: {
          type: 'openai-compatible',
          base_url: 'https://api.regolo.ai/v1',
          api_key: '${REGOLO_API_KEY}',
        },
        openai: {
          type: 'openai-compatible',
          base_url: 'https://api.openai.com/v1',
          api_key: '${OPENAI_API_KEY}',
        },
      },
      modality_routes: {},
      text_routes: [
        {
          name: 'coding',
          priority: 80,
          signals: {
            keywords: ['code', 'debug', 'function', 'api', 'programming'],
            domains: ['computer_science', 'engineering'],
          },
          operator: 'OR',
          provider: 'regolo',
          model: 'deepseek-v3-0324',
        },
        {
          name: 'reasoning',
          priority: 70,
          signals: {
            keywords: ['analyze', 'explain', 'compare', 'reason'],
            domains: ['mathematics', 'physics', 'philosophy'],
          },
          operator: 'OR',
          provider: 'openai',
          model: 'gpt-4o',
        },
        {
          name: 'default',
          priority: 0,
          signals: {keywords: [], domains: []},
          operator: 'OR',
          provider: 'regolo',
          model: 'deepseek-v3-0324',
        },
      ],
      server: {port: 8000, cors: ''},
      plugins: {},
      classifier: {},
    },
  },
]

/* ── Step implementation ───────────────────────────────── */

export async function promptInitMode(outputPath: string): Promise<InitModeResult> {
  const mode = await askChoice<InitMode>(
    'How would you like to set up your configuration?',
    [
      {name: 'Start new configuration', value: 'new', description: 'Interactive step-by-step wizard'},
      {name: 'Use pre-made configuration', value: 'premade', description: 'Pick from ready-to-use templates'},
      {name: 'Import configuration from path', value: 'import', description: 'Load an existing config.yaml'},
    ],
  )

  if (mode === 'new') {
    return {mode}
  }

  if (mode === 'import') {
    return handleImport()
  }

  return handlePremade()
}

/* ── Import handler ────────────────────────────────────── */

async function handleImport(): Promise<InitModeResult> {
  const filePath = await askText('Path to config file:', {
    placeholder: './config.yaml',
    required: true,
  })

  if (!fs.existsSync(filePath)) {
    p.log.error(`File not found: ${filePath}`)
    // Ask again
    return handleImport()
  }

  try {
    const config = loadConfig(filePath)
    p.log.success(`Configuration loaded from ${ACCENT(filePath)}`)

    // Collect env vars from provider api_keys
    const envVars: Record<string, string> = {}
    for (const provider of Object.values(config.providers)) {
      const match = provider.api_key.match(/\$\{([^}]+)\}/)
      if (match) {
        envVars[match[1]] = ''
      }
    }

    return {mode: 'import', config, envVars}
  } catch (error) {
    p.log.error(`Failed to parse config: ${(error as Error).message}`)
    return handleImport()
  }
}

/* ── Pre-made handler ──────────────────────────────────── */

async function handlePremade(): Promise<InitModeResult> {
  const choices = PREMADE_CONFIGS.map((preset, i) => ({
    name: preset.name,
    value: String(i),
    description: preset.description,
  }))

  const selected = await askChoice('Choose a pre-made configuration:', choices)
  const preset = PREMADE_CONFIGS[Number(selected)]

  // Show what's included
  const lines: string[] = []
  lines.push(ACCENT(preset.name))
  lines.push(DIM(preset.description))
  lines.push('')
  lines.push(`Providers: ${Object.keys(preset.config.providers).join(', ')}`)
  lines.push(`Routes: ${preset.config.text_routes.map(r => r.name).join(', ')}`)
  if (Object.keys(preset.envVars).length > 0) {
    lines.push(`Env vars needed: ${Object.keys(preset.envVars).join(', ')}`)
  }
  p.note(lines.join('\n'), 'Configuration Preview')

  return {mode: 'premade', config: preset.config, envVars: preset.envVars}
}
