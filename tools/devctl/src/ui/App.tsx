import { Box, Text, useInput } from 'ink';
import { useEffect, useMemo, useRef, useState } from 'react';
import { discoverProjects } from '../discovery/projects.js';
import { discoverEnvFiles } from '../discovery/env-files.js';
import { detectPort } from '../discovery/ports.js';
import type { DiscoveredProject, ProjectEnv, Warning } from '../discovery/types.js';
import { computeSharedKeys } from '../env/shared-keys.js';
import type { ProcessManager } from '../process/manager.js';
import { StatusBar } from './components/StatusBar.js';
import { ServicesScreen } from './screens/ServicesScreen.js';
import { LogsScreen } from './screens/LogsScreen.js';
import { EnvScreen } from './screens/EnvScreen.js';
import { SharedEnvScreen } from './screens/SharedEnvScreen.js';

export type Screen = 'services' | 'env' | 'shared-env' | 'logs';

interface AppProps {
  workspaceRoot: string;
  manager: ProcessManager;
  onQuit: () => Promise<void>;
}

const SELF_PROJECT = 'devctl';

export function App({ workspaceRoot, manager, onQuit }: AppProps) {
  const [loading, setLoading] = useState(true);
  const [fatalError, setFatalError] = useState<string | null>(null);
  const [projects, setProjects] = useState<DiscoveredProject[]>([]);
  const [projectEnvs, setProjectEnvs] = useState<ProjectEnv[]>([]);
  const [warnings, setWarnings] = useState<Warning[]>([]);
  const [screen, setScreen] = useState<Screen>('services');
  const [inputLocked, setInputLocked] = useState(false);
  const [logsInitialProject, setLogsInitialProject] = useState<string | null>(null);
  const [quitting, setQuitting] = useState(false);
  const [tick, forceRerender] = useState(0);
  const registered = useRef(false);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const { projects: discovered, warnings: projectWarnings } =
          await discoverProjects(workspaceRoot);
        const { projectEnvs: envs, warnings: envWarnings } = discoverEnvFiles(
          workspaceRoot,
          discovered
        );
        if (cancelled) return;

        setProjects(discovered);
        setProjectEnvs(envs);
        setWarnings([...projectWarnings, ...envWarnings]);

        if (!registered.current) {
          registered.current = true;
          for (const project of discovered) {
            if (project.name === SELF_PROJECT || !project.runTarget) continue;
            const env = envs.find((pe) => pe.project === project.name);
            const { port } = detectPort(project, env);
            manager.register(project.name, project.runTarget, port);
          }
        }

        setLoading(false);
      } catch (err) {
        if (!cancelled) {
          setFatalError((err as Error).message);
          setLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const handler = () => forceRerender((t) => t + 1);
    manager.on('change', handler);
    return () => {
      manager.off('change', handler);
    };
  }, [manager]);

  useEffect(() => {
    const interval = setInterval(() => forceRerender((t) => t + 1), 1000);
    return () => clearInterval(interval);
  }, []);

  const sharedKeys = useMemo(() => computeSharedKeys(projectEnvs), [projectEnvs]);
  const runnableProjects = useMemo(
    () => projects.filter((p) => p.name !== SELF_PROJECT && p.runTarget),
    [projects]
  );
  const nonRunnableProjects = useMemo(
    () => projects.filter((p) => p.name !== SELF_PROJECT && !p.runTarget),
    [projects]
  );
  // `tick` isn't read directly, but forces this to re-derive whenever the
  // process manager reports a change or the 1s uptime interval fires — its
  // state is mutated in place rather than replaced.
  const services = useMemo(
    () =>
      runnableProjects
        .map((p) => manager.getState(p.name))
        .filter((s): s is NonNullable<typeof s> => Boolean(s)),
    [runnableProjects, manager, tick]
  );

  async function refreshEnv() {
    const { projectEnvs: envs, warnings: envWarnings } = discoverEnvFiles(
      workspaceRoot,
      projects
    );
    setProjectEnvs(envs);
    setWarnings((prev) => [
      ...prev.filter((w) => !envs.some((e) => e.project === w.scope)),
      ...envWarnings,
    ]);
  }

  function openLogsFor(project: string) {
    setLogsInitialProject(project);
    setScreen('logs');
  }

  async function handleQuit() {
    setQuitting(true);
    await onQuit();
  }

  useInput(
    (input, key) => {
      if (quitting) return;
      if (input === 'q' || (key.ctrl && input === 'c')) {
        handleQuit();
        return;
      }
      if (input === '1') setScreen('services');
      else if (input === '2') setScreen('env');
      else if (input === '3') setScreen('shared-env');
      else if (input === '4') setScreen('logs');
    },
    { isActive: !inputLocked && !quitting }
  );

  if (quitting) {
    return <Text color="yellow">Shutting down services…</Text>;
  }

  if (loading) {
    return <Text>Discovering projects…</Text>;
  }

  if (fatalError) {
    return <Text color="red">Failed to discover workspace: {fatalError}</Text>;
  }

  return (
    <Box flexDirection="column">
      <Box paddingX={1} paddingBottom={1}>
        <Text bold color="cyan">
          devctl
        </Text>
        <Text dimColor> — {workspaceRoot}</Text>
      </Box>

      <Box paddingX={1}>
        {screen === 'services' && (
          <ServicesScreen
            services={services}
            nonRunnable={nonRunnableProjects}
            warnings={warnings}
            manager={manager}
            isActive={screen === 'services' && !inputLocked}
            onOpenLogs={openLogsFor}
          />
        )}
        {screen === 'env' && (
          <EnvScreen
            projectEnvs={projectEnvs}
            isActive={screen === 'env'}
            onEditingChange={setInputLocked}
            refreshEnv={refreshEnv}
          />
        )}
        {screen === 'shared-env' && (
          <SharedEnvScreen
            sharedKeys={sharedKeys}
            projectEnvs={projectEnvs}
            isActive={screen === 'shared-env'}
            onEditingChange={setInputLocked}
            refreshEnv={refreshEnv}
          />
        )}
        {screen === 'logs' && (
          <LogsScreen
            manager={manager}
            projectNames={runnableProjects.map((p) => p.name)}
            isActive={screen === 'logs' && !inputLocked}
            initialProject={logsInitialProject}
          />
        )}
      </Box>

      <StatusBar screen={screen} services={services} hint="1-4 switch screens · q quit" />
    </Box>
  );
}
