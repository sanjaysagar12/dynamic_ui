import { ROLES as ROLES_CONST } from './roles.js';

export type Role = string;

export const ROLES: readonly Role[] = ROLES_CONST;

export function isRole(value: unknown): value is Role {
  return typeof value === 'string' && ROLES.includes(value);
}
