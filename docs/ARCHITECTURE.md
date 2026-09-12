# Architecture

How the app is structured and **why**. For the everyday dev workflow see
[DEVELOPMENT.md](./DEVELOPMENT.md); for domain terms see [PATCHING.md](./PATCHING.md).

## Project Goal & Context

The traditional firmware flashing process relies on command-line tools, Python environments, and bakes user-supplied (copyrighted) ROMs directly into the firmware image at compile-time. This makes distributing pre-compiled firmware legally impossible. 

**Our Goal:** A browser app where the user picks options and supplies their own legally-obtained ROMs. The app fetches pre-compiled, ROM-agnostic firmware binaries from GitHub CI, dynamically packs the user's ROMs into filesystems (FrogFS/LittleFS), and flashes everything **entirely client-side**. ROMs never leave the machine, meaning the hosted app carries no copyrighted material.

## The one idea that makes this tractable

Flashing a Game & Watch *looks* like it needs OpenOCD and a custom external-flash
loader. It doesn't. The insight (from studying gnwmanager):

> gnwmanager uses OpenOCD as a **dumb SWD pipe** only — it loads a small RAM
> "flash util" (`firmware.bin`) into the device's SRAM, then drives everything by
> **writing/reading device memory** and **halt/resume**. The actual flashing runs
> *on the device* inside that util. OpenOCD never programs flash.

Those primitives — `readMemory`, `writeMemory`, `writeRegister`, `halt`,
`resume`, `reset` over SWD — are exactly what **dapjs** (CMSIS-DAP) and
**webstlink** (ST-Link) already provide in the browser via WebUSB. So the whole
host side reduces to: a thin transport, the gnwmanager mailbox protocol replayed
on top, and the device blobs reused unmodified. No OpenOCD, no WASM debugger, no
external-flash-loader engineering.

## Codebase map

One screen of where everything lives. The layer detail is below.

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
                            flash-install orchestrator, installPaths: all real. index.ts's
                            buildSdLayout/buildFlashImages/buildFilesystem façade is stubbed
                            (BOTH modes, not just SD) and nothing calls it
apps/web/                THE REAL UI — Svelte 5 + Vite SPA: device.svelte.ts (store), ui/, views/,
                            advanced/, sources/, i18n/, engine/ (transport.ts connects;
                            flasher.ts does info/flash/dump; flashInstall.ts, fsscan.ts,
                            intflashscan.ts, classify.ts, devicePaths.ts, screenshot.ts…)
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

## Layers

```
        ┌──────────────────────────────────────────────────────────┐
        │  apps/web  THE REAL UI (Svelte 5 + Vite). lib/engine/ is   │
        │      its own typed layer over L1/L2/gnw-patch/fs-builders  │
        ├──────────────────────────────────────────────────────────┤
        │  L3  builder-core   "endpoint" API (resolveBuild, …)      │
        ├──────────────────────────────────────────────────────────┤
        │  L2  gnw-flasher    gnwmanager mailbox protocol in JS     │
        │      startStub · info · flash · dump · clock · progress   │
        ├──────────────────────────────────────────────────────────┤
        │  L1  swd-transport  SwdTransport: read/write mem+regs,    │
        │      halt/resume/reset   (dapjs · webstlink backends)     │
        └──────────────────────────────────────────────────────────┘
   side: thumb-asm (Thumb-2 assembler)   gnw-patch (firmware patcher)
         fs-builders (FrogFS/LittleFS filesystem packing)
```

### L1 — `packages/swd-transport`

One interface, two WebUSB backends. The package is **zero-dependency**: each
backend wraps a low-level handle the caller injects (a dapjs `CortexM` or a
webstlink `Stlinkv2`), so the package itself imports neither library.

- `DapjsTransport` (Raspberry Pi debugprobe/picoprobe; **CMSIS-DAP v2** required).
- `WebStlinkTransport` (ST-Link v2).
- `halt`/`resume`/`reset` are implemented against **generic ARMv7-M debug
  registers** (DHCSR/DEMCR/AIRCR), so they work on the STM32H7B0 even though
  neither library's chip table lists it.
- SWD clock is driven conservatively: dapjs defaults to 10 MHz (which corrupts
  transfers over flying leads) and webstlink to 1.8 MHz. `apps/web` overrides
  **both** to one shared value — `SWD_CLOCK_HZ` in `lib/engine/transport.ts`,
  the ST-Link table maximum. Lower it there if flying leads corrupt transfers.

### L2 — `packages/gnw-flasher`

