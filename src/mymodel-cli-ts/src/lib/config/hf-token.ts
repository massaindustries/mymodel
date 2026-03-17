/**
 * HuggingFace token persistence.
 *
 * The vLLM SR container downloads ~8 BERT/classifier models on first startup.
 * Without an HF token, requests are rate-limited and the download can take 5–10
 * minutes. With a token the same download completes in under a minute.
 *
 * The token is NOT required — the server works fine without it, just slower on
 * first run. That's why the prompt defaults to empty (press Enter to skip).
 *
 * Storage: ~/.mymodel/hf_token  (plain text, 0600 permissions)
 */

import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'

const MYMODEL_DIR = path.join(os.homedir(), '.mymodel')
const TOKEN_FILE = path.join(MYMODEL_DIR, 'hf_token')

/** Read a previously saved HF token, or undefined if none. */
export function loadHfToken(): string | undefined {
  try {
    const token = fs.readFileSync(TOKEN_FILE, 'utf8').trim()
    return token || undefined
  } catch {
    return undefined
  }
}

/** Persist an HF token to disk (creates ~/.mymodel/ if needed). */
export function saveHfToken(token: string): void {
  fs.mkdirSync(MYMODEL_DIR, {recursive: true})
  fs.writeFileSync(TOKEN_FILE, token + '\n', {mode: 0o600})
}

/**
 * Resolve the HF token from (in priority order):
 *   1. HF_TOKEN env var
 *   2. Stored ~/.mymodel/hf_token
 *
 * Returns the token string or undefined if not available.
 */
export function resolveHfToken(): string | undefined {
  return process.env.HF_TOKEN || loadHfToken()
}
