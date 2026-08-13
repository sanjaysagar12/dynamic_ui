# devctl

A terminal UI for running this Nx workspace locally: start/stop/restart services, tail their logs, and view/edit `.env` files across all projects without hunting through folders.

## Running

```sh
npm run devctl
```

(equivalent to `nx run devctl:serve`)

This launches a full-screen TUI. It discovers every Nx project in the workspace (`nx show projects`), figures out which ones are runnable (`serve` or `dev` target), finds their `.env*` files, and detects their ports from `PORT`/`NEXT_PUBLIC_PORT`/etc. or from a `-p <port>` flag in their run command.

Nothing is started automatically — devctl only starts a process when you press `s`.

## Screens

Switch screens with `1`–`4` at any time (except while typing into a text field):

| Key | Screen | Purpose |
| --- | --- | --- |
| `1` | Services | List every runnable service, its status/port/PID/uptime. Start, stop, restart. |
| `2` | Env | Browse and edit `.env` files per project. Values are masked by default. |
| `3` | Shared Env | Keys that appear in more than one service's `.env`, with a bulk-edit action. |
| `4` | Logs | Live-tailing stdout/stderr for any service devctl has started. |

`q` or `Ctrl+C` quits — this kills every process devctl started (via `tree-kill`, which kills the whole process tree, not just the immediate child) before exiting, so nothing is left running in the background.

### Services

- `↑`/`↓` — select a service
- `s` — start the selected service
- `k` — kill it (asks for `y`/`n` confirmation)
- `r` — restart it
- `enter` — jump to the Logs screen for the selected service

If a service's port is already occupied by something devctl didn't start, starting it fails with an "already in use" error shown inline instead of silently hanging.

### Env

- `↑`/`↓`, `enter` — drill into a project, then into its keys
- `v` — reveal/mask the selected value (masked values look like `sk_live_••••••••1234`)
- `enter` on a key — edit it inline; `enter` again saves, `esc` cancels without writing
- `esc` — go back up a level

Saving rewrites only the changed line in the `.env` file — comments, ordering, and every other line are left untouched. Nothing is written to disk until you explicitly press `enter` on an edit.

### Shared Env

Lists every env key that shows up in more than one service's `.env` file, and flags (`DIFFERS`) when the values don't match across services. Selecting a key shows every occurrence; `e` lets you push one new value to every file that has that key, after a confirmation prompt.

### Logs

- `←`/`→` — switch which service's log you're viewing
- `↑`/`↓` — scroll back through history (last 5,000 lines are kept per service, in memory, for the life of the session)
- `/` — filter the visible log to lines containing a search string

Logs are also written to `.devctl/logs/<service>.log` in the workspace root so they survive a devctl restart.

## Notes

- devctl itself is excluded from the Services list.
- Projects without a `serve`/`dev` target (e.g. `shared-auth`) are shown as "Not runnable" on the Services screen rather than hidden.
- devctl spawns Nx directly via `node node_modules/nx/dist/bin/nx.js` rather than `npx nx`. On Windows, `npx` resolves to `npx.cmd`, and piping a long-running task's output through that wrapper buffers it almost indefinitely — logs wouldn't stream and port checks would race against output that hadn't arrived yet.
