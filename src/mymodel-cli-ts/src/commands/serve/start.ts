/**
 * `mymodel serve start` — explicit start alias for `mymodel serve`.
 *
 * Identical to `mymodel serve` but makes the serve topic symmetric:
 * serve start / serve stop / serve rm.
 *
 * Removes any stale containers first, then starts fresh.
 */

import {Flags} from '@oclif/core'
import * as p from '@clack/prompts'
import {BaseCommand} from '../../base-command.js'
import {startVllmSr, stopVllmSr} from '../../lib/core.js'
import {DOCKER_CONTAINER_NAME} from '../../lib/constants.js'
import {containerStatus} from '../../lib/docker/containers.js'
import {ACCENT, ACCENT_BOLD, SUCCESS, DIM} from '../../lib/ui/theme.js'
import {ALGORITHM_TYPES} from '../../lib/constants.js'
import {resolveHfToken, saveHfToken} from '../../lib/config/hf-token.js'
import {askText} from '../../lib/ui/prompts.js'
import * as fs from 'node:fs'
import * as yaml from 'js-yaml'
import * as os from 'node:os'
import * as path from 'node:path'

export default class ServeStart extends BaseCommand {
  static summary = 'Start (or restart) the MyModel server'
  static description = 'Starts the full stack: router + observability containers.\nIf containers already exist they are removed and recreated.'

  static flags = {
    ...BaseCommand.baseFlags,
    port: Flags.integer({char: 'p', default: 8000, description: 'Server port'}),
    image: Flags.string({description: 'Docker image to use'}),
    algorithm: Flags.string({
      description: 'Model selection algorithm override',
      options: [...ALGORITHM_TYPES],
    }),
    minimal: Flags.boolean({default: false, description: 'No dashboard or observability'}),
  }

  static examples = [
    '<%= config.bin %> serve start',
    '<%= config.bin %> serve start --config ./my-config.yaml',
    '<%= config.bin %> serve start --port 9000 --minimal',
  ]

  async run(): Promise<void> {
    const {flags} = await this.parse(ServeStart)

    const config = this.loadConfigOrExit(flags.config)

    if (flags.port && flags.port !== config.server.port) {
      config.server.port = flags.port
    }

    // Remove stale containers if they exist
    const stale = containerStatus(DOCKER_CONTAINER_NAME)
    if (stale !== 'not found') {
      p.log.info(DIM(`Removing stale containers (status: ${stale})...`))
      stopVllmSr()
    }

    let effectivePath = flags.config
    if (flags.algorithm) {
      effectivePath = this.injectAlgorithm(flags.config, flags.algorithm)
    }

    // ── HF token: not required but speeds up first-run model downloads ──
    let hfToken = resolveHfToken()
    if (!hfToken) {
      const entered = await askText(
        'HuggingFace token (speeds up first download — press Enter to skip):',
        {placeholder: 'hf_...'},
      )
      if (entered) {
        saveHfToken(entered)
        hfToken = entered
        p.log.success('HF token saved to ~/.mymodel/hf_token')
      }
    }

    const envVars: Record<string, string> = {}
    const envKeys = [
      'ANTHROPIC_API_KEY', 'OPENAI_API_KEY', 'REGOLO_API_KEY', 'GOOGLE_API_KEY',
      'HF_ENDPOINT', 'HF_HOME', 'HF_HUB_CACHE',
    ]
    for (const key of envKeys) {
      if (process.env[key]) envVars[key] = process.env[key]!
    }
    if (hfToken) envVars.HF_TOKEN = hfToken

    this.printBanner(config)

    try {
      await startVllmSr(effectivePath, config, {
        envVars,
        image: flags.image,
        enableObservability: !flags.minimal,
        minimal: flags.minimal,
      })
    } catch (error) {
      if ((error as Error).message?.includes('Neither docker nor podman')) {
        p.log.error('Docker or Podman is required to run the server.')
      } else {
        throw error
      }
    }
  }

  private printBanner(config: ReturnType<typeof this.loadConfigOrExit>): void {
    const lines: string[] = [
      ACCENT_BOLD(`MyModel: ${config.model.name}`),
      '',
      `  Providers: ${Object.keys(config.providers).length} (${Object.keys(config.providers).join(', ')})`,
      `  Routes:    ${config.text_routes.length}`,
    ]
    const pluginStatus: string[] = []
    for (const [name, conf] of Object.entries(config.plugins)) {
      const short = name.split('_')[0].toUpperCase()
      pluginStatus.push(conf.enabled ? SUCCESS(`${short} ON`) : DIM(`${short} OFF`))
    }
    if (pluginStatus.length > 0) lines.push(`  Plugins:   ${pluginStatus.join('  ')}`)
    p.note(lines.join('\n'), 'Configuration')
    p.log.success(`Server listening on ${ACCENT_BOLD(`http://0.0.0.0:${config.server.port}`)}`)
    p.log.message('Press Ctrl+C to stop.')
  }

  private injectAlgorithm(configPath: string, algorithm: string): string {
    const raw = yaml.load(fs.readFileSync(configPath, 'utf8')) as Record<string, unknown> ?? {}
    const decisions = raw.decisions as Array<Record<string, unknown>> | undefined
    if (decisions) {
      for (const decision of decisions) {
        if (!decision.algorithm) decision.algorithm = {}
        ;(decision.algorithm as Record<string, unknown>).type = algorithm
      }
    }
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mymodel-'))
    const tmpPath = path.join(tmpDir, 'config-with-algorithm.yaml')
    fs.writeFileSync(tmpPath, yaml.dump(raw, {sortKeys: false}))
    return tmpPath
  }
}
