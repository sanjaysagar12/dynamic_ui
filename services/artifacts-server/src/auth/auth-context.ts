import type { Role } from '@org/shared-types';

export interface AuthContext {
  subject: string;
  role: Role;
  /** The raw token used to authenticate, so it can be propagated to sub-resource requests. */
  token: string;
}
