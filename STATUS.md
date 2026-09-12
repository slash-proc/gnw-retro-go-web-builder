# Project Status

This document is the definitive source of truth for the current state of the Game & Watch Web
Builder project. For the UI overhaul specifically, read [`HANDOVER.md`](./HANDOVER.md) first —
it carries the owner's standing instructions and the corrections that have already cost work.

## UI redesign conformance (as of 2026-09-08)

**Read [`docs/CONFORMANCE.md`](./docs/CONFORMANCE.md) first, and read the counts there rather
than here.** It is the live scoreboard, it states how its figures are derived, and it has been
re-derived with a hand-validated parser; a number copied out of it into this file would rot.
`docs/audit-ui-conformance.md` is a *findings list*, not a measure of conformance — quoting its
closed-findings ratio as progress is the mistake that once sent work toward cleanup while whole
screens sat unbuilt.

The redesign is built against the artboards in `docs/design/mockups/` — count them with
`ls docs/design/mockups/*.dc.html | wc -l`, and read the number the surveys actually walk off
`docs/CONFORMANCE.md`'s scoreboard rather than from here. `Specimen` is a type-and-grey
reference sheet rather than a screen, and `FileBrowserFrogfs` has no rows; nothing else is
unsurveyed. `apps/web/test/artboard-index.mjs` (in `npm run check`) is what keeps the board set,
`docs/design/mockups/README.md`'s index and `canvas.json` from disagreeing.

The boards and the published Claude Design canvas (URL in `docs/design/mockups/README.md`) drift
silently — nothing syncs them. 19 boards were found a generation behind and were resynced in
`31cc2f7`; every verdict resting on a stale reading has since been re-walked. **Diff the canvas
before trusting a board, and re-check anything citing one.** See HANDOVER §2.

Open questions live in [`docs/DECISIONS.md`](./docs/DECISIONS.md), what each proposed policy
would decide in [`docs/DECISIONS-MAP.md`](./docs/DECISIONS-MAP.md), and the owner-blocked rows in
[`docs/BLOCKED-AUDIT.md`](./docs/BLOCKED-AUDIT.md). The largest single open question is whether a
running flash gets a user-facing Cancel: the engine half exists (`GnwFlasher.flash()` takes an
`abortSignal` and checks it at every 256 KiB chunk boundary), but nothing in `apps/web`
constructs an `AbortController` for a user — the only one there is a timeout guard in
`Wizard.svelte`. The flasher also implements the `BAD_HASH_FLASH` ruling: sanity check, retry
twice, then a real error naming the blocks that failed.

Structural work that landed: the one 12-column page grid with per-screen vertical padding, the
full-bleed nav band and Firmware rail, the anchored 72px footer bar across every Advanced pane,
the Guided Setup spine and Landing rebuild, the add-source look-up step, the Backup & patch
spine, and the **fixed viewport** — `.app` is `height: 100vh; overflow: hidden` and `.tabpane` is
the app's only general scroll container (see CLAUDE.md; no gate in this repo detects breaking it).
`docs/audit-write-progress.md` separately covers every device-write path's progress reporting.

## Overarching To-Do / Feature Matrix

