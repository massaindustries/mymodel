import React from 'react';
import { Box, Text } from 'ink';
import type { ThinkingMode } from '../client/openai.js';
import { REGOLO_WORDMARK } from './mascot.js';

const accent = '#00d4aa';
const regoloGreen = '#5ee6a1';

export function Welcome(props: {
  baseUrl: string;
  model: string;
  thinking: ThinkingMode | null;
  stream: boolean;
  showThinking: boolean;
}) {
  return (
    <Box flexDirection="column" borderStyle="round" borderColor={accent} paddingX={2} paddingY={1} marginTop={1} marginBottom={0}>
      <Box>
        <Text color={accent} bold>✻ Welcome to mymodel</Text>
      </Box>

      <Box marginTop={1}>
        <Text dimColor>self-hosted semantic router · Brick gateway, powered by</Text>
      </Box>
      <Box flexDirection="column" marginTop={1}>
        {REGOLO_WORDMARK.map((line, i) => (
          <Text key={i} color={regoloGreen}>{line}</Text>
        ))}
      </Box>

      <Box marginTop={1} flexDirection="column">
        <Box>
          <Text dimColor>endpoint  </Text>
          <Text>{props.baseUrl}</Text>
        </Box>
        <Box>
          <Text dimColor>model     </Text>
          <Text>{props.model}</Text>
        </Box>
        <Box>
          <Text dimColor>thinking  </Text>
          <Text>{props.thinking ?? 'router-default'}</Text>
          <Text dimColor>  · visibility </Text>
          <Text>{props.showThinking ? 'show' : 'hidden'}</Text>
        </Box>
        <Box>
          <Text dimColor>stream    </Text>
          <Text>{props.stream ? 'on' : 'off'}</Text>
        </Box>
      </Box>

      <Box marginTop={1} flexDirection="column">
        <Text color={accent}>tips</Text>
        <Text dimColor>· type <Text color={accent}>/</Text> to see available commands (/thinking /stream /reset /quit)</Text>
        <Text dimColor>· ↑/↓ navigate prompt history</Text>
        <Text dimColor>· <Text color={accent}>Ctrl+T</Text> toggle reasoning visibility · <Text color={accent}>Esc</Text> interrupt stream · <Text color={accent}>Esc Esc</Text> clear input</Text>
        <Text dimColor>· keep typing while a response streams: messages queue up</Text>
      </Box>
    </Box>
  );
}
