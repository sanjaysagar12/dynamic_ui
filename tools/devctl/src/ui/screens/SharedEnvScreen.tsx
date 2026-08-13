import { Box, Text, useInput } from 'ink';
import TextInput from 'ink-text-input';
import { useEffect, useState } from 'react';
import { maskValue } from '../../env/mask.js';
import { bulkUpdateEnvValue, updateEnvValue } from '../../env/writer.js';
import type { SharedKeyEntry, SharedKeyOccurrence } from '../../env/shared-keys.js';
import type { ProjectEnv } from '../../discovery/types.js';
import { padEnd } from '../format.js';
import { ConfirmBar } from '../components/ConfirmBar.js';

interface SharedEnvScreenProps {
  sharedKeys: SharedKeyEntry[];
  projectEnvs: ProjectEnv[];
  isActive: boolean;
  onEditingChange: (editing: boolean) => void;
  refreshEnv: () => Promise<void>;
}

type Mode = 'list' | 'editing' | 'confirming';
type Focus = 'keys' | 'occurrences';
type EditScope = 'all' | 'single';

export function SharedEnvScreen({
  sharedKeys,
  projectEnvs,
  isActive,
  onEditingChange,
  refreshEnv,
}: SharedEnvScreenProps) {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [occurrenceIndex, setOccurrenceIndex] = useState(0);
  const [focus, setFocus] = useState<Focus>('keys');
  const [revealed, setRevealed] = useState(false);
  const [mode, setMode] = useState<Mode>('list');
  const [editScope, setEditScope] = useState<EditScope>('all');
  const [newValue, setNewValue] = useState('');
  const [status, setStatus] = useState<string | null>(null);

  const entry = sharedKeys[Math.min(selectedIndex, Math.max(0, sharedKeys.length - 1))];
  const occurrence = entry
    ? entry.occurrences[Math.min(occurrenceIndex, Math.max(0, entry.occurrences.length - 1))]
    : undefined;

  useEffect(() => {
    setOccurrenceIndex(0);
    setFocus('keys');
  }, [entry?.key]);

  function resolveFilePath(o: SharedKeyOccurrence): string | undefined {
    const pe = projectEnvs.find((p) => p.project === o.project);
    return pe?.files.find((f) => f.relativePath === o.file)?.path;
  }

  const allFilePaths = entry
    ? entry.occurrences.map(resolveFilePath).filter((p): p is string => Boolean(p))
    : [];
  const singleFilePath = occurrence ? resolveFilePath(occurrence) : undefined;

  useInput(
    (input, key) => {
      if (mode !== 'list') return;

      if (focus === 'keys') {
        if (key.upArrow) {
          setSelectedIndex((i) => Math.max(0, i - 1));
          setRevealed(false);
        } else if (key.downArrow) {
          setSelectedIndex((i) => Math.min(sharedKeys.length - 1, i + 1));
          setRevealed(false);
        } else if ((key.rightArrow || key.return) && entry && entry.occurrences.length > 0) {
          setFocus('occurrences');
        } else if (input === 'v') {
          setRevealed((r) => !r);
        } else if (input === 'e' && entry) {
          setNewValue(entry.occurrences[0]?.value ?? '');
          setEditScope('all');
          setMode('editing');
          onEditingChange(true);
          setStatus(null);
        }
        return;
      }

      // focus === 'occurrences'
      if (key.leftArrow || key.escape) {
        setFocus('keys');
      } else if (key.upArrow) {
        setOccurrenceIndex((i) => Math.max(0, i - 1));
      } else if (key.downArrow) {
        setOccurrenceIndex((i) => Math.min((entry?.occurrences.length ?? 1) - 1, i + 1));
      } else if (input === 'v') {
        setRevealed((r) => !r);
      } else if (input === 'e' && occurrence) {
        setNewValue(occurrence.value);
        setEditScope('single');
        setMode('editing');
        onEditingChange(true);
        setStatus(null);
      }
    },
    { isActive: isActive && mode === 'list' }
  );

  useInput(
    (_input, key) => {
      if (key.escape) {
        setMode('list');
        onEditingChange(false);
      }
    },
    { isActive: isActive && mode === 'editing' }
  );

  useInput(
    (input) => {
      if (input === 'y' && entry) {
        try {
          if (editScope === 'all') {
            bulkUpdateEnvValue(allFilePaths, entry.key, newValue);
            setStatus(`Updated ${entry.key} in ${allFilePaths.length} file(s)`);
          } else if (occurrence && singleFilePath) {
            updateEnvValue(singleFilePath, entry.key, newValue);
            setStatus(`Updated ${entry.key} for ${occurrence.project}`);
          }
        } catch (err) {
          setStatus(`Failed to update: ${(err as Error).message}`);
        }
        refreshEnv();
        setMode('list');
        onEditingChange(false);
      } else if (input === 'n') {
        setMode('list');
        onEditingChange(false);
      }
    },
    { isActive: isActive && mode === 'confirming' }
  );

  function submitNewValue(value: string) {
    setNewValue(value);
    setMode('confirming');
  }

  return (
    <Box flexDirection="column">
      <Text bold>Shared Env Keys</Text>
      <Box marginTop={1}>
        <Text dimColor>
          {padEnd('KEY', 24)}
          {padEnd('PROJECTS', 10)}
          MATCH
        </Text>
      </Box>
      {sharedKeys.length === 0 && (
        <Text dimColor>No env keys are duplicated across services.</Text>
      )}
      {sharedKeys.map((s, index) => (
        <Text key={s.key} color={focus === 'keys' && index === selectedIndex ? 'cyan' : undefined}>
          {focus === 'keys' && index === selectedIndex ? '> ' : '  '}
          {padEnd(s.key, 22)}
          {padEnd(String(s.occurrences.length), 10)}
          <Text color={s.valuesMatch ? 'green' : 'yellow'}>
            {s.valuesMatch ? 'match' : 'DIFFERS'}
          </Text>
        </Text>
      ))}

      {entry && (
        <Box marginTop={1} flexDirection="column">
          <Text bold>{entry.key}</Text>
          {entry.occurrences.map((o, index) => {
            const isSelected = focus === 'occurrences' && index === occurrenceIndex;
            return (
              <Text key={`${o.project}-${o.file}`} color={isSelected ? 'cyan' : undefined}>
                {isSelected ? '> ' : '  '}
                {padEnd(o.project, 24)}
                {padEnd(o.file, 34)}
                {revealed ? o.value : maskValue(o.value)}
              </Text>
            );
          })}
        </Box>
      )}

      {mode === 'editing' && entry && (
        <Box marginTop={1}>
          <Text>
            New value for {entry.key}
            {editScope === 'single' && occurrence ? ` (${occurrence.project} only)` : ` (all ${allFilePaths.length} services)`}:{' '}
          </Text>
          <TextInput value={newValue} onChange={setNewValue} onSubmit={submitNewValue} />
        </Box>
      )}

      {mode === 'confirming' && entry && (
        <Box marginTop={1}>
          <ConfirmBar
            message={
              editScope === 'all'
                ? `Write "${maskValue(newValue)}" to ${allFilePaths.length} file(s) for ${entry.key}?`
                : `Write "${maskValue(newValue)}" to ${occurrence?.project}'s ${entry.key}?`
            }
          />
        </Box>
      )}

      {status && (
        <Box marginTop={1}>
          <Text color="green">{status}</Text>
        </Box>
      )}

      <Box marginTop={1}>
        <Text dimColor>
          {mode === 'list'
            ? focus === 'keys'
              ? '↑/↓ select key · → occurrences · v reveal · e edit all'
              : '↑/↓ select project · ← back · v reveal · e edit this project only'
            : mode === 'editing'
              ? 'enter continue · esc cancel'
              : 'y confirm · n cancel'}
        </Text>
      </Box>
    </Box>
  );
}
