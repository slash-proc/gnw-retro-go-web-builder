# Placing a `mapped` artifact on a flash-only install

> **CORRECTIONS, 2026-09-11, from the firmware source and the GWRG manifest.** This document was
> written from `frogfs_pico8_ro.py` alone and generalises from it in two places.
>
> 1. **WHO relocates depends on the medium, and the split is in one shared helper.**
>    `odroid_overlay_cache_file_in_flash_relocate` (`Core/Src/porting/odroid_overlay.c`) runs the
>    relocation callback only under `SD_CARD == 1`. Its `SD_CARD == 0` arm maps the file straight
>    out of FrogFS, discards the callback with `(void)relocate_cb`, and says so: *"FrogFS maps the
>    file where it already sits in the firmware image, so there is no copy to relocate. Callers
>    that need one must not use this build."* So on SD we must ship the blob UNRELOCATED at its
>    sentinel, and on flash-only pre-relocating is the entire job. pico-8 reaches the same place by
>    a different route (`Pico8CacheCodeToFlash` guards its own patch with `#if SD_CARD == 1`, and
>    the build script pre-patches the FrogFS copy), so deriving GBA's behaviour from the pico-8
>    script gets the right answer for the wrong reason. `main_gba.c` contains no `SD_CARD`
>    reference at all.
> 2. **Section 4's claim that the spec repo was unreachable was false.** `gwrg-dist-spec` is on
>    disk, `spec/03-manifest.md` uses `gba.xip` as its worked example, and the sentinel is printed
>    there in both bases (`0xDEC00000` / `3737124864`). `relocBase` IS declared in the GBA
>    manifest and always was; it is written as a hex string in `gwrg.json` and converted to the
>    integer the schema wants by `make_manifest.py`'s `u32()`. Do not re-derive a sentinel from
>    the bytes: a search for a dense cluster finds Thumb opcode aliasing and concludes there is
>    none. `apps/web/test/gba-e2e.mjs` pins 263 relocated words as the invariant.


Implemented for Flash installs. Target case: the GBA core, whose cold half `gba.xip` is
executed in place out of memory-mapped QSPI while `gba.bin` runs from RAM. The source client
preserves `mapped`/`relocBase`, `prepareState` carries that metadata with the artifact bytes,
`planFlashImage` routes mapped files to FrogFS, and `flashInstall` relocates them after packing.

Scope: **flash-only**. Per `spec/05-host.md`, an installer writing to an SD card has
nothing extra to do; the core caches the file into QSPI itself at load time and patches
it on the way in. Everything below is about the flash image, where there is no runtime
help.

## 1. Where it goes, and how its address is computed

A mapped file must be one contiguous run at a known address. Of the two partitions only
FrogFS gives that: it stores each file as a single uncompressed run, and its data offset
is recoverable from the packed image. LittleFS scatters a file across blocks, so a file
there has no address to hand the core. That is the whole reason `gba.xip` belongs in
FrogFS while `gba.bin` does not.

The address falls out of the finished image rather than being chosen during layout:

```
xipAddr = EXTBASE + frogfsOffset + dataOffs
```

- `EXTBASE` is `0x90000000` (`apps/web/src/lib/engine/addr.ts:6`).
- `frogfsOffset` is `reservedOffset` (`packages/fs-builders/src/flashImage.ts:331`).
- `dataOffs` is the entry's offset inside the packed image, from our own parser.

This mirrors `references/game-and-watch-retro-go-sd/scripts/frogfs_pico8_ro.py`, which
computes `extflash_base + extflash_offset + data_offs` against the built `frogfs.bin`.

**The seam is a post-pass over the packed FrogFS image**, after `planFlashImage()` has
produced it and after `planFlashLayout()` has fixed `frogfsOffset`, before the image is
written to the device. Nothing earlier can know the address; nothing later may move it.

`packages/fs-builders/src/frogfsParse.ts:93` already returns `{ path, dataOffs, dataSize }`
per file with a byte-exact round-trip suite, so the pass walks our own image without
reimplementing the format.

### Ruled: mapped wins over the role directory

The manifest role for `gba.xip` is `cores`, which normally maps to LittleFS. `mapped: true`
overrides that role for Flash: the planner removes any LittleFS copy and puts the artifact in
FrogFS. The owner's rule is explicit: "mapped: true = flash = frogfs and it's unambiguous".
This is metadata-driven; no GBA filename special case belongs in the planner. The surrounding
split is also explicit: regular core files, writable state, languages, and cheats use LittleFS;
read-only content and mapped artifacts use FrogFS as appropriate to their roles.

## 2. Carrying `mapped` and `relocBase` to the packer

They are artifact fields, and the packer takes byte maps. The current chain:

1. `apps/web/src/lib/sources/types.ts` defines `Artifact`, including optional `mapped` and
   `relocBase`; `client.ts` parses and validates those fields. A mapped artifact may also
   declare `lookupKey`, the exact opaque string its core passes to the flash-only
   `lookup_data_in_flash()` ABI.
