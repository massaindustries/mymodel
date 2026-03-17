/**
 * `mymodel serve rm` — fully remove all MyModel containers and network.
 *
 * This is the destructive cleanup: stops + removes containers and the
 * Docker network. Use `mymodel serve start` afterwards to recreate everything.
 */

import * as p from '@clack/prompts'
import {Command} from '@oclif/core'
import {stopVllmSr} from '../../lib/core.js'
import {DOCKER_CONTAINER_NAME, DOCKER_NETWORK} from '../../lib/constants.js'
import {containerStatus} from '../../lib/docker/containers.js'
import {OBSERVABILITY_CONTAINERS} from '../../lib/docker/observability.js'
import {ACCENT, ERROR, DIM} from '../../lib/ui/theme.js'
import {askConfirm} from '../../lib/ui/prompts.js'
import {requireTty} from '../../lib/ui/output.js'

export default class ServeRm extends Command {
  static summary = 'Remove all MyModel containers and network'
  static description = 'Stops and removes the router, observability containers, and Docker network.\nUse "mymodel serve start" to recreate everything from scratch.'

  static examples = [
    '<%= config.bin %> serve rm',
  ]

  async run(): Promise<void> {
    requireTty()
    p.intro(ACCENT(' serve rm '))

    const allContainers = [DOCKER_CONTAINER_NAME, ...OBSERVABILITY_CONTAINERS]
    const existing = allContainers.filter(n => {
      const s = containerStatus(n)
      return s !== 'not found'
    })

    if (existing.length === 0) {
      p.log.warn('No MyModel containers found.')
      p.outro('Nothing to remove.')
      return
    }

    // Show what will be removed
    p.note(
      [
        `Containers to remove:`,
        ...existing.map(n => `  ${ERROR('✕')}  ${n}`),
        ``,
        `Network to remove: ${DOCKER_NETWORK}`,
      ].join('\n'),
      'Will be deleted',
    )

    const confirmed = await askConfirm('Remove all MyModel containers and network?')
    if (!confirmed) {
      p.outro('Cancelled.')
      return
    }

    stopVllmSr()

    // Verify cleanup
    const stillExisting = allContainers.filter(n => containerStatus(n) !== 'not found')
    if (stillExisting.length > 0) {
      p.log.warn(`Could not remove: ${stillExisting.join(', ')}`)
    }

    p.note(
      [
        `All MyModel containers removed.`,
        ``,
        `  ${ACCENT('mymodel serve start')}   Start fresh with a config`,
      ].join('\n'),
      'Done',
    )

    p.outro(DIM('Cleanup complete.'))
  }
}
