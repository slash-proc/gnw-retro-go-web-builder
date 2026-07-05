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
- **Screenshot pattern (halt/read/resume)**: `captureScreenshot` in `engine/screenshot.ts` always halts the CPU for a tear-free frame. Key invariants:
  - Use **64 KiB chunks** for the framebuffer read (`readMemory(addr, 65536)` with a 10 ms delay between chunks). This keeps the internal per-chunk delays inside the serialTransport queue entry (`busy()=true`), so the liveness poll cannot interleave and fire its 300 ms timeout mid-screenshot.
  - **Stop the poll** (`this.stopPoll()`) in `device.captureScreenshot` before calling the engine function, restart in `finally`. The poll is for idle-period loss detection; the screenshot's own transport calls surface any live loss.
  - Never skip the halt/resume (even with the gnwmanager stub loaded). The stub does not configure LTDC after reset, so the registers would be garbage without a halt of a running Retro-Go session.
  - **BOTH firmwares we ever halt into run a hardware watchdog with a sub-second window, refreshed only by their own main loop**, and neither is frozen by default when the core halts for debug: Retro-Go's app firmware runs WWDG1 (`references/game-and-watch-retro-go-sd/Core/Src/main.c` `HAL_WWDG_Refresh`); the gnwmanager RAM stub (the flash util) runs IWDG1 (`references/gnwmanager/Core/Src/main.c` `HAL_IWDG_Refresh`, ~512ms window on the LSI clock). `SwdTransport.halt()`/`resume()` (`packages/swd-transport/src/index.ts`) freeze/unfreeze BOTH unconditionally via `DBGMCU.APB3FZ1` bit 6 (`DBG_WWDG1`, addr `0x5c001034`) and `DBGMCU.APB4FZ1` bit 18 (`DBG_IWDG1`, addr `0x5c001054`) — we don't know which firmware is running, so freezing the inactive one is a harmless no-op. This was the ACTUAL cause of the device resetting mid-screenshot (reproducible both with Retro-Go running AND with the flash util loaded) — not any JS-level timeout/retry/poll logic. If a halt-based read starts resetting the device again, check BOTH freeze bits are still being set before suspecting the app-layer transport/poll code.
  - The `flashImage` watchdog (`engine/flasher.ts`) surfaces stall errors to the caller. Auto-retry (reboot the RAM stub + retry, 3 attempts total) was removed then reintroduced (2026-07-03) once flashing started pausing the liveness poll (`device.suspendPoll()`/`resumePoll()`, same pattern as the screenshot halt/resume above) around every flash-writing call — that closed the actual race (a silent `transport.reset()` via `bootStub` racing an independent concurrent SWD user like the poll or a screenshot), so retry no longer needs to stay disabled. Any flasher-getter passed below a flow's own initial (already-confirmed) `ensureStub()` call must always force silently (`() => device.ensureStub(undefined, true)`) — never let `flashImage`'s internal per-attempt retry flag decide `forceReboot`, or a stale stub between chunks can re-surface `StubLoadModal`'s confirmation mid-operation for consent the user already gave once.
  - `packages/gnw-flasher`'s `program()` must wait for the firmware's global `STATUS` register to reach `IDLE` (`waitForIdle()`) AFTER a context's `READY` flag clears — the firmware (`references/gnwmanager/Core/Src/gnwmanager.c`) clears `READY` right after the RAM buffer transfer, well before erase/program/hash-verify even start. Treating `READY`-cleared alone as "done" (as our port did until this was found and fixed) causes both a stuck on-device progress bar and spurious stall-watchdog trips. When debugging this protocol, read the actual firmware C source in `references/gnwmanager`, not just the Python host tool — the Python tool's usage pattern implies requirements the C source states explicitly.
  - **`program()`'s per-chunk context-buffer write does NOT read back/verify by default** (`verify: false` at every real call site — `flashInstall.ts`'s `flashRegion()`, `engine/flasher.ts`'s `flashImage()`). This was a deliberate reversal (2026-07-04) of a self-inflicted regression: a full read-back verify of the entire payload (up to 256KB, in 16KB sub-chunks each with its own settle/throttle delay) ran on EVERY chunk of EVERY flash operation, roughly tripling the WebUSB transaction count per chunk — `references/gnwmanager`'s reference Python has no equivalent at all, it trusts the device's own `BAD_HASH_RAM(_COMPRESSED)` check plus the chunk-retry handshake (`tryChunkRetry`, still correctly ported) entirely. The extra read-back directly fed the documented ST-Link-clone USB-saturation lockup risk below, and (compounded by a same-day, now-reverted 120s→15s watchdog tightening) was the actual cause of a months-long "flashing has gotten slower and janker" regression report. **The one-time stub firmware load in `startStub()` KEEPS `verify: true` hardcoded — a corrupt stub hardfaults, so that one read-back (once, small) is cheap and genuinely justified; don't remove it there.** If you're tempted to add read-back verification to a NEW per-chunk write path, check gnwmanager's Python first — if it doesn't verify there either, don't add it; trust the device-side hash check. See `.claude/projects/.../memory/flash-verify-overhead-regression.md`.
  - The flash stall watchdog (`engine/flasher.ts`'s `flashImage()`) is **120 seconds of no progress**, not 15 — a same-day 15s tightening (chasing the symptom of the read-back-verify bug above) was reverted once the actual cause was found. `Wizard.svelte` has TWO sibling `withTimeout(...)` outer guards wrapping flash calls (same no-progress-resets-timer semantics) that must both stay `>=` this inner watchdog's threshold, or the outer one fires first and false-aborts a slow-but-healthy transfer — check both stay in sync if this value ever changes again.

### Frontend State & Contexts
- Access device properties explicitly using the `firmware` property, not the `type` property (e.g., `if (device.firmware === 'retro-go')`). The central `device` store (`device.svelte.ts`) maps classification explicitly to `.firmware`.
- **SD mode vs Flash mode share UI, not budget logic.** `RomManagementTab.svelte`'s game-selection table (Select All / per-game toggles) is rendered ABOVE the `device.targetMedia === "sd"` split, so it's common to both modes. Anything reading `device.partitions`/`device.info`-derived state (`frogfsOffset`, `ceilingOffset`, `fitsGap`, `validateFit()`, the FrogFS-preview-build effect) is a Flash-only concept (the device's real flash-chip gap) and MUST early-out on `device.targetMedia === "sd"` — a device merely being connected while the user manages SD content is not a signal that Flash's constraints apply. This bit us once already (docs/AUDIT_NOTES.md item #14); don't reintroduce it when touching this shared table.
- `runInstall()` (Flash) and `doSdSync()` (SD) in `RomManagementTab.svelte` are two separate functions, not one function branching on `targetMedia` — don't conflate them when reading/editing this file.
- **`--maxw` (`styles/tokens.css`) is the GLOBAL page-width cap** — `App.svelte`'s outer `.body`
  wrapper uses it for every tab, not just whichever one you're currently working on. If a single
  tab looks too wide/narrow, scope the fix to that tab's own container (e.g.
  `Advanced.svelte`'s per-tab `.shell.wide`/`.shell.narrow` modifier classes) — don't change this
  token itself; that was tried once and silently widened/narrowed every other tab along with it.
  Relatedly: a CSS Grid column declared in `fr` units (e.g. `grid-template-columns: 2fr 3fr`)
  always stretches to fill its container's width regardless of what its content actually needs —
  if a grid row looks "too wide," the container's own max-width or the fr ratio is almost always
  the fix, not restructuring the row into a separate shrink-wrapped flex layout (tried once on
  `OverviewTab.svelte`'s dashboard, made the two rows stop lining up in columns, reverted).

### Reusable primitives — check before adding a new one
A cleanup pass (`docs/AUDIT_NOTES.md`, now 19 items, batches 1-6 fixed) consolidated several
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
- `apps/web/src/lib/ui/BankCard.svelte` — the internal-flash bank-bar visualization (stacked
  segment bar + title + optional footer snippet), extracted from `OverviewTab.svelte`. Supports
  a non-interactive mode (Overview tab, unchanged) and a `selectable`/`selected`/`onSelect` clickable
  mode (`RomSection.svelte`'s bank picker). Reuse for any future bank-visualization need.
- `apps/web/src/lib/util.ts`'s `download(name, data)` — accepts `Uint8Array | Blob`, use for
  any new download-triggering code instead of a hand-rolled createObjectURL/click/revoke.
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
  own header comment for the three things it replaced). Three variants, not interchangeable:
  `card` (standalone bordered box), `footer` (a light single inline caption line under a
  `GeometryBar`, only fits 1-2 short stats — `InstallGeometry.svelte`'s Flash-mode footer),
  `panel-footer` (a fuller boxed footer with several stats stacked one-per-row, border-top
  divider + page background — `OverviewTab.svelte`'s External Flash panel). Rows can set
  `total: true` to render as a trailing aggregate (divider above, bolder) instead of a peer
  category — e.g. RomManagementTab's "Total projected size" row.
- `apps/web/src/lib/i18n/` — the i18n string tables and locale store (full app coverage done for
  en/de; 11 more locales in progress — see STATUS.md's i18n bullet for the exact current state,
  since that changes fast). Any new UI string goes in `apps/web/src/lib/i18n/strings/<area>.ts`
  first (English + German — its per-group `Widen<...>` type is what German is checked against,
  so a missing German key is a compile error), then read it via `locale.t.<area>.<key>`.
  Runtime/device-derived text (version numbers, model names, byte counts) stays in component
  logic — only translate the literal surrounding copy, using a typed function entry (e.g.
  `connectedAs: (label: string) => ...`) for interpolation.
  - **Adding a new locale (beyond en/de)**: create NEW sibling files
    `strings/<area>.<code>.ts` (e.g. `strings/deviceHeader.fr.ts` exporting
    `deviceHeaderFr: DeviceHeaderStrings`) — never edit the original English/German file. This
    is what lets every language be worked on in total isolation (safe to hand to separate
    agents, even in parallel, since no two languages ever touch the same file). Once a locale's
    7 files exist, wire it in with a small assembler `apps/web/src/lib/i18n/<code>.ts` (mirrors
    `en.ts`/`de.ts`) that calls `registerLocale(code, {...})`, registered via a side-effect
    import added to `registerLocales.ts` (imported once from `App.svelte`) — NOT imported
    directly from `locale.svelte.ts`, which would create a circular import (the assembler
    imports `registerLocale` FROM `locale.svelte.ts`). `locale.svelte.ts`'s `registry` falls
    back to English for any locale in `SUPPORTED_LOCALES` not yet registered, so the switcher
    can safely list a locale before its translation exists.
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
