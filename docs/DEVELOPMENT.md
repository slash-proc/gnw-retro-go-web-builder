# Development

Everything runs in Docker — **nothing is installed on the host**. The dev image
(`node:20-slim` + `git`, `python3`, and a few pip packages for the test oracles)
is built by `docker compose`.

> **Note on Workflow:** Practice healthy use of Git branches. You MUST run checks and tests locally before committing changes (e.g. `docker compose exec dev npm run check --workspace @gnw/web`). Do not commit code blindly without verifying it passes compilation and linting. Visual changes should be **flagged** for a look — never blocked on one (`HANDOVER.md` §3).

## Run it

```bash
docker compose up --build        # build image + start dev server on :3000
# or, day-to-day:
docker compose up -d             # start (backend hot-reloads via tsx; tsc -b --watch rebuilds packages)
docker compose logs -f           # watch output
docker compose down              # stop
```

Open <http://localhost:3000> in Chrome/Edge. That is **`apps/web`, the real UI** (Vite + Svelte 5, HMR). The throwaway ES-module test harness lives at **`/dev`**, proxied to the Express backend.

For live reload through the HTTPS proxy instead, restart the stack with:

```bash
PROXY_TLS=1 docker compose up --build
```

Then open <https://gnw-builder.local>. The default `docker compose up --build` path is
the direct HTTP server, so its HMR websocket works at `localhost:3000`.

If using Podman on macOS, the compose service uses polling for Vite and TypeScript watches
because the Podman VM may not forward host filesystem events reliably.

How the container is wired (see `docker-compose.yml`):
- The repo is bind-mounted at `/app`, so source edits are live.
- `node_modules` and each package's `dist/` are **anonymous volumes**. The backend serves built `dist/` under `/packages` so the `/dev` harness imports packages directly.
- Three processes in the `dev` service: `tsc -b --watch` (package `dist/`), Express on internal :3001, Vite on :3000.
- A second `proxy` service (nginx) terminates HTTPS on :443 so WebUSB has a secure context from other LAN machines; `http://localhost:3000` is already a secure context and needs no proxy.

### Agent worktrees

Create them with `scripts/worktree-setup.sh <name>` from the main clone — it adds the worktree,
symlinks `node_modules` and `apps/web/node_modules`, checks out `frontend/vendor/webstlink`, and
runs `tsc -b` in the container. Idempotent; re-run to repair. Note `references/` is **gitignored**
and does not exist inside a worktree, so the reference-oracle commands below only run from the
main clone.

**A worktree resolves `@gnw/*` to its OWN `packages/*`**, not the main clone's: by an alias in
`apps/web/vite.config.ts`, a `paths` entry in `apps/web/tsconfig.json`, and
`apps/web/test/gnwResolve.mjs` for the esbuild suites. The symlinked `node_modules` supplies
third-party deps only. Without that, a worktree silently tests the MAIN clone's `dist/` and a
green run means nothing. A new suite needs BOTH `gnwResolveFor(import.meta.url)` (for the
bundle) and `gnwImport(import.meta.url, pkg)` for its own top-level workspace imports; a bare
`import("@gnw/...")` goes through node's resolver and breaks `instanceof` across the boundary.

The browser resolves the patcher's `@gnw/thumb-asm` import via an **import map** in
`frontend/index.html`; keep it in sync if package paths change.

## Building and Testing (TypeScript)

### Build Packages

```bash
docker compose exec dev npx tsc -b                 # build the whole package graph
docker compose exec dev npx tsc -b packages/gnw-patch   # build one package
docker compose exec dev npx tsc -b --force         # force (use after dist/ was wiped)
```

### Tests = Reference Oracles

There is no unit-test framework; correctness for anything that must match an upstream tool is a **byte-exact diff against a reference**. Run these after touching the relevant package:

