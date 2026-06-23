# Filesystems

The Game & Watch flash mod requires writing a read-only filesystem (FrogFS) and a read-write filesystem (LittleFS) to the external SPI flash chip. This document covers the formats, our WASM integrations, and the orchestration pipeline to build them client-side in the browser.

## The Big Picture: Two Extflash Images

The flash install writes the intflash firmware blob plus **two** extflash regions:

1. **FrogFS (read-only) at the bottom** (`EXTFLASH_OFFSET`): Holds `bios`, `fonts`, `roms`, `lang`.
2. **LittleFS (read-write) at the top** (`FILESYSTEM_OFFSET`, grows down): Holds the **cores** and runtime **saves**. 

The device serves `/cores/*` from LittleFS and `/roms`, `/bios`, `/fonts`, `/lang` from FrogFS via a unified Virtual Filesystem (VFS). Cores must be flashed into LittleFS, they do *not* go into FrogFS.

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
