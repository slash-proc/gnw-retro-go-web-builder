# CLAUDE.md

Orientation for AI assistants (and humans) working in this repo. Read this, then
[`STATUS.md`](./STATUS.md),
[`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md), and
[`docs/DEVELOPMENT.md`](./docs/DEVELOPMENT.md).

## What this is

A browser app (WebUSB, Chromium-only) that flashes/manages firmware on a Nintendo
Game & Watch (STM32H7B0). A from-scratch browser port of gnwmanager's host side +
the firmware patcher. Everything runs **client-side**; `backend/`+`frontend/` are
a throwaway test harness.

## Golden rules

- **Never install to the host.** All npm/build/test work runs in Docker. Use
  `docker compose exec dev …`. Regenerate the lockfile in a throwaway container
  with `--package-lock-only` (writes only `package-lock.json`). (Owner preference.)
- **Byte-exactness is verified, not assumed.** Anything that mirrors an upstream
  tool (Thumb asm, `liblzma`, the patcher) has a reference oracle test. Run it.
- **Keep packages dependency-free and bundler-free.** The browser imports built
  `dist/*.js` directly; cross-package runtime deps are handled by *dependency
  injection* or a browser *import map* — not a bundler. (See ARCHITECTURE.)
- **The frontend is throwaway.** Don't over-invest; it's a test harness until the
  real UX (`docs/UX_DESIGN.md`) is built.

## Codebase map

```
packages/swd-transport  L1: SwdTransport interface + DapjsTransport/WebStlinkTransport
                            (wrap an injected CortexM / Stlinkv2; generic ARMv7-M halt/reset)
packages/gnw-flasher     L2: GnwFlasher — startStub, info, flash (context protocol,
                            verify+retry, device progress, clock sync), readFlash, blobs/
packages/thumb-asm          in-house Thumb-2 assembler (assemble()); validated vs keystone
packages/gnw-patch          firmware patcher (patchFirmware): Device/firmware/mario/zelda,
                            aes, lz77, sha1; vendor/{lzma-wasm,symbols_*,novel_*}; wasm/ build
packages/builder-core    L3: resolveBuild (real) + manifest/artifact/flash (stubs)
packages/fs-builders    L-FS: FrogFS/LittleFS/SD builders (stubs)
apps/web/                THE REAL UI — Svelte 5 + Vite SPA: device.svelte.ts (store), ui/, views/,
                            engine/ = typed connect/info/flash/dump/patch over the @gnw packages
backend/                 Express dev server (tsx, :3001): legacy /dev harness + /packages, /api
frontend/                throwaway ES-module harness, served at /dev (probe.js, gnw.js, patch.js…)
references/gnwmanager    submodule (branch remove-keystone-engine) — porting reference
references/game-and-watch-retro-go-sd  submodule — firmware reference
```

## Build & test (always in the container)

```bash
docker compose up -d                                   # Vite app :3000 (/dev = legacy) + tsc watch + Express :3001
docker compose exec dev npx tsc -b                     # build all packages
docker compose exec dev npm run check --workspace @gnw/web   # svelte-check the UI
docker compose exec dev sh -c 'cd apps/web && npx vite build' # static build (GitHub Pages)
docker compose exec dev node packages/thumb-asm/test/validate.mjs   # asm oracle (must pass)
docker compose exec dev node packages/gnw-patch/wasm/validate.mjs   # liblzma WASM (72 vectors)
docker compose exec dev python3 packages/gnw-patch/test/oracle.py   # regen patch reference
docker compose exec dev node packages/gnw-patch/test/engine.mjs     # patcher byte-exact diff
docker compose exec dev node packages/gnw-patch/test/superblock.mjs # layout-superblock patcher byte-exact + real-blob integration
docker compose exec dev node packages/fs-builders/test/frogfs.mjs   # FrogFS byte-exact vs mkfrogfs.py (needs pyyaml)
docker compose exec dev node packages/fs-builders/test/staging.mjs  # FrogFS staging xforms (byteswap oracle + predicates)
docker compose exec dev node packages/fs-builders/test/rom_lzma.mjs # ROM .lzma sidecars byte-exact vs Python liblzma
docker compose exec dev node packages/fs-builders/test/littlefs.mjs # LittleFS round-trip (+ lfs_oracle.py cross-mount)
docker compose exec dev node packages/fs-builders/test/flashImage.mjs # flash-install FrogFS orchestrator (dest-map, /bios merge, msx omit, MD byteswap order)
docker compose exec dev node packages/fs-builders/test/frogfsParse.mjs # FrogFS PARSER round-trip (reverse of the builder; powers the on-device installed-games read)
```

## Conventions

- TypeScript packages compile with `tsc -b` to `dist/`; imports use explicit
  `.js` extensions; `type: "module"`. No test framework — validation is plain
  `node` scripts diffing against oracles.
- LZMA: **two** compressors on purpose. *Flashing* uses LZMA-JS (browser, only
  needs to decode on-device). *Patching* uses **WASM `liblzma`** (must be
  byte-exact with Python). Don't mix them up.
- Ports from gnwmanager are 1:1 and cite the source file. The patch reference is
  the `remove-keystone-engine` branch (no keystone); runtime blobs are pinned to
  gnwmanager v0.22.1.

## Dev-container gotchas (these have bitten us)

- **Stale anon `node_modules` volume.** Adding a workspace package and recreating
  the container can leave `node_modules/@gnw/*` symlinks missing → "cannot find
  module @gnw/…". Fix: `docker compose up -d --force-recreate --renew-anon-volumes`.
- **Stale `tsconfig.tsbuildinfo`.** `tsc -b` writes buildinfo next to each
  tsconfig; if `dist/` was wiped (anon volume) but buildinfo persists, tsc skips
  emitting. Fix: `tsc -b --force` (buildinfo is `.dockerignore`d so it won't enter
  the image). 
- **Host file ownership.** Anything the container writes to a bind-mounted path is
  root-owned; `chown` it back if you need to edit from the host.
- The browser resolves the patcher's `@gnw/thumb-asm` import via an **import map**
  in `frontend/index.html`; keep it in sync if package paths change.

## Memory

Durable project facts are in `.claude/projects/.../memory/` (the OpenOCD model,
the patch engine's byte-exact-LZMA requirement, the Thumb assembler, the
no-host-installs rule). Consult them before re-deriving.

## Agent Rules and Project Guidelines

### Git Workflow & Collaboration
- **Branching:** Practice healthy use of Git branches when changing or updating the project. Do not commit directly to `main` for feature work.
- **Mandatory Pre-Commit Checks:** You MUST run checks and tests locally before committing changes. Never commit code that has been blindly changed. For the frontend, ALWAYS run `docker compose exec dev npm run check --workspace @gnw/web` before committing UI or Svelte store changes.
- **Visual Verification:** Some things (especially UI/UX) can only be verified by looking at them. You must coordinate with the user to visually check what was done before those commits go through.

### Build Environment & Docker
- ALWAYS perform builds and run terminal commands inside the `dev` Docker container unless strictly doing local filesystem interactions.
- Command format: `docker compose exec dev <command>` (e.g. `docker compose exec dev npx tsc -b apps/web`)
- The web app heavily leverages Vite and local workspaces (`packages/`). Ensure to recompile the individual packages (e.g., `packages/gnw-flasher`) before reloading the frontend.

### Game & Watch Flasher specific (WebUSB / ST-Link)
- **ST-Link Clone USB Saturation**: Generic ST-Link v2 / CMSIS-DAP programmers are prone to locking up permanently if WebUSB bulk transfers are interleaved too rapidly or zero-delay polled. 
  - ALWAYS include a throttle delay (e.g., `await new Promise(r => setTimeout(r, 10))`) inside synchronous hardware polling loops.
  - DO NOT execute hundreds of individual tiny WebUSB requests in quick succession (like reading `readMemory(..., 16)` inside a loop). Instead, issue a single bulk read request (e.g., up to 64KB `readMemory(..., 65536)`) and manually parse the resulting `Uint8Array`.

### Frontend State & Contexts
- Access device properties explicitly using the `firmware` property, not the `type` property (e.g., `if (device.firmware === 'retro-go')`). The central `device` store (`device.svelte.ts`) maps classification explicitly to `.firmware`.

### Incremental Flashing (FrogFS)
- The flash verification system operates on 256KB chunks. Adding data (like a new ROM) pushes the payload size out without shifting the start locations of existing payloads *as long as* `opts.dataStart` is meticulously preserved when regenerating the FrogFS image.
- When troubleshooting incremental differential flashes (skipping behavior):
  - Missing skips are almost universally caused by `opts.dataStart` shifting, invalidating every hash block.
  - Device stub skips happen incredibly fast (~20-30ms) compared to an actual erase/flash operation (~500ms).