```bash
# In-house Thumb-2 assembler vs upstream Python asm:
docker compose exec dev node packages/thumb-asm/test/validate.mjs

# WASM liblzma vs Python liblzma 5.4.1:
docker compose exec dev node packages/gnw-patch/wasm/validate.mjs

# Patch engine vs the real gnwmanager patcher. oracle.py REGENERATES the reference and
# needs references/gnwmanager on the `remove-keystone-engine` branch (on any other branch
# it aborts on keystone); engine.mjs diffs against the already-generated test/ref/ and
# runs regardless. test/ref/ is gitignored, so a fresh clone must regenerate it first.
docker compose exec dev python3 packages/gnw-patch/test/oracle.py
docker compose exec dev node    packages/gnw-patch/test/engine.mjs

# Layout-superblock patcher (byte-exact + real-blob integration):
docker compose exec dev node packages/gnw-patch/test/superblock.mjs

# L1 halt/resume/reset register sequences (incl. the watchdog freeze bits):
docker compose exec dev node packages/swd-transport/test/transport.mjs

# L2 mailbox protocol vs a simulated RAM stub:
docker compose exec dev node packages/gnw-flasher/test/protocol.mjs

# L3 resolveBuild layout logic + scaffold-stub guards:
docker compose exec dev node packages/builder-core/test/resolveBuild.mjs

# fs-builders — each against its own oracle:
docker compose exec dev node packages/fs-builders/test/frogfs.mjs       # vs mkfrogfs.py (needs pyyaml)
docker compose exec dev node packages/fs-builders/test/frogfsParse.mjs  # parser round-trip
docker compose exec dev node packages/fs-builders/test/staging.mjs      # staging xforms
docker compose exec dev node packages/fs-builders/test/rom_lzma.mjs     # ROM .lzma sidecars
docker compose exec dev node packages/fs-builders/test/littlefs.mjs     # round-trip + lfs_oracle.py
docker compose exec dev node packages/fs-builders/test/lfsWrite.mjs     # LittleFS write-in-place: lazy-fetch retry, dirty-block bound (a rebuild fails it), device offset mapping
docker compose exec dev node packages/fs-builders/test/flashImage.mjs   # flash-install orchestrator
```

The web app has its own suites plus `svelte-check`, all run by one command. **The authoritative
list is the `check` script in `apps/web/package.json`** — read it there rather than duplicating it:

```bash
docker compose exec dev npm run check --workspace @gnw/web
docker compose exec dev sh -c 'cd apps/web && npx vite build'   # only this catches the optional-param footgun
docker compose exec dev sh -c 'cd apps/web && node src/lib/sources/test/validate.mjs'
```

### Rebuilding the WASM `liblzma`
Only needed if you bump the xz version. Built with the emscripten image, output vendored into `packages/gnw-patch/vendor/lzma-wasm/`:

```bash
docker run --rm -v "$PWD/packages/gnw-patch":/pkg -w /pkg/wasm emscripten/emsdk:3.1.74 bash build.sh
```

## Firmware Distribution (CI & Consumption)

How the browser flasher gets a retro-go firmware build. The contract is
`docs/FIRMWARE_DIST.md` in `game-and-watch-retro-go-sd`; the client for it is
`apps/web/src/lib/firmwareDist/`.

### Discovery

One hard-coded URL (`FIRMWARE_VERSIONS_URL`, `firmwareDist/types.ts`):

```
https://slash-proc.github.io/game-and-watch-retro-go-sd/dist/versions.json
```

It lists releases newest-first, each pointing at a `manifest.json`. A release
publishes **four bundle zips** — one per `<storage>-bank<n>` combination:
`flash-bank1`, `flash-bank2`, `sd-bank1`, `sd-bank2`. The bank axis exists
because link addresses (`0x08000000` / `0x08100000`) cannot be runtime-patched;
geometry is still host-set through the layout superblock, so one binary serves
any extflash size.

### Verification is mandatory and ordered

`firmwareDist/extract.ts` follows the doc's order exactly:

1. `bundle.sha256` is checked **before the archive is opened** — a bundle whose
   bytes do not match is refused, never unpacked.
2. Every `image`, `sdUpdate` and `content[]` entry is checked **after** extraction.
3. Hashes are lowercase hex over raw file bytes.

The easiest mistake the doc names: extraction reads `path` (the entry inside the
zip) and **never** `install` (where the bytes land on the device). `install` is
carried through untouched for a later step.

### Install locations come from the manifest

