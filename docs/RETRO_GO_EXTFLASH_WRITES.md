# Retro-Go's extflash writes and the stock asset region

What the firmware actually does, established from `references/game-and-watch-retro-go-sd`.
Every claim carries a `file:line`; each was read, not inferred.

Written to answer: did retro-go destroy the Zelda stock assets, or did we?

## Summary

1. **Retro-Go does respect the stock asset region**, contrary to the premise. The mechanism is
   `get_ofw_extflash_size()`, which reads the booted OFW's own extflash footprint out of bank 1's
   vector table. It predates the superblock and is the fallback when no superblock is present.
2. **The updater is the one write path with no reservation check at all.** `update_extflash()`
   erases and programs from extflash offset 0 unconditionally. It only runs when
   `/update_extflash.bin` exists on the card, and this repo's release never produces that file.
3. **The owner's own SD card carries direct evidence that the reservation worked**:
   `data/flashcachedata.bin` records `flash_write_base = 0x90400000`, i.e. the ROM cache reserved
   exactly 4 MiB. See "Evidence on the card".
4. The ROM cache is **compiled out of flash builds entirely**, so it cannot be the culprit on a
   `SD_CARD=0` device.

## 1. Does any write path consult the stock asset region?

Yes. There are four extflash writers in the tree.

| Writer | `file:line` | Respects a floor? |
|---|---|---|
| ROM cache (round-robin) | `Core/Src/gw_flash_alloc.c:274,286` | **Yes** |
| LittleFS (saves) | `Core/Src/gw_littlefs.c:103,126` | N/A: partition at the **top** |
| PICO-8 core patch | `Core/Src/retro-go/rg_emulators.c:212-213` | N/A: writes over an already-placed blob |
| **Updater** | `external/firmware_update/Core/Src/gw_flash.c:985,993` | **No** |

### The ROM cache's floor

`Core/Src/gw_flash_alloc.c:89-98`:

```c
static uint32_t get_reserved_extflash_size()
{
#if SD_CARD == 1
    uint32_t ofw = gw_layout_reserved_size();
#else
    uint32_t ofw = get_ofw_extflash_size();
#endif
    uint32_t reserved = (uint32_t)&__EXTFLASH_OFFSET__;
    return ofw > reserved ? ofw : reserved;
}
```

The write base is that value, block-aligned (`:100-103`). Note it is the **max** of two
reservations, and the in-tree comment at `:78-88` explains why: `__EXTFLASH_OFFSET__` is the
chainloader's bottom region covering *both* games' asset blocks, both OFW backups and the FAT
module store, while `get_ofw_extflash_size()` describes only the single booted game.

### Correction to our own comment

`apps/web/src/lib/engine/flashInstall.ts:96-110` states that without a patched superblock the cache
"falls back to whatever `__EXTFLASH_OFFSET__` was compiled into this blob at CI build time (0 unless
upstream overrides it)".

**That is wrong.** `Core/Src/retro-go/gw_layout_superblock.c:61-67`:

```c
uint32_t gw_layout_reserved_size(void)
{
    if (gw_layout_valid() && (sb->flags & GNW_LAYOUT_FLAG_RESERVED_OFFSET))
        return sb->reserved_offset;
    return get_ofw_extflash_size();          /* <-- not 0 */
}
```

The fallback is the bank-1 OFW footprint, not zero. An unpatched superblock therefore degrades to
*stock retro-go behaviour*, which already protects the assets. The patched `reserved_offset` is an
override that can widen the reservation (to cover backups and the FAT store), not the only thing
standing between the assets and a write.

### How the footprint is derived

`Core/Src/gw_ofw.c:23-43`. A 32-bit packed field at `OFW_ADDRESS + 0x1B8` (the HDMI-CEC slot of the
vector table) holds `external_flash_size` in 4 KiB units plus `is_mario` / `is_zelda` bits and a
`must_be_4` tag. If the tag does not read 4 the struct is zeroed (`:30-33`), so a missing or
corrupted OFW yields a reservation of **0**. `OFW_ADDRESS ?= 0x08000000` (`Makefile.common:131`),
i.e. intflash bank 1.

So the protection has one dependency: **a valid OFW must still be present in bank 1**. On this
device the screenshot shows `Zelda OFW (patched)` in bank 1, and the card confirms the field reads
correctly (below).

