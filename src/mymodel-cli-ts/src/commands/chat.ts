/**
 * `mymodel chat` — interactive TUI chat with a running MyModel instance.
 *
 * Connects to the local vLLM SR endpoint (OpenAI-compatible) and provides
 * a readline-based REPL with streaming support and slash commands.
 *
 * Slash commands:
 *   /stream       Toggle streaming on/off
 *   /clear        Clear conversation history
 *   /model        Change the model name sent in requests
 *   /system       Set or clear the system prompt
 *   /temperature  Set sampling temperature
 *   /history      Show conversation history
 *   /help         Show available commands
 *   /exit         Quit the chat
 */

import {Flags} from '@oclif/core'
import * as readline from 'node:readline'
import {BaseCommand} from '../base-command.js'
import {DOCKER_CONTAINER_NAME, DEFAULT_PROXY_PORT} from '../lib/constants.js'
import {containerStatus} from '../lib/docker/containers.js'
import {ACCENT, ACCENT_BOLD, DIM, ERROR, BOLD, WARN} from '../lib/ui/theme.js'

/* ── Types ────────────────────────────────────────────────── */

interface ChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

interface ChatState {
  messages: ChatMessage[]
  model: string
  stream: boolean
  temperature: number
  baseUrl: string
}

/* ── Slash command registry ────────────────────────────────── */

interface SlashCommand {
  description: string
  handler: (state: ChatState, args: string, rl: readline.Interface) => Promise<boolean | void>
}

const SLASH_COMMANDS: Record<string, SlashCommand> = {
  '/stream': {
    description: 'Toggle streaming on/off',
    async handler(state) {
      state.stream = !state.stream
      console.log(ACCENT(`  Streaming: ${state.stream ? 'ON' : 'OFF'}`))
    },
  },
  '/clear': {
    description: 'Clear conversation history',
    async handler(state) {
      const systemMsg = state.messages.find(m => m.role === 'system')
      state.messages = systemMsg ? [systemMsg] : []
      console.log(ACCENT('  Conversation cleared.'))
    },
  },
  '/model': {
    description: 'Change model name (e.g. /model mybeautifulmodel)',
    async handler(state, args, rl) {
      if (args.trim()) {
        state.model = args.trim()
        console.log(ACCENT(`  Model set to: ${state.model}`))
      } else {
        const name = await question(rl, DIM('  Enter model name: '))
        if (name.trim()) {
          state.model = name.trim()
          console.log(ACCENT(`  Model set to: ${state.model}`))
        }
      }
    },
  },
  '/system': {
    description: 'Set system prompt (empty to clear)',
    async handler(state, args, rl) {
      const text = args.trim() || (await question(rl, DIM('  System prompt (empty to clear): ')))
      // Remove existing system message
      state.messages = state.messages.filter(m => m.role !== 'system')
      if (text.trim()) {
        state.messages.unshift({role: 'system', content: text.trim()})
        console.log(ACCENT('  System prompt set.'))
      } else {
        console.log(ACCENT('  System prompt cleared.'))
      }
    },
  },
  '/temperature': {
    description: 'Set temperature (0.0–2.0)',
    async handler(state, args, rl) {
      const raw = args.trim() || (await question(rl, DIM('  Temperature (0.0–2.0): ')))
      const n = parseFloat(raw)
      if (Number.isNaN(n) || n < 0 || n > 2) {
        console.log(ERROR('  Invalid temperature. Must be between 0.0 and 2.0.'))
      } else {
        state.temperature = n
        console.log(ACCENT(`  Temperature set to: ${state.temperature}`))
      }
    },
  },
  '/history': {
    description: 'Show conversation history',
    async handler(state) {
      if (state.messages.length === 0) {
        console.log(DIM('  (empty)'))
        return
      }
      for (const msg of state.messages) {
        const tag = msg.role === 'system' ? WARN('system')
          : msg.role === 'user' ? ACCENT_BOLD('you')
          : BOLD('assistant')
        const preview = msg.content.length > 120
          ? msg.content.slice(0, 120) + '...'
          : msg.content
        console.log(`  ${tag}: ${DIM(preview)}`)
      }
    },
  },
  '/help': {
    description: 'Show available commands',
    async handler() {
      console.log()
      console.log(ACCENT_BOLD('  Slash commands:'))
      for (const [cmd, info] of Object.entries(SLASH_COMMANDS)) {
        console.log(`  ${ACCENT(cmd.padEnd(16))} ${DIM(info.description)}`)
      }
      console.log()
    },
  },
  '/exit': {
    description: 'Quit the chat',
    async handler() {
      return true // signal exit
    },
  },
}

