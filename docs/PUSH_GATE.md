# Push gate

Before pushing a change, run the push gate. It is an **honor-system gate, not a Git hook** —
nothing forces it. It runs the same production checks as the Pages workflow:

1. **diff check** — `git diff --check` (whitespace/conflict-marker validation). Skipped with a
   notice if there is no `.git` directory.
2. **internal packages** — `tsc -b` builds all six internal packages
   (`builder-core`, `fs-builders`, `gnw-flasher`, `gnw-patch`, `swd-transport`, `thumb-asm`).
3. **web production build** — the complete `@gnw/web` build (the full `apps/web` test chain +
   `vite build`).

On success the last line is `== push gate: PASSED`. **Do not push a change if the gate fails**
(any test or `tsc` error aborts the run, so the `PASSED` line is never printed).

## Running the gate

### Preferred: inside the `dev` container (docker compose)

Run it in the `dev` service so it uses the same toolchain and containerized `node_modules` /
package `dist` volumes the app builds with. Source is bind-mounted at `/app`, so the script is
found at `scripts/push-gate.sh`.

```sh
# 1. Start the dev service (skip if it is already running).
docker compose up -d dev

# 2. Run the gate and capture the result. `-T` is required (no TTY needed); `bash -lc`
#    gives the interactive shell PATH. Redirect to a log so a long build can be polled
#    without holding the terminal, and record the exit code on the same line.
docker compose exec -T dev bash -lc \
  "bash scripts/push-gate.sh > /tmp/push-gate.log 2>&1; echo EXIT=\$? >> /tmp/push-gate.log; tail -5 /tmp/push-gate.log"

# 3. (Optional) follow the log live while it runs.
tail -f /tmp/push-gate.log
```

The command blocks until the gate finishes, then prints the exit code plus the last few log
lines. A pass ends with:

```
== push gate: PASSED
EXIT=0
```

> Note: `/tmp/push-gate.log` lives in the **container's** filesystem, not the host. Read it
> through `docker compose exec dev cat /tmp/push-gate.log` if you need the full output.

### From the host

```sh
npm run check:push
```

This runs the same `scripts/push-gate.sh` on the host (it needs the host to have run `npm ci`).
Prefer the container method above unless you specifically want the host toolchain.

## Configuration

The gate sets sensible defaults for the web build; override them with environment variables if a
change requires a different base or storage scope.

| Variable               | Default                             | Purpose                                            |
| ---------------------- | ----------------------------------- | -------------------------------------------------- |
| `PUBLIC_BASE`          | `/gnw-retro-go-web-builder/`        | Public base path baked into the web build.         |
| `PUBLIC_STORAGE_SCOPE` | *(empty)*                           | Storage scope marker for the web build.            |

Override example:

```sh
docker compose exec -T dev bash -lc \
  'PUBLIC_BASE=/my-base/ bash scripts/push-gate.sh > /tmp/push-gate.log 2>&1; echo EXIT=$? >> /tmp/push-gate.log; tail -5 /tmp/push-gate.log'
```

## Prerequisites

- **Dependencies installed** — the gate fails fast if `node_modules/.bin/tsc` is missing. Inside
  the `dev` container this is handled by the image + anonymous `node_modules` volumes; on the host
  run `npm ci` first.
- **`.git` is optional** — the diff check is skipped with a notice when there is no `.git`
  directory (e.g. a source-only environment). The build stages still run.

## Failure modes

- **Rollup / Vite chunk-size warning** is *not* a failure — it can appear on a passing build.
- Any `tsc` error, failing web test, or `vite build` error aborts the run (there is no
  `== push gate: PASSED` line). Treat a missing `PASSED` line as a failure and do not push.
