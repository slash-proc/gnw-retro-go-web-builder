# Filesystems

The Game & Watch flash mod requires writing a read-only filesystem (FrogFS) and a read-write filesystem (LittleFS) to the external SPI flash chip. This document covers the formats, our WASM integrations, and the orchestration pipeline to build them client-side in the browser.

## The Big Picture: Two Install Paths

### Flash Install (internal storage only)

The flash install writes the intflash firmware blob plus **two** extflash regions:

1. **FrogFS (read-only) at the bottom** (`EXTFLASH_OFFSET`): Holds `bios`, `fonts`, `roms`, `lang`.
2. **LittleFS (read-write) at the top** (`FILESYSTEM_OFFSET`, grows down): Holds the **cores** and runtime **saves**.

The device serves `/cores/*` from LittleFS and `/roms`, `/bios`, `/fonts`, `/lang` from FrogFS via a unified Virtual Filesystem (VFS). Cores must be flashed into LittleFS, they do *not* go into FrogFS.

### SD Card Install

When the user has the SD card hardware mod and selects "SD Card" as their target media, the pipeline is entirely different:

- **Intflash** receives the `sd_1`/`sd_2` blob (an SD-capable Retro-Go build), same as any intflash write.
- **Extflash** is left completely untouched — FrogFS and LittleFS are **not written**.
- **SD card content** (`sdContent` from the CI bundle: cores, bios, fonts) is written directly to the user's SD card directory via the File System Access API.
- ROMs are managed by reading/writing files on the SD card filesystem, not by repacking FrogFS.

The content pipeline stages 3–7 below (LZMA compress, FrogFS/LittleFS build, superblock patch, extflash flash) are **skipped entirely** for SD installs.

## Cheats

Cheat files live **directly next to the ROM they apply to** — `roms/<system>/<name>.<ext>` (`.ggcodes` for NES/GB Game Genie/GameShark codes, `.pceplus` for PCE hex patches, `.mcf` for MSX/Coleco/SG-1000 whole-file blueMSX cheats) — confirmed on real hardware for both flash and SD. This contradicts the upstream README/`odroid_system.c` path-helper naming (`ODROID_PATH_CHEAT_*`, which implies a separate `cheats/` directory) and cost real debugging time before a hardware test settled it; don't reintroduce a `cheats/` prefix. `classifyContentPath()` (`apps/web/src/lib/romSelection.svelte.ts`) recognizes a cheat file by **extension**, not directory, for exactly this reason — a cheat file is structurally indistinguishable from a ROM by path alone.

**Device is the sole source of truth for what cheats currently exist — never scanned from the local folder.** `RomManagementTab.svelte`'s `loadCheatsBaseline()` reads cheat files back from the device itself (flash: filter `device.installedFrogfs.files` for the 3 extensions, read via `dumpRegion`; SD: `scanRomDirectory()` against `device.sdHandle`, same filter) as soon as the ROMs tab mounts. User edits (preset toggles, manual add/remove) live in a separate overlay (`configuredCheats`, keyed by game) seeded from that baseline once per game, never overwritten once touched. What actually needs writing is the diff between overlay and baseline (`changedCheatEntries()`), not "always rewrite everything" — this is why cheats participate in the same `SD_SYNC_POLICY`/`SD_WRITE_BUCK ET`-style category framework as games/covers rather than being a special case.

