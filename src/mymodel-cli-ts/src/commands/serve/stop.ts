/**
 * `mymodel serve stop` — pause all MyModel containers (docker stop).
 *
 * Containers are stopped but NOT removed — use `mymodel serve start` to
 * bring them back, or `mymodel serve rm` to clean everything up.
 */

import * as p from '@clack/prompts'
import {Command} from '@oclif/core'
import {pauseVllmSr} from '../../lib/core.js'
import {DOCKER_CONTAINER_NAME} from '../../lib/constants.js'
import {containerStatus} from '../../lib/docker/containers.js'
import {OBSERVABILITY_CONTAINERS} from '../../lib/docker/observability.js'
import {ACCENT, SUCCESS, DIM} from '../../lib/ui/theme.js'

export default class ServeStop extends Command {
  static summary = 'Stop MyModel containers (keeps them for restart)'
  static description = 'Stops the router and observability containers without removing them.\nUse "mymodel serve start" to restart, or "mymodel serve rm" to delete.'

  static examples = [
    '<%= config.bin %> serve stop',
  ]

  async run(): Promise<void> {
    p.intro(ACCENT(' serve stop '))

    // Show what's running before stopping
    const allContainers = [DOCKER_CONTAINER_NAME, ...OBSERVABILITY_CONTAINERS]
    const running = allContainers.filter(n => containerStatus(n) === 'running')

    if (running.length === 0) {
      p.log.warn('No MyModel containers are running.')
      p.outro('Nothing to stop.')
      return
    }

    p.log.info(`Stopping ${running.length} container(s): ${running.map(n => ACCENT(n)).join(', ')}`)

    pauseVllmSr()

    // Confirm result
    const stopped = allContainers.filter(n => containerStatus(n) === 'exited')
    for (const name of stopped) {
      p.log.success(`${SUCCESS('stopped')}  ${name}`)
    }

    p.note(
      [
        `Containers are stopped but still exist.`,
        ``,
        `  ${ACCENT('mymodel serve start')}   Restart with a config`,
        `  ${ACCENT('mymodel serve rm')}      Remove containers completely`,
      ].join('\n'),
      'Next steps',
    )

    p.outro(DIM('Containers paused.'))
  }
}
