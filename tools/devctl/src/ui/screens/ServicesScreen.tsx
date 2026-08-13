import { Box, Text, useInput } from 'ink';
import { useState } from 'react';
import type { DiscoveredProject, Warning } from '../../discovery/types.js';
import type { ProcessManager, ServiceState } from '../../process/manager.js';
import { formatUptime, padEnd, statusColor } from '../format.js';
import { ConfirmBar } from '../components/ConfirmBar.js';

interface ServicesScreenProps {
  services: ServiceState[];
  nonRunnable: DiscoveredProject[];
  warnings: Warning[];
  manager: ProcessManager;
  isActive: boolean;
  onOpenLogs: (project: string) => void;
}

export function ServicesScreen({
  services,
  nonRunnable,
  warnings,
  manager,
  isActive,
  onOpenLogs,
}: ServicesScreenProps) {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [confirmKill, setConfirmKill] = useState<string | null>(null);

  const clampedIndex = Math.min(selectedIndex, Math.max(0, services.length - 1));
  const selected = services[clampedIndex];

  useInput(
    (input, key) => {
      if (confirmKill) {
        if (input === 'y') {
          manager.stop(confirmKill).catch(() => undefined);
          setConfirmKill(null);
        } else if (input === 'n' || key.escape) {
          setConfirmKill(null);
        }
        return;
      }

      if (key.upArrow) {
        setSelectedIndex((i) => Math.max(0, i - 1));
      } else if (key.downArrow) {
        setSelectedIndex((i) => Math.min(services.length - 1, i + 1));
      } else if (key.return && selected) {
        onOpenLogs(selected.project);
      } else if (input === 's' && selected) {
        manager.start(selected.project).catch(() => undefined);
      } else if (input === 'k' && selected && selected.status !== 'stopped') {
        setConfirmKill(selected.project);
      } else if (input === 'r' && selected) {
        manager.restart(selected.project).catch(() => undefined);
      }
    },
    { isActive }
  );

  return (
    <Box flexDirection="column">
      <Text bold>Services</Text>
      <Box marginTop={1}>
        <Text dimColor>
          {padEnd('NAME', 24)}
          {padEnd('STATUS', 10)}
          {padEnd('PORT', 8)}
          {padEnd('PID', 8)}
          {padEnd('UPTIME', 8)}
        </Text>
      </Box>
      {services.length === 0 && <Text dimColor>No runnable services discovered.</Text>}
      {services.map((service, index) => {
        const isSelected = index === clampedIndex;
        return (
          <Text key={service.project} color={isSelected ? 'cyan' : undefined}>
            {isSelected ? '> ' : '  '}
            {padEnd(service.project, 22)}
            <Text color={statusColor(service.status)}>{padEnd(service.status, 10)}</Text>
            {padEnd(service.port !== null ? String(service.port) : 'unknown', 8)}
            {padEnd(service.pid !== null ? String(service.pid) : '-', 8)}
            {padEnd(formatUptime(service.startedAt), 8)}
          </Text>
        );
      })}

      {selected?.lastError && (
        <Box marginTop={1}>
          <Text color="red">Error: {selected.lastError}</Text>
        </Box>
      )}

      {confirmKill && (
        <Box marginTop={1}>
          <ConfirmBar message={`Kill "${confirmKill}"?`} />
        </Box>
      )}

      {(nonRunnable.length > 0 || warnings.length > 0) && (
        <Box marginTop={1} flexDirection="column">
          {nonRunnable.length > 0 && (
            <Text dimColor>
              Not runnable: {nonRunnable.map((p) => p.name).join(', ')}
            </Text>
          )}
          {warnings.map((warning) => (
            <Text key={`${warning.scope}-${warning.message}`} color="yellow">
              Warning ({warning.scope}): {warning.message}
            </Text>
          ))}
        </Box>
      )}

      <Box marginTop={1}>
        <Text dimColor>
          ↑/↓ select · s start · k kill · r restart · enter view logs
        </Text>
      </Box>
    </Box>
  );
}
