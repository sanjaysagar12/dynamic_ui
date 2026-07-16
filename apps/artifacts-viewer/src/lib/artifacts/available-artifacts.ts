export interface ArtifactOption {
  path: string;
  label: string;
}

/** Static registry of artifacts this app knows how to request. Extend as new artifacts are published. */
export const AVAILABLE_ARTIFACTS: ArtifactOption[] = [
  { path: '/dashboard/', label: 'Dashboard (admin, manager)' },
  { path: '/admin/users/', label: 'User Management (admin only)' },
];
