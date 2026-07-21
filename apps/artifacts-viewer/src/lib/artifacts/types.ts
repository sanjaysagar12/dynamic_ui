import type { Role } from '@org/shared-auth';

export interface ArtifactCatalogEntry {
  slug: string;
  title: string;
  roles: Role[];
}
