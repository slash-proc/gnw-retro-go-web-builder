# Project Status

This document is the definitive source of truth for the current state of the Game & Watch Web Builder project. 

## Overarching To-Do / Feature Matrix

### Implemented & Working
- [ ] **i18n (7 of 13 locales done — en, de, fr, ja, ko, es, pl; 6 remaining, rollout paused):** Hand-rolled locale infra — `apps/web/src/lib/i18n/` (`widen.ts`'s `Widen<T>` mapped type; per-feature-area files under `strings/` — `deviceHeader.ts`, `landing.ts`, `shared.ts`, `overview.ts`, `wizard.ts`, `firmwareSetup.ts`, `roms.ts` — each exporting an `xEn`/`xDe` pair type-checked against each other so a missing/extra key is a compile error). No library (`svelte-i18n` etc.) — this app's needs (short strings, light interpolation, no pluralization/RTL for en/de) don't justify one. Every view/component with real user-facing text is converted (a handful of pure layout/props components — `Button.svelte`, `Badge.svelte`, `Card.svelte`, `ModalShell.svelte`, `Progress.svelte`, `StatPanel.svelte`, `ChangeSummary.svelte`, `GeometryBar.svelte`, `InfoTip.svelte`, `App.svelte` — correctly have no strings of their own). Runtime/device-derived text (version numbers, model names, byte counts, ROM/game names, caught-error messages) is never in the string tables — only literal surrounding copy is, via typed interpolation functions. German is a real, reviewed translation (not machine-literal placeholder text) — natural/contemporary tone, established term consistency across files (e.g. "Recovery-Modus", "Gepatcht"/"Original").
  - **Multi-locale expansion (PAUSED 2026-07 — owner hit a token budget limit, resume only when asked):** target set is 13 locales total: en, de, fr, ja, ko, es, pl (all DONE, wired in) — nl, pt, zh-Hans, zh-Hant, ru, uk, no (NOT yet started; see `.claude/projects/.../memory/i18n-multilocale-rollout.md` for the exact dispatch-prompt template and per-language notes to resume with). `locale.svelte.ts` now holds a `Locale` union of all 13 + a `registry: Partial<Record<Locale, Strings>>` populated at runtime via `registerLocale(code, strings)`, so a locale listed in `SUPPORTED_LOCALES` (drives the header's `<select>`, which replaced the old EN/DE-only toggle button) but not yet translated silently falls back to English instead of crashing. Per-locale translations live in NEW sibling files, never editing the original English/German source: `strings/<area>.<code>.ts` (e.g. `strings/deviceHeader.fr.ts` → `export const deviceHeaderFr: DeviceHeaderStrings = {...}`), which keeps every language's translation agent working on entirely disjoint files with zero collision risk even when dispatched in parallel. Each finished locale gets a small assembler `apps/web/src/lib/i18n/<code>.ts` (mirrors `en.ts`/`de.ts`, imports all 7 files' exports for that locale and calls `registerLocale`) wired in via a side-effect import added to `apps/web/src/lib/i18n/registerLocales.ts` (imported once from `App.svelte`) — deliberately NOT imported directly from `locale.svelte.ts` itself, which would create a circular import (each assembler imports `registerLocale` FROM `locale.svelte.ts`). This wiring step (creating the 8th file + one line in `registerLocales.ts`) is done by the orchestrating session, never by a translation agent.
  - **Translation-agent dispatch pattern**: one very long, precise, context-loaded prompt per locale (repo/product context, the exact architecture above, the file list to create, an explicit quality bar modeled on the German pass's standard, domain terms to keep as loanwords vs. translate — Retro-Go/Mario/Zelda never translated — and an instruction to keep recurring concepts like "Recovery Mode" and "Patched"/"Stock" identically worded across all 7 files). Owner explicitly wants these dispatched **one at a time, sequentially, not in parallel** (a deliberate choice, not a technical constraint — the architecture above WOULD support safe parallel dispatch since each locale's files are disjoint, but owner wants to review each language as it lands before starting the next). After each agent reports back, the orchestrating session independently reruns `docker compose exec dev npm run check --workspace @gnw/web`, spot-reads a sample of the actual translated files (not just trusting the agent's self-report), then does the assembler-wiring step above.
  - **Known recurring bug class**: "Pre/Mid/Post/Bold"-style split keys exist because a `.svelte` component interleaves translated fragments around an inline `<code>`/`<strong>` element (e.g. `expertCornerEn.rawPatchWillPre` + literal `<code>/dev</code>` + `rawPatchWillPost`), concatenated by the template with literal spaces. The French pass got two of these grammatically wrong (an article ended up glued directly to unrelated text with no verb/preposition connecting them) because it translated each fragment in isolation instead of composing the full sentence first — caught by owner review, fixed by editing the fragment split itself (moving words between the Pre/Mid and Post/Body fragments so the concatenated result is one grammatical sentence), not by touching the `.svelte` template. Every subsequent language's dispatch prompt now explicitly warns about this exact failure mode and requires composing the full sentence mentally (or actually) before finalizing any such key.
- [x] **WebUSB / Device Flasher:** Read/Write flash operations, verification, and chunking (via `@gnw/gnw-flasher`).
- [x] **FrogFS Building:** Creating valid FrogFS images from user ROMs (`@gnw/fs-builders`).
- [x] **LittleFS Building:** Formatting and packing `cores/` into LittleFS (`@gnw/fs-builders`).
- [x] **Thumb Assembler:** Assembling ARM Thumb-2 patches for the firmware.
- [x] **Firmware Patching:** Modifying Mario/Zelda/etc. OFWs dynamically.
- [x] **File Browser (Read-Only):** Extracting and viewing file structures from FrogFS and LittleFS partitions on the device.
- [x] **Artifact Pipeline:** GitHub Actions workflow correctly packs and tags `retro-go` release bundles (`v1.3.1-xx-gXXXXX`) for consumption.

### Not Properly Implemented Yet (TODO)
- [ ] **ROM Management: Version Independence:** When adding ROMs, the tool currently repacks the FrogFS using `bios`, `fonts`, and `lang` files from the *latest GitHub bundle*. Because the device's `cores` (living in LittleFS) are left untouched during a ROM flash, this can create a severe version mismatch. **Fix:** We must extract the `bios/fonts/lang` system files directly from the device's existing FrogFS (just like we do for missing ROMs) to guarantee the newly packed FrogFS perfectly matches the untouched LittleFS cores.
- [ ] **ROM Management: Idempotency & Block Shifting:** Adding new ROMs currently re-alphabetizes the FrogFS payload, shifting the byte addresses of all subsequent games. This invalidates the 256KB block hashes and breaks differential flash skipping. **Fix:** When repacking the FrogFS, we must parse the device's existing FrogFS offsets and pack the files back in that exact order (lowest to highest address). This guarantees an append-only strategy where new ROMs are tacked onto the end, preserving all existing 256KB block boundaries.
- [x] **SD Content Sync (ROM Management Tab):** "Sync SD Card" in the ROMs tab writes ROM files, covers, BIOS assets, and cheats directly to the picked SD card folder via the File System Access API. Path mapping: `covers/`, `bios/`, `cheats/` stay at the SD root; ROMs get a `roms/` prefix (`GBC/zelda.gbc` → `roms/GBC/zelda.gbc`). No device connection required. **Diff-based (fixed 2026-07-03):** only writes newly-added games and files marked dirty since the last sync (`roms.dirtyFiles`), not a blanket rewrite of the whole selection every click. Cores/bios/fonts (the bulk of the sync's data) are gated behind an off-by-default "Sync cores / system files" checkbox — only fetched/written when explicitly preparing the card for a firmware/cores update. The Guided Wizard still handles the base SD install (intflash blob + sdContent cores).
- [ ] **SD Card Auto-Detection (`sdPresent`):** The device store has a placeholder for detecting whether the connected device has the SD mod hardware (so the app could automatically default to SD mode on connect). Currently always `null`; the user must manually select their target media. Whether the SD mod is detectable via SWD probing without an SD card inserted is currently unknown.
- [x] **Screenshots:** The Device / Retro-Go Management tab now properly decodes and displays RGB565 screenshots natively in the browser.
- [x] **Cover Art:** Supported through scanning `covers/` in the ROM folder and appending them to the FrogFS image. The UI now features a fully reactive 3D Cover Flow carousel and includes built-in ScreenScraper API integration for both single-game and bulk batch scraping.
- [x] **Saves Management:** Implemented a fast, lazy-loading LittleFS browser (`lfsBrowser.ts`) to view saves and screenshots without dumping the entire partition. Saves and raw screenshots can be downloaded directly from the UI. (Upload/Restore functionality may still need work).
- [x] **Cheat Codes:** Implemented. UI natively supports parsing `.ggcodes` files sitting next to ROMs, displaying them in a ledger, and automatically packing modified cheats back into the FrogFS payload natively without descriptions to ensure Retro-Go compatibility.
- [x] **LittleFS Migration during Upgrade:** Implemented. When upgrading the firmware (and deploying new emulator cores to LittleFS), the UI seamlessly extracts existing `/data` and `CONFIG` elements from the device's LittleFS and splices them natively into the newly generated LittleFS filesystem.
- [x] **Homebrew Ports (SMW/Zelda3):** Implemented using a native WASM `restool` port rather than Pyodide. The UI smoothly integrates Homebrew directly into the ROM selection table, tracking missing assets, triggering extraction, and cleanly showing footprint sizes just like standard emulated games.
- [x] **SD Card Install Mode:** The app fully supports the SD-capable Retro-Go firmware variant. The user selects a target media (`flash` vs `sd card`) and the install pipeline branches accordingly. The SD path flashes only intflash (using `sd_1`/`sd_2` blobs from the CI artifact bundle), then writes `sdContent` (cores, bios, fonts) directly to the user's SD card directory via the File System Access API. The folder handle is persisted across page reloads via IndexedDB. Device classification distinguishes `retrogo-sd` (current SD install) and `retrogo-old` (older Retro-Go without the SD version string) — this is about firmware *vintage* (the upstream fork name), separate from the newer `installOrigin` field (below) which is about which of THIS tool's own install paths produced the image. In SD mode, the installed games list is populated by scanning the SD card directory rather than reading device FrogFS.
- [x] **Flash vs SD install origin detection (`installOrigin`):** Reads gnw-patch's layout superblock directly off intflash (already probed for "is this web-builder-aware at all") and checks its `FLAG_LITTLEFS_LENGTH` flag — set only when this tool's Flash-mode build path passes a `littlefsLength` (SD-mode's `patchSuperblock` call never does). `"flash"` / `"sd"` / `"old"` (no layout superblock at all — foreign/pre-web-builder image). Deliberately NOT based on whether the extflash scan finds a real LittleFS partition — that scan can miss one even on a genuine Flash-mode device. Surfaced as a soft, non-blocking notice in `RomSection.svelte` if it disagrees with the currently-selected install mode ("complain, don't harass" — no modal, nothing blocked).
- [x] **RomSection ("Install/Reinstall Retro-Go") redesign:** Auto-renamed title (Install vs. Reinstall based on whether Retro-Go is found anywhere on the device). Version picker simplified to a single dropdown (no more installed→target chip pair — the status bar already shows the installed version). Bank selector now reuses `ui/BankCard.svelte` (shared with the Overview tab) as a real clickable selected/unselected toggle instead of a hidden `<select>`. The device's current flash-layout geometry bar moved into the collapsed "Layout (advanced)" dropdown, and (Flash mode) now shows a real FrogFS/LittleFS PROJECTION of what the install will do — hatched "will be (re)written" styling on both regions always (they're always rewritten regardless of migrate checkboxes; only the size shown differs by migrate state). SD mode's install now also mirrors Wizard.svelte's SD-card folder-gate + cores-sync-to-SD-card behavior that RomSection was previously missing entirely.
- [x] **UX Navigation Overhaul (`feature/ux-flow-overhaul`):**
  - **Guided Setup auto-routing:** "Manage Device" always lands on the Overview tab first. After the device scan completes (`banks.length > 0` guard — `applyInfo()` sets `firmware` prematurely before the scan), if firmware is not `retro-go`, the app routes to Guided Setup (wizard mode). Routing is skipped if the device was already connected at navigate time.
  - **FolderGateModal:** Global modal (`lib/ui/FolderGateModal.svelte`) that fires when the ROM Management tab opens without required folders selected. Driven by `roms.ensureFolders(sd)` (Promise-gate pattern matching `StubLoadModal`). Shows ROM folder + SD folder rows in SD mode; Continue enabled once all handles are set.
  - **ConnectAdapterModal:** Shown in Guided Setup (`Advanced.svelte`) when device is not connected. "Connect Adapter" tries trusted probe first (no forced picker); "Back" returns to the Overview tab.
  - **SD mode ROM tab:** No device/partition/baseInstalled gate in SD mode (SD installs don't require SWD). Space shown as recursive FSAA file-size scan of the SD handle (`sdUsedBytes`) — no web API exposes total/free capacity for a picked directory.
  - **Auto-reconnect after device restart:** Module-level `navigator.usb.addEventListener("connect", ...)` in `device.svelte.ts` calls `connectSilent()` when any USB device re-enumerates. Handles the common case where the ST-Link probe briefly drops USB after a target reset. `connectSilent()` now also works from the `"lost"` state (not just `"disconnected"`).
  - **DeviceControls reconnect:** superseded by the header/status-icon merge below — "Change Adapter" now always uses `forcePicker: true` for explicit adapter switching.
- [x] **Overview tab + header + Firmware Setup UX pass:**
  - **"Information" tab renamed "Overview"** (file: `DeviceInfoTab.svelte` → `views/OverviewTab.svelte`). Every reference across the codebase/docs renamed to match (internal `Tab = "info"` id and its `#info` hash-URL segment deliberately left alone — those are routing internals, not user-facing text, and renaming them would break existing bookmarked hash links for no visible benefit).
  - **Overview dashboard restructure:** "Model" row dropped (redundant with "Game & Watch"); "Firmware"/"Base Firmware" renamed "Retro-Go"/"Game & Watch" (in that order); Retro-Go's value is now the bare version only (reuses `DeviceHeader.svelte`'s existing `.replace(/^Retro-Go\s*(SD\s*)?/, "")` pattern that already strips the "SD" fork name). The "Info" card and "Controls" card (was "Device Controls") are now two separately-boxed cards stacked in the left column, and the screenshot viewport got pulled into its own card on the right — fixed at the G&W's native 320x240 (never fluid/scaled), centered via `margin: 0 auto`. The dashboard is a single `grid-template-columns: 2fr 2.5fr` (top row: Info/Controls + screenshot; bottom row: bank cards + external-flash geometry bar) — the two rows share those columns on purpose so they stay lined up; an attempt to let the top row shrink-wrap to its own content independently of the bottom row was reverted (see CLAUDE.md's `--maxw`/grid-`fr` gotcha). Overview's own `.shell` width is capped at 900px via a `.shell.narrow` modifier scoped to just this tab in `Advanced.svelte` — NOT the global `--maxw` token, which affects every tab.
  - **Firmware Setup tab (`RetroGoTab.svelte`/`Advanced.svelte`) accordion fix:** removed the reactive "auto-open the firmware-appropriate default section" mechanism entirely — it read `device.banks`/`device.partitions`, which are empty at mount and settle asynchronously mid-scan, so a section would pop open pre-scan, re-target itself as the scan progressed, then sometimes auto-close once "fully installed" resolved, all without the user clicking anything. Every section (including Install/Reinstall Retro-Go, Dump/Write/Erase Flash — renamed from "Dump flash"/"Flash image"/"Erase flash") now opens only on an explicit click or a hash deep-link, and shows a "Scanning device…" placeholder if opened while `device.scanning` is true instead of rendering bank-picker content that would jump once the scan resolves.
  - **Header status icon + device-actions menu merged:** the console-icon status LED in the header's overview line (colored red/yellow/green) and the separate top-right hamburger-icon dropdown (`DeviceControls.svelte`) were two unrelated controls — now one. Click always opens a dropdown (previously the icon's click directly triggered a scan); a small caret badge signals it's clickable. Menu options vary by state — connected+recovery-mode: Rescan / Restart Recovery Mode / Change Adapter / Disconnect Device; connected+app: Start Recovery Mode / Change Adapter / Disconnect Device; disconnected: Connect / Change Adapter — dropped emojis and the Debug-Log/Take-Screenshot items (redundant with Overview's own Controls card). The icon + status text are now a permanent fixture of the header (render regardless of connection state); only the Retro-Go/OFW version rows next to them stay connection-gated.
  - **RomManagementTab summary polish:** "Total projected size" (both Flash and SD mode) marked as a `StatPanel`/`ChangeSummary` `total` row (divider + bold, reads as an aggregate rather than a peer category). ROMs row no longer turns green before anything's actually changed. SD mode's "Cores / system files" row is hidden entirely unless the "Upgrade Retro-Go and Emulators" checkbox is on (checkbox moved above the summary panel), and when shown now displays a real emulator/file count + version (fetched from the release bundle the moment the checkbox is checked) instead of a static "Will be re-synced" string — trade-off: this fetches the (large) bundle eagerly on checkbox-check, then fetches it again at actual sync time; not de-duplicated (would mean holding the full multi-MB bundle in memory for the tab's lifetime).

## Code Quality / Cleanup Pass (in progress)

A full-codebase audit is tracked in [`docs/AUDIT_NOTES.md`](./docs/AUDIT_NOTES.md) (19 items:
timeout/retry sprawl, chunked-read pacing, engine-layer constant duplication, download-blob
helpers, modal shell duplication, LED-color tokens, `packages/` internal dedup, the
install-progress-modal architecture fix, a `gnw-flasher` protocol bug, flash auto-retry, and more).
Batches 1-6 of the execution plan are fixed (dead code removed, plaintext-password fix,
constants/types consolidated, download helper unified, modal shell + LED tokens extracted).
Batches 7-9 (localStorage key-prefix migration, shared gating getters, and a higher-risk
device-store state-ownership consolidation) are still open — see
`.claude/plans/jaunty-squishing-marble.md`. Several UI-visible changes from this pass
(password-obfuscation UI, SD/Flash budget-check fix, modal styling, LED colors) are pending
real-browser visual verification.

## Install/Flash Progress UI (DONE, pending final real-hardware sign-off)

A shared `InstallProgressModal.svelte` + `installProgress.svelte.ts` store replaced the ad hoc
`ConfirmModal`/status-string/`InstallLog` progress displays across all device-write flows:
`RomSection.svelte`'s Install/Repair flash, `Wizard.svelte`'s Guided Setup steps 1 and 2, and
`RomManagementTab.svelte`'s Flash "Install ROMs" and SD "Sync SD Card". This went through
several iterations this session (see `docs/AUDIT_NOTES.md` items #17-19 for the full history) —
current shape:

- **Phases** are a fixed checklist (pending ○ / active ● / done ✓ / error ✗), each **collapsed
  by default** — clicking a phase reveals its own **named, fixed sub-steps** (not raw text),
  which auto-collapse again once that phase finishes. Sub-steps only exist where a phase has
  real, distinguishable internal work (e.g. the build phase's "Build games/BIOS/languages
  image" / "Build emulators/saves image" / "Patch superblock", or the flash phase's per-region
  writes) — a genuinely atomic phase has none.
- **One shared, timestamped, auto-scrolling audit log** at the bottom of the modal — collapsed
  by default, remembers the user's last open/closed choice across separate operations
  (`persist.ts`, key `install-log-open`). Every entry is `YYYY-MM-DD HH:MM:SS [Phase — Substep]
  message`, logging real decisions (target version resolved, migrate-games/saves choices and
  why, inferred/chosen bank, budget fit results, retry attempts) and real granular step-by-step
  narration, not raw device chatter dumped as one run-on sentence.
- "FrogFS"/"LittleFS" are referred to as **"Games, BIOS, Languages"** / **"Emulators, Saves"**
  in this user-facing checklist (technical FS names stay in power-user/debug-only spots like
  the Advanced Layout offset inputs and the raw hex debug well).
- The modal's state lives entirely in the `installProgress` store singleton (mirroring
  `device.stubPrompt`/`connectGatePrompt`/`roms.folderGatePrompt`) and renders once,
  unconditionally, at `App.svelte`'s root — **not** component-local state — specifically
  because a real bug was found and fixed this session where component-local modal state got
  destroyed mid-flash by an unrelated `{#if}` unmount (see AUDIT_NOTES #18).
- `packages/gnw-flasher`'s `program()` now correctly waits for the firmware's global `STATUS`
  register to reach `IDLE` after a context's `READY` flag clears, instead of treating
  `READY`-cleared alone as "operation complete" — a real protocol-conformance bug (the firmware
  clears `READY` before erase/program/hash-verify even start) that caused both a stuck
  on-device progress bar and spurious stall-watchdog trips (see AUDIT_NOTES #19).
- Flash-stall auto-retry (reboot the RAM stub + retry, 3 attempts total) was reintroduced after
  removal, paired with pausing the liveness poll for the duration of any flash — closing the
  specific race that made the original auto-retry unsafe.

**Still needs a full real-hardware verification pass** before this is considered fully done —
none of the phase-transition timing, sub-step collapse/expand behavior, retry recovery, or the
`waitForIdle()` protocol fix have been confirmed against physical hardware yet.

See `.claude/plans/jaunty-squishing-marble.md` for the full design and required real-hardware
verification checklist before this is considered done.

## Flash Reliability/Performance Regression (FIXED, real-hardware confirmed 2026-07-04)

Owner reported flashing had gotten progressively slower and janker over a long period — frequent
mid-operation mini-hangs and unexpected device reboots that "used to happen periodically, not
constantly." Root cause (found via parallel git-archaeology + `references/gnwmanager`-comparison
agents — see `.claude/projects/.../memory/flash-verify-overhead-regression.md`): NOT a
context-lifecycle bug (that logic has been essentially unchanged since day one); two compounding,
self-inflicted issues instead:

1. `packages/gnw-flasher`'s `program()` was doing a full read-back verification of every
   per-chunk context-buffer write (up to 256KB, in 16KB sub-chunks with their own settle/throttle
   delays) — something gnwmanager's reference Python implementation has no equivalent of at all
   (it trusts the device's own SHA256 hash check + the existing chunk-retry handshake entirely).
   This roughly tripled the WebUSB transaction count per chunk on every flash operation. **Fixed:**
   this verify now defaults OFF at every real call site; the one-time stub firmware load keeps it
   (cheap, and a corrupt stub genuinely hardfaults, so it's justified there).
2. The flash stall watchdog had been tightened 120s→15s the same day, specifically to compensate
   for the resulting stalls — an 8x-more-trigger-happy threshold that turned ordinary transient
   slowness (now with ~3x the transfer volume from #1) into far more frequent abort+reboot cycles.
   **Fixed:** reverted to 120s; a related `Wizard.svelte` outer-timeout inconsistency (one of two
   sibling guards was never bumped to match, so it would fire before the inner watchdog ever got
   a chance) was fixed alongside it.

Owner-confirmed on real hardware: "flashing much much faster and it was smooth" after this fix.

## Architecture

**Cores vs ROMs:**
- **ROMs** are packed into a **FrogFS** image which is flashed to the lower section of external flash.
- **Cores** are packed into a **LittleFS** image which is flashed to the upper section of external flash (this partition also holds Saves, Screenshots, and Settings).

When adding ROMs through the ROM Management Tab, the application extracts the existing FrogFS contents and repacks them alongside the new ROMs. This process must be **version independent** to ensure we don't accidentally create a mismatch between the firmware version and the installed cores (which live in LittleFS).

## Documentation Navigation

The documentation hierarchy is strictly limited to 3 hops (`CLAUDE.md` -> `STATUS.md` -> `docs/*.md`). When you need specific technical details, consult the appropriate core document:

- [**`docs/ARCHITECTURE.md`**](./docs/ARCHITECTURE.md): The overall architecture, how the host communicates with the device over SWD, WebUSB transport (`packages/swd-transport`, `packages/gnw-flasher`), device scanning, classification, and the Master Glossary & Hardware Quick Reference.
- [**`docs/DEVELOPMENT.md`**](./docs/DEVELOPMENT.md): The development environment, Docker container setup, testing, and CI artifact pipelines (how `retro-go` bundles are built and tagged).
- [**`docs/FILESYSTEMS.md`**](./docs/FILESYSTEMS.md): Detailed information on how data is stored. Explains FrogFS (ROMs, BIOS, Fonts) vs LittleFS (Cores, Saves), WASM integrations, LZMA sidecar compression for ROMs, and the client-side content packing pipeline.
- [**`docs/PATCHING.md`**](./docs/PATCHING.md): Details the byte-exact `gnw-patch` mechanism (stock Mario/Zelda to dual-boot) and the `GnwLayoutSuperblock` format used to dynamically size partitions at flash-time.
- [**`docs/UX_DESIGN.md`**](./docs/UX_DESIGN.md): The UI specs, workflows, phase models (Guided vs Advanced mode), visual design system, and the user's mental model for ROM and game management.
