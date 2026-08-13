import { Box, Text } from 'ink';
import type { ServiceState } from '../../process/manager.js';
import type { Screen } from '../App.js';

const SCREEN_LABELS: Record<Screen, string> = {
  services: '1 Services',
  env: '2 Env',
  'shared-env': '3 Shared Env',
  logs: '4 Logs',
};

interface StatusBarProps {
  screen: Screen;
  services: ServiceState[];
  hint: string;
}

export function StatusBar({ screen, services, hint }: StatusBarProps) {
  const running = services.filter((s) => s.status === 'running').length;

  return (
    <Box flexDirection="column" borderStyle="single" borderColor="gray" paddingX={1}>
      <Box justifyContent="space-between">
        <Box gap={2}>
          {(Object.keys(SCREEN_LABELS) as Screen[]).map((key) => (
            <Text key={key} color={key === screen ? 'cyan' : 'gray'} bold={key === screen}>
              {SCREEN_LABELS[key]}
            </Text>
          ))}
        </Box>
        <Text color="green">
          {running}/{services.length} running
        </Text>
      </Box>
      <Text dimColor>{hint}</Text>
    </Box>
  );
}
