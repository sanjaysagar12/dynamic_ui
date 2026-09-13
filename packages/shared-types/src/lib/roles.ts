// The single source of truth for valid roles — adding/renaming a role is a
// one-file change instead of hunting through every service and component
// that hardcodes the list.
export const ROLES = ['OWNER', 'STOREKEEPER'] as const;