A direct JS port of gnwmanager's host protocol (`gnw.py`). The device exposes a
memory-mapped **mailbox** at `0x24025800`: a global status area plus two
double-buffered 256 KiB "context" slots. Commands are structured memory writes;
completion is status polling.

- `startStub(firmware)` — reset-and-halt, write the RAM util to `0x240E6800`, set
  SP/PC from its vector table, resume, poll status until `IDLE` (`0xCAFE0000`).
  Then set the device clock (`utc_timestamp`).
- `info()` — read back what the booted stub reports (ext-flash size/JEDEC, lock
  state, detected stock firmware).
- `flash(bank, offset, data)` — the context protocol: fill a slot
  (size/offset/bank/erase/sha256 + LZMA-compressed payload), trigger, await
  device verify. Writes a 0–26 progress field the device GUI draws. Bank 0 = ext
  (`0x90000000`), 1 = bank1 (`0x08000000`), 2 = bank2 (`0x08100000`).
- `readFlash(...)` — dump a region (memory-mapped read; needs the stub running so
  OSPI is mapped).
- Vendored on-device blobs (`firmware.bin`, `unlock.bin`) live in `blobs/`.

### L3 — `packages/builder-core`

`resolveBuild()` — the Makefile-equivalent layout logic — is real and tested
(`test/resolveBuild.mjs`). The rest of the "endpoint" API (`fetchManifest`,
`fetchArtifacts`, `buildFilesystem`, `flash`, `pullSaves`/`pushSaves`) is still
scaffold stubs that throw. **`apps/web` does not import this package at all** —
it drives L1/L2, `gnw-patch` and `fs-builders` directly from its own
`lib/engine/`, and fetches artifacts in `lib/artifacts.ts`. Treat L3 as an
unfinished alternative front door, not as the path the app takes.

### `apps/web` — the real UI

A Svelte 5 + Vite SPA, and the only UI that ships. (`frontend/` is the throwaway
`/dev` harness — see [DEVELOPMENT.md](./DEVELOPMENT.md).) Under `src/lib/`:

- `engine/` — the typed layer over the packages: `transport`, `flasher`,
  `flashInstall`, `patch`, `ofw`, `fsscan`/`intflashscan`/`classify`,
  `screenshot`, `lfsBrowser`, `frogfsDevice`.
- `device.svelte.ts` — the central store (connection, liveness poll, scan
  results, classification). Read `.firmware`, never `.type`.
- `views/` — the tabs; `advanced/` — the Advanced Firmware sections;
  `sources/` — ROM/BIOS sourcing and conversion; `ui/` — shared components;
  `i18n/` — one string file per area per locale.

The page is a **fixed viewport**: `.app` is `height: 100vh; overflow: hidden` and
`.tabpane` is the only general scroll container. No gate in this repo detects
breaking that.

### Cores and homebrew — what a core actually is

A **core** is a program that teaches the Game & Watch to run a *category* of
content. It ships a binary, and it declares one or more **systems**: for each,
the `roms/<folder>/` directory its content lives in, the file extensions that
count, the names to show, and how the launcher browses them. Install a core and
the device gains a console it did not have; remove it and that console goes away
along with its tab.

A **homebrew app** is a program that *is* the content. It ships a binary and
runs. It declares no systems, owns no folder, and adds no console. One entry in
the launcher, one thing to play.

That is the whole distinction, and it is a difference in kind rather than in
degree: **a core is not a fancy homebrew app, and homebrew is not a core with
nothing in it.** The two are separate first-class kinds in the manifest
(`kind: "core"` / `kind: "homebrew"`), they install to separate directories
(`coresDir()` / `homebrewDir()` in `sources/placement.ts`), and only one of them
is allowed to create a console.

**A core is not the same thing as an emulator.** An emulator is one *kind* of
core — the kind that imitates real hardware, like the NES or Game Boy core. But
DOOM is a core too: it declares a `doom/` folder and the `.wad` extension, it
turns WADs into playable entries, and it emulates nothing whatsoever. It is a
game engine. "Core" is the general word that covers both, which is why the
distribution spec renamed the manifest field (`gwrg-dist-spec` commit `d6c24b0`,
"Call a core a core") and why this app says *core* everywhere a user can see.

#### How a core reaches the Library

Nothing about the console list is hardcoded. The chain is one direction only:

```
an active source declares a system  (folder, names, extensions, browse mode)
  -> a scan of the user's ROM folder(s) finds files matching that declaration
    -> that console, and only that console, gets a button in the Library
```

So a console button requires **both halves**: an active core that declares the
system, *and* files on disk that match it. A `gbc/` folder with no Game Boy Color
core enabled produces no button; an enabled core whose folder is empty produces
no button either. Deactivating a source removes its console, because the first
half stopped being true.

