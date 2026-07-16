export type Role = 'admin' | 'manager';

export const ROLES: readonly Role[] = ['admin', 'manager'] as const;

export function isRole(value: unknown): value is Role {
  return typeof value === 'string' && (ROLES as readonly string[]).includes(value);
}