**Two file formats, not one.** Line-based (NES/GB, `.ggcodes`) each entry is `"code, description"` — write the **whole line**, not just the code (a real regression: `cheatFileContent()` once dropped everything after the first comma, so the firmware's fallback-to-code-when-no-description behavior made every cheat display its own code instead of a description). MSX/Coleco/SG-1000 (`.mcf`) is a **whole file per game**, not a list of toggleable codes — copied wholesale from `cheat-codes/<system>/` (mirrored as static assets in `apps/web/public/cheat-codes/`), matched by the same `normalizeTitle()` convention used for NES/GB preset matching. PCE has no preset source at all (manual entry only).

**Preset database**: `apps/web/src/lib/cheats/{nes,gb}.json` (one file per system, NOT one combined blob — `cheats.json` used to be a single ~1.8MB file covering 5 systems and got fetched in full regardless of which system was relevant; split so a GB game's panel only ever fetches `gb.json`). Two sources merged: the original xlsx-derived data (`ingest.py`) plus gap-fill from `references/libretro-database`'s `.cht` files tagged `(Game Genie)`/`(GameShark)` only — untagged `.cht` files use an incompatible raw address:value RetroArch-internal format and are skipped (`ingest_libretro.py`). SNES/Genesis/Game Gear presets exist in the underlying data but are deliberately **not** exposed in the UI — the firmware has no cheat-application path for those systems at all (confirmed: only GB/GBC/NES/PCE/MSX are supported), so showing them would be actively misleading.

## FrogFS (ROMs, BIOS, Fonts)

FrogFS is a highly-deterministic, simple filesystem. Our TS builder (`packages/fs-builders/src/frogfs.ts`) is byte-identical to retro-go's `mkfrogfs.py`.

### Raw Container Format
Crucially, retro-go's FrogFS stores every file **RAW** (no frogfs-level compression). The firmware compiles only `decomp_raw.c`. ROM compression is handled externally as `.lzma` sidecar files that the *game* decodes, not the filesystem.

**Binary Format (Little Endian):**
- **Magic:** `0x474F5246` ("FROG")
- **Layout:** `[ head (12) ][ hashtable (8 × num_entries) ][ entry headers... ][ file data... ][ crc32 (4) ]`
- Alignment is strictly 4-byte boundaries. No timestamps are stored, making the image completely byte-deterministic based on file order (sorted alphabetically).

### ROM LZMA Sidecars
Because FrogFS stores files raw, ROMs are pre-compressed into `.lzma` sidecars (e.g., `game.lzma` instead of `game.nes`). 
- **The Core Transform:** `compress_lzma_raw` applies LZMA1, preset 6, dict_size 16 KiB, and strips the 13-byte header.
- **In-Browser:** We reuse the same **WASM `liblzma`** from `gnw-patch` to perform this compression.
- **Per-System Container:** 
  - `nes`, `pce`, `col`, etc.: Single raw stream.
  - `gb`, `gbc`: Concatenated 16 KiB banks (Bank 0 is left raw, subsequent banks are compressed).
  - `sms`, `gg`, `md`: Indexed multi-bank container with `SMS+` magic. `md` ROMs are strictly 16-bit byte-swapped prior to compression.

## LittleFS (Cores & Saves)

The firmware mounts LittleFS v2.11 (Disk v2.1). The LittleFS partition is anchored at the **end of external flash and grows downward**.

### Partition & Geometry Specs
- **Block Reversal:** Because the partition grows downward (block 0 is at the end of flash, block N is deeper in), a linearly-built LittleFS image must have its blocks reversed before being flashed sequentially to the device (`reverseLfsBlocks`).
- **Device Config:**
  - `block_size`: Detected from the chip's real erase sector (`info().minEraseSizeBytes`), typically 4096.
  - `read_size = prog_size = cache_size = 256`
  - `lookahead = 16`, `block_cycles = 500`.

### C to WASM Wrapper
There is no pure-TS LittleFS port. We vendor the upstream C library (matching littlefs-python 0.17.1) and compile it via emscripten. The browser interacts with a pluggable in-memory block device. We format the image, inject the cores, and pull the resulting raw buffer back to JS for flashing.

## The Content Pipeline

To assemble the flash images, we merge the CI-provided default artifacts (`sd_content`) with the user's ROM folder. 

| Stage | Action | Component |
|---|---|---|
| **0. Default Bundle** | Fetch `web-artifacts.zip` CI artifact (contains cores, bios, fonts, lang). | `artifacts.ts` |
| **1. User ROM Scan** | Scan user's local ROM directory. | `romScan.ts` |
| **2. Map & Merge** | Route cores to LittleFS tree. Route everything else + user ROMs to FrogFS tree. Merge `/bios`. | `planFlashImage` |
| **3. Staging** | MD 16-bit byteswap; drop junk extensions / `.DS_Store`; drop MSX bios if no MSX games. | `staging.ts` |
| **4. LZMA Compress** | Generate `.lzma` sidecars for ROMs per-system. | `romLzma.ts` |
| **5. Build Containers** | Pack the FrogFS binary and the LittleFS binary (with block-reversal). | `frogfs.ts` / WASM LFS |
| **6. Budget Layout** | Calculate if images fit within the chip's extflash. | `planFlashLayout` |
| **7. Superblock Patch** | Host-patch the intflash firmware blob's `frogfs_offset` and `littlefs_length` parameters. | `superblock.ts` |
| **8. Flash Install** | Flash intflash, then FrogFS (bottom), then LittleFS (top). | `flashInstall.ts` |
