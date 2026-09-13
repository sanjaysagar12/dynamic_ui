import { Client } from 'pg';
import type { TestDatabase } from './testDatabase.js';

export interface ElevatedRole {
  roleName: string;
  connectionString: string;
}

/**
 * Provisions a second Postgres role — LOGIN + SUPERUSER, distinct from the
 * role tool-service itself connects as (the container's own init user) — so
 * Layer 1's append-only guard tests can prove trg_block_movement_update/
 * trg_block_movement_delete/trg_block_audit_update fire regardless of which
 * role attempts the mutation, not just an artifact of the app's own
 * unprivileged connection. Trigger-based guards fire for any role, including
 * a superuser, since they aren't a GRANT/RLS-based restriction — that's the
 * property this role exists to demonstrate.
 */
export async function createElevatedRole(db: TestDatabase, roleName = 'test_elevated_role'): Promise<ElevatedRole> {
  const password = 'test_elevated_role_password';
  const admin = new Client({ connectionString: db.connectionString });
  await admin.connect();
  try {
    await admin.query(`DROP ROLE IF EXISTS ${roleName}`);
    await admin.query(`CREATE ROLE ${roleName} WITH LOGIN SUPERUSER PASSWORD '${password}'`);
  } finally {
    await admin.end();
  }

  const url = new URL(db.connectionString);
  url.username = roleName;
  url.password = password;

  return { roleName, connectionString: url.toString() };
}
