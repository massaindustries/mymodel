import { Command, Flags } from '@oclif/core';
import React from 'react';
import { render } from 'ink';
import { loadConfig } from '../lib/config/load.js';
import type { ThinkingMode } from '../lib/client/openai.js';
import { App } from '../lib/chat-tui/App.js';

export default class Chat extends Command {
  static description = 'Interactive chat (ink TUI: bottom input + scrolling history, Claude Code style)';
  static flags = {
    model: Flags.string({ default: 'brick', description: 'virtual model name' }),
    system: Flags.string({ description: 'system prompt' }),
    'show-thinking': Flags.boolean({ default: false, description: 'show reasoning content from the start' }),
    'max-tokens': Flags.integer({ default: 4096, description: 'max tokens for response' }),
    thinking: Flags.string({ options: ['off', 'low', 'medium', 'high', 'auto'], description: 'force brick-thinking mode (off|low|medium|high|auto)' }),
  };
  async run(): Promise<void> {
    const { flags } = await this.parse(Chat);
    const cfg = await loadConfig();
    const baseUrl = `http://localhost:${cfg.server_port}`;
    const initialThinking = (flags.thinking as ThinkingMode | undefined) ?? null;

    if (!process.stdin.isTTY) {
      this.error('mymodel chat requires an interactive TTY. Use `mymodel generate "<prompt>"` for non-interactive use.', { exit: 2 });
    }
    const { waitUntilExit } = render(
      React.createElement(App, {
        baseUrl,
        model: flags.model,
        systemPrompt: flags.system,
        maxTokens: flags['max-tokens'],
        initialThinking,
        initialShowThinking: flags['show-thinking'],
      })
    );
    await waitUntilExit();
  }
}
