import { isRole, type Role } from '@org/shared-auth';

export interface ArtifactManifest {
  roles: Role[];
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

  return { roles: (raw as { roles: Role[] }).roles };
}