`sources/coreRegistry.ts` implements this and its header comment records the
three hardcoded tables it replaced — `romScan.ts`'s `CONSOLE_DIRS`,
`romSelection.svelte.ts`'s `CONSOLE_WHITELISTS`, and `engine/consoles.ts`'s
`LABELS`, none of which ever consulted the user's Sources. **Those three still
exist and must not be deleted**: they are the fallback for a user who has added
no cores yet, and the name supply for a console that is already on the device
whose core was later disabled. Do not add a fourth.

One asymmetry worth knowing: whether a directory *is* a console directory is
structural and does not depend on activation, but whether it gets a *button*
does. `registryIsAuthoritative()` is the switch between the two regimes.

#### Where a core's files land, and the two mappers that decide

On **SD** every role is a directory on the card. On **flash** there are two
filesystems and the role decides which one: upstream builds cores into the
LittleFS image and FrogFS from bios/covers/fonts/roms
(`gen_littlefs_image.py` `DEFAULT_DIRS=("cores",)` vs `gen_frogfs_image.py`).
That split is upstream's to define; we mirror it.

Two functions map a content key to a destination, and **they must agree**:

| | mapper | used by |
|---|---|---|
| SD | `sdDestPath()` (`engine/devicePaths.ts`) | the card sync |
| Flash | `userDest()` (`fs-builders/src/flashImage.ts`) | the FrogFS/LittleFS pack |

Both pass a key already rooted at a known role through untouched and fall back
to `under(paths.roms, key)` for anything else. **Neither had a case for
`paths.cores`**, so a core supplied by a *source* (rather than by the firmware
bundle) took the ROMs fallback and became `roms/cores/<file>` — on SD, a
directory the firmware never reads; on flash, inside the FrogFS payload where a
core is equally invisible. `test/devicepaths.mjs` now drives both live
implementations and compares them, so the two cannot drift apart again.

On flash there was a **second** defect behind the first: `flashImage.ts` split
the *bundle* content into the cores tree but never split `userRoms`, so fixing
the path alone would have shipped a correctly-named core into the wrong
filesystem. Path and partition are two decisions; a check that pins only one
passes while the other is broken.

#### Open: the flash-only content split is not settled

The rule above is **directory-based**, and that is at best partially right. A
core's binary is loaded into RAM and belongs in LittleFS, but some cores carry
read-only data (pico-8, GBA) that must be **contiguous and XIP-able**, which
means FrogFS. The same question applies to homebrew and its data. A directory
cannot express that, because the deciding fact is the file's role at runtime,
not the folder it arrived in.

A spec addition is under discussion upstream to make this expressible:
`"mapped": { "base": <sentinel> }` on an artifact, where presence means the file
must be placed somewhere directly addressable rather than in a filesystem, and
`base` is the sentinel address it was linked at — so whoever places it can
relocate every pointer into `[base, base+size)` by the delta. **Do not design
against the current directory split as though it were settled.** See
[RETRO_GO_EXTFLASH_WRITES.md](./RETRO_GO_EXTFLASH_WRITES.md) for what the
firmware actually reserves and reads.

### Side packages

- **`thumb-asm`** — a tiny in-house ARM Thumb-2 assembler. The patcher needs to
  encode a handful of instructions; rather than ship keystone (or its cache), we
  port gnwmanager's pure-Python `thumb_asm.py`. See [PATCHING.md](./PATCHING.md).
- **`gnw-patch`** — the firmware patcher: stock Mario/Zelda OFW → retro-go
  dual-boot build, **byte-exact** with gnwmanager. Its own doc: [PATCHING.md](./PATCHING.md).
- **`fs-builders`** — the FrogFS builder and parser, LittleFS builder, ROM
  `.lzma` sidecars, staging transforms and the flash-install orchestrator. All
  real and oracle-tested; only the SD endpoints in `index.ts` remain scaffold
  stubs. See [FILESYSTEMS.md](./FILESYSTEMS.md).

## Device Scan & Classification (Host-Side)

How the app learns what's on a connected Game & Watch and decides what to do with it. **The scan runs on connect and drives the whole UI** — classification, which install options are offered, what gets preserved, and the up-top geometry visualization.

We replicate gnwmanager's *on-device* flash-geometry scanner **on the host, over SWD** — reading raw flash through the debug connection and doing all filesystem/partition recognition in TypeScript. 

### Extflash Partition Scan (`fsscan.ts`)

