import { readFile } from 'node:fs/promises';
import { paths } from '../config/paths.js';

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface ChatResult {
  content: string;
  reasoning?: string;
  selectedModel?: string;
  thinkingApplied?: string;
  raw: any;
  status: number;
  latencyMs: number;
}

let cachedKey: string | null = null;

async function readApiKey(): Promise<string> {
  if (cachedKey) return cachedKey;
  try {
    const env = await readFile(paths.env, 'utf8');
    const m = env.match(/REGOLO_API_KEY=([^\s]+)/);
    if (m) {
      cachedKey = m[1];
      return cachedKey;
    }
  } catch {}
  cachedKey = process.env.REGOLO_API_KEY ?? process.env.OPENAI_API_KEY ?? '';
  return cachedKey;
}

export interface StreamChunk {
  type: 'reasoning' | 'content' | 'done' | 'meta' | 'error';
  text?: string;
  selectedModel?: string;
  thinkingApplied?: string;
  finishReason?: string;
  usage?: any;
  status?: number;
  error?: string;
}

export type ThinkingMode = 'off' | 'low' | 'medium' | 'high' | 'auto';

export async function* chatCompletionStream(opts: {
  baseUrl?: string;
  model?: string;
  messages: ChatMessage[];
  apiKey?: string;
  maxTokens?: number;
  timeoutMs?: number;
  thinking?: ThinkingMode | null;
}): AsyncGenerator<StreamChunk, void, unknown> {
  const baseUrl = opts.baseUrl ?? `http://localhost:8000`;
  const key = opts.apiKey ?? (await readApiKey());
  const ctrl = new AbortController();
  const timeout = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? 120000);
  try {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Accept: 'text/event-stream',
      Authorization: `Bearer ${key}`,
    };
    if (opts.thinking) headers['X-Brick-Thinking'] = opts.thinking;
    const res = await fetch(`${baseUrl}/v1/chat/completions`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model: opts.model ?? 'brick',
        messages: opts.messages,
        max_tokens: opts.maxTokens ?? 4096,
        stream: true,
      }),
      signal: ctrl.signal,
    });
    const selectedModel =
      res.headers.get('x-vsr-selected-model') ??
      res.headers.get('x-selected-model') ??
      res.headers.get('x-litellm-model-group') ??
      undefined;
    const thinkingApplied = res.headers.get('x-brick-thinking-mode') ?? undefined;
    yield { type: 'meta', selectedModel, status: res.status, thinkingApplied };
    if (!res.ok || !res.body) {
      const errText = await res.text().catch(() => '');
      yield { type: 'error', error: errText.slice(0, 400), status: res.status };
      return;
    }
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = '';
    let finishReason: string | undefined;
    let usage: any | undefined;
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const lines = buf.split('\n');
      buf = lines.pop() ?? '';
      for (const lineRaw of lines) {
        const line = lineRaw.trim();
        if (!line) continue;
        if (!line.startsWith('data:')) continue;
        const payload = line.slice(5).trim();
        if (payload === '[DONE]') continue;
        try {
          const evt: any = JSON.parse(payload);
          const delta = evt?.choices?.[0]?.delta ?? {};
          const fr = evt?.choices?.[0]?.finish_reason;
          if (fr) finishReason = fr;
          if (evt?.usage) usage = evt.usage;
          if (delta.reasoning_content) yield { type: 'reasoning', text: delta.reasoning_content };
          if (delta.content) yield { type: 'content', text: delta.content };
        } catch {
          // ignore parse errors mid-stream
        }
      }
    }
    yield { type: 'done', finishReason, usage };
  } finally {
    clearTimeout(timeout);
  }
}

export async function chatCompletion(opts: {
  baseUrl?: string;
  model?: string;
  messages: ChatMessage[];
  apiKey?: string;
  stream?: boolean;
  maxTokens?: number;
  timeoutMs?: number;
  thinking?: ThinkingMode | null;
}): Promise<ChatResult> {
  const baseUrl = opts.baseUrl ?? `http://localhost:8000`;
  const key = opts.apiKey ?? (await readApiKey());
  const ctrl = new AbortController();
  const timeout = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? 60000);
  const t0 = performance.now();
  try {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${key}`,
    };
    if (opts.thinking) headers['X-Brick-Thinking'] = opts.thinking;
    const res = await fetch(`${baseUrl}/v1/chat/completions`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model: opts.model ?? 'brick',
        messages: opts.messages,
        max_tokens: opts.maxTokens ?? 512,
        stream: false,
      }),
      signal: ctrl.signal,
    });
    const selectedModel =
      res.headers.get('x-vsr-selected-model') ??
      res.headers.get('x-selected-model') ??
      res.headers.get('x-litellm-model-group') ??
      undefined;
    const thinkingApplied = res.headers.get('x-brick-thinking-mode') ?? undefined;
    const status = res.status;
    const json: any = await res.json().catch(() => ({}));
    const msg = json?.choices?.[0]?.message ?? {};
    const reasoning: string | undefined = msg.reasoning_content || msg.thinking || undefined;
    const content: string = msg.content ?? json?.error?.message ?? '';
    const latencyMs = Math.round(performance.now() - t0);
    return { content, reasoning, selectedModel, thinkingApplied, raw: json, status, latencyMs };
  } finally {
    clearTimeout(timeout);
  }
}
