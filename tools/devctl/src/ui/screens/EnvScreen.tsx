import { Box, Text, useInput } from 'ink';
import TextInput from 'ink-text-input';
import { useState } from 'react';
import type { EnvFile, EnvVarEntry, ProjectEnv } from '../../discovery/types.js';
import { maskValue } from '../../env/mask.js';
import { updateEnvValue } from '../../env/writer.js';
import { padEnd } from '../format.js';

interface EnvScreenProps {
  projectEnvs: ProjectEnv[];
  isActive: boolean;
  onEditingChange: (editing: boolean) => void;
  refreshEnv: () => Promise<void>;
}

interface EnvRow {
  file: EnvFile;
  entry: EnvVarEntry;
}

type Mode = 'projects' | 'keys' | 'editing';

export function EnvScreen({
  projectEnvs,
  isActive,
  onEditingChange,
  refreshEnv,
}: EnvScreenProps) {
  const [mode, setMode] = useState<Mode>('projects');
  const [projectIndex, setProjectIndex] = useState(0);
  const [rowIndex, setRowIndex] = useState(0);
  const [revealed, setRevealed] = useState<Set<string>>(new Set());
  const [editValue, setEditValue] = useState('');
  const [status, setStatus] = useState<string | null>(null);

  const project = projectEnvs[Math.min(projectIndex, Math.max(0, projectEnvs.length - 1))];
  const rows: EnvRow[] = project
    ? project.files.flatMap((file) => file.vars.map((entry) => ({ file, entry })))
    : [];
  const row = rows[Math.min(rowIndex, Math.max(0, rows.length - 1))];

  useInput(
    (input, key) => {
      if (mode === 'editing') return; // handled by TextInput's onSubmit/escape below

      if (mode === 'projects') {
        if (key.upArrow) setProjectIndex((i) => Math.max(0, i - 1));
        else if (key.downArrow)
          setProjectIndex((i) => Math.min(projectEnvs.length - 1, i + 1));
        else if (key.return && project) {
          setMode('keys');
          setRowIndex(0);
          setStatus(null);
        }
        return;
      }

      // mode === 'keys'
      if (key.escape) {
        setMode('projects');
        setStatus(null);
      } else if (key.upArrow) {
        setRowIndex((i) => Math.max(0, i - 1));
      } else if (key.downArrow) {
        setRowIndex((i) => Math.min(rows.length - 1, i + 1));
      } else if (input === 'v' && row) {
        setRevealed((prev) => {
          const next = new Set(prev);
          const id = `${row.file.path}:${row.entry.key}`;
          if (next.has(id)) next.delete(id);
          else next.add(id);
          return next;
        });
      } else if (key.return && row) {
        setEditValue(row.entry.value);
        setMode('editing');
        onEditingChange(true);
        setStatus(null);
      }
    },
    { isActive: isActive && mode !== 'editing' }
  );

  function cancelEdit() {
    setMode('keys');
    onEditingChange(false);
  }

  // ink-text-input doesn't expose an onCancel, so escape is caught separately here.
  useInput(
    (_input, key) => {
      if (key.escape) cancelEdit();
    },
    { isActive: isActive && mode === 'editing' }
  );

  async function submitEdit(value: string) {
    if (!row) return;
    try {
      updateEnvValue(row.file.path, row.entry.key, value);
      await refreshEnv();
      setStatus(`Saved ${row.entry.key} to ${row.file.relativePath}`);
    } catch (err) {
      setStatus(`Failed to save: ${(err as Error).message}`);
    }
    setMode('keys');
    onEditingChange(false);
  }

  if (mode === 'projects' || !project) {
    return (
      <Box flexDirection="column">
        <Text bold>Env</Text>
        <Box marginTop={1} flexDirection="column">
          {projectEnvs.length === 0 && <Text dimColor>No .env files discovered.</Text>}
          {projectEnvs.map((pe, index) => (
            <Text key={pe.project} color={index === projectIndex ? 'cyan' : undefined}>
              {index === projectIndex ? '> ' : '  '}
              {pe.project} ({pe.files.length} file{pe.files.length === 1 ? '' : 's'})
            </Text>
          ))}
        </Box>
        <Box marginTop={1}>
          <Text dimColor>↑/↓ select · enter open</Text>
        </Box>
      </Box>
    );
  }

  return (
    <Box flexDirection="column">
      <Text bold>Env — {project.project}</Text>
      <Box marginTop={1}>
        <Text dimColor>
          {padEnd('FILE', 32)}
          {padEnd('KEY', 28)}
          VALUE
        </Text>
      </Box>
      {rows.map((r, index) => {
        const isSelected = index === rowIndex;
        const id = `${r.file.path}:${r.entry.key}`;
        const isRevealed = revealed.has(id);
        const isEditingThis = isSelected && mode === 'editing';
        return (
          <Box key={id}>
            <Text color={isSelected ? 'cyan' : undefined}>
              {isSelected ? '> ' : '  '}
              {padEnd(r.file.relativePath, 32)}
              {padEnd(r.entry.key, 28)}
            </Text>
            {isEditingThis ? (
              <TextInput
                value={editValue}
                onChange={setEditValue}
                onSubmit={submitEdit}
              />
            ) : (
              <Text>{isRevealed ? r.entry.value : maskValue(r.entry.value)}</Text>
            )}
          </Box>
        );
      })}

      {status && (
        <Box marginTop={1}>
          <Text color="green">{status}</Text>
        </Box>
      )}

      <Box marginTop={1}>
        <Text dimColor>
          {mode === 'editing'
            ? 'enter save · esc cancel'
            : 'esc back · ↑/↓ select · v reveal · enter edit'}
        </Text>
      </Box>
    </Box>
  );
}