A multi-stride walk reading a 512B header at each probe point via `readFlash`, matching in priority order:
- **LittleFS**: `"littlefs"`@+8, disk version major 2, sane block_size/count.
- **FAT**: `sec[510..511]==55 AA`.
- **FrogFS**: `"FROG"`@0.
- **OFW backup (Int, 128 KiB)**: Mario / Zelda specific signatures.
- **Asset blobs**: 4 fixed 8-byte sigs (OFW vs Assets).

### Intflash Bank Scan (`intflashscan.ts`)

Recognizes the payload per bank (0x08000000, 0x08100000). Reads the vector table to validate the app, then checks the reset vector to determine if it is Stock OFW or Retro-Go payload.

To determine the true data size, a **backward 16 K stride** scan from the bank top is used to find the end of the data payload (stops after 4 empty `0xFF` strides). 

### Device Classification

On connect, the device is grouped into one of the following categories (`DeviceKind` in `classify.ts`) to drive UI options:
- **`stock`**: Bank1 holds stock Nintendo OFW (Mario or Zelda). Bank1 overwrite *or* Bank2 install (keep stock, patch bank1 to chainload).
- **`retrogo-sd`**: Retro-Go SD firmware detected — version string starts with "Retro-Go SD" or FrogFS is present in extflash. Current install; Reinstall / ROM Management offered.
- **`retrogo-old`**: Older Retro-Go install — LittleFS/app present but no SD version string. Upgrade to the SD-capable build offered.
- **`locked`**: RDP lock active. Any flow that writes unlocks first, automatically
  (`engine/unlockGate.ts`). Note the ordering is *not* back-up-then-unlock: RDP 1 makes internal
  flash unreadable over SWD, so a locked device cannot be backed up first, and clearing RDP
  mass-erases internal flash. Backup flows therefore do not auto-unlock. See UX_DESIGN 2.2.
- **`unknown`**: Unrecognized flash contents. Read-only backup fallback.

## Key Decisions

**No OpenOCD.** The SWD primitives are all that's needed, and the browser libraries provide them.

**Dependency injection, no bundler *in the packages*.** Every `packages/*` has
zero third-party dependencies — the environment-specific glue (a dapjs `CortexM`,
a webstlink `Stlinkv2`) is injected by the caller. The `frontend/` harness loads
the built `dist/*.js` as plain ES modules via an import map; `apps/web` is a Vite
app and resolves `@gnw/*` through an alias, but the packages themselves stay
bundler-agnostic either way.

**LZMA implementations.**
For performance and byte-exact compatibility, we use two separate LZMA implementations. See [PATCHING.md](./PATCHING.md) and [FILESYSTEMS.md](./FILESYSTEMS.md) for details.

**Bank swapping: dropped.** The STM32 dual-bank `SWAP_BANK` option byte is not part of this product. No swap UI, logic, or awareness — except one build guard: never flash a bank1-built image into bank2.

**Firmware blobs come from upstream CI, not this repo.** This repo's CI only builds and deploys the web frontend. The intflash firmware blobs and the content trees (cores, bios, fonts, languages) are built by the upstream `game-and-watch-retro-go-sd` pipeline and published to **GitHub Pages** as `dist/versions.json` plus a per-release `manifest.json` and four bundle zips (`flash-bank1`, `flash-bank2`, `sd-bank1`, `sd-bank2`). The contract is `docs/FIRMWARE_DIST.md` in that repo; the client is `apps/web/src/lib/firmwareDist/`, with `artifacts.ts` as a thin adapter over it. Bundle bytes are refused before the archive is opened unless `bundle.sha256` matches, and every extracted entry is hash-checked afterwards. See [DEVELOPMENT.md](./DEVELOPMENT.md#firmware-distribution-ci--consumption).

**A folder scan whitelist can silently break something years later.** `romScan.ts`'s local-folder walker only keeps whitelisted filenames (`HOMEBREW_DEVICE_FILES`/`HOMEBREW_SOURCE_ROMS`) inside a `homebrew/` folder — added to keep stray junk out of the scan, it also silently dropped homebrew cover art (`.png`/`.jpg`/`.img`), since a cover matches neither list. This broke cover loading for both flash and SD, for both manually-placed and UI-set covers, and looked like a device/sync bug for a while before the actual cause (the scan itself, upstream of everything else) was found. Lesson: a whitelist filter needs to be re-examined whenever a new content *type* (not just new content) is added to a directory it covers.

