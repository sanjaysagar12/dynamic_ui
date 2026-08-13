import { Box, Text, useInput, useStdout } from 'ink';
import TextInput from 'ink-text-input';
import { useEffect, useState } from 'react';
import type { ProcessManager } from '../../process/manager.js';
import { statusColor } from '../format.js';

interface LogsScreenProps {
  manager: ProcessManager;
  projectNames: string[];
  isActive: boolean;
  initialProject: string | null;
}

export function LogsScreen({
  manager,
  projectNames,
  isActive,
  initialProject,
}: LogsScreenProps) {
  const { stdout } = useStdout();
  const [selectedIndex, setSelectedIndex] = useState(() => {
    const idx = initialProject ? projectNames.indexOf(initialProject) : -1;
    return idx >= 0 ? idx : 0;
  });
  const [, forceRerender] = useState(0);
  const [searchMode, setSearchMode] = useState(false);
  const [query, setQuery] = useState('');
  const [scrollOffset, setScrollOffset] = useState(0);

  const selectedProject = projectNames[selectedIndex] ?? null;

  useEffect(() => {
    if (!selectedProject) return undefined;
    const buffer = manager.getLogBuffer(selectedProject);
    if (!buffer) return undefined;
    return buffer.onLine(() => forceRerender((t) => t + 1));
  }, [manager, selectedProject]);

  useEffect(() => {
    setScrollOffset(0);
  }, [selectedProject]);

  useInput(
    (input, key) => {
      if (searchMode) {
        if (key.escape) {
          setSearchMode(false);
        } else if (key.return) {
          setSearchMode(false);
        }
        return;
      }

      if (key.leftArrow) {
        setSelectedIndex((i) => Math.max(0, i - 1));
      } else if (key.rightArrow) {
        setSelectedIndex((i) => Math.min(projectNames.length - 1, i + 1));
      } else if (key.upArrow) {
        setScrollOffset((o) => o + 1);
      } else if (key.downArrow) {
        setScrollOffset((o) => Math.max(0, o - 1));
      } else if (input === '/') {
        setSearchMode(true);
      } else if (input === 'c' && query) {
        setQuery('');
      }
    },
    { isActive }
  );

  const buffer = selectedProject ? manager.getLogBuffer(selectedProject) : undefined;
  const allLines = buffer?.getLines() ?? [];
  const filtered = query
    ? allLines.filter((l) => l.text.toLowerCase().includes(query.toLowerCase()))
    : allLines;

  const viewportHeight = Math.max(5, (stdout?.rows ?? 24) - 12);
  const maxOffset = Math.max(0, filtered.length - viewportHeight);
  const clampedOffset = Math.min(scrollOffset, maxOffset);
  const start = Math.max(0, filtered.length - viewportHeight - clampedOffset);
  const visible = filtered.slice(start, start + viewportHeight);

  return (
    <Box flexDirection="column">
      <Text bold>Logs</Text>
      <Box marginTop={1} gap={2}>
        {projectNames.map((name, index) => {
          const state = manager.getState(name);
          return (
            <Text
              key={name}
              color={index === selectedIndex ? 'cyan' : statusColor(state?.status ?? 'stopped')}
              bold={index === selectedIndex}
            >
              {index === selectedIndex ? `[${name}]` : name}
            </Text>
          );
        })}
        {projectNames.length === 0 && <Text dimColor>No services registered.</Text>}
      </Box>

      <Box
        marginTop={1}
        flexDirection="column"
        borderStyle="round"
        borderColor="gray"
        height={viewportHeight + 2}
      >
        {visible.length === 0 && <Text dimColor>No log output yet.</Text>}
        {visible.map((line, i) => (
          <Text
            key={`${start + i}-${line.timestamp}`}
            color={line.stream === 'stderr' ? 'red' : line.stream === 'system' ? 'yellow' : undefined}
          >
            {line.text}
          </Text>
        ))}
      </Box>

      <Box marginTop={1}>
        {searchMode ? (
          <Box>
            <Text>Search: </Text>
            <TextInput value={query} onChange={setQuery} onSubmit={() => setSearchMode(false)} />
          </Box>
        ) : (
          <Text dimColor>
            ←/→ switch service · ↑/↓ scroll · / search{query ? ` ("${query}", c to clear)` : ''} ·{' '}
            showing {visible.length}/{filtered.length} lines
          </Text>
        )}
      </Box>
    </Box>
  );
}
