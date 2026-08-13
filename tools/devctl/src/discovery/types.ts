export interface DiscoveredTarget {
  name: string;
  executor?: string;
  /** Literal shell command, when the target is a `nx:run-commands` executor. */
  command?: string;
}

export interface DiscoveredProject {
  name: string;
  /** Path relative to the workspace root, e.g. "services/artifacts-server". */
  root: string;
  projectType?: string;
  targets: DiscoveredTarget[];
  /** Preferred target to run the project's dev server, if any. */
  runTarget: string | null;
}

export interface EnvVarEntry {
  key: string;
  value: string;
  /** 0-based line number within the source file. */
  line: number;
}

export interface EnvFile {
  /** Absolute path to the .env file. */
  path: string;
  /** Path relative to the workspace root. */
  relativePath: string;
  vars: EnvVarEntry[];
}

export interface ProjectEnv {
  project: string;
  root: string;
  files: EnvFile[];
}

export interface ServicePort {
  project: string;
  port: number | null;
  source: 'env' | 'command' | 'unknown';
}

export interface Warning {
  scope: string;
  message: string;
}