2. Artifact fetching returns `filename -> bytes`; `prepareState` preserves the mapped metadata
   beside those bytes rather than widening the byte-map value type.
3. `prepareState.svelte.ts`: the key becomes
   `${assetPrefix(artifactDir(target))}/${filename}`, e.g. `cores/gba.xip`.
4. `flashImage` receives `userRoms: Map<string, Uint8Array>` and the selected mapped metadata.

`prepareState.svelte.ts` keeps `assetSource` and `mappedArtifacts` beside `assets`, keyed by
the same prepared path. The install planner also re-derives routing facts from the live
manifest, so restoring cached bytes cannot lose the declaration. The map carries:

```
mappedArtifacts: Map<key, { relocBase?: number; lookupKey?: string }>
```

The presence of the map entry means `mapped`; `relocBase` is optional within it, matching the
spec (a file may need to be addressable without needing relocation). `lookupKey` opts the
artifact into the flash-only lookup index; without it, the artifact is still placed and
relocated but gets no index row. `mappedKeys` routes the bytes before packing; `flashInstall`
maps metadata to packed destinations and invokes the relocation post-pass after layout.

This keeps `Map<string, Uint8Array>` intact while carrying placement metadata separately.

## 3. Compression and contiguity

FrogFS stores files uncompressed, and the relocation post-pass checks the packed entry's file
type, alignment, and size before patching it.

**FrogFS container compression is impossible here.** `packages/fs-builders/src/frogfs.ts:4`
records why: retro-go-sd compiles only `decomp_raw.c`, so its images store every file
uncompressed, and our builder implements the raw container only. Our parser assumes the
same: `frogfsParse.ts:113` treats only `childCount === 0xFF00` as a file, so a compressed
entry would be misparsed as a directory rather than rejected.

**ROM `.lzma` sidecars cannot reach it either**, as long as it is not under `roms/`.
`packages/fs-builders/src/romLzma.ts:206` states the rule: "only roms/<...> participate;
everything else passes through."

Neither guarantee is a rule *about mapped files*; both are properties of where the file
happens to sit. Relying on incidental structure is how `roms/cores/doom.bin` happened. So
the post-pass asserts, per mapped artifact, before patching:

- the entry exists in the packed image;
- it is an uncompressed file entry;
- `dataOffs` is 4-byte aligned;
- `dataSize` equals the artifact's declared `bytes`;
- no `.lzma` sibling was substituted for it.

Any failure refuses. `frogfs_pico8_ro.py` sets the precedent: it prints
"is compressed; need uncompressed for XIP" and returns failure rather than patching.

**The image CRC must be recomputed.** `frogfs_pico8_ro.py` rewrites the trailing four
bytes with `zlib.crc32` over everything before them after patching in place. A relocation
pass that skips this leaves a structurally invalid image. This is the single most
overlookable step in the port.

## 4. Relocation

`mappedReloc.ts` ports `pico8_ro_build_patch.py`. For each 32-bit little-endian word at a 4-byte
stride over `(size // 4) * 4` bytes:

```
masked = value & ~1
if relocBase <= masked < relocBase + size:
    write (value + delta) & 0xFFFFFFFF     # delta = xipAddr - relocBase, signed 32-bit
```

Bit 0 is masked **for the range test only**; the delta is added to the unmasked value so
a Thumb function pointer keeps its low bit. Getting that backwards produces a blob that
looks patched and faults on the first indirect call.

`packages/gnw-patch` was checked for a reusable implementation. Its relocation entry
points are firmware-specific (`src/device.ts:148` onward, a lookup keyed to OFW symbol
tables), not a general sentinel-window scan, so there is nothing to share. The pico-8
routine is about fifteen lines; port it rather than generalise the patcher.

A patch count of zero is suspicious but not fatal: the pico-8 script warns and continues.
Whether we treat it as a refusal is a decision for the owner; the spec does not say.

