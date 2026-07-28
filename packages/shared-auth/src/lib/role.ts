// The single source of truth for valid roles lives in roles.json (not here),
// so adding/renaming a role is a one-file change instead of hunting through
// every service and component that hardcodes the list. A plain JSON import
// (rather than an fs read) keeps this module safe to bundle into browser code.
import rolesConfig from './roles.json' with { type: 'json' };

export type Role = string;

export const ROLES: readonly Role[] = rolesConfig.roles;

export function isRole(value: unknown): value is Role {
  return typeof value === 'string' && ROLES.includes(value);
}
