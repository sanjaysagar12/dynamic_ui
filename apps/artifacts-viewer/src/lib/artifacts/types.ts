import type { Role } from '@org/shared-types';

export interface ArtifactCatalogEntry {
  slug: string;
  title: string;
  roles: Role[];
}
