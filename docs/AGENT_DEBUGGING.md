# Agent controlled app debugging

When a bug depends on app behavior, start a visible app instance and inspect it directly before
asking the owner to reproduce steps or capture logs. Use the existing browser or Electron window
for the whole investigation. Keep its profile and tabs alive while reloading, navigating, and
collecting evidence; don't repeatedly launch new instances.

## Chromium (preferred for browser behavior)

From the repository root:

```sh
scripts/debug-chromium.sh
```

The launcher starts the Docker `dev` service if needed, opens the real Svelte app at
`http://localhost:3000/?libraryTrace=1`, and launches a visible Chromium with a persistent profile
at `~/.cache/gnwmanager-chromium-debug`. Chromium's remote debugging endpoint is bound only to
loopback at port `9223`. `--no-server` skips Docker startup; `--url URL` chooses the first page.
Set `GNW_DEBUG_CHROMIUM` if Chromium is installed outside the launcher's auto-detected locations.

If port 9223 already has a Chromium session, the launcher reports it and leaves its windows,
tabs, and navigation alone. Continue using that instance. This avoids losing folder permissions,
the user's configured library, and the exact state being measured. To attach an automation or
inspection client, use the Chrome DevTools Protocol endpoint at `http://127.0.0.1:9223`.

`localhost` is a secure context for WebUSB, so this path avoids the self-signed nginx certificate
interstitial. The persistent profile also preserves browser folder permissions and local app
storage between launches. Do not use incognito or create a fresh profile for each measurement.

## Electron

Electron development is launched from `desktop/` and builds/stages the renderer through the
project Docker image before opening the window:

```sh
npm ci --prefix desktop       # once, if Electron is not installed
npm run dev --prefix desktop
```

The launcher checks a source fingerprint, so it refuses to display a stale renderer. For a
controlled debugging session, enable DevTools and its local CDP endpoint:

```sh
GNW_DEBUG_ELECTRON=1 GNW_DEBUG_PORT=9224 npm run dev --prefix desktop
```

DevTools opens in a separate visible window; CDP listens on loopback at port 9224. Electron keeps
its own normal user-data profile, including authorized native folder roots. Its `gnw://app`
origin is stable across launches. Use Chromium for browser File System Access behavior and
Electron for the native filesystem bridge or issues specific to the desktop shell.

## Investigation loop

1. Start the relevant app once and leave it open. Check its visible state before changing code.
2. Reproduce by clicking through the interface yourself via the controlled window. Keep the
   profile, selected folders, and permissions intact.
3. Collect focused evidence through the console, app debug output, CDP, and process memory. The
   `libraryTrace=1` query enables library snapshot and worker trace messages. Use the existing
   `libraryPerformance.ts` measures for scan phase timings. Follow the dev server output with
   `docker compose logs -f dev`; the browser debug sink can also be read inside the container
   with `docker compose exec dev tail -f /tmp/gnw-debug.log`. Compare browser process memory with
   `performance.memory` JS heap where Chromium exposes it; they measure different things.
4. For a memory issue, record one short window around the suspected phase, then inspect worker
   messages, retained arrays/caches, and heap snapshots. Avoid long DevTools performance captures
   when they destabilize DevTools or substantially change the workload. Capture the minimum
   necessary evidence and write larger diagnostic artifacts under ignored `build/diagnostics/`,
   never `/tmp` (which may be RAM-backed).
5. Change one cause at a time, use HMR or reload in the same session, and compare the same user
   action and library state. Re-run the behavior after the fix and verify the visible result.
6. Report the reproduction, measurements, change, and remaining uncertainty. Ask the owner to
   intervene only for state or hardware that is unavailable to the controlled environment.

This method was effective for the large-library memory regression: a visible browser with the
owner's real folder permissions and library state made it possible to repeat Manage Library,
watch memory through completion, and identify that the expensive behavior was tied to browser
file access. Electron's native directory bridge provided a useful comparison. The same direct
iteration now applies to library scans, cover loading, rendering, and browser-versus-Electron
differences.

## Boundaries

- The CDP port is a local debugging interface. Bind it to `127.0.0.1`; do not expose it to the
  LAN or forward it publicly.
- Keep one instance open. If the debug port is occupied, attach to the existing session rather
  than starting a second browser.
- Don't reset browser storage, clear permissions, or replace the Electron user-data directory
  during an investigation unless that state itself is under test.
- Hardware attachment and destructive device operations still require the normal device safety
  workflow in [DEVICE_IO.md](./DEVICE_IO.md).
