import type { Role } from '@org/shared-auth';

export interface AuthContext {
  subject: string;
  role: Role;
}