### Implemented & Working
- [x] **i18n (15 locales done — en, de, ar, es, fr, it, ja, ko, no, pl, pt, ru, uk, zh-Hans, zh-Hant; `nl` declared but unwritten):** Hand-rolled locale infra — `apps/web/src/lib/i18n/` (`widen.ts`'s `Widen<T>` mapped type; per-feature-area files under `strings/` — `deviceHeader.ts`, `landing.ts`, `shared.ts`, `overview.ts`, `overviewRail.ts`, `wizard.ts`, `firmwareSetup.ts`, `roms.ts`, `sources.ts` (**nine** areas, **135 files**) — each with an English source and **fourteen** locale siblings (`strings/<area>.<code>.ts`), every one of them type-checked against the SAME English `Widen<...>` shape). No library (`svelte-i18n` etc.) — this app's needs (short strings, light interpolation) still don't justify one, though **RTL is no longer hypothetical**: Arabic is wired, `lib/direction.svelte.ts` writes `dir`/`lang` onto `<html>` from an `RTL_LOCALES` set, and `test/direction.mjs` fails the build on a physical inline CSS property anywhere in `src/`. Every view/component with real user-facing text is converted (a handful of pure layout/props components — `Button.svelte`, `Card.svelte`, `ModalShell.svelte`, `Progress.svelte`, `StatPanel.svelte`, `ChangeSummary.svelte`, `GeometryBar.svelte`, `App.svelte` — correctly have no strings of their own). Runtime/device-derived text (version numbers, model names, byte counts, ROM/game names, caught-error messages) is never in the string tables — only literal surrounding copy is, via typed interpolation functions. Every wired-in locale is a real, reviewed translation (not machine-literal placeholder text) — natural/contemporary tone, established term consistency across files (e.g. German's "Recovery-Modus", "Gepatcht"/"Original"). **A missing English-added key is a compile error in all fourteen sibling locales at once, not just German — see CLAUDE.md's i18n rule; landing a new user-visible string is a 15-file edit.**
  - **Multi-locale expansion (COMPLETE, 2026-09-12):** every locale in the original target set is written and wired except **`nl`**, plus `ar` and `it`, which were added after it. Done: en, de, ar, es, fr, it, ja, ko, no, pl, pt, ru, uk, zh-Hans, zh-Hant. **`nl` is declared in the `Locale` union and in `SUPPORTED_LOCALES` with zero string files**; it does not reach the picker because `DeviceHeader.svelte` filters through `isRegistered()`, so the switcher shows the fifteen that exist rather than the sixteen declared. Writing it means 9 files plus an assembler; dropping it means two lines in `locale.svelte.ts`. The dispatch-prompt template is still in `.claude/projects/.../memory/i18n-multilocale-rollout.md` if it is ever wanted again. `locale.svelte.ts` holds a `Locale` union of all 16 declared codes + a `registry: Partial<Record<Locale, Strings>>` populated at runtime via `registerLocale(code, strings)`, so a locale listed in `SUPPORTED_LOCALES` (drives the header's `<select>`, which replaced the old EN/DE-only toggle button) but not yet translated silently falls back to English instead of crashing. Per-locale translations live in NEW sibling files, never editing the original English source or another locale's file: `strings/<area>.<code>.ts` (e.g. `strings/deviceHeader.fr.ts` → `export const deviceHeaderFr: DeviceHeaderStrings = {...}`), which keeps every language's translation agent working on entirely disjoint files with zero collision risk even when dispatched in parallel. Each finished locale gets a small assembler `apps/web/src/lib/i18n/<code>.ts` (mirrors `en.ts`/`de.ts`, imports all nine areas' exports for that locale and calls `registerLocale`) wired in via a side-effect import added to `apps/web/src/lib/i18n/registerLocales.ts` (imported once from `App.svelte`) — deliberately NOT imported directly from `locale.svelte.ts` itself, which would create a circular import (each assembler imports `registerLocale` FROM `locale.svelte.ts`). This wiring step (creating the assembler file + one line in `registerLocales.ts`) is done by the orchestrating session, never by a translation agent.
  - **Translation-agent dispatch pattern**: one very long, precise, context-loaded prompt per locale (repo/product context, the exact architecture above, the file list to create, an explicit quality bar modeled on the German pass's standard, domain terms to keep as loanwords vs. translate — Retro-Go/Mario/Zelda never translated — and an instruction to keep recurring concepts like "Recovery Mode" and "Patched"/"Stock" identically worded across all 9 files). Owner explicitly wants these dispatched **one at a time, sequentially, not in parallel** (a deliberate choice, not a technical constraint — the architecture above WOULD support safe parallel dispatch since each locale's files are disjoint, but owner wants to review each language as it lands before starting the next). After each agent reports back, the orchestrating session independently reruns `docker compose exec dev npm run check --workspace @gnw/web`, spot-reads a sample of the actual translated files (not just trusting the agent's self-report), then does the assembler-wiring step above.
  - **Known recurring bug class**: "Pre/Mid/Post/Bold"-style split keys exist because a `.svelte` component interleaves translated fragments around an inline `<code>`/`<strong>` element (e.g. `expertCornerEn.rawPatchWillPre` + literal `<code>/dev</code>` + `rawPatchWillPost`), concatenated by the template with literal spaces. The French pass got two of these grammatically wrong (an article ended up glued directly to unrelated text with no verb/preposition connecting them) because it translated each fragment in isolation instead of composing the full sentence first — caught by owner review, fixed by editing the fragment split itself (moving words between the Pre/Mid and Post/Body fragments so the concatenated result is one grammatical sentence), not by touching the `.svelte` template. Every subsequent language's dispatch prompt now explicitly warns about this exact failure mode and requires composing the full sentence mentally (or actually) before finalizing any such key.
- [x] **WebUSB / Device Flasher:** Read/Write flash operations, verification, and chunking (via `@gnw/gnw-flasher`).
- [x] **FrogFS Building:** Creating valid FrogFS images from user ROMs (`@gnw/fs-builders`).
- [x] **LittleFS Building:** Formatting and packing `cores/` into LittleFS (`@gnw/fs-builders`).
- [x] **Thumb Assembler:** Assembling ARM Thumb-2 patches for the firmware.
- [x] **Firmware Patching:** Modifying Mario/Zelda/etc. OFWs dynamically.
- [x] **File Browser (Read-Only):** Extracting and viewing file structures from FrogFS and LittleFS partitions on the device.
- [x] **Firmware distribution:** Cut over from the POC (one `web-artifacts.zip` per GitHub release, discovered through the Releases API, fetched through a Cloudflare Worker CORS proxy) to the published contract — `dist/versions.json` on GitHub Pages → a per-release `manifest.json` → four hash-verified bundle zips (`flash-bank1`, `flash-bank2`, `sd-bank1`, `sd-bank2`). Client: `apps/web/src/lib/firmwareDist/`; `artifacts.ts` is a thin adapter so its four consumers kept their surface. Install locations, the superblock contract and the `/data/INSTALL` marker all come from the manifest rather than constants. `ARTIFACT_WORKER` and `infra/cors-proxy/` are deleted, guarded by `apps/web/test/firmwarecutover.mjs`.
- [x] **Library driven by Sources:** `sources/coreRegistry.ts` — an active core's declared systems decide which consoles exist; deactivating a source removes its button even with files on disk. `sources/gameRows.ts` gives one row per game, pairing an input with its converted output so prepare-then-install happens in place. Replaces three hardcoded console tables (kept only as an empty-case fallback).
- [x] **Overview is the `overview-v2` rail:** `views/OverviewRail.svelte` replaced the accordion stack with the proposal's two groups (CONSOLE: Status, Details / LOGS: Activity, Device log), mounting one pane at a time. It reuses `advanced/FirmwareRail.svelte`'s grid, `PaneFooter` slot and pane-head rather than inventing a second rail idiom, because the owner asked for that pattern by name. Panes deep-link as `#info/<pane>` and are pushed, so Back walks them. `OverviewTab.svelte` is down to 320 lines as a host for the disconnected states and the screen dock; the panes are `ui/StatusPane.svelte`, `ui/DetailsPane.svelte`, `ui/DeviceLogPane.svelte`, with `overviewRail` as a ninth i18n area.
- [x] **The app reports a real version:** `2.0.0-alpha` in all three `package.json` files, read by `vite.config.ts` into a `__APP_VERSION__` define and exposed by `lib/appVersion.ts` (the `__STORAGE_SCOPE__` shape). The fallback is `null`, never a fabricated number, so a node suite or a bare `svelte-check` draws the unknown value instead of asserting a version the build does not have. `test/desktop-config.mjs` fails if the three disagree.
- [x] **SD content is measured, and capacity is deliberately not:** `lib/sdStorage.svelte.ts` walks the connected card reading `File.size` only, bucketing by the same `InstallPaths` roles `sdDestPath()` writes to. It has four states, and `unavailable`/`unreadable` are kept distinct from an empty card. **No capacity is produced**: a `FileSystemDirectoryHandle` does not expose its volume, and `navigator.storage.estimate()` reports this origin's sandboxed quota, which is a real number about the wrong thing.
- [x] **`/wip/` testing deploy (built, not deployed):** the Pages workflow publishes production (always from `main`) at `/` and a testing build at `/wip/` in one artifact, the wip half fenced so it cannot break production. **Nothing has been pushed**, so `/wip/` does not exist yet; the push is held until the Overview overhaul lands. `/wip/` runs under its own storage scope (`lib/storageScope.ts`), so a tester never touches real users' localStorage / IndexedDB / OPFS.
- [x] **SD installed-content is classified against the manifest, not a literal.** `classifySdScanKey()` (`engine/devicePaths.ts`) is the inverse of `sdDestPath()`. The firmware's homebrew directory is `/homebrews` **plural** while the role name is `homebrew` singular, so the old top-segment classification filed every homebrew file under system `homebrews` and it was dropped by every "is it installed" check — SMW sat correctly on the card and never showed as installed. Write-side placement was already right and is deliberately untouched. `romScan.ts` takes the resolved prefixes as an argument rather than importing `engine/devicePaths.ts`, which would drag the littlefs WASM vendor into every `platform: "neutral"` suite bundle.
- [x] **A core supplied by a source lands in the cores directory, in the right filesystem.** `sdDestPath()` and `flashImage.ts`'s `userDest()` both lacked a `paths.cores` pass-through, so it became `roms/cores/<file>`: on SD a directory the firmware never reads, on flash inside the FrogFS payload. Flash carried a second defect behind it — only *bundle* content was split into the cores tree, so the path fix alone would have put a correctly-named core in the wrong filesystem. `test/devicepaths.mjs` drives both live mappers and compares them so they cannot drift.
- [x] **A converter's input is never copied to the device.** `Game.role`'s `ingestable` had said so since `gameRows.ts`, but `plannedInstallNames` consulted only the selection and a row's identity is the INPUT's key — so `doom.wad` and `doom2.wad` (~27 MB) shipped beside the `.whd` games they become. Both install flows share that map, so Flash packed them into FrogFS too.
- [x] **Additional files: one row per file, not a count.** `prepareState.supplied` is a `Map<string, Set<string>>` of per-input filenames (it was a `Set` of input keys — presence with no cardinality), and `removed` carries per-filename entries. Configure draws a row per held file with its own remove; whether another fits is the picker being present or absent, not a pluralised label. `chooseFiles` is deleted in every locale.

### Not Properly Implemented Yet (TODO)
- [ ] **ROM Management: Version Independence:** When adding ROMs, the tool currently repacks the FrogFS using `bios`, `fonts`, and `lang` files from the *latest GitHub bundle*. Because the device's `cores` (living in LittleFS) are left untouched during a ROM flash, this can create a severe version mismatch. **Fix:** We must extract the `bios/fonts/lang` system files directly from the device's existing FrogFS (just like we do for missing ROMs) to guarantee the newly packed FrogFS perfectly matches the untouched LittleFS cores.
- [ ] **ROM Management: Idempotency & Block Shifting:** Adding new ROMs currently re-alphabetizes the FrogFS payload, shifting the byte addresses of all subsequent games. This invalidates the 256KB block hashes and breaks differential flash skipping. **Fix:** When repacking the FrogFS, we must parse the device's existing FrogFS offsets and pack the files back in that exact order (lowest to highest address). This guarantees an append-only strategy where new ROMs are tacked onto the end, preserving all existing 256KB block boundaries.
- [x] **SD Content Sync (ROM Management Tab):** "Sync SD Card" in the Library tab writes ROM files, covers, BIOS assets, and cheats directly to the picked SD card folder via the File System Access API. Path mapping: `covers/`, `bios/`, `cheats/` stay at the SD root; ROMs get a `roms/` prefix (`GBC/zelda.gbc` → `roms/GBC/zelda.gbc`). No device connection required. **Diff-based (fixed 2026-07-03):** only writes newly-added games and files marked dirty since the last sync (`roms.dirtyFiles`), not a blanket rewrite of the whole selection every click. Cores/bios/fonts (the bulk of the sync's data) are gated behind an off-by-default "Sync cores / system files" checkbox — only fetched/written when explicitly preparing the card for a firmware/cores update. The Guided Wizard still handles the base SD install (intflash blob + sdContent cores).
- [ ] **SD Card Auto-Detection (`sdPresent`):** The device store has a placeholder for detecting whether the connected device has the SD mod hardware (so the app could automatically default to SD mode on connect). Currently always `null`; the user must manually select their target media. **Answered 2026-09-10: it is not, and cannot be.** `references/game-and-watch-bootloader`'s `sdcard_hw_detect()` (`Core/Src/bootloader.c:24`) has no card-detect line to read: it powers VCC, inits SPI1 and calls `disk_initialize()`, which sends **CMD0 (GO_IDLE_STATE)** and needs an R1 of `0x01`. An empty slot never answers, so it deinits, tries OSPI1, and lands on `SDCARD_HW_NO_SD_FOUND` — **an SD mod with no card inserted is indistinguishable from no mod at all**. What the firmware *can* distinguish, and we do not yet model, is `SDCARD_HW_SPI1_UNSUPPORTED_FS` / `OSPI1_UNSUPPORTED_FS`: the card answered but the volume is not FAT/exFAT, which is the difference between "no SD mod" and "your ext4 card will not work here" (`Core/Inc/main.h:54-59`).
- [x] **Screenshots:** The Device / Retro-Go Management tab now properly decodes and displays RGB565 screenshots natively in the browser.
- [x] **Cover Art:** Supported through scanning `covers/` in the ROM folder and appending them to the FrogFS image. The UI now features a fully reactive 3D Cover Flow carousel and includes built-in ScreenScraper API integration for both single-game and bulk batch scraping.
- [x] **Saves Management:** Implemented a fast, lazy-loading LittleFS browser (`lfsBrowser.ts`) to view saves and screenshots without dumping the entire partition. Saves and raw screenshots can be downloaded directly from the UI. (Upload/Restore functionality may still need work).
- [x] **Cheat Codes:** Implemented. UI natively supports parsing `.ggcodes` files sitting next to ROMs, displaying them in a ledger, and automatically packing modified cheats back into the FrogFS payload natively without descriptions to ensure Retro-Go compatibility.
- [x] **LittleFS Migration during Upgrade:** Implemented. When upgrading the firmware (and deploying new cores to LittleFS), the UI seamlessly extracts existing `/data` and `CONFIG` elements from the device's LittleFS and splices them natively into the newly generated LittleFS filesystem.
- [x] **Homebrew Ports:** No longer a hardcoded catalogue. Titles are derived at runtime from the active Sources' `manifest.json` files (`lib/sources/homebrewTitles.svelte.ts`, a `$derived` over the active sources), keyed `owner/repo#targetId`. Asset extraction runs through the spec's ABI-1 WASM converter host (`lib/sources/converter.ts` + `wasmVerify.ts` + a Worker), which hash-verifies each module and instantiates it with no import object. The old `engine/homebrew.ts` `HOMEBREW_TITLES` table and the Python/Pyodide `restool` path are deleted. The UI still integrates homebrew directly into the Library selection table, tracking missing assets, triggering extraction, and showing footprint sizes like standard emulated games.
- [x] **Sources install path:** `lib/sources/installArtifacts.ts` fetches a homebrew target's own `targets[].artifacts[]` (the engine `.bin` and anything shipped beside it) hash- and length-verified against the manifest (`fetchVerified`), and this now overrides whatever copy of the engine `.bin` the firmware bundle carries — closing the gap `HANDOVER.md` used to list as the next task. Fetches run at a bounded concurrency (never an unbounded `Promise.all`) because the artifact list itself comes from an untrusted third-party manifest. There is deliberately **no total-size ceiling**: an earlier version carried an invented 64 MiB one and it was removed, because what an install actually has to fit in is a property of the device (the FrogFS gap in flash mode; the SD card plus the extflash ROM cache in SD mode), not a constant the tool can know in advance.
- [x] **`originalSystem` adopted from the manifest spec:** replaces the old `HOMEBREW_TITLES.virtualConsole` special-casing. When a manifest does not publish `originalSystem`, the app makes **no cover-scrape attempt at all** for that title — no name-based fallback search, no console lookup table. This closes one of `HANDOVER.md`'s open questions; the degraded-scrape behavior it described is gone, replaced with "don't guess."
- [x] **Manifest filename hardening:** `parseManifest` (`lib/sources/client.ts`) refuses any artifact/symbol `filename` or `url` that is not a plain filename (`isPlainFilename`, shared with the converter ABI's own rule), because that string reaches a FrogFS tree key. `lib/sources/bundle.ts`'s Zip importer applies the same guard a second time, independently, against the zip's raw central-directory entry names — **not** against `JSZip.loadAsync`'s parsed view, because JSZip normalises entry names (e.g. reports `../../etc/passwd` as `etc/passwd`), which would make a path-escape guard checked against its output silently useless.
- [x] **Bundle Zip import** in Sources is implemented (`lib/sources/bundle.ts`), no longer a placeholder: imports `dist/<tag>/` zipped with nothing added/rewritten, verifies every manifest-named file's length and sha256 before the source is kept, and labels the imported source UNVERIFIED in the UI (a bundle proves its own integrity, not a publisher's honesty — the hash checks catch corruption/tampering-in-transit, not a hostile publisher).
- [x] **Manifest-driven file prompt** (`lib/ui/FilePromptModal.svelte`) replaced the old "scan the ROM folder for a matching extension" heuristic; `findSourceFile` is gone. The converter's input file is now requested explicitly, driven by what the manifest declares.
- [x] **Restore-to-Stock** implemented in Guided Setup (`engine/ofw.ts`'s `restoreStock()`). Its spine is **two** flash phases (internal → bank 1, external → bank 0), not three: restoring the stock reset vector to bank 1 IS the Retro-Go removal, so there is no separate "uninstall Retro-Go" step. Anything above the backed-up external image's own length on a larger chip (leftover FrogFS/LittleFS content) is left untouched — stock firmware never reads past its own region, and blanking further would multiply the length of an already-destructive write for no functional gain. A hard capacity guard refuses a backup whose external image is larger than the device's chip (a 4 MB Zelda backup onto a 1 MB Mario chip), checked in the engine as well as the UI so no caller can start a partial write. **This has never been run on hardware** — its guards and write plan are covered offline by `apps/web/test/ofw-restore.mjs` and nothing more.
- [x] **Guided Setup gated on external-flash floors** (`Wizard.svelte`): below 8 MB, Guided Setup offers only Restore-to-Stock (the chip is not fit for modern Retro-Go); below 16 MB, dual boot is not offered. These are owner-set hardware floors, not preferences, and the check only fires once the chip size is actually known (`extSizeMB` is null pre-scan; unknown size does not gate — hiding options on "haven't looked yet" would be a worse lie than briefly showing one the device can't support). Anyone who wants Retro-Go on a smaller chip does it from Advanced, without the training wheels.
- [x] **BIOS discovery, status and install** (`lib/sources/bios.ts` — pure, tested; `lib/sources/biosState.svelte.ts` — the reactive glue; `lib/sources/sdBios.ts` — the card's `bios/` scan). A core source declares, per launcher tab, which non-game files the user must supply (`systems[].bios[]`: filename or accepted names, hash, size, `strict`, localised copy). The app now collects those needs, resolves each slot's status against the user's folder plus whichever side it is actually targeting (the device's FrogFS listing in Flash mode, the card's `bios/` tree in SD mode — never both), and installs the files the user supplies. Need is three-valued rather than boolean because `requiredFor` is narrower than a system: `disksys.rom` is mandatory for `.fds` images and irrelevant to the `.nes` cartridges in the same folder, so it reports `required` / `conditional-hit` / `conditional-idle` / `optional`.
  - **Install policy differs by medium on purpose** (`installsBios`): **SD** writes an active source's BIOS whether or not the user has games for that system today — a card is open, ROMs land on it outside this app, and a missing BIOS means those games silently do not boot (ColecoVision does not even fail loudly: the core allocates 8 KiB and ignores `odroid_sdcard_read_file`'s return value). **Flash** writes a system's BIOS only when that system has games — the content set is closed and the gap between the FrogFS image and LittleFS is the scarce resource. The Flash rule is the general form of the `bios/msx` omission `packages/fs-builders/src/flashImage.ts` already applied, so the builder's own omission stays a no-op rather than a second opinion.
  - **Prompts, twice, and neither blocks.** Selecting a ROM for a system with an unmet BIOS opens `FilePromptModal` once per system (not once per ROM; a dismissal counts, and arriving on the tab never opens one). A still-unmet required slot at install time gets one last offer, then the install runs either way. Optional slots are never raised. Supplied files go through `inputGate.ts` — the same hash/size/`strict` rules as any converter input.
  - **BIOS rows in the Library list**, one per installable slot, sorted worst-first, filtered by the medium policy so a slot this medium would not write is never offered. The chip reads Found / Needs a file / optional and opens the same modal. The library summary also carries a BIOS row and an unconditional Cores row. An earlier `BiosPanel.svelte` on the Overview tab was removed — no artboard has one (`docs/audit-invented-copy.md`, S1).
- [x] **`systems[].biosDir` replaced a hardcoded table.** Placement is declared, not derived: `RG_BASE_PATH_BIOS` has zero call sites in `references/game-and-watch-retro-go-sd`, every core opens a hardcoded literal, and the subdirectory is the *core's* name rather than the system's ROM `dirname`. `biosDestKey` resolves `biosDir ?? id` and consults no table; the old `col`→`coleco` special case is deleted. Omitted means the system `id`, which is the common case — exactly two systems diverge: ColecoVision (`roms/col` → `bios/coleco`) and PC Engine CD (`roms/pcecd` → `bios/pce`). `client.ts` validates `biosDir` as a plain path segment at the parse boundary and `biosDestKey` re-checks it; an unknown value falls back to the `/bios` root rather than a guessed subdirectory. See `docs/proposals/bios-placement.md`.
- [x] **Firmware ABI read from the device** (`engine/firmwareAbi.ts`). The Retro-Go SD firmware pins `.firmware_abi` to `ORIGIN(FLASH) + 0x400` — a fixed offset into whichever intflash bank the firmware lives in — and its header is nothing but `version` and `size`. **There is no magic number**, so validation is heuristic and deliberately strict: the header must be self-consistent (version 1–255, size 8..16 KiB and 4-aligned) *and* the first four function-pointer slots must all look like Thumb code addresses in internal flash. Parsing runs over the buffer the intflash bank scan already downloaded, so it costs zero extra SWD transactions. A Sources row whose build needs a newer ABI than the device reports says **"Needs newer firmware"** in its meta line; an **unknown** ABI (nothing connected, no scan, stock OFW, a pre-ABI Retro-Go) renders **no claim at all** — the same "no data, no assertion" rule cover scraping follows for a missing `originalSystem`. The cost of a false positive is a wrong compatibility claim, which is worse than "unknown".
- [x] **Sources rows say what a source gives you.** One meta line per row: for a core, the systems it declares and their extensions (`WonderSwan, WS Color · .ws .wsc`), then how many files in the user's picked folder those extensions match; for homebrew, nothing — it is already under the Homebrew heading. **No title counts anywhere**, and the artifact/file counts that were there are gone. Every part is untrusted manifest text, interpolated as text, never markup and never a path.
- [x] **Bundles survive a reload** (`lib/sources/bundleStore.ts`). The ORIGINAL zip is kept in IndexedDB, keyed by the row's normalised `owner/repo`, and restoring re-runs `importBundle()` in full — entry-name guards, schema gating, length and sha256 of every manifest-named file, then fresh blob URLs which `installArtifacts.ts` hashes again on the way out. There is deliberately no "already checked once" fast path: a local store is not a trust boundary, and something that could rewrite the bytes could rewrite a "verified" flag beside them. localStorage cannot hold binary and its quota is a few megabytes, which is why this is IndexedDB and not a line in `persist.ts`. Every failure mode (private browsing, disabled store, quota refusal, a zip that no longer verifies) degrades to the pre-existing behaviour: the row loads from its card and asks for the zip again.
- [x] **Add Sources modal in Guided Setup** (`lib/ui/AddSourcesModal.svelte`): sources can be added without leaving the wizard. The wizard's button reads **Add Sources**.
- [x] **`views/Sources.svelte` decomposed.** `ui/AdditionalFiles.svelte` and `ui/AddSource.svelte` were extracted as components; four pure, rune-free modules were lifted out and each guarded with a real test against a mutated copy of the source it covers: `sources/metaLine.ts` (row meta-line composition), `sources/metaFacts.ts` (which fact a row shows and in what precedence), `sources/errorText.ts` (the `errorMessageKind` rule plus the strings-table lookup, injected), `sources/fileRows.ts` (the Additional-files three-state rule). `sources/prepareState.svelte.ts` (see above) is the fifth extraction, a stateful store rather than a pure module.
- [x] **User-facing "emulators" is now "cores"** across every wired locale, and the rename has since reached internal identifiers, types and comments too. This line previously recorded the opposite move; it was reversed because "emulator" is the narrower word. An emulator is one kind of core, the kind that imitates real hardware; DOOM is a core that emulates nothing. `docs/ARCHITECTURE.md` carries the definition, and `test/core-vocabulary.mjs` fails the build on a regression in either the copy or the code. `isCoreKind()` (`sources/types.ts`) remains a deliberate shim accepting the pre-rename `kind: "emulator"` from publishers that still lag.
- [x] **Optional converter inputs are all-or-nothing.** `FilePromptModal` renders required sections always and puts **every** optional input behind one disclosure, or none of them. The artboard's literal "8 more optional files" implied a partial tail; the owner ruled that out.
- [x] **SD Card Install Mode:** The app fully supports the SD-capable Retro-Go firmware variant. The user selects a target media (`flash` vs `sd card`) and the install pipeline branches accordingly. The SD path flashes only intflash (using `sd_1`/`sd_2` blobs from the CI artifact bundle), then writes `sdContent` (cores, bios, fonts) directly to the user's SD card directory via the File System Access API. The folder handle is persisted across page reloads via IndexedDB. Device classification distinguishes `retrogo-sd` (current SD install) and `retrogo-old` (older Retro-Go without the SD version string) — this is about firmware *vintage* (the upstream fork name), separate from the newer `installOrigin` field (below) which is about which of THIS tool's own install paths produced the image. In SD mode, the installed games list is populated by scanning the SD card directory rather than reading device FrogFS.
- [x] **Flash vs SD install origin detection (`installOrigin`):** Reads gnw-patch's layout superblock directly off intflash (already probed for "is this web-builder-aware at all") and checks its `FLAG_LITTLEFS_LENGTH` flag — set only when this tool's Flash-mode build path passes a `littlefsLength` (SD-mode's `patchSuperblock` call never does). `"flash"` / `"sd"` / `"old"` (no layout superblock at all — foreign/pre-web-builder image). Deliberately NOT based on whether the extflash scan finds a real LittleFS partition — that scan can miss one even on a genuine Flash-mode device. Surfaced as a soft, non-blocking notice in `RomSection.svelte` if it disagrees with the currently-selected install mode ("complain, don't harass" — no modal, nothing blocked).
- [x] **RomSection ("Install/Reinstall Retro-Go") redesign:** Auto-renamed title (Install vs. Reinstall based on whether Retro-Go is found anywhere on the device). Version picker simplified to a single dropdown (no more installed→target chip pair — the status bar already shows the installed version). Bank selector now reuses `ui/BankCard.svelte` (shared with the Overview tab) as a real clickable selected/unselected toggle instead of a hidden `<select>`. The device's current flash-layout geometry bar moved into the collapsed "Layout (advanced)" dropdown, and (Flash mode) now shows a real FrogFS/LittleFS PROJECTION of what the install will do — hatched "will be (re)written" styling on both regions always (they're always rewritten regardless of migrate checkboxes; only the size shown differs by migrate state). SD mode's install now also mirrors Wizard.svelte's SD-card folder-gate + cores-sync-to-SD-card behavior that RomSection was previously missing entirely.
- [x] **UX Navigation Overhaul (`feature/ux-flow-overhaul`):**
  - **Guided Setup auto-routing:** "Manage Device" always lands on the Overview tab first. After the device scan completes (`banks.length > 0` guard — `applyInfo()` sets `firmware` prematurely before the scan), if firmware is not `retro-go`, the app routes to Guided Setup (wizard mode). Routing is skipped if the device was already connected at navigate time.
  - **FolderGateModal:** Global modal (`lib/ui/FolderGateModal.svelte`) that fires when the ROM Management tab opens without required folders selected. Driven by `roms.ensureFolders(sd)` (Promise-gate pattern matching `StubLoadModal`). Shows ROM folder + SD folder rows in SD mode; Continue enabled once all handles are set.
  - **ConnectGateModal** (`lib/ui/ConnectGateModal.svelte`, formerly `ConnectAdapterModal`)**:** Shown in Guided Setup (`Advanced.svelte`) when device is not connected. "Connect Adapter" tries trusted probe first (no forced picker); "Back" returns to the Overview tab.
  - **SD mode ROM tab:** No device/partition/baseInstalled gate in SD mode (SD installs don't require SWD). Space shown as recursive FSAA file-size scan of the SD handle (`sdUsedBytes`) — no web API exposes total/free capacity for a picked directory.
  - **Auto-reconnect after device restart:** Module-level `navigator.usb.addEventListener("connect", ...)` in `device.svelte.ts` calls `connectSilent()` when any USB device re-enumerates. Handles the common case where the ST-Link probe briefly drops USB after a target reset. `connectSilent()` now also works from the `"lost"` state (not just `"disconnected"`).
  - **DeviceControls reconnect:** superseded by the header/status-icon merge below — "Change Adapter" now always uses `forcePicker: true` for explicit adapter switching.
- [x] **Overview tab + header + Firmware Setup UX pass:**
  - **"Information" tab renamed "Overview"** (file: `DeviceInfoTab.svelte` → `views/OverviewTab.svelte`). Every reference across the codebase/docs renamed to match (internal `Tab = "info"` id and its `#info` hash-URL segment deliberately left alone — those are routing internals, not user-facing text, and renaming them would break existing bookmarked hash links for no visible benefit).
  - **Overview dashboard restructure:** "Model" row dropped (redundant with "Game & Watch"); "Firmware"/"Base Firmware" renamed "Retro-Go"/"Game & Watch" (in that order); Retro-Go's value is now the bare version only (reuses `DeviceHeader.svelte`'s existing `.replace(/^Retro-Go\s*(SD\s*)?/, "")` pattern that already strips the "SD" fork name). The "Info" card and "Controls" card (was "Device Controls") are now two separately-boxed cards stacked in the left column, and the screenshot viewport got pulled into its own card on the right — fixed at the G&W's native 320x240 (never fluid/scaled), centered via `margin: 0 auto`. The dashboard is one two-column grid (top row: Info/Controls + screenshot; bottom row: bank cards + external-flash geometry bar) — the two rows share those columns on purpose so they stay lined up; an attempt to let the top row shrink-wrap independently of the bottom row was reverted (see CLAUDE.md's `--maxw`/grid-`fr` gotcha). The redesign has since made the columns even (`repeat(2, minmax(0, 1fr))`, per `Main.dc.html`) and **retired the per-tab width caps entirely** — `Advanced.svelte`'s `.shell.wide`/`.narrow` modifiers now carry per-screen vertical *padding* only, and Overview, Library and Sources all share one body width (`.page-body`). CLAUDE.md still describes the old per-tab caps; the code comment at `Advanced.svelte:290` is the current truth.
  - **Firmware tab (`RetroGoTab.svelte`/`Advanced.svelte`) accordion fix:** removed the reactive "auto-open the firmware-appropriate default section" mechanism entirely — it read `device.banks`/`device.partitions`, which are empty at mount and settle asynchronously mid-scan, so a section would pop open pre-scan, re-target itself as the scan progressed, then sometimes auto-close once "fully installed" resolved, all without the user clicking anything. Every section (including Install/Reinstall Retro-Go, Dump/Write/Erase Flash — renamed from "Dump flash"/"Flash image"/"Erase flash") now opens only on an explicit click or a hash deep-link, and shows a "Scanning device…" placeholder if opened while `device.scanning` is true instead of rendering bank-picker content that would jump once the scan resolves.
  - **Header status icon + device-actions menu merged:** the console-icon status LED in the header's overview line (colored red/yellow/green) and the separate top-right hamburger-icon dropdown (`DeviceControls.svelte`) were two unrelated controls — now one. Click always opens a dropdown (previously the icon's click directly triggered a scan); a small caret badge signals it's clickable. Menu options vary by state — connected+recovery-mode: Rescan / Restart Recovery Mode / Change Adapter / Disconnect Device; connected+app: Start Recovery Mode / Change Adapter / Disconnect Device; disconnected: Connect / Change Adapter — dropped emojis and the Debug-Log/Take-Screenshot items (redundant with Overview's own Controls card). The icon + status text are now a permanent fixture of the header (render regardless of connection state); only the Retro-Go/OFW version rows next to them stay connection-gated.
  - **RomManagementTab summary polish:** "Total projected size" (both Flash and SD mode) marked as a `StatPanel`/`ChangeSummary` `total` row (divider + bold, reads as an aggregate rather than a peer category). ROMs row no longer turns green before anything's actually changed. SD mode's "Cores / system files" row is hidden entirely unless the "Upgrade Retro-Go and Cores" checkbox is on (checkbox moved above the summary panel), and when shown now displays a real core/file count + version (fetched from the release bundle the moment the checkbox is checked) instead of a static "Will be re-synced" string — trade-off: this fetches the (large) bundle eagerly on checkbox-check, then fetches it again at actual sync time; not de-duplicated (would mean holding the full multi-MB bundle in memory for the tab's lifetime).

## Session of 2026-09-11: install, scan and lip progress (READ THIS FIRST)

A long hardware session. Everything below is on `feat/ui-redesign`, all gates green, nothing
pushed. The order matters: several of these were fixes for damage done earlier in the same
session, and the commit messages say so.

**Cores and the install split.** The owner's ruling, now in memory as `core-install-rules`:
SD installs every core unasked (a ROM can arrive on a card by hand); Flash installs none by
default but must still CREATE the filesystem structure (`cores/`, `data/` as real directories);
and on Flash the core follows the ROM selection, both ways. Then he reversed the flash half after
living with it: cores now ride in the LittleFS image a firmware install flashes whole, because a
ROM install cannot rebuild that partition (it holds saves) and writing into the live filesystem
over SWD is slow for a structural reason, not a tunable one. See `sources/coreGate.ts` and
`advanced/RomSection.svelte`.

**`gba.xip`'s sentinel is `0xDEC00000`.** It is `GBA_CODE_BASE` in the firmware's `main_gba.c`
and is declared in the GWRG manifest (`relocBase`), NOT derived from the bytes -- an agent's
byte-pattern search concluded there was no sentinel and that claim reached `docs/MAPPED_ARTIFACTS.md`.
The owner's real `gba.xip` holds 263 words in the window. `apps/web/test/gba-e2e.mjs` pins the
count as the invariant.

**Who relocates a mapped artifact.** `odroid_overlay_cache_file_in_flash_relocate` runs the
firmware's relocation callback ONLY under `SD_CARD == 1`; the `SD_CARD == 0` arm maps the file
straight out of FrogFS and discards the callback. So on flash-only the installer must
pre-relocate, and on SD it must NOT. `docs/MAPPED_ARTIFACTS.md` generalises from the pico-8
script and does not record this; correct it before designing against it.

**Language blobs live in LittleFS.** `rg_i18n.c` opens them with a plain `fopen`, and
`syscalls.c`'s `is_frogfs_path()` routes only roms/covers/bios/fonts/font and `cores/pico8.ro`
to FrogFS. We shipped them to FrogFS, where the firmware cannot see them, and it looked fine
because English is baked into rodata.

**Performance work, all measured rather than reasoned:**
- The LittleFS write skips a file the device already holds byte for byte. littlefs is
  copy-on-write, so rewriting unchanged content cost 1677 dirty blocks (6.55 MiB) for 483 KiB.
- The write asks the stub for its own SHA-256 per 256 KiB chunk (`GnwFlasher.readHashes`, the
  port of `gnw.py`'s `read_hashes`) and keeps cached blocks whose chunk is unchanged, instead of
  re-reading the partition every time. **The stub could always do this and we never called it.**
- The retain phase prefers a local copy over re-reading a kept game off the device.
- The library scan counts FILES and runs ONCE, after the sources resolve (it used to rescan per
  arriving manifest).

**The gold lip draws OPERATIONS, not transfers.** A scan issues ~1400 reads and the lip swept
once per read, which reads as a thousand scans. An operation that knows its progress claims the
lip (`lipProgress.operationProgress`), background reads silence it (`setQuiet`), and a single
long transfer still sweeps as before. `device.runScan(reason)` now logs sequence, trigger,
duration, reads and bytes -- use that line rather than impressions.

**Flash waits are 10 s warning / 20 s give-up, no-progress**, and a context-counter desync is
caught in ~2 s by proof: the stub's counter resets when the stub restarts while the mailbox
survives, so a restarted stub waits for 1 while the host writes N, with every liveness check
passing. See `stallWatch` and `CONTEXT_PICKUP_GRACE_MS` in `packages/gnw-flasher/src/index.ts`.

**Still open from this session, in priority order:**
1. **Per-system "Used by" entries.** One entry per SYSTEM, not per core (PC Engine != PC Engine
   CD). Needs the option key to carry the system, which `isLibrarySource` and
   `dedicatedFolderPrefix` both read, and `usedBy` is PERSISTED user data -- old `repo#targetId`
   values must keep working or folders silently un-associate. Worktree `wt-persystem` is empty;
   the task was never started.
2. **The reverted one-pass scan.** `agent/wt-scanpass` (`76830d7`) rewrote the extflash walk to
   anchors-first with a byte denominator: on SYNTHETIC layouts, 1101 reads to 9 on a populated
   64 MiB chip. It was REVERTED (`b16b6cd`) because the owner reported it as BOTH slower and
   visually noisy on real hardware. The visual half was later explained (the lip swept once per
   read), but **the "much longer" half was never explained and remains unexplained**: the
   synthetic measurements and his device disagree, and the device wins. Re-test it with the
   `[scan] #N ... ms, N reads` telemetry line before assuming the branch was fine.
3. **Zipped ROMs.** `agent/wt-ziproms` (`0c8671e`, `23fe312`): central-directory-only scan,
   1.46 MiB read instead of 92.4 MiB, lazy inflation at install. Unmerged, unverified by me.
4. **The core header is still read in full.** Capping it needs a new littlefs WASM export
   (`lfs_w_read_n`) and an emsdk rebuild; `emcc` is not in the dev container.
5. **`hbRemovals` lacks the `deviceFiles.length > 0` guard** its sibling in
   `homebrewTitles.svelte.ts` has, so a title with only derived outputs is a phantom removal.

## Known open (do not read the list above as covering these)

- **The flash-only content split is not settled.** The rule today is directory-based: cores to
  LittleFS, everything else to FrogFS, mirroring upstream's `gen_littlefs_image.py` /
  `gen_frogfs_image.py` defaults. That is at best partially right. A core's binary is loaded into
  RAM and belongs in LittleFS, but some cores carry read-only data (pico-8, GBA) that must be
  **contiguous and XIP-able**, which means FrogFS; the same applies to homebrew and its data. A
  directory cannot express that, because the deciding fact is the file's runtime role, not the
  folder it arrived in. A spec addition is under discussion upstream to make it expressible —
  `"mapped": { "base": <sentinel> }` on an artifact, meaning the file must be placed somewhere
  directly addressable, with `base` the sentinel it was linked at so a placer can relocate every
  pointer into `[base, base+size)` by the delta. **Do not design against the current split as
  though it were settled.** See `docs/ARCHITECTURE.md`'s "Where a core's files land" and
  `docs/RETRO_GO_EXTFLASH_WRITES.md`.
- **Flash layout questionnaire** — built, then **reverted** (`64e2db1`, reverted by `d24ab60`).
  It was invented UI with no approved artboard behind it; the littlefs sizing fix it carried was
  kept. Nothing of the questionnaire remains in the tree.
- **Restore-to-stock is untested on hardware.** Offline checks only. Hardware verification is
  the owner's, per HANDOVER §3 — do not re-raise it.
- **`curated` and `Installed` source chips are dropped from the design** — they were an
  invention. `curated` in particular waits on the distribution model carrying a repo list;
  there is nothing today for the app to be curated *against*.
- The two spec proposals in `docs/proposals/` are open:
  [`bios-placement.md`](./docs/proposals/bios-placement.md) (kept as the evidence for the
  `biosDir` field that shipped) and
  [`bios-derived-files.md`](./docs/proposals/bios-derived-files.md) (`systems[].bios[].derivedFrom`
  — a core can open a BIOS file the build system manufactures from a file the user supplied, and
  a host that follows the manifest exactly produces a device missing it).
- [`docs/audit-invented-copy.md`](./docs/audit-invented-copy.md) records a copy audit against the
  approved artboards (1 structural, 7 wording, 6 unsupported-prose defects). Its findings have
  been applied.

## Test suite (apps/web)

`npm run check --workspace @gnw/web` runs every suite in `apps/web/test/` (see the `check` script
in `apps/web/package.json` for the authoritative list and order) and then `svelte-check`;
`npm run build` runs the same list plus `vite build`. **One** gate is not in `check`:

```bash
docker compose exec dev sh -c 'cd apps/web && npx vite build'
```

`src/lib/sources/test/validate.mjs` used to be listed here as a second one; it is inside both
`check` and `build` now, so running it by hand only repeats it. `vite build` genuinely stays
outside `check` and is the only gate that catches a TS optional parameter in a `.svelte` script
block.

**Do not record per-suite check counts in this file** — HANDOVER §5 explains why (they went
stale four times in two days and misdispatched agents). Run the gates and read the counts off
that run; what matters is that a count does not *drop*.

`svelte-optional-params.mjs` exists because a TS optional parameter in a `.svelte`
`<script lang="ts">` passes `svelte-check` and breaks `vite build` — the transform drops the type
and leaves the `?`. It shipped a blank white page once (`d3493c5`). See CLAUDE.md's dev-container
gotchas. `i18n-locale-drift.mjs` fails when an English string changes without its fourteen siblings;
it now runs inside a container worktree, and **a SKIP from it is a broken worktree, never a pass**.

Two documentation guards run in the same script and are the reason the bookkeeping above is
checked rather than asserted (see CLAUDE.md's "Documentation guards" and HANDOVER §4b):
`conformance-counts.mjs` re-derives the per-status counts of both artboard surveys by the rule
`docs/CONFORMANCE.md` states and diffs them against that file's scoreboard table;
`artboard-index.mjs` fails when the `docs/design/mockups/*.dc.html` set, the README index table
and `canvas.json` disagree in either direction. Both exit non-zero when they cannot actually run,
rather than printing a green line — and a survey status cell is never the thing to "fix" to make
a count pass.

`ofw-patch.mjs` covers `patchAndFlash` offline (capacity guard, bootloader-overlap guard, the
single-write bank-1 splice, write order/targets, progress accounting including the spliced
bank-1 total, abort, input immutability) and closes a gap `ofw-restore.mjs` didn't: `ofw.ts` was
missing the two explicit abort checks `restoreStock` already had. `engine/restoreGuards.ts`
extracts the Wizard's restore verdict (both-dumps-valid / Zelda-on-Mario / capacity) out of the
Wizard so it is independently testable and so `Advanced.svelte`'s restore path reuses the same
verdict instead of a second copy, while keeping its own acknowledge-and-override.

A P0 shipped-broken bug was found and fixed in this area: `sources/converter.ts`'s `runConverter`
passed `opts.tool.limits`/`opts.tool.outputs` into the conversion Worker's `postMessage` by
reference. `RomManagementTab.svelte` holds the chosen title in `$state`, which proxies plain
objects/arrays **deeply** (not `Uint8Array` — only values whose prototype is `Object.prototype`
or `Array.prototype`), so those two fields arrived as Proxy exotic objects and structured clone
refused them outright: `DataCloneError`, converter never ran. Every homebrew-prepare attempt had
been failing since the converter host landed. Fixed by `buildWorkerRequest()`, a single boundary
that rebuilds the request field by field into plain values; regression coverage in
`sources/test/validate.mjs` runs `runConverter` against a Svelte-shaped deep proxy through a
Worker stand-in that calls Node's own `structuredClone`.

## Code Quality / Cleanup Pass (in progress)

A full-codebase audit is tracked in [`docs/AUDIT_NOTES.md`](./docs/AUDIT_NOTES.md) (timeout/retry
sprawl, chunked-read pacing, engine-layer constant duplication, download-blob helpers, modal shell
duplication, LED-color tokens, `packages/` internal dedup, the install-progress-modal architecture
fix, a `gnw-flasher` protocol bug, flash auto-retry, design-token duplication, and more). **Read
its "Counts by status" table for what is still open** rather than a status quoted here; it was
re-verified item by item on 2026-09-07/08, and the remaining work is the partially-fixed items it
names, in the priority order that file gives. The `RomManagementTab.svelte`
dead-CSS item (~19 unused selectors, exposed when `class="gchip {state.cls}"` became a component
prop) is now deleted. Several UI-visible changes from this pass
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
  image" / "Build cores/saves image" / "Patch superblock", or the flash phase's per-region
  writes) — a genuinely atomic phase has none.
- **One shared, timestamped, auto-scrolling audit log** at the bottom of the modal — collapsed
  by default, remembers the user's last open/closed choice across separate operations
  (`persist.ts`, key `install-log-open`). Every entry is `YYYY-MM-DD HH:MM:SS [Phase — Substep]
  message`, logging real decisions (target version resolved, migrate-games/saves choices and
  why, inferred/chosen bank, budget fit results, retry attempts) and real granular step-by-step
  narration, not raw device chatter dumped as one run-on sentence.
- "FrogFS"/"LittleFS" are referred to as **"Games, BIOS, Languages"** / **"Cores, Saves"**
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
   **Fixed:** reverted to 120s; a `Wizard.svelte` outer-timeout guard that was never bumped to
   match (and so would fire before the inner watchdog ever got a chance) was fixed alongside it.
   Enumerate `Wizard.svelte`'s sibling guards with
   `grep -n 'withTimeout(' apps/web/src/lib/views/Wizard.svelte` and keep every flash-family one
   `>=` 120s — one of the hits is a 30s dump guard and is unrelated. Don't trust a count in prose.

Owner-confirmed on real hardware: "flashing much much faster and it was smooth" after this fix.

## Architecture

**Cores vs ROMs:**
- **ROMs** are packed into a **FrogFS** image which is flashed to the lower section of external flash.
- **Cores** are packed into a **LittleFS** image which is flashed to the upper section of external flash (this partition also holds Saves, Screenshots, and Settings).

When adding ROMs through the ROM Management Tab, the application extracts the existing FrogFS contents and repacks them alongside the new ROMs. This process must be **version independent** to ensure we don't accidentally create a mismatch between the firmware version and the installed cores (which live in LittleFS).

## Documentation Navigation

The documentation hierarchy is strictly limited to 3 hops (`CLAUDE.md` -> `STATUS.md` -> `docs/*.md`). When you need specific technical details, consult the appropriate core document:

- [**`docs/ARCHITECTURE.md`**](./docs/ARCHITECTURE.md): The overall architecture, how the host communicates with the device over SWD, WebUSB transport (`packages/swd-transport`, `packages/gnw-flasher`), device scanning, classification, and the Master Glossary & Hardware Quick Reference.
- [**`docs/DEVELOPMENT.md`**](./docs/DEVELOPMENT.md): The development environment, Docker container setup, testing, the firmware distribution pipeline (`versions.json` → `manifest.json` → hash-verified bundles), and the `/` + `/wip/` Pages deploy.
- [**`docs/ELECTRON.md`**](./docs/ELECTRON.md): The desktop build's filesystem plan — the shared
  `FsDirHandle` seam, what a native implementation changes, and the open questions.
- [**`docs/FILESYSTEMS.md`**](./docs/FILESYSTEMS.md): Detailed information on how data is stored. Explains FrogFS (ROMs, BIOS, Fonts) vs LittleFS (Cores, Saves), WASM integrations, LZMA sidecar compression for ROMs, and the client-side content packing pipeline.
- [**`docs/RETRO_GO_EXTFLASH_WRITES.md`**](./docs/RETRO_GO_EXTFLASH_WRITES.md): What the firmware
  itself writes to extflash and what it reserves — the ROM cache's floor, the updater's lack of
  one, and why an unpatched superblock still protects the stock assets. Read before changing any
  offset math.
- [**`docs/VIRTUAL_CONSOLE.md`**](./docs/VIRTUAL_CONSOLE.md): Feasibility of a preview/test mode
  backed by GWemu over its GDB stub (and the browser twin), starting from the working
  `feat/qemu-adapter` branch.
- [**`docs/PATCHING.md`**](./docs/PATCHING.md): Details the byte-exact `gnw-patch` mechanism (stock Mario/Zelda to dual-boot) and the `GnwLayoutSuperblock` format used to dynamically size partitions at flash-time.
- [**`docs/UI_VOICE.md`**](./docs/UI_VOICE.md): What user-visible copy may and may not say, every
  rule quoted from an owner correction. **Read before writing or changing any string, or drawing
  any board.** No narration, no filler, state in structure rather than wording.
- [**`docs/CONFORMANCE.md`**](./docs/CONFORMANCE.md): The live scoreboard for the UI redesign —
  what conforms to the artboards and what does not, with its counting rule stated. Open questions
  are in `docs/DECISIONS.md` / `docs/DECISIONS-MAP.md` / `docs/BLOCKED-AUDIT.md`.
- [**`docs/RESUME-HERE.md`**](./docs/RESUME-HERE.md): The running "start here next session" note —
  what the last session actually changed and the questions it left open.
- [**`docs/UX_DESIGN.md`**](./docs/UX_DESIGN.md): The UI specs, workflows, phase models (Guided vs Advanced mode), visual design system, and the user's mental model for ROM and game management.
