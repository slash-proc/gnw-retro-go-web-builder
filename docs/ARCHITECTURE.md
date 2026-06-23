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

On connect, the device is grouped into one of the following categories to drive UI options:
- **Stock (Mario|Zelda)**: Bank1 (overwrite) *or* Bank2 (keep stock, patch bank1 to chainload).
- **Retro-Go-sd (current)**: Reinstall / ROM Management.
- **Retro-Go-sd (out-of-date)**: Upgrade offered.
- **Unknown/Locked**: Unlock-first path or read-only backup fallback.

## Key Decisions

**No OpenOCD.** The SWD primitives are all that's needed, and the browser libraries provide them.

**Dependency injection, no bundler.** The frontend loads plain ES modules. Packages stay zero-dependency and the environment-specific glue is injected from the frontend.

**LZMA implementations.**
For performance and byte-exact compatibility, we use two separate LZMA implementations. See [PATCHING.md](./PATCHING.md) and [FILESYSTEMS.md](./FILESYSTEMS.md) for details.

**Bank swapping: dropped.** The STM32 dual-bank `SWAP_BANK` option byte is not part of this product. No swap UI, logic, or awareness — except one build guard: never flash a bank1-built image into bank2.

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