**Auto-scan on discovering a live device — freshness-gated, not unconditional.** `device.svelte.ts`'s liveness poll (`pollTick()`, every 300ms while idle) can passively discover the flash util already running (e.g. left over from a prior session) via `isStubAlive()`. `ensureStub()` itself deliberately never triggers a scan, so without this the UI could show "Connected (Recovery Mode)" (status bar, keyed on `utilLoaded`) while other panels still showed stale "Enter Recovery Mode" prompts (keyed on `device.partitions`, populated only by a scan that never ran). Fixed by having the poll fire `runScan()` on a genuine not-loaded→loaded transition — but gated by `_lastFullScanAt`/`AUTO_SCAN_FRESHNESS_WINDOW_MS` (60s), so a device that scanned recently doesn't get an unsolicited extra scan every time the poll happens to notice. This gate applies **only** to that passive trigger — every deliberate `runScan()` call elsewhere (post-install, an explicit Scan button) always runs regardless of freshness.

**One shared stat-panel component, not three.** `StatPanel.svelte` (`apps/web/src/lib/ui/`) is the single implementation for "bordered box of label/bold-value rows" — previously duplicated three times under unrelated names (`OverviewTab.svelte`'s `.bank-footer`/`.ext-fs-single`/`.fs-stat-row`, `RomManagementTab.svelte`'s `.sd-summary`/`.sd-stat`/`.sd-label`/`.sd-val`, `ChangeSummary.svelte`'s `.summary`/`.row`/`.label`/`.status`). `ChangeSummary.svelte` is now a thin wrapper around it (kept for its external `{items, bare}` interface, still used by `ConfirmModal.svelte`). Reach for `StatPanel` directly for any new stat/summary display — don't hand-roll a fourth version.

**Open question, not yet resolved: does our web app's "Sync SD Card" actually work end-to-end?** `references/game-and-watch-retro-go-sd/external/firmware_update/` is a **separate git submodule** building its own standalone `firmware_update.bin` artifact — the code that actually checks for `update_bank2.bin`/`update_bank1.bin`/`gnw_bootloader*.bin`/`update_extflash.bin` on the SD card lives there, not in the main `gw_retro_go.bin` the device runs day-to-day. Nothing found in this repo or the retro-go-sd Makefile/release process flashes `firmware_update.bin` into any bank — our Wizard's "patch official firmware" step flashes bank1 with the stock OFW patched to chainload (via `gnw-patch`), which is a different binary entirely. If `firmware_update.bin` never actually boots on the device, the update-checking code never runs, and `update_bank2.bin` sitting on the SD card would be silently ignored regardless of correct naming/placement — this may be why SD-card "sync cores" hasn't been observed to actually apply an update. Needs resolution before trusting that feature; see [[sd-content-variant-mismatch-bug]] for related SD/flash divergence history. Also noted in passing: `references/gnw-chainloader/` is a **separate, more ambitious** triple-boot/multi-payload bootloader project (its own repo, its own `DESIGN.md`) — not integrated with this app at all currently, distinct from (and not a fix for) the above.

## Glossary & Hardware Reference

Domain terms used across this project:

### Hardware
- **Game & Watch (G&W)**: Nintendo's 2020 collectibles (Mario/Zelda). STM32H7B0 MCU.
- **SWD (Serial Wire Debug)**: 2-wire ARM debug protocol, driven over USB via a **debug probe** (ST-Link v2 or Raspberry Pi debugprobe running CMSIS-DAP v2).
- **WebUSB**: Browser API for raw USB access to the probe.
- **intflash**: MCU's on-chip flash (bank1 at `0x08000000`, bank2 at `0x08100000`) (128 KiB stock image).
- **extflash**: External OSPI flash mapped at `0x90000000` (1 MiB Mario, 4 MiB Zelda, 16+ MiB modded; OTFDEC-encrypted).
- **SRAM**: `0x24000000`; mailbox `0x24025800`; RAM util loads at `0x240E6800`.
- **OTFDEC**: On-The-Fly DECryption peripheral.
- **RDP**: Read-Out Protection.

### Protocol
- **gnwmanager**: Upstream Python CLI.
- **RAM util / firmware.bin**: gnwmanager's small program loaded into SRAM to drive flash operations.
- **mailbox**: Memory-mapped comm structure at `0x24025800`.
- **OFW**: Original/stock FirmWare.

### Firmware & Filesystems
- **retro-go**: The homebrew multi-emulator firmware.
- **core**: A separately-built binary that adds a whole console to the device by declaring its folder, extensions and names. An **emulator** (NES, GB) is one kind of core; DOOM is a core that emulates nothing. Not a kind of homebrew — see "Cores and homebrew" above.
- **homebrew**: A standalone app that *is* the content. Declares no systems and adds no console.
- **FrogFS**: Read-only packed filesystem for ROMs/assets.
- **LittleFS**: Writable flash filesystem for cores and saves.
