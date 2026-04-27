import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Box, Text, useApp, useInput } from 'ink';
import { MessageView } from './MessageView.js';
import { InputBox } from './InputBox.js';
import { ThinkingMenu } from './ThinkingMenu.js';
import { SlashPopup, SLASH_COMMANDS, filterCommands } from './SlashPopup.js';
import { Welcome } from './Welcome.js';
import { useChat } from './useChat.js';
import type { ThinkingMode } from '../client/openai.js';

const accent = '#00d4aa';

export interface AppProps {
  baseUrl: string;
  model: string;
  systemPrompt?: string;
  maxTokens: number;
  initialThinking: ThinkingMode | null;
  initialShowThinking: boolean;
}

export function App(props: AppProps) {
  const { exit } = useApp();
  const chat = useChat(props);

  const [input, setInput] = useState('');
  const [historyIdx, setHistoryIdx] = useState(-1);
  const [menuOpen, setMenuOpen] = useState(false);
  const [slashIdx, setSlashIdx] = useState(0);
  const lastEscRef = useRef(0);

  const slashOpen = input.startsWith('/') && !menuOpen;
  const slashItems = useMemo(() => slashOpen ? filterCommands(input) : [], [slashOpen, input]);

  // Reset selection when filtered list changes
  useEffect(() => {
    if (slashIdx >= slashItems.length) setSlashIdx(0);
  }, [slashItems.length, slashIdx]);

  // Run a command by its name (returns true if handled)
  const runCommand = useCallback((cmd: string): boolean => {
    if (cmd === '/quit' || cmd === '/exit') { setInput(''); exit(); return true; }
    if (cmd === '/reset') { setInput(''); chat.reset(); chat.pushSystemNote('history cleared'); return true; }
    if (cmd === '/thinking') { setInput(''); setMenuOpen(true); return true; }
    if (cmd === '/stream') {
      chat.setStream(!chat.stream);
      chat.pushSystemNote(`stream ${!chat.stream ? 'on' : 'off'}`);
      setInput('');
      return true;
    }
    return false;
  }, [chat, exit]);

  // Slash command handling
  const handleSubmit = useCallback((value: string) => {
    if (!value) return;
    const trimmed = value.trim();
    // If the popup is open and the input does NOT exactly match a known command,
    // treat Enter as autocomplete: replace input with the highlighted command.
    if (slashOpen && slashItems.length > 0) {
      const exact = SLASH_COMMANDS.find((c) => c.name === trimmed || (c.aliases ?? []).includes(trimmed));
      if (!exact) {
        setInput(slashItems[slashIdx].name + ' ');
        return;
      }
      runCommand(exact.name);
      return;
    }
    if (trimmed.startsWith('/')) {
      if (!runCommand(trimmed)) {
        chat.pushSystemNote(`unknown command: ${trimmed}`);
        setInput('');
      }
      return;
    }
    chat.enqueueOrSend(value);
    setInput('');
    setHistoryIdx(-1);
  }, [chat, runCommand, slashOpen, slashItems, slashIdx]);

  // Keyboard handlers (ink useInput cannot run while TextInput's own listener is active —
  // ink-text-input only handles printable + arrows + return, so most special keys still reach us)
  useInput((inputKey, key) => {
    if (menuOpen) return; // menu has its own input
    if (key.escape) {
      // Esc dismisses the slash popup first if it's showing
      if (slashOpen) { setInput(''); return; }
      const now = Date.now();
      if (now - lastEscRef.current < 500) {
        setInput('');
        lastEscRef.current = 0;
      } else {
        lastEscRef.current = now;
        if (chat.busy) chat.interrupt();
      }
      return;
    }
    if (key.ctrl && inputKey === 't') {
      chat.setShowThinking(!chat.showThinking);
      chat.pushSystemNote(`thinking visibility ${!chat.showThinking ? 'on' : 'off'}`);
      return;
    }
    if (key.ctrl && inputKey === 'c') {
      if (chat.busy) chat.interrupt();
      else exit();
      return;
    }
    // Slash popup navigation takes priority over history navigation
    if (slashOpen && slashItems.length > 0) {
      if (key.upArrow) { setSlashIdx((i) => Math.max(0, i - 1)); return; }
      if (key.downArrow) { setSlashIdx((i) => Math.min(slashItems.length - 1, i + 1)); return; }
      if (key.tab) { setInput(slashItems[slashIdx].name + ' '); return; }
    }
    if (key.upArrow && !chat.busy) {
      const list = chat.history;
      if (list.length === 0) return;
      const next = historyIdx < 0 ? list.length - 1 : Math.max(0, historyIdx - 1);
      setHistoryIdx(next);
      setInput(list[next] ?? '');
      return;
    }
    if (key.downArrow && !chat.busy) {
      const list = chat.history;
      if (list.length === 0) return;
      if (historyIdx < 0) return;
      const next = historyIdx + 1;
      if (next >= list.length) { setHistoryIdx(-1); setInput(''); }
      else { setHistoryIdx(next); setInput(list[next]); }
      return;
    }
  });

  const hint = `Enter send · ↑/↓ history · Ctrl+T toggle thinking · Esc interrupt · Esc Esc clear input · /quit /reset /thinking /stream`;

  const userHasSpoken = chat.messages.some((m) => m.role === 'user');

  return (
    <Box flexDirection="column">
      <Box>
        <Text color={accent} bold>mymodel</Text>
        <Text>  · </Text>
        <Text>{props.baseUrl}</Text>
        <Text>  · model={props.model}</Text>
        <Text>  · stream={chat.stream ? 'on' : 'off'}</Text>
        <Text>  · thinking={chat.thinking ?? 'router-default'}</Text>
        {chat.busy && <Text color="yellow">  · streaming…</Text>}
      </Box>

      {!userHasSpoken && (
        <Welcome
          baseUrl={props.baseUrl}
          model={props.model}
          thinking={chat.thinking}
          stream={chat.stream}
          showThinking={chat.showThinking}
        />
      )}

      {chat.messages.map((m) => (
        <MessageView key={m.id} msg={m} showThinking={chat.showThinking} />
      ))}

      {menuOpen ? (
        <ThinkingMenu
          showThinking={chat.showThinking}
          mode={chat.thinking}
          onPick={(next) => {
            if (next.showThinking !== undefined) chat.setShowThinking(next.showThinking);
            if (next.mode !== undefined) chat.setThinking(next.mode);
            chat.pushSystemNote(
              [
                next.showThinking !== undefined ? `thinking visibility=${next.showThinking ? 'on' : 'off'}` : '',
                next.mode !== undefined ? `thinking mode=${next.mode ?? 'router-default'}` : '',
              ].filter(Boolean).join(' · ') || 'no change'
            );
          }}
          onClose={() => setMenuOpen(false)}
        />
      ) : (
        <>
          {slashOpen && <SlashPopup items={slashItems} selected={slashIdx} />}
          <InputBox
            value={input}
            onChange={setInput}
            onSubmit={handleSubmit}
            busy={chat.busy}
            queueLen={chat.queue.length}
            hint={hint}
          />
        </>
      )}
    </Box>
  );
}