**Known limitation, not designed around** (owner's ruling): a blob whose sentinel
references were materialised as `MOVW`/`MOVT` immediate pairs cannot be relocated by a
word scan at all, because neither half holds the value being sought. That is a property of
how the blob was built. `spec/07-cores.md` states it (no line cited: the spec repo is
outside this sandbox, so I could not verify one). Nothing on our side can detect it, and a
zero patch count is the only weak signal.

## 5. Re-install: relocation rebases off wherever the blob currently lives

`relocBase` is the base for the **first** relocation only. A blob already on the device
holds addresses in `[oldAddr, oldAddr + bytes)`, and `oldAddr` need not be remembered: it
is derived from the FrogFS image the same way the new address is, from the entry as it
currently sits. So a re-place is the identical scan with a different base.

| case | base for the window test | delta |
|---|---|---|
| first placement | `relocBase` from the manifest | `xipAddr - relocBase` |
| re-place | `EXTBASE + oldFrogfsOffset + oldDataOffs` | `newAddr - oldAddr` |

No pristine copy, no recorded delta, no pinned offset, and no need for the artifact bundle
to still be cached. Retaining a mapped artifact read back from the device is fine, and the
retain paths (`RomSection.svelte:558`, `RomManagementTab.svelte:2110`) need no exclusion.

The old address comes from the device scan that already runs: `readInstalledFrogfs` (`apps/web/src/lib/engine/frogfsDevice.ts:76`) parses
the on-device image, and `frogfsOffset` is the offset that read was made against.

### One risk worth stating, not mitigating

The spec justifies the window test by the sentinel being unmistakable: "The sentinel is an
impossible address, so a word in range is a pointer and not a coincidence." That reasoning
does not carry to a re-place, where the base is a **real** QSPI address. A non-pointer data
word can coincidentally fall inside `[oldAddr, oldAddr + bytes)` and be corrupted.

**Neither reference implementation addresses this, because neither ever re-places.** The
firmware always patches from the hardcoded `PICO8_CODE_BASE`
(`references/game-and-watch-retro-go-sd/Core/Src/retro-go/rg_emulators.c:147-159`), copying
the pristine source into RAM and writing the patched result to a separate cache window, so
the FrogFS copy is never patched in place. `frogfs_pico8_ro.py` patches the image once, at
build time, over an unpatched blob. Re-placement is a mode new to us.

The risk is not negligible at these sizes. A uniformly random 32-bit word lands in a
256 KiB window with probability `2^18 / 2^32`, about 1 in 16384, so a 256 KiB blob of
random data would expect roughly four false hits. Real code and data are not uniform, but
they are not immune either, and a corrupted data word fails silently.

What would detect it, without designing a mitigation: **the patch count is an invariant.**
The same words are relocated every time, so a re-place that patches a different number of
words than the original placement has hit something it should not have. That count is
already produced (the pico-8 routine returns it) and would need carrying alongside the
install rather than recomputing.

## 6. Flash-only firmware lookup index

The flash-only firmware ABI reads `/data/mappedsidecars.bin` from LittleFS. Each record is
one fixed-size `gw_flash_file_metadata_t` struct from `Core/Inc/gw_flash_alloc.h`: three
little-endian `uint32_t` fields (`file_crc32`, `flash_address`, `file_size`), a `valid` byte,
and three reserved zero bytes. The file is a headerless array of these 16-byte records, with at
most `GW_FLASH_CACHE_MAX_FILES` (256). A mapped artifact's `lookupKey` is the exact opaque
string passed by the core. The parser hashes every byte with
`crc32_le(0, key, strlen(key))`; it does not inspect or split the key. The record's
`file_crc32` is that full-key hash, not the mapped blob's CRC. For example, the observed PICO-8
key is `cold:pico8:b13aeac5:107512`; `b13aeac5` is separately the raw cold-data CRC before
relocation and helps the core construct the key.

`mappedReloc.ts` captures the raw blob CRC before rewriting pointers, and separately computes
the full-key CRC used by the index when the manifest supplies `lookupKey`. That exact key
cannot be inferred from the raw CRC and size without a per-core convention. A mapped artifact
without `lookupKey` is simply omitted from the lookup index. The serialized first field is
the little-endian key CRC; the other record fields are the final XIP address, byte size, valid
flag (`1`), and three zero reserved bytes. No post-relocation blob CRC belongs in the index.

The full Flash builder writes the generated index into LittleFS alongside the install's other
`/data` files. Library Sync regenerates it from the same mapped placement result used for the
FrogFS image and updates LittleFS when its bytes change. An empty index replaces a stale one
when an install no longer contains mapped sidecars. SD installs keep their existing runtime
cache path and do not use this file.

## 7. Not in scope

- **SD installs.** The host does not relocate the artifact. It still copies all manifest-
  declared core files to their SD paths; the firmware handles its SD cache when loading them.
- **Other content accounting.** See [SOURCE_INSTALL_ACCOUNTING.md](./SOURCE_INSTALL_ACCOUNTING.md)
  for how the complete selected file set is formed before Flash/SD placement.
- **Detecting `MOVW`/`MOVT` blobs.** Owner's ruling.
- **Choosing the refusal copy.** Section 8 names the states that need words; the words are
  the owner's.

## 8. Refusal points

The spec's "refuse rather than guess" needs somewhere to say so. Three states, no copy
proposed:

1. **A mapped artifact cannot be placed addressably**: no FrogFS partition in the plan,
   or the layout leaves it nowhere contiguous. Refuse at build time, before writing.
2. **A mapped artifact failed its assertions**: compressed, misaligned, wrong size, or
   absent from the packed image. Refuse at the post-pass.
3. **`relocBase` present but no words matched.** Ambiguous rather than certainly wrong.
   Needs the owner's ruling before it needs copy.

All three are build-time, before any device write, so the device is never left in a
partial state. The surface is the install progress modal's failure path, which already
carries a phase checklist and an audit log.