The manifest's `paths` object (`cores`, `homebrew`, `bios`, `roms`, `covers`,
`cheats`, `data`) says where things go; `packages/fs-builders/src/installPaths.ts`
is the single place a declared path becomes an internal key. Note
`paths.homebrew` is `/homebrews` — plural — which is why nothing should hardcode
`roms/homebrew`.

### Consumer

`apps/web/src/lib/artifacts.ts` is a thin **adapter** over `firmwareDist/`,
preserving the surface its four consumers already use (`listVersions()`,
`fetchBundle()`, `blobs` / `contentFor()` / `manifest`). It merges the user's
ROMs with the release's content, builds FrogFS and LittleFS, patches the
superblock geometry, and flashes.

> **Superseded:** the old model — one `web-artifacts.zip` per GitHub release,
> discovered through the Releases API and fetched through a Cloudflare Worker
> CORS proxy at `infra/cors-proxy/` — is gone. Both the worker and the directory
> were deleted, and `apps/web/test/firmwarecutover.mjs` fails the build if either
> comes back.

## Building retro-go firmware blobs locally

If you need to build the firmware manually for testing, use the host toolchain (ARM GCC):

```bash
cd references/game-and-watch-retro-go-sd
# MUST pass SD_CARD=0 to build the FrogFS flash path.
FLAGS="SD_CARD=0 COVERFLOW=1 CHEAT_CODES=1 MAX_CHEAT_CODES=13 SCREENSHOTS=1 \
       SHARED_HIBERNATE_SAVESTATE=1 DISABLE_SPLASH_SCREEN=1 ZH_CN=1 ZH_TW=1 KO_KR=1 JA_JP=1"
make clean
make build/gw_retro_go_intflash.bin INTFLASH_BANK=2 $FLAGS -j"$(nproc)"
```

**Gotchas for Local Builds:**
- **Default is `SD_CARD=1`**. A bare `make` builds the SD variant. Use `SD_CARD=0`.
- **`BUILD_DIR` must stay `build/`**. Linker scripts hardcode `build/<core>/*.o`.
- **`EXTFLASH_OFFSET` must be decimal**. Do not pass hex.
- **`GNW_TARGET` is retired**.

## Cheat Data Ingestion

The cheat preset database (`apps/web/src/lib/cheats/{nes,gb}.json`, one file per system) is generated, not hand-edited:

```bash
python3 apps/web/src/lib/cheats/ingest.py            # xlsx source -> {nes,snes,gb,genesis,gamegear}.json + cheatsMeta.json
python3 apps/web/src/lib/cheats/ingest_libretro.py    # gap-fills nes.json/gb.json from references/libretro-database (stdlib only)
```

Only the `nes.json`/`gb.json` presets are actually consumed (`lineCheatSystems` in `GameDetailsPanel.svelte` maps nes/gb/gbc, plus pce — which has no preset file). SNES/Genesis/Game Gear presets exist in the data but are deliberately unused (no firmware cheat support for those systems). `ingest_libretro.py` only pulls `.cht` files tagged `(Game Genie)`/`(GameShark)` in the filename — untagged files use an incompatible raw-address RetroArch-internal format and are skipped. It only *adds* games missing from the xlsx-derived baseline; never touches/merges an already-present entry.