## 2. What the updater writes

`external/firmware_update/Core/Src/firmware_update.c` and its `gw_flash.c`.

The README (`external/firmware_update/README.md`) describes only SD extraction and bank 2. **The
README is incomplete.** The code has a third path:

- `firmware_update.c:25` — `#define EXTFLASH_UPDATE_FILE "/update_extflash.bin"`
- `firmware_update.c:280-292` — if that file exists, call `update_extflash()` **first**, and abort
  the whole update if it fails. The comment at `:277-278` gives the reason: *"it is mandatory to
  have correct data in extflash for original firmware to boot (on Zelda version at least)"*.

`gw_flash.c:958-1025` is the implementation:

```c
uint32_t flash_address = 0;                              /* :981 */
do {
    OSPI_EraseSync(flash_address, block_size);           /* :985 */
    res = f_read(&file, buffer, block_size, &bytes_read);
    OSPI_Program(flash_address, buffer, bytes_read);     /* :993 */
    ...
    flash_address += block_size;
} while (bytes_read);
```

**It starts at 0 and consults nothing** — no `get_ofw_extflash_size()`, no
`gw_layout_reserved_size()`, no superblock, no signature check. `block_size` is
`OSPI_GetLargestEraseSize()` (`:977`).

That is by design rather than by oversight: this file is how the asset region gets *restored*, so it
is meant to write there. The danger is that its content is authoritative for the whole span it
covers.

Two properties worth noting:

- **It erases one block past the end of the file.** The loop erases before reading, so the final
  iteration erases a largest-erase-block, reads 0 bytes, programs nothing, and only then exits on
  `while (bytes_read)`. Whatever occupied that block is gone and is not rewritten.
- **This repo never produces `update_extflash.bin`.** `scripts/gen_release_package.sh:41` builds
  `retro-go_update.bin` as `firmware_update.bin` + padding + size + `gw_update.tar`, and the tar is
  just `sd_content/` (`Makefile.common:1607`). Grepping the build for `update_extflash.bin` finds
  only an exclusion list entry (`scripts/flasher/pack_bundle.py:38`, which also names
  `update_bank1.bin` / `update_bank2.bin`). So the file must arrive from some other source — an
  older release, the bootloader project, or by hand.

## 3. Which superblock fields the firmware reads

From `Core/Src/retro-go/gw_layout_superblock.c`, gated on `gw_layout_valid()` (`:32-51`: magic,
version, `struct_size >= 36`, and `crc32_le(0, sb, 0x20)`), each behind its own flag bit so a real
0 is distinguishable from unset (`Core/Inc/retro-go/gw_layout_superblock.h:24-29`):

| Field | Read by | Flag | Fallback |
|---|---|---|---|
| `frogfs_offset` | `gw_layout_frogfs_addr()` `:53-59` | `FROGFS_OFFSET` | `&__EXTFLASH_START__` |
| `reserved_offset` | `gw_layout_reserved_size()` `:61-67` | `RESERVED_OFFSET` | `get_ofw_extflash_size()` |
| `extflash_size` | `gw_layout_extflash_size()` `:71-77` | `EXTFLASH_SIZE` | `OSPI_GetFlashSize()` |
| `littlefs_length` | `gw_layout_littlefs_top/size()` `:79-101` | `LITTLEFS_LENGTH` | linker symbols |

`frogfs_length` (`gw_layout_superblock.h:37`) is written by us and read by nothing in this tree.

`reserved_offset` is consumed **only** through `gw_flash_alloc.c:92`, which is inside
`#if SD_CARD == 1`. The file itself is only compiled for SD builds
(`Makefile.common:340,348`, under `ifeq ($(SD_CARD), 1)`), and the surrounding comment at `:342-347`
says `gw_layout_superblock.c` is otherwise part of the flash-only FrogFS source group. **In a flash
build there is no ROM cache and `reserved_offset` is inert.**

## 4. Evidence on the owner's card

`/media/doug/99B8-6D8A/data/flashcachedata.bin`, 828 bytes, matching `sizeof(Metadata)` from
`gw_flash_alloc.c:37-45`. Decoding the trailing fields:

```
version              1
flash_write_pointer  0x90983000
flash_write_base     0x90400000   <-- extflash base + 4.00 MiB
last_written_slot    3
```

`flash_write_base` is `get_extflash_base()` (`gw_flash_alloc.c:100-103`) as computed at the time the
cache was last reset. **4 MiB is exactly the Zelda asset footprint.**

This establishes three things:

- The bank-1 Zelda OFW metadata was present and read correctly (`must_be_4 == 4`, size field = 0x400
  units).
- `get_reserved_extflash_size()` returned 4 MiB, so the SD firmware's ROM cache was writing from
  0x90400000 upward and **never touched the bottom 4 MiB**.
- The cache had written up to 0x90983000, about 5.5 MiB of cached ROMs, all above the floor.

The SD build's ROM cache is therefore **exonerated**. No leftover `update_extflash.bin`,
`update_bank2.bin` or `retro-go_update.bin` is on the card, but the updater unlinks on success
(`gw_flash.c:1018`), so absence proves nothing either way.

## 5. Whose bug is it?

**Not determinable from source alone.** What the source does establish:

- The SD ROM cache cannot have done it (proved by `flash_write_base` above).
- The flash build has no ROM cache at all.
- The updater *can* do it, but only if `/update_extflash.bin` was on the card, and nothing in this
  repo's release produces that file.
- Every other firmware writer is bounded to regions above the assets.

That leaves the flash install as the remaining candidate, but this report cannot confirm it.

### The observation that would settle it

**Read the first 64 KiB of extflash and look at offset 0.**

- If it holds a **FrogFS image header**, our flash install wrote its FrogFS at offset 0 and that is
  what destroyed the assets. Our own scanner already distinguishes this: `apps/web/src/lib/engine/
  fsscan.ts:170-177` matches `ZELDA_STOCK_SIG` / `ZELDA_PATCHED_SIG` for the asset region, and the
  partition bar in the Firmware tab draws the result. A bar whose leftmost block is
  "Games & Homebrew" starting at 0, with no asset block before it, is that case.
- If it holds **neither** a FrogFS header nor an asset signature, something wrote a raw image there
  (the updater's `update_extflash.bin` being the only firmware path that does), and the length of
  the damaged span would match that file's size rounded up to a largest-erase-block.

A second, cheaper check: whether `data/flashcachedata.bin` still decodes to
`flash_write_base = 0x90400000` after the flash install. It does today, which means it has not been
reset since the SD era; a reset would have recomputed the base against the current bank-1 state.

## 6. What this means for us

The premise "retro-go never respected zelda/mario assets" is false, so the defensive posture should
not be built on it. Two concrete consequences:

1. **Fix the comment at `apps/web/src/lib/engine/flashInstall.ts:96-110.`** It claims the fallback is
   `__EXTFLASH_OFFSET__` (0 unless overridden). The real fallback is `get_ofw_extflash_size()`. The
   comment overstates what our superblock patch is protecting against, which makes the patch look
   load-bearing when it is an override that widens an existing reservation.
2. **Our reservation must not be weaker than the firmware's.** Retro-Go derives its floor from bank-1
   OFW metadata at runtime, on every boot, with no dependence on a scan. We derive ours from a
   host-side signature scan of extflash (`fsscan.ts:170-177`) feeding `reservedEnd`, and an empty or
   failed scan yields 0. The firmware's source is more robust than ours: bank 1 is 128 KiB and always
   readable, and the field is a 4-byte tagged struct rather than a signature hunt over 64 MiB.
   Reading `OFW_ADDRESS + 0x1B8` ourselves would give the same floor the firmware uses, and would not
   depend on the asset bytes still being intact to detect that they should be protected.

Point 2 is the substantive one: **our current detection cannot distinguish "no assets are present"
from "the assets are already destroyed", and both yield offset 0.** The firmware's method can, because
it asks the OFW how much space it needs rather than looking for the data.

## Not established

- Whether `/update_extflash.bin` was ever on this card. Deleted on success; no log survives.
- What wrote the FrogFS at its current offset, since the audit log was lost to the UI refresh.
- Whether the flash build has any runtime writer below the FrogFS base. I found none, but I did not
  exhaustively trace every `OSPI_*` caller in the vendored cores.
