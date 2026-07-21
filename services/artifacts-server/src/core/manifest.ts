import { isRole, type Role } from '@org/shared-auth';

export interface ArtifactManifest {
  roles: Role[];
  title?: string;
}

export function parseManifest(raw: unknown): ArtifactManifest {
  if (
    typeof raw !== 'object' ||
    raw === null ||
    !('roles' in raw) ||
    !Array.isArray((raw as { roles: unknown }).roles) ||
    !(raw as { roles: unknown[] }).roles.every(isRole)
  ) {
    throw new Error('Invalid manifest.json: "roles" must be an array of valid roles');
  }

  const title = (raw as { title?: unknown }).title;

  return {
    roles: (raw as { roles: Role[] }).roles,
    ...(typeof title === 'string' && title.length > 0 ? { title } : {}),
  };
}
