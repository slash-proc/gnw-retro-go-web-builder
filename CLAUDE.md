# CLAUDE.md

Orientation for AI assistants (and humans) working in this repo. Read this, then
[`HANDOVER.md`](./HANDOVER.md) (the UI overhaul's standing instructions),
[`STATUS.md`](./STATUS.md),
[`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md), and
[`docs/DEVELOPMENT.md`](./docs/DEVELOPMENT.md).

**Touching any user-visible string, or drawing any board? Read
[`docs/UI_VOICE.md`](./docs/UI_VOICE.md) first, every time.** No narration, no filler, state
carried by structure rather than wording, and nothing invented that no artboard draws. Every rule
in it is quoted from a correction the owner made, because each one was fought over at least once.

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
- **`frontend/` is throwaway**, not `apps/web`. `frontend/` is the `/dev` harness — don't
  over-invest in it. `apps/web` is the real UI and is under an active design pass; its bar
  and standing instructions are in `HANDOVER.md`.

## Codebase map

```
packages/swd-transport  L1: SwdTransport interface + DapjsTransport/WebStlinkTransport
                            (wrap an injected CortexM / Stlinkv2; generic ARMv7-M halt/reset)
packages/gnw-flasher     L2: GnwFlasher — startStub, info, flash (context protocol,
                            verify+retry, device progress, clock sync), readFlash, unlock, blobs/
                            (lock() stays a deliberate stub; see the routing/unlock notes below)
packages/thumb-asm          in-house Thumb-2 assembler (assemble()); validated vs keystone
packages/gnw-patch          firmware patcher (patchFirmware): Device/firmware/mario/zelda,
                            aes, lz77, sha1; vendor/{lzma-wasm,symbols_*,novel_*}; wasm/ build
packages/builder-core    L3: resolveBuild (real) + manifest/artifact/flash (stubs)
packages/fs-builders    L-FS: FrogFS (builder+parser), LittleFS, staging, ROM .lzma,
                            flash-install orchestrator — real; index.ts keeps SD scaffold stubs
apps/web/                THE REAL UI — Svelte 5 + Vite SPA: device.svelte.ts (store), ui/, views/,
                            advanced/, sources/, i18n/, engine/ = typed connect/info/flash/
                            dump/patch over the @gnw packages
  firmwareDist/             client for the firmware distribution contract (versions.json ->
                            manifest.json -> hash-verified bundles); artifacts.ts adapts it
  sources/                  third-party cores/homebrew: manifest client, core registry, the
                            sandboxed WASM converter host, input discovery, caches
  views/OverviewRail.svelte Overview's rail (CONSOLE: Status, Details / LOGS: Activity, Device
                            log); panes are ui/{Status,Details,DeviceLog}Pane.svelte
  backupPresence /          two folder-reading stores: does a real firmware backup exist, and
  sdStorage.svelte.ts       what is on the SD card. Both cache and expose an explicit refresh
backend/                 Express dev server (tsx, :3001): legacy /dev harness + /packages, /api
frontend/                throwaway ES-module harness, served at /dev (probe.js, gnw.js, patch.js…)
external/                REAL submodules: sylverb's zelda3 / smw forks (homebrew sources)
references/              gitignored plain local clones, NOT submodules and NOT tracked — a
                            fresh clone or an agent worktree has no references/ at all, so the
                            reference-oracle tests only run from the main clone
  gnwmanager                porting reference; the patch oracle needs it checked out on
                            remove-keystone-engine — check the branch before running it
  game-and-watch-retro-go-sd  firmware reference (developed on a local branch); also the home
                            of docs/FIRMWARE_DIST.md, the distribution contract we implement
  game-and-watch-bootloader, gnw-chainloader, external_cores, libretro-database, CoverStudio
                            further read-only references (bootloader diagnostics, cheat data)
```

## Build & test (always in the container)

```bash
docker compose up -d                                   # Vite app :3000 (/dev = legacy) + tsc watch + Express :3001
docker compose exec dev npx tsc -b                     # build all packages
docker compose exec dev npm run check --workspace @gnw/web   # apps/web/test/* suites + svelte-check
                                                       # (authoritative list: the `check` script in apps/web/package.json)
docker compose exec dev sh -c 'cd apps/web && npx vite build' # static build (GitHub Pages)
docker compose exec dev node packages/swd-transport/test/transport.mjs  # L1 halt/resume/reset register sequences (watchdog freeze bits)
docker compose exec dev node packages/gnw-flasher/test/protocol.mjs  # L2 mailbox protocol vs a simulated RAM stub (waitForIdle order, verify defaults)
docker compose exec dev node packages/builder-core/test/resolveBuild.mjs # L3 resolveBuild layout logic + scaffold-stub guards
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
docker compose exec dev node packages/fs-builders/test/lfsWrite.mjs   # LittleFS write-in-place: lazy-fetch retry, dirty-block bound (a rebuild fails it), device offset mapping
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
- **Agent worktrees: use `scripts/worktree-setup.sh <name>`** (run from the main clone). It
  creates or repairs the worktree, links `node_modules` and `apps/web/node_modules` to the main
  clone's, checks out `frontend/vendor/webstlink`, and runs `npx tsc -b` in the dev container.
  A worktree set up this way runs the full gate set green. Those symlinks supply third-party
  deps only: `@gnw/*` is resolved to the worktree's OWN `packages/*` by an alias in
  `apps/web/vite.config.ts`, a `paths` entry in `apps/web/tsconfig.json`, and
  `apps/web/test/gnwResolve.mjs` for the esbuild suites — otherwise a worktree silently tests
  the MAIN clone's `dist/`. A new suite needs BOTH `gnwResolveFor(import.meta.url)` (bundle) and
  `gnwImport(import.meta.url, pkg)` for its own top-level workspace imports; a bare
  `import("@gnw/...")` goes through node's resolver and breaks `instanceof` across the boundary.
- **Host file ownership.** Anything the container writes to a bind-mounted path is
  root-owned; `chown` it back if you need to edit from the host.
- The browser resolves the patcher's `@gnw/thumb-asm` import via an **import map**
  in `frontend/index.html`; keep it in sync if package paths change.
- **No TS optional parameters (`foo?: T`) in a `.svelte` `<script lang="ts">`.** The
  Svelte TS-stripping transform drops the type but leaves the `?` behind, emitting
  `function f(a, b?)` — invalid JavaScript. `svelte-check` stays green (the
  TypeScript itself is valid; type checking can't catch a bug in type *stripping*),
  so the only gate that catches it is `vite build` — and it has reached the browser
  as a blank white page once already (commit `d3493c5`). Fix: widen to an explicit
  union with a default, e.g. `done: (() => void) | undefined = undefined`. Optional
  *properties* in a type literal, `?.`, and `?:` in a type position are all fine —
  it's only parameter lists. Guarded by
  `apps/web/test/svelte-optional-params.mjs` (parses each `<script>` with the real
  TypeScript parser, flags parameter declarations carrying a question token, skips
  type-position ones), which now runs first in both `npm run check` and
  `npm run build` for `@gnw/web`, or standalone:
  `docker compose exec dev sh -c 'cd /app/apps/web && node test/svelte-optional-params.mjs'`.

## Memory

Durable project facts are in `.claude/projects/.../memory/` (the OpenOCD model,
the patch engine's byte-exact-LZMA requirement, the Thumb assembler, the
no-host-installs rule). Consult them before re-deriving.

## Agent Rules and Project Guidelines

### Git Workflow & Collaboration
- **Branching:** Practice healthy use of Git branches when changing or updating the project. Do not commit directly to `main` for feature work.
- **Mandatory Pre-Commit Checks:** You MUST run checks and tests locally before committing changes. Never commit code that has been blindly changed. For the frontend, ALWAYS run `docker compose exec dev npm run check --workspace @gnw/web` before committing UI or Svelte store changes.
- **Visual Verification:** Some things (especially UI/UX) can only be verified by looking at them. Flag those changes for a look — but do not halt the workflow waiting for one (HANDOVER §3, "Do not stockpile blockers. Build the visuals.").

### Build Environment & Docker
- ALWAYS perform builds and run terminal commands inside the `dev` Docker container unless strictly doing local filesystem interactions.
- Command format: `docker compose exec dev <command>` (e.g. `docker compose exec dev npx tsc -b apps/web`)
- The web app heavily leverages Vite and local workspaces (`packages/`). Ensure to recompile the individual packages (e.g., `packages/gnw-flasher`) before reloading the frontend.

### Game & Watch Flasher specific (WebUSB / ST-Link)
- **ST-Link Clone USB Saturation**: Generic ST-Link v2 / CMSIS-DAP programmers are prone to locking up permanently if WebUSB bulk transfers are interleaved too rapidly or zero-delay polled. 
  - ALWAYS include a throttle delay (e.g., `await new Promise(r => setTimeout(r, 10))`) inside synchronous hardware polling loops.
  - DO NOT execute hundreds of individual tiny WebUSB requests in quick succession (like reading `readMemory(..., 16)` inside a loop). Instead, issue a single bulk read request (e.g., up to 64KB `readMemory(..., 65536)`) and manually parse the resulting `Uint8Array`.
- **Screenshot pattern (halt/read/resume)**: `captureScreenshot` in `engine/screenshot.ts` always halts the CPU for a tear-free frame. Key invariants:
  - Use **64 KiB chunks** for the framebuffer read (`readMemory(addr, 65536)` with a 10 ms delay between chunks). This keeps the internal per-chunk delays inside the serialTransport queue entry (`busy()=true`), so the liveness poll cannot interleave and fire its 300 ms timeout mid-screenshot.
  - **Suspend the poll** (`this.suspendPoll()`/`resumePoll()` — the COUNTED pair, never the raw `stopPoll()`/`startPoll()`, which would restart the poll mid-flash if a flash holds its own suspend) in `device.captureScreenshot` around the engine call. The poll is for idle-period loss detection; the screenshot's own transport calls surface any live loss.
  - Never skip the halt/resume (even with the gnwmanager stub loaded). The stub does not configure LTDC after reset, so the registers would be garbage without a halt of a running Retro-Go session.
  - **BOTH firmwares we ever halt into run a hardware watchdog with a sub-second window, refreshed only by their own main loop**, and neither is frozen by default when the core halts for debug: Retro-Go's app firmware runs WWDG1 (`references/game-and-watch-retro-go-sd/Core/Src/main.c` `HAL_WWDG_Refresh`); the gnwmanager RAM stub (the flash util) runs IWDG1 (`references/gnwmanager/Core/Src/main.c` `HAL_IWDG_Refresh`, ~512ms window on the LSI clock). `SwdTransport.halt()`/`resume()` (`packages/swd-transport/src/index.ts`) freeze/unfreeze BOTH unconditionally via `DBGMCU.APB3FZ1` bit 6 (`DBG_WWDG1`, addr `0x5c001034`) and `DBGMCU.APB4FZ1` bit 18 (`DBG_IWDG1`, addr `0x5c001054`) — we don't know which firmware is running, so freezing the inactive one is a harmless no-op. This was the ACTUAL cause of the device resetting mid-screenshot (reproducible both with Retro-Go running AND with the flash util loaded) — not any JS-level timeout/retry/poll logic. If a halt-based read starts resetting the device again, check BOTH freeze bits are still being set before suspecting the app-layer transport/poll code.
  - The `flashImage` watchdog (`engine/flasher.ts`) surfaces stall errors to the caller. Auto-retry (reboot the RAM stub + retry, 3 attempts total) was removed then reintroduced (2026-07-03) once flashing started pausing the liveness poll (`device.suspendPoll()`/`resumePoll()`, same pattern as the screenshot halt/resume above) around every flash-writing call — that closed the actual race (a silent `transport.reset()` via `bootStub` racing an independent concurrent SWD user like the poll or a screenshot), so retry no longer needs to stay disabled. A flasher-getter passed below a flow's own initial (already-confirmed) `ensureStub()` call is `(force) => device.ensureStub(undefined, force, true)`: the third argument (`silent`) is what stops `StubLoadModal` re-asking for consent already given, and `force` is *forwarded* from `flashImage`'s per-attempt retry flag — hardcoding it true would reset the device on every per-chunk call instead of reusing the live cached stub.
  - `packages/gnw-flasher`'s `program()` must wait for the firmware's global `STATUS` register to reach `IDLE` (`waitForIdle()`) AFTER a context's `READY` flag clears — the firmware (`references/gnwmanager/Core/Src/gnwmanager.c`) clears `READY` right after the RAM buffer transfer, well before erase/program/hash-verify even start. Treating `READY`-cleared alone as "done" (as our port did until this was found and fixed) causes both a stuck on-device progress bar and spurious stall-watchdog trips. When debugging this protocol, read the actual firmware C source in `references/gnwmanager`, not just the Python host tool — the Python tool's usage pattern implies requirements the C source states explicitly.
  - **`program()`'s per-chunk context-buffer write does NOT read back/verify by default** (`verify: false` at every real call site — `flashInstall.ts`'s `flashRegion()`, `engine/flasher.ts`'s `flashImage()`). This was a deliberate reversal (2026-07-04) of a self-inflicted regression: a full read-back verify of the entire payload (up to 256KB, in 16KB sub-chunks each with its own settle/throttle delay) ran on EVERY chunk of EVERY flash operation, roughly tripling the WebUSB transaction count per chunk — `references/gnwmanager`'s reference Python has no equivalent at all, it trusts the device's own `BAD_HASH_RAM(_COMPRESSED)` check plus the chunk-retry handshake (`tryChunkRetry`, still correctly ported) entirely. The extra read-back directly fed the ST-Link-clone USB-saturation lockup risk documented at the top of this section, and (compounded by a same-day, now-reverted 120s→15s watchdog tightening) was the actual cause of a months-long "flashing has gotten slower and janker" regression report. **The one-time stub firmware load in `startStub()` KEEPS `verify: true` hardcoded — a corrupt stub hardfaults, so that one read-back (once, small) is cheap and genuinely justified; don't remove it there.** If you're tempted to add read-back verification to a NEW per-chunk write path, check gnwmanager's Python first — if it doesn't verify there either, don't add it; trust the device-side hash check. See `.claude/projects/.../memory/flash-verify-overhead-regression.md`.
  - The flash stall watchdog (`engine/flasher.ts`'s `flashImage()`) is **120 seconds of no progress**, not 15 — a same-day 15s tightening (chasing the symptom of the read-back-verify bug above) was reverted once the actual cause was found. `Wizard.svelte` wraps its flash-family calls (`patchAndFlash`, the step-2 flash, `restoreStock`) in sibling `withTimeout(...)` outer guards at `120000` (same no-progress-resets-timer semantics) that must ALL stay `>=` this inner watchdog's threshold, or the outer one fires first and false-aborts a slow-but-healthy transfer. **Don't trust a count in prose** — this note has said TWO and then THREE; enumerate them with `grep -n 'withTimeout(' apps/web/src/lib/views/Wizard.svelte` and check each value, remembering one of the hits is a 30s dump guard, unrelated.
  - **`BAD_HASH_FLASH` (device-side flash-content hash mismatch) is retried by `program()` itself** — the initial attempt plus two, with a status re-read sanity check between them (`MAX_FLASH_HASH_ATTEMPTS`, `packages/gnw-flasher/src/index.ts`) — then throws a `FlashVerifyError` naming the failed blocks. That error carries `retryable = false` and `engine/flasher.ts`'s `flashImage()` rethrows it on sight rather than spending its own 3-attempt region budget: retrying there would multiply to 9 attempts and force a device-resetting stub reboot between each, for a failure the device has already reported three times. This is distinct from `BAD_HASH_RAM(_COMPRESSED)`, which has the firmware's own `tryChunkRetry` handshake.

### Frontend State & Contexts
- Access device properties explicitly using the `firmware` property, not the `type` property (e.g., `if (device.firmware === 'retro-go')`). The central `device` store (`device.svelte.ts`) maps classification explicitly to `.firmware`.
- **SD mode vs Flash mode share UI, not budget logic.** `RomManagementTab.svelte`'s game-selection table (Select All / per-game toggles) is rendered ABOVE the `device.targetMedia === "sd"` split, so it's common to both modes. Anything reading `device.partitions`/`device.info`-derived state (`frogfsOffset`, `ceilingOffset`, `fitsGap`, `validateFit()`, the FrogFS-preview-build effect) is a Flash-only concept (the device's real flash-chip gap) and MUST early-out on `device.targetMedia === "sd"` — a device merely being connected while the user manages SD content is not a signal that Flash's constraints apply. This bit us once already (docs/AUDIT_NOTES.md item #14); don't reintroduce it when touching this shared table.
- `runInstall()` (Flash) and `doSdSync()` (SD) in `RomManagementTab.svelte` are two separate functions, not one function branching on `targetMedia` — don't conflate them when reading/editing this file.
- **`device.targetMedia` decides which of those two the Library's dock draws, and both buttons
  carry the SAME label.** It is persisted, defaults to `"flash"`, and has exactly three writers:
  `App.svelte:87`, `Landing.svelte:21`, and `romScan.ts`'s `pickSdCardFolder` adopt callback.
  That third one is new and is the fix for a real bug: the Sources SD pane set `device.sdHandle`
  without setting the mode, so `Sync Library` rendered the **Flash** button under the SD label
  and pressing it connected and booted the RAM stub, resetting a running Retro-Go. A card write
  must reach no device primitive at all (`test/sdsyncdevice.mjs` drives `doSdSync` against a
  device stub whose every hardware method throws). Second symptom of the same cause, worth
  knowing because it is silent: `scanSdCardGames()` early-returns on `targetMedia !== "sd"` and
  **clears `installedGames`**, so a card picked in the wrong mode was never read and the next
  sync called itself a fresh target and rewrote the whole selection.
- **`device.sdHandle` persists, and persistence hangs off ASSIGNMENT, not off the picker.** It is
  a getter/setter pair mirroring `targetMedia`, so a caller that only sets the field cannot
  half-register a card — which is exactly how the Sources pane arrived. The restore is started by
  a **field initializer** (not a lazy getter — see the `dbg()`/favourites hazard above), and
  `whenSdRestored()` is the contract every reader awaits. A reader that checks `sdStorage.state`
  must admit `"unknown"`, which is what the store is constructed at: a guard written against an
  assumed `"unavailable"` returned early on the one case it existed for, and the Library saw the
  card while the Sources page showed nothing.
- **The SD card is a source, with its own modules**: `sdStorage.svelte.ts` (the walk, nine
  `SdCategory` buckets, `truncatedBy` naming which of three limits was hit), `sdCapacity.ts` (a
  user-STATED capacity, because no browser API reports a picked directory's volume — see
  `docs/SDCARD_CAPACITY.md` and `src/lib/data/sdCapacity.json`), `sdHomebrewMigration.ts` (the
  `roms/homebrew` to `/homebrews` move) and `ui/SdCardPane.svelte`. Two rules that are easy to
  break: **used bytes are measured and free bytes are inferred**, so the page must not present a
  stated capacity with the same confidence as a walked total; and **cluster slack matters as much
  as capacity**, because every file rounds up to a cluster and exFAT uses 128 KiB clusters from
  64 GB up, which loses more to slack than the safety margin withholds.
- **Only `roms/<console>/` and the homebrew directories hold games** (`classifySdScanKey`). That
  used to be a deny-list naming three asset directories and treating every other top-level
  directory as a console, so `cores/`, `fonts/`, `lang/`, `data/` and `screenshots/` all became
  phantom systems and a core binary drew a `cores` chip in the Library. It is now derived from
  the manifest's own roles rather than typed. Note the shape trap: `romScan.ts` strips one
  leading `roms/` per key before the classifier sees it, so after the strip a game and a firmware
  asset are the same shape and the prefix that an allow-list needs is already gone. Preserving
  that prefix is the real fix and has not been done.
- **The page is a fixed viewport and `.tabpane` is its ONLY general scroll container.**
  `App.svelte`'s `.app` is `height: 100vh; overflow: hidden`, and `.tabpane`
  (`Advanced.svelte`) carries `min-height: 0; overflow-y: auto` on its **base** rule —
  `.library`/`.guided`/`.bleed` override padding only, never overflow. `App.svelte`'s `.landing`
  is not a `.tabpane`, so it has its own copy.
  `global.css` states the same fact at the root: `html, body { height: 100%; overflow: hidden }`.
  It does **not** set `scrollbar-gutter` — a `stable` gutter lived there briefly and reserved
  scrollbar width on the right for a scrollbar that can never appear, so every full-bleed row
  (header band, nav band, footer bars) stopped short of the right edge by that width. Don't
  reintroduce it: `.tabpane`'s scrollbar is taken from inside the pane, below the chrome, so
  nothing above or below it moves when that scrollbar toggles. `--page-pad-top-guided`/
  `--page-pad-bottom-guided` are retired; `.tabpane.guided` is `justify-content: safe center`.
  Adding `overflow: hidden` to `.tabpane`, `.shell` or `.page` silently turns every tab from
  scrollable into clipped-with-no-scrollbar, and **no gate in this repo detects it** —
  svelte-check, `vite build` and every suite pass on a clipped page. Anything using
  `position: fixed` anchored to page content must also follow the pane: `SplitButton.svelte`'s
  menu listens for `scroll` in **capture phase**, because `scroll` does not bubble and the
  emitter is `.tabpane`, not the document.
- **`lib/nav.ts` is the only owner of `history`, and a bare `location.hash =` is load-bearing.**
  Browser Back navigates inside the app now: `navigate(hash, push)` pushes for a navigation the
  user performed and replaces for one the app derived, and `onRoute(fn)` pings subscribers to
  *read* `location`, never to write it. `lib/sourcesRoute.ts` parses `<pane>/<id>/config`
  positionally, because a source id is itself `owner/name`.
  The trap: `pushState`/`replaceState` fire **neither** `popstate` nor `hashchange`, while a bare
  `location.hash = ...` assignment fires **only** `hashchange`. Both listeners are wired
  deliberately. So the remaining bare assignments are what makes those cross-tab deep links
  reach the readers at all: `DeviceHeader.svelte:30`, `StatusPane.svelte:161` and
  `DetailsPane.svelte:171`, those three and no others. **Do not "tidy" them into `navigate()`**,
  which would look neater and silently break them. (This list previously named `OverviewTab.svelte`
  and `App.svelte`; the Overview rail moved those writes into the panes and `App.svelte` has none.
  Re-derive it with `grep -rn 'location\.hash\s*=' apps/web/src` rather than trusting prose.) Guarded by
  `apps/web/test/history.mjs`, which drives a miniature history stack rather than counting calls.
  `ModalShell` registers with `pushDismiss` only when it has an `onDismiss`, so a modal is
  Back-dismissable exactly when backdrop-click and Escape would close it (a flash in progress is
  not, and becomes so the moment it finishes).
- **`--maxw` (`src/styles/tokens.css`) is the GLOBAL page-width cap**, applied by `.page-body`
  (`src/styles/global.css`) — which every tab's pane uses, not just whichever one you're working
  on. Don't change the token to fix one tab; that was tried once and silently resized every other
  tab too. **There is no per-tab width escape hatch any more**: `Advanced.svelte`'s
  `.shell.wide`/`.narrow` were reinstated for vertical *padding* only and their width caps are
  gone for good (Overview/Library/Sources deliberately share one body width). A tab that looks
  wrong is a question about that tab's own content, not about the page cap.
  Relatedly: a CSS Grid column declared in `fr` units (e.g. `grid-template-columns: 2fr 3fr`)
  always stretches to fill its container's width regardless of what its content actually needs —
  if a grid row looks "too wide," the container's own max-width or the fr ratio is almost always
  the fix, not restructuring the row into a separate shrink-wrapped flex layout (tried once on
  `OverviewTab.svelte`'s dashboard, made the two rows stop lining up in columns, reverted).

- **Every `z-index` comes from the scale in `src/styles/tokens.css`**, and
  `apps/web/test/zlayers.mjs` fails the build on a raw one. Layers bottom-up:
  `--z-raised` (lifted inside one component) · `--z-dock` · `--z-sticky` · `--z-popover` ·
  `--z-tooltip` · `--z-modal` · `--z-modal-prompt` · `--z-modal-alert`. Read the comment block
  beside them for which to pick. Two intra-component exceptions are allowed by name and must
  isolate themselves (`Carousel`'s per-slide order). The Library dock/carousel bug this replaced
  was **not** a number problem: `.dock` was a *static* flex sibling, and CSS paints positioned
  descendants above non-positioned blocks whatever their order — so no z-index on the carousel
  could have fixed it. When layering looks impossible, check for a missing stacking context
  before reaching for a bigger number.
- **Every persisted name goes through `scoped()` (`lib/storageScope.ts`).** localStorage keys,
  both IndexedDB databases and the OPFS directory. Production's scope is empty so its names are
  unchanged; the `/wip/` Pages build sets `PUBLIC_STORAGE_SCOPE` and gets its own storage, which
  is what stops a tester's session from reading and migrating real users' data on the same
  origin. `apps/web/test/storagescope.mjs` enumerates the names and fails if a new one bypasses
  the helper — so a new persisted key is a two-line change, not a one-line one.

### Sources, cores and the Library

- **A source declares what a console is; the scan says which ones have files.** `sources/coreRegistry.ts`
  builds the registry from **active** sources' declared systems (folder, names, extensions,
  browse mode), and a console button exists only where an active core declares the system AND
  the scan found files. This replaced three hardcoded tables that never consulted Sources —
  `romScan.ts`'s `CONSOLE_DIRS`, `romSelection.svelte.ts`'s `CONSOLE_WHITELISTS`, and
  `engine/consoles.ts`'s `LABELS`. **They still exist as a fallback for the empty case** (no core
  registered yet) and to name a console already on the device whose core was later disabled — do
  not delete them, and do not add a fourth. Note that whether a directory *is* a console
  directory is structural and does not depend on activation; whether it gets a *button* does.
- **Three transitional compatibility shims**, each in exactly one place with a documented sunset.
  Do not "tidy" them away, and do not scatter the comparison — that is how the last rename broke
  ten call sites: `isCoreKind()` (`sources/types.ts`) accepts the pre-rename `kind: "emulator"`
  alongside `"core"`; `allowMultipleOf()` (`sources/inputGate.ts`) accepts the pre-rename
  `repeatable` when `allowMultiple` is absent; `outputSpecFor()` (`sources/converterTypes.ts`)
  resolves a module that emits an output's declared *filename* where the spec now requires its
  *id*. Each names the spec commit that renamed the thing and the publisher that still lags.
- **A per-file tool may not also name a fixed output filename** (`sources/converter.ts`'s
  `checkRunShape`, from `gwrg-dist-spec` `44b0bf3`). `runPerFile` means one run per input file,
  so a fixed `filename` would have every run write the same name and clobber its predecessors.
  **The boundary is narrower than that reasoning suggests, and matters**: the refusal fires only
  on the *mixed* shape (a `runPerFile` input AND a derived output AND a fixed filename). A
  per-file tool whose outputs are *all* fixed is an upstream WARN, not an error, and refusing it
  here would break manifests whose publishers were told they were publishable. It lives in
  `prepareTool`, the one chokepoint that sees both halves -- `parseToolInputs`/`parseToolOutputs`
  each see only one. No published project changes status under it.
- **Two older run-shape rules are enforced beside it**, from the same block of the spec's checker.
  State them exactly; loose paraphrases of these have twice nearly caused a publisher-facing break.
  1. `runPerFile && !allowMultiple` is refused (`converter.ts:124`). It is read from the **parsed**
     input, so it resolves through the `allowMultipleOf()` shim -- judging the raw key instead
     would refuse the pre-rename manifests that shim exists to keep working.
  2. `derived.length > 0 && perFile.length !== 1` is refused (`converter.ts:131`). Note `!== 1`:
     this refuses **zero** per-file inputs as well as several, because a name derived from the
     iterated file has no file to derive from. It is gated on a derived output existing, which is
     what keeps the all-fixed WARN shape accepted.
  A fourth ERROR in the same loop (`maxCount` without `allowMultiple`) is deliberately **not**
  implemented: `parseToolInputs` silently drops a non-integer `maxCount`, so checking the parsed
  input would mean something different from the spec's raw-key check. That is a decision, not an
  oversight. All refusals reuse `SourceError("malformed")` with the diagnosis in `detail`, which
  already maps to the `unreadable` prepare group, so none of them needed a full-locale i18n edit.
  **An over-broad refusal here cascades silently**: wrongly refusing every per-file tool stops
  cores becoming titles at all and surfaces as unrelated `titles:` failures with no mention of the
  real cause. Read whole failure lists, not first lines.
- **A converter's output size is not knowable before it runs.** A title's size sums real bytes
  from `prepareState`'s provenance (`produced` + `assetSource`), never a declared-name list —
  `deviceFiles` cannot contain a derived output, which is why a size built from it counted only
  the shipped binary.
- **The firmware's homebrew directory is `/homebrews`, plural; the ROLE is `homebrew`, singular.**
  They differ on purpose and both spellings are load-bearing. An SD scan classifies a key with
  `classifySdScanKey()` (`engine/devicePaths.ts`), which resolves against the manifest's paths —
  it used to take the top path segment literally, so every file under `/homebrews` classified as
  system `homebrews` and was filtered out of every "is it installed" check. **Placement was
  always correct**: do not "fix" this by renaming the on-card directory, which would break a
  working install. The read side is the only side that was wrong.
- **`romScan.ts` must not import `engine/devicePaths.ts`.** That barrel resolves through
  `@gnw/fs-builders`, which re-exports the littlefs WASM vendor, which imports node's `module` —
  and every suite that bundles the scan under `platform: "neutral"` breaks. A caller that has the
  manifest passes the resolved prefixes in (`scanRomDirectory(dir, onFile, hbPrefixes)`); the
  pre-manifest default is spelled out locally as `LEGACY_HOMEBREW_PREFIXES`. A dynamic import is
  no escape — esbuild bundles those too. `sources/discoveryWire.svelte.ts:145-147` records the
  same hazard about the same module.
- **A core's destination is decided in two places that must agree** — `sdDestPath()`
  (`engine/devicePaths.ts`) and `userDest()` (`fs-builders/src/flashImage.ts`). Neither had a
  `paths.cores` case, so a source-supplied core became `roms/cores/<file>` on both. On flash there
  was a second, separate defect: only *bundle* content was split into the cores tree, so the path
  fix alone would have put a correctly-named core in the wrong filesystem. See
  `docs/ARCHITECTURE.md`'s "Where a core's files land". The flash-only split itself is **under
  review** and is not settled — read that section before designing against it.
- **A converter's INPUT is never copied to the device.** `Game.role`'s `ingestable` has said so
  since `gameRows.ts` collapsed an input and its output into one row, but nothing enforced it:
  a row's identity is the INPUT's key, so selecting a Doom game selected `doom/doom.wad` and it
  shipped beside the `.whd` it becomes. Both install flows share that map, so Flash packed them
  into FrogFS too. `romSelection.svelte.ts`'s `plannedInstallNames` now skips them.
- **Multiplicity is carried by structure, never by wording.** `prepareState.supplied` is a
  `Map<string, Set<string>>` (per-input filenames), not a set of input keys — presence with no
  cardinality is what made a row say `2 added` with one Remove that dropped both. Configure draws
  one row per held file, each with its own remove; whether another fits is the picker being
  present or absent (`slotsLeft`), not a pluralised label. `chooseFiles` is deleted in every
  locale. Two i18n keys differing only in plurality are a smell.

### Reusable primitives — check before adding a new one
A cleanup pass (`docs/AUDIT_NOTES.md` — read its "Counts by status" table for what is still
open) consolidated several
duplicated patterns into shared modules. Check these before hand-rolling the equivalent again:
- `apps/web/src/lib/engine/addr.ts` — `EXTBASE`/`BANK_BASE`/`MemReadFn` (device memory-map
  constants + the shared read-closure type).
- `apps/web/src/lib/engine/chunkedRead.ts` — `readMemoryPaced()` for small-chunk/no-delay
  reads. Do NOT use for `screenshot.ts`'s framebuffer read (needs large 64KiB chunks — see the
  watchdog note above).
- `apps/web/src/lib/engine/timeout.ts` — `raceWithFallback()` for simple single-race/no-retry
  timeouts. The other 3 timeout/retry shapes in the codebase are deliberately different and
  already reviewed — don't try to fold them in.
- `apps/web/src/lib/localCrypt.ts` — `obfuscate()`/`deobfuscate()` (AES-GCM, bundle-embedded
  key — obfuscation not real security) for any localStorage value that shouldn't sit around as
  bare plaintext but must be recoverable (e.g. a credential re-sent to a remote API — a
  one-way hash can't work for that case).
- `apps/web/src/lib/ui/ModalShell.svelte` — shared modal backdrop/CSS/dismiss-handling for any
  new modal.
- **Rails: there are two, and there must not be a third.** `advanced/FirmwareRail.svelte` is the
  original; `views/OverviewRail.svelte` reuses its `244px minmax(0, 1fr)` full-bleed grid, its
  `createPaneFooterSlot()` / `PaneFooter` arrangement (the bar is drawn as the pane column's
  second child, not by the pane itself) and its pane-head shape. That reuse is deliberate,
  because the owner asked for the Firmware/Sources rail pattern by name. A new grouped-navigation surface
  extends one of these, it does not invent a third idiom. Overview's rail mounts exactly one of
  `status | details | activity | log` (`OVERVIEW_RAIL_IDS`), deep-linked as `#info/<pane>`.
- `apps/web/src/lib/ui/BankCard.svelte` — the internal-flash bank-bar visualization (stacked
  segment bar + title + optional footer snippet), originally extracted from `OverviewTab.svelte`
  and now drawn by `DetailsPane.svelte` (the bank cards moved there with the Overview rail).
  Supports a non-interactive mode and a `selectable`/`selected`/`onSelect` clickable mode
  (`RomSection.svelte`'s bank picker). Reuse for any future bank-visualization need.
- `apps/web/src/lib/util.ts`'s `download(name, data)` — accepts `Uint8Array | Blob`, use for
  any new download-triggering code instead of a hand-rolled createObjectURL/click/revoke.
- `apps/web/src/lib/auditLog.svelte.ts` is the GLOBAL audit log, distinct from the
  install-progress modal's own per-run log. Four severities, `debug | info | warning | error`, ordered by
  `SEVERITY_RANK` and compared with `atLeast()`. Two rules the owner set, both load-bearing:
  **the bell is errors only** (`notifications` is unseen-and-`error` by construction, so a
  converter's own progress note can never ring it), and **`debug` is a capture mode, not a peer**
  of the other three, so the pane's `"all"` filter excludes it and it sits behind its own toggle.
  `dbg()` (`lib/debug.ts`) feeds it through an **injected** sink (`setDbgSink`), so `debug.ts`
  stays store-free; its `/api/debug` POST only ever reached the Express dev server, which meant
  every diagnostic line was discarded in the deployed build, which is exactly the build where
  someone is asked for a bug report. **Debug has its own 200-entry budget** (`MAX_DEBUG_ENTRIES`) held apart
  from the 500-entry `MAX_ENTRIES` cap, and that separation is the thing that makes the wiring
  safe rather than the pane hiding it: `dbg()` fires per game, cover, cheat and core, so one
  library sync would otherwise flush every error out of a shared ring. Hidden is not evicted.
- **`dbg()` WRITES `$state`, SO WHERE YOU CALL IT IS LOAD-BEARING.** This took down two tabs in
  one afternoon and neither failure named itself. `dbg()` goes through its sink into
  `auditLog.add()`, which assigns `$state`, so:
  - inside a **`$derived`** it throws `state_unsafe_mutation` (Svelte 5 forbids assigning state
    while computing derived state) and whatever read that derived is dead;
  - synchronously inside an **`$effect`** it re-dirties the batch the effect belongs to, so the
    effect reruns, writes again, and the runtime ends it with `effect_update_depth_exceeded`.
    **That error aborts the WHOLE flush**, so every effect declared after the offending one
    silently stops running. A cheats diagnostic is what stopped the Saves tab from loading its
    tree, and nothing pointed at the diagnostic.
  - **`untrack()` fixes neither** — measured, not assumed: synchronous 301 effect runs,
    `untrack(write)` 301, `queueMicrotask(write)` 1.
  **The working shape is to build the line inside and hand it to `dbg()` via `queueMicrotask`.**
  `apps/web/test/effectloop.mjs` pins this by driving the real `auditLog` through a real
  reactive graph, and the same hazard applies to any other store write reachable from a derived
  or an effect — the favourites store hit it with a lazy `load()` called from a `$derived`, which
  left the stars empty for the life of the page and then persisted that emptiness over the real
  list. A store restore belongs in a **constructor or a field initializer**, never a lazy getter.
- `apps/web/src/lib/installProgress.svelte.ts` + `apps/web/src/lib/ui/InstallProgressModal.svelte`
  — the shared phase-checklist/sub-step/audit-log progress modal for ANY device-write or
  long-running operation (flash, SD sync, etc.); call `installProgress.run({title, body, phases,
  checkboxes?, exec})` instead of rendering a modal locally. Its state is store-level singleton
  state (like `device.stubPrompt`/`connectGatePrompt`), not component-local — this is deliberate:
  a component-local version of this modal was once destroyed mid-flash by an unrelated `{#if}`
  unmount elsewhere in the tree (see `docs/AUDIT_NOTES.md` item #17). Any future "must never
  disappear mid-operation" modal must follow this same store-backed-singleton-rendered-at-
  App.svelte-root pattern, never local `$state` inside a conditionally-rendered view.
- `apps/web/src/lib/ui/StatPanel.svelte` — the shared "label / bold value" stat-row list (see its
  own header comment for the three things it replaced). Variants are not interchangeable —
  `card` (standalone bordered box), `bare` (the same rows, no box), `footer` (a light single
  inline caption line under a `GeometryBar`, only fits 1-2 short stats —
  `InstallGeometry.svelte`), `panel-footer` (a fuller boxed footer, several stats one-per-row,
  border-top divider + page background — `DetailsPane.svelte`'s External flash panel), and
  `grid` (a three-column name/After/Change table — `RomManagementTab.svelte`); check the
  `variant` union in the component rather than this list. Rows can set
  `total: true` to render as a trailing aggregate (divider above, bolder) instead of a peer
  category — e.g. RomManagementTab's "Total projected size" row.
- `apps/web/src/lib/i18n/` — the i18n string tables and locale store. **Fifteen locales are
  wired in now: en, de, ar, es, fr, it, ja, ko, no, pl, pt, ru, uk, zh-Hans, zh-Hant** —
  `strings/<area>.ts` (English) has a full sibling
  `strings/<area>.<code>.ts` for all fourteen non-English locales, for every one of the **9** area
  files (`deviceHeader`, `firmwareSetup`, `landing`, `overview`, `overviewRail`, `roms`,
  `shared`, `sources`, `wizard`), **135 files in all**. `overviewRail` is the Overview rail's own
  area, added with it; a new area must also be registered in all fifteen assemblers
  (`i18n/<code>.ts`) and listed in `test/firstrun.mjs`'s `AREAS`, or its dead strings are
  invisible to the orphan check. Every non-English sibling is type-checked against the SAME English shape via each
  area's `Widen<...>` mapped type — **not just German**. Adding one key to an English area file
  is therefore a compile error in **all fourteen** sibling files at once, and landing a new
  user-visible string is a **15-file edit** (the English source plus all fourteen translations) —
  never English-only, and never English + one other locale. An agent that assumed German was
  the only compile-checked sibling added a key to en+de only, hit five unrelated compile errors
  from the other locales, and had to back the change out — don't repeat that. Placeholder
  English text copy-pasted into the other fourteen files to silence the compiler is not acceptable;
  each key needs a real translation. Read strings via `locale.t.<area>.<key>`. Runtime/
  device-derived text (version numbers, model names, byte counts) stays in component logic —
  only translate the literal surrounding copy, using a typed function entry (e.g.
  `connectedAs: (label: string) => ...`) for interpolation.
  - **Adding a locale beyond the fifteen already wired in**: create NEW sibling files
    `strings/<area>.<code>.ts` (e.g. `strings/deviceHeader.fr.ts` exporting
    `deviceHeaderFr: DeviceHeaderStrings`) — never edit the original English file, and never
    edit another locale's file. This is what lets every language be worked on in total
    isolation (safe to hand to separate agents, even in parallel, since no two languages ever
    touch the same file). Once a locale's 9 files exist, wire it in with a small assembler
    `apps/web/src/lib/i18n/<code>.ts` (mirrors `en.ts`/`de.ts`) that calls
    `registerLocale(code, {...})`, registered via a side-effect import added to
    `registerLocales.ts` (imported once from `App.svelte`) — NOT imported directly from
    `locale.svelte.ts`, which would create a circular import (the assembler imports
    `registerLocale` FROM `locale.svelte.ts`). `locale.svelte.ts`'s `registry` falls back to
    English for any locale in `SUPPORTED_LOCALES` not yet registered, so the switcher can
    safely list a locale before its translation exists. Check STATUS.md's i18n bullet for
    which locales beyond the fifteen (if any) are in progress — that state changes fast.
    **`nl` is the live example of that gap**: it is declared in `SUPPORTED_LOCALES` and in the
    `Locale` union, and it has ZERO string files. It does not reach the picker because
    `DeviceHeader.svelte` filters the list through `isRegistered()`, so the switcher shows the
    fifteen that exist rather than the sixteen that are declared. Writing Dutch means creating
    its 9 files and an assembler; deleting it means removing two lines in `locale.svelte.ts`.
    Either is fine, but the declaration on its own buys nothing.
  - **Recurring translation bug to watch for**: keys named with a `Pre`/`Mid`/`Post`/`Bold`
    pattern exist because a `.svelte` component interleaves them around an inline `<code>`/
    `<strong>` element, concatenated by the template with literal spaces — e.g.
    `expertCornerEn.rawPatchWillPre` + literal `<code>/dev</code>` + `rawPatchWillPost`.
    Translating each fragment in isolation (without reading the actual `.svelte` template to see
    how they concatenate) produces a grammatically broken composed sentence in languages with
    different word order/agreement than English — this actually happened in the French pass and
    had to be fixed by re-splitting the words across the Pre/Post boundary, not by touching the
    template. Always find the component (grep the key name across `apps/web/src/lib/**/*.svelte`)
    and mentally compose the full sentence before finalizing any such key, in any language.
See `.claude/projects/.../memory/code-cleanup-audit-2026-07.md` and
`.claude/projects/.../memory/install-progress-modal.md` for the full list, including
several "looked like duplication, turned out not to be" false positives (Card.svelte/
Button.svelte adoption, tokens.css's dark-theme block) — don't re-attempt those.

### Incremental Flashing (FrogFS)
- The flash verification system operates on 256KB chunks. Adding data (like a new ROM) pushes the payload size out without shifting the start locations of existing payloads *as long as* `opts.dataStart` is meticulously preserved when regenerating the FrogFS image.
- When troubleshooting incremental differential flashes (skipping behavior):
  - Missing skips are almost universally caused by `opts.dataStart` shifting, invalidating every hash block.
  - Device stub skips happen incredibly fast (~20-30ms) compared to an actual erase/flash operation (~500ms).

### Documentation guards (they run in `npm run check` / `npm run build` for `@gnw/web`)
- `apps/web/test/conformance-counts.mjs` — re-derives the per-status counts of both artboard
  surveys by the rule `docs/CONFORMANCE.md` states, and diffs them against that file's
  scoreboard table. Five passes once produced five conflicting answers; the two parser traps
  that caused it (the empty leading cell of a `|`-prefixed markdown row; the trailing full stop
  on `**BLOCKED**.`) are implemented explicitly in the guard — read it before re-deriving
  anything by hand. It covers the live scoreboard table only, not the dated prose figures.
- `apps/web/test/artboard-index.mjs` — every `docs/design/mockups/*.dc.html` must appear in the
  README index table and in `canvas.json`, and neither may name a board that does not exist
  (an audit once found 23 of 57 boards unindexed after a nine-name spot check declared it fine).
- Both exit non-zero if they cannot actually run (missing file, unparseable table, zero rows
  parsed) rather than printing a green line. Do not "fix" a survey status cell to make a count
  guard pass — the header is the thing that is wrong.

### Code guards added since (same `check`/`build` runs)
Three that constrain how you write, not just what you document. Each was written after the bug
it now prevents, and each is **general** rather than a restatement of the one case that prompted
it, so a differently-named instance of the same mistake still fails.
- `apps/web/test/errorsurface.mjs` — **an error a user can hit must reach the activity log.**
  Nothing may report only to the browser console (a deployed build cannot show it and a bug
  report cannot carry it), and an error captured into store state must carry that failure into
  the log. The census that produced it: **273 catch sites in `src/`, exactly one reached
  `auditLog.add`.** A failed Recovery Mode boot wrote `device.error`, which no component renders,
  so a real race read as a button that did nothing. Deliberate silence is still allowed (storage
  in private mode, optional probes) — the guard checks the sites that capture, not every catch.
- `apps/web/test/direction.mjs` — **no physical inline CSS property anywhere in `src/`.** No
  `padding-left`/`margin-right`/`text-align: left`/`float`, no asymmetric four-value shorthand;
  use `padding-inline-start`, `text-align: start` and friends. Arabic is wired and the app
  mirrors, and a physical property looks correct in LTR precisely because the physical side
  happens to coincide. Physical insets must be symmetric, a centring pair, or in the guard's
  named exception list with a reason.
- `apps/web/test/effectloop.mjs` — the `dbg()`-inside-an-effect hazard described in the
  `auditLog` bullet above. Pinned by driving the real store through a real reactive graph,
  because no static gate sees it.
- **Rendering beats reading for anything in a `.svelte` file.** `activitypane.mjs`,
  `choosercommit.mjs`, `landingshift.mjs`, `libraryrow.mjs` and `sdpane.mjs` compile the real
  component with the real Svelte compiler and assert over the rendered markup;
  `optionsmodal.mjs` and `direction.mjs` read the **emitted** stylesheet rather than the source,
  because Svelte scopes rules inside `:where(...)`, which carries **zero specificity** — reasoning
  about the source gets the cascade wrong. Three static gates and 22 targeted checks all passed
  on a component whose tabs did not work; only a rendering check caught it.
- **No hand-written file in `apps/web` may carry a raw NUL byte** (`src/lib/sources/test/validate.mjs`,
  near the end). Write the escape, not the byte. This is not cosmetic: **`git` and `grep` classify
  such a file as binary and skip it**, so a grep-based audit reports clean on a file it never read,
  and a diff shows `Bin` instead of the change. It has happened twice — first in
  `sources/outputNames.ts`, then in `test/sourceremoval.mjs`, both a composite map-key separator
  written as the byte instead of the escape its sibling (`prepareState.svelte.ts`'s `NOTICE_SEP`)
  uses correctly. The guard was scoped to `src/lib/sources` when the second one landed, which is
  exactly why it landed; it now walks `src/` and `test/` together.
