# Firmware Patching & Concepts

This document covers how we modify device firmware on the fly entirely in the browser. There are two distinct patching operations performed by the web app:
1. **Stock Firmware Patching:** Turning a stock Nintendo dump into a dual-boot setup.
2. **The Layout Superblock:** Modifying our pre-built universal retro-go binaries to fit the user's specific flash chip geometry.

## 1. Stock Firmware Patching (`gnw-patch`)

`packages/gnw-patch` turns a **stock Mario or Zelda firmware backup** into a patched build that dual-boots into retro-go. It is a 1:1 byte-exact port of gnwmanager's `flash-patch`.

### Pipeline
1. Verify SHA-1 of the user's dumped `internal.bin` and `external.bin` against known stock ROMs.
2. Decrypt external (AES-128, OTFDEC counter mode).
3. Copy novel-code payload past `STOCK_ROM_END`.
4. Run device-specific patch sequence (`mario.ts` / `zelda.ts`):
   - **`thumb-asm`**: Assemble patched ARM instructions.
   - Relocate/compress assets into internal flash.
   - Rebuild rwdata init table.
5. Flash patched internal + external back to device.

### Why byte-exact LZMA is non-negotiable
The patcher's relocation logic decides *where* each asset goes based on its **compressed length**. On Mario, the margin is ~1004 bytes. Even a 1-byte deviation from Python's `liblzma` changes the layout.
Therefore, the patcher uses a **WASM build of xz 5.4.1's `liblzma`**, proven to reproduce Python's output byte-for-byte.

## 2. The Layout Superblock (v2)

To avoid compiling unique firmware binaries for every possible flash chip size (1MB, 4MB, 16MB, etc.), retro-go binaries are built with a **Layout Superblock** (`GWLB`). This makes the layout patchable post-link.

### The Struct
The `GnwLayoutSuperblock` is a 36-byte packed LE struct compiled into `.rodata`:
- `magic`: `0x424C5747u` ("GWLB")
- `version`: `2`
- `frogfs_offset`: Base address for the FrogFS partition.
- `frogfs_length`: Size of FrogFS image.
- `extflash_size`: Total extflash size (to place LittleFS at the top).
- `littlefs_length`: Partition size for LittleFS.
- `flags`: Override bits for the fields.
- `crc32`: Over bytes `[0x00, 0x20)`.

### How the Host Patches It
1. The app detects the chip size over SWD (`externalFlashSizeBytes`).
2. The app scans the pre-built `bank2` binary for the `GWLB` magic string.
3. It overwrites `extflash_size` and `littlefs_length` based on the user's flash chip and calculated ROM payload sizes.
4. It recomputes the CRC-32 and writes it.
5. The binary is flashed. If the firmware detects an invalid CRC at boot, it gracefully falls back to linker defaults.