MSX/Coleco/SG-1000 cheats are a completely different mechanism: whole `.mcf` files (not individual toggleable codes). These were a one-time processing job, not an ongoing pipeline like the xlsx/libretro-database ingestion above — the raw `cheat-codes/<system>/` source tree (unlike the xlsx file and the `references/libretro-database` local clone) is deliberately NOT tracked in this repo; only its output is: the mirrored static assets under `apps/web/public/cheat-codes/` + the generated `apps/web/src/lib/cheats/mcfManifest.json`. Those two are what the app actually consumes (`cheats/index.ts`'s `MCF_WHOLE_FILE_SYSTEMS`/`findMcfPreset`) and are the only things that need to exist for a fresh clone to work. These are old/discontinued consoles with an effectively-frozen cheat set — if this ever needs redoing from scratch, re-source the raw `.mcf` files externally rather than expecting a `cheat-codes/` folder to already be present.

## Dependencies & Gotchas

- **Stale `node_modules` anon volume:** Fix missing symlinks via `docker compose up -d --force-recreate --renew-anon-volumes`.
- **Stale `tsconfig.tsbuildinfo`:** `tsc -b` writes buildinfo next to each tsconfig, so if
  `dist/` was wiped (anon volume) while buildinfo persisted, tsc skips emitting. Fix via
  `tsc -b --force`. Buildinfo is `.dockerignore`d, so it never enters the image.
- **Root ownership of generated files:** Fix via `docker compose exec -u root dev chown -R "$(id -u):$(id -g)" <path>`.
- **GitHub Pages deploy (`.github/workflows/deploy-pages.yml`)** is written to publish two
  builds in one artifact: production at `/` and a testing build at `/wip/`. **`/wip/` is not
  live.** The redesign branch has never been pushed, so nothing has ever run this half and
  `/wip/` is a 404 by design rather than a broken deploy; the push is held until the Overview
  overhaul finishes. Everything below describes what the workflow will do once it runs, not
  something you can go and look at. **Production always comes from
  `main`**, whatever ref triggered the run, and is staged first — so pushing the wip branch
  cannot change what production serves. The `/wip/` build is fenced with `continue-on-error`, so
  a broken wip branch degrades to a stale or absent `/wip/`, never a broken production. The
  branch is `WIP_BRANCH_DEFAULT` in the workflow, overridable per-run via `workflow_dispatch`.
  `/wip/` gets **its own storage scope** (`PUBLIC_STORAGE_SCOPE`, see `lib/storageScope.ts`) so a
  tester's localStorage / IndexedDB / OPFS never touches production data. If
  `actions/deploy-pages@v4` fails with "Multiple artifacts named
  github-pages were unexpectedly found," that's a re-run of an already-attempted run leaving a
  stale artifact attached to the same run ID — the workflow has a cleanup step for this, but if
  it ever resurfaces, a fresh run (not "re-run failed jobs") also clears it. A bare "Deployment
  failed, try again later" with only one artifact found is usually a transient GitHub-side Pages
  hiccup (check githubstatus.com) — just re-run.

## Desktop release (`.github/workflows/release-desktop.yml`)

Four build legs produce four artifacts, and like `/wip/` **none of this has ever run**, because
the branch has not been pushed:

| Leg | Runner | Artifact |
| --- | --- | --- |
| Windows x64 | `windows-latest` | `desktop-win-x64` |
| macOS universal | `macos-14` | `desktop-macos-universal` |
| Linux x64 | `ubuntu-latest` | `desktop-linux-x64` |
| Linux arm64 | `ubuntu-24.04-arm` | `desktop-linux-arm64` |

That is four artifacts for five requested targets because macOS ships **one universal `.dmg`**
carrying arm64 and x64 together, built entirely on the arm64 runner: Electron downloads prebuilt
binaries per target arch, so nothing cross-compiles, and `qemu-gnw` recorded macos-13 (Intel)
runners sitting queued for six hours without being picked up. Legs are `fail-fast: false` so one
platform's failure cannot mask another's real signal. `apps/web/test/desktop-config.mjs` checks
the matrix against the declared targets, so adding a leg without a target (or the reverse) fails
the build.

**Nothing is signed, on any platform, and that is a decision rather than an omission.** macOS has
no Developer ID because there is no Apple Developer Program membership; Windows was declined at a
recurring cost, which rules out Azure Trusted Signing and the pricier yearly OV/EV certificates.
`CSC_IDENTITY_AUTO_DISCOVERY: false` makes that deterministic instead of letting electron-builder
adopt whatever identity happens to sit in a runner keychain. **Do not scaffold disabled signing
steps**: a step that looks active and silently no-ops is worse than one honestly absent. What a
user sees today, and the exact secrets each platform would need if this is ever revisited, are in
that workflow's own header comment.

Note the AppImage arrives from the artifact store non-executable, so the release job `chmod +x`es
it; without that it is dead on arrival for anyone who downloads it.

## Hardware Testing

Needs a Chromium browser, an SWD probe, and a Game & Watch:
- **ST-Link v2** — works out of the box.
- **Raspberry Pi debugprobe** — must run **CMSIS-DAP v2** firmware (v1/HID can't be claimed by WebUSB).