/* ── Helpers ───────────────────────────────────────────────── */

function question(rl: readline.Interface, prompt: string): Promise<string> {
  return new Promise(resolve => rl.question(prompt, resolve))
}

/** Parse SSE stream and yield content deltas. */
async function* parseSSEStream(response: Response): AsyncGenerator<string> {
  const reader = response.body?.getReader()
  if (!reader) return

  const decoder = new TextDecoder()
  let buffer = ''

  while (true) {
    const {done, value} = await reader.read()
    if (done) break

    buffer += decoder.decode(value, {stream: true})
    const lines = buffer.split('\n')
    buffer = lines.pop() ?? ''

    for (const line of lines) {
      if (line.startsWith('data: ')) {
        const data = line.slice(6).trim()
        if (data === '[DONE]') return
        try {
          const parsed = JSON.parse(data) as {
            choices?: Array<{delta?: {content?: string}}>
          }
          const content = parsed.choices?.[0]?.delta?.content
          if (content) yield content
        } catch {
          // skip malformed JSON chunks
        }
      }
    }
  }
}

/** Send a chat completion request (streaming or not). */
async function chatCompletion(state: ChatState): Promise<string> {
  const body: Record<string, unknown> = {
    model: state.model,
    messages: state.messages,
    temperature: state.temperature,
    stream: state.stream,
  }

  const response = await fetch(`${state.baseUrl}/v1/chat/completions`, {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify(body),
  })

  if (!response.ok) {
    const text = await response.text()
    throw new Error(`API error ${response.status}: ${text.slice(0, 200)}`)
  }

  if (state.stream) {
    let full = ''
    for await (const chunk of parseSSEStream(response)) {
      process.stdout.write(chunk)
      full += chunk
    }
    console.log() // newline after stream
    return full
  }

  // Non-streaming
  const data = await response.json() as {
    choices?: Array<{message?: {content?: string}}>
  }
  const content = data.choices?.[0]?.message?.content ?? ''
  return content
}

/* ── Command ──────────────────────────────────────────────── */

export default class Chat extends BaseCommand {
  static summary = 'Interactive chat with your MyModel instance'
  static description = 'Opens a TUI chat session connected to the running MyModel server.\nSupports streaming, slash commands (/help), and conversation history.'

  static flags = {
    ...BaseCommand.baseFlags,
    port: Flags.integer({char: 'p', default: DEFAULT_PROXY_PORT, description: 'Server port (default: 8000)'}),
    model: Flags.string({char: 'm', description: 'Model name override'}),
    stream: Flags.boolean({default: true, description: 'Enable streaming', allowNo: true}),
    system: Flags.string({char: 's', description: 'System prompt'}),
  }

  static examples = [
    '<%= config.bin %> chat',
    '<%= config.bin %> chat --port 9000',
    '<%= config.bin %> chat --model gpt-4o --no-stream',
    '<%= config.bin %> chat --system "You are a helpful coding assistant"',
  ]

