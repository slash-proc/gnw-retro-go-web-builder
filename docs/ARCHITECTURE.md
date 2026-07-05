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

## Layers

```
        ┌──────────────────────────────────────────────────────────┐
  UI →  │  L3  builder-core   "endpoint" API (resolveBuild, …)      │
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
- SWD clock is driven conservatively (dapjs defaults to 10 MHz, which corrupts
  transfers over flying leads; we set 2 MHz). ST-Link uses webstlink's 1.8 MHz.

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

The orchestrator the GUI will call. `resolveBuild()` (the Makefile-equivalent
layout logic) orchestrates manifest checking, artifact fetching, filesystem packaging, and flash instructions.

### Side packages

- **`thumb-asm`** — a tiny in-house ARM Thumb-2 assembler. The patcher needs to
  encode a handful of instructions; rather than ship keystone (or its cache), we
  port gnwmanager's pure-Python `thumb_asm.py`. See [PATCHING.md](./PATCHING.md).
- **`gnw-patch`** — the firmware patcher: stock Mario/Zelda OFW → retro-go
  dual-boot build, **byte-exact** with gnwmanager. Its own doc: [PATCHING.md](./PATCHING.md).
- **`fs-builders`** — FrogFS/LittleFS/SD image builders for packing ROMs. See [FILESYSTEMS.md](./FILESYSTEMS.md).

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
- **`locked`**: RDP lock active. Unlock-first path.
- **`unknown`**: Unrecognized flash contents. Read-only backup fallback.

## Key Decisions

**No OpenOCD.** The SWD primitives are all that's needed, and the browser libraries provide them.

**Dependency injection, no bundler.** The frontend loads plain ES modules. Packages stay zero-dependency and the environment-specific glue is injected from the frontend.

**LZMA implementations.**
For performance and byte-exact compatibility, we use two separate LZMA implementations. See [PATCHING.md](./PATCHING.md) and [FILESYSTEMS.md](./FILESYSTEMS.md) for details.

**Bank swapping: dropped.** The STM32 dual-bank `SWAP_BANK` option byte is not part of this product. No swap UI, logic, or awareness — except one build guard: never flash a bank1-built image into bank2.

**Firmware blobs come from upstream CI, not this repo.** This repo's CI only builds and deploys the web frontend. The intflash firmware blobs (`1`, `2`, `sd_1`, `sd_2`) and `sdContent` (cores, bios, fonts) are built by the upstream `game-and-watch-retro-go` / `game-and-watch-retro-go-sd` CI pipelines and shipped in a `web-artifacts.zip` attached to each GitHub release. The web app fetches this zip at runtime from `artifacts.ts`.

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
- **core**: A single emulator (NES, GB) built as a separate binary.
- **FrogFS**: Read-only packed filesystem for ROMs/assets.
- **LittleFS**: Writable flash filesystem for cores and saves.
