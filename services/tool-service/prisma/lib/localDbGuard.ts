/**
 * Shared by every script in prisma/ that can destroy or rewrite data
 * (seed.ts, reset-soft.ts, reset-full.ts) — one place to keep this check so
 * it can't drift between copies. Each script still calls it as the very
 * first thing it does, so the check is effectively "at the top of every
 * script" even though the logic itself lives here once.
 *
 * Deliberately fails CLOSED: anything that doesn't look like a local
 * database (no localhost/127.0.0.1/host.docker.internal in the URL) refuses
 * to proceed unless the caller explicitly opts in via ALLOW_DB_RESET=true.
 * This is the single most important check in prisma/ — a seeder that resets
 * data must be structurally hard to run against the wrong database by
 * accident.
 */
export function assertLocalDatabase(url: string | undefined): void {
  const value = url ?? '';
  const looksLocal = /localhost|127\.0\.0\.1|host\.docker\.internal/.test(value);
  if (!looksLocal && process.env.ALLOW_DB_RESET !== 'true') {
    console.error(
      'Refusing to reset/seed: DATABASE_URL does not look like a local ' +
        'database. Set ALLOW_DB_RESET=true to override (e.g. for a disposable ' +
        'CI/demo database), but never point this at anything you care about.',
    );
    process.exit(1);
  }
}