  async run(): Promise<void> {
    const {flags} = await this.parse(Chat)

    // Check that the server is actually running
    const status = containerStatus(DOCKER_CONTAINER_NAME)
    if (status !== 'running') {
      console.log(ERROR(`\n  MyModel server is not running (status: ${status}).`))
      console.log(DIM('  Start it with: mymodel serve start\n'))
      this.exit(1)
    }

    // Resolve model name: flag > default backend model from config > fallback
    // The router indexes models by "provider/model" key (e.g. "regoloai/qwen3.5-122b"),
    // not by the display name ("Francesco"). Sending the wrong name causes the router
    // to skip the access_key lookup → 401. We derive the key from the first/default route.
    let modelName = flags.model
    let displayName = modelName ?? 'MyModel'
    if (!modelName) {
      try {
        const config = this.loadConfigOrExit(flags.config)
        displayName = config.model.name
        // Find the default route (one with no signals) or the first route
        const defaultRoute = config.text_routes.find(r =>
          (r.signals?.keywords ?? []).length === 0 && (r.signals?.domains ?? []).length === 0,
        ) ?? config.text_routes[0]
        if (defaultRoute?.model) {
          modelName = defaultRoute.model
        } else {
          modelName = config.model.name
        }
      } catch {
        modelName = 'MyModel'
      }
    }

    const state: ChatState = {
      messages: [],
      model: modelName,
      stream: flags.stream,
      temperature: 0.7,
      baseUrl: `http://localhost:${flags.port}`,
    }

    if (flags.system) {
      state.messages.push({role: 'system', content: flags.system})
    }

    // ── Print header ──────────────────────────────────────────
    console.log()
    console.log(ACCENT_BOLD('  ╭─────────────────────────────────────╮'))
    console.log(ACCENT_BOLD('  │         MyModel Chat                │'))
    console.log(ACCENT_BOLD('  ╰─────────────────────────────────────╯'))
    console.log()
    console.log(`  ${DIM('Model:')}       ${ACCENT(displayName)}  ${DIM(`(${state.model})`)}`)
    console.log(`  ${DIM('Endpoint:')}    ${state.baseUrl}`)
    console.log(`  ${DIM('Streaming:')}   ${state.stream ? 'ON' : 'OFF'}`)
    console.log(`  ${DIM('Temperature:')} ${state.temperature}`)
    console.log()
    console.log(DIM('  Type /help for commands, /exit to quit.\n'))

    // ── REPL loop ─────────────────────────────────────────────
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      terminal: true,
    })

    const prompt = () => {
      rl.question(ACCENT_BOLD('  you ▸ '), async (input) => {
        const trimmed = input.trim()

        if (!trimmed) {
          prompt()
          return
        }

        // ── Slash command handling ──────────────
        if (trimmed.startsWith('/')) {
          const [cmd, ...rest] = trimmed.split(' ')
          const args = rest.join(' ')
          const handler = SLASH_COMMANDS[cmd.toLowerCase()]
          if (handler) {
            const shouldExit = await handler.handler(state, args, rl)
            if (shouldExit) {
              console.log(DIM('\n  Goodbye!\n'))
              rl.close()
              return
            }
          } else {
            console.log(ERROR(`  Unknown command: ${cmd}`))
            console.log(DIM('  Type /help for available commands.'))
          }
          console.log()
          prompt()
          return
        }

        // ── Send message ───────────────────────
        state.messages.push({role: 'user', content: trimmed})

        try {
          process.stdout.write(`\n  ${BOLD('assistant')} ${DIM('▸')} `)

          const reply = await chatCompletion(state)

          if (!state.stream) {
            // For non-streaming, print the full reply
            console.log(reply)
          }

          state.messages.push({role: 'assistant', content: reply})
        } catch (error) {
          const msg = error instanceof Error ? error.message : String(error)
          console.log(ERROR(`\n  Error: ${msg}`))
          // Remove the failed user message so it can be retried
          state.messages.pop()
        }

        console.log()
        prompt()
      })
    }

    // Handle Ctrl+C gracefully
    rl.on('close', () => {
      console.log(DIM('\n  Goodbye!\n'))
      process.exit(0)
    })

    prompt()

    // Keep the process alive
    await new Promise(() => {})
  }
}
