# Shipped: `systems[].biosDir`

This began as a host-side proposal for `gwrg-dist-spec`
([`spec/07-cores.md`](https://github.com/gwrg-ng/gwrg-dist-spec), the "BIOS"
section). **It has shipped**, in a different shape from the one first argued for:
the declared field is `biosDir` on the **system**, not `path` on the BIOS entry.

The evidence below is kept because it is what the field is *for*: without it the
ColecoVision divergence and the dead `RG_BASE_PATH_BIOS` look like curiosities
rather than the reason a host cannot derive a BIOS directory.

## What shipped

| Field | On | Required | |
|---|---|---|---|
| `biosDir` | `systems[]` | no | Directory under `/bios` holding this system's BIOS files |

```json
{ "id": "pcecd", "biosDir": "pce", "bios": [ … ] }
```

**Omitted means the system's `id`.** That is the common case — `nes`, `msx`,
`gba` and the rest all place their BIOS in `/bios/<id>`. Exactly two systems in
the whole fleet diverge, and both are named explicitly:

| System | ROM folder | BIOS folder |
|---|---|---|
| ColecoVision | `col` | `bios/coleco` |
| PC Engine CD | `pcecd` | `bios/pce` |

**Shape.** A single plain path segment: non-empty, no `/` or `\`, not `.` or
`..`, no control characters. It is a directory name, not a path — the file's own
name is already `filename`, and when `filename` is a list of accepted names they
all land in the same directory, which is what makes them one slot.

**On the system, not the entry.** The first draft hung it on each BIOS entry so
two entries in one system could differ. In practice they do not: every core
reads all of a system's BIOS files out of one directory, and hoisting the field
to the system means the two divergent systems each state it once instead of once
per entry.

## What the host does

`apps/web/src/lib/sources/bios.ts` resolves `system.biosDir ?? system.id` in
`collectBiosNeeds`, carries the result on each need as `biosDir`, and
`biosDestKey` composes `bios/<biosDir>/<filename>` from it. There is no
host-side table of firmware literals any more — the one that existed
(`BIOS_DIR_BY_SYSTEM`: `col`, `nes`, `msx`, `mini`) has been deleted, which is
the whole point: it could never have known about a third-party core.

`biosDir` is untrusted third-party text and becomes a path segment, so it is
validated twice — once at the parse boundary in `client.ts` (dropped, not
refused, when it fails, leaving the `id` default to apply) and once again in
`biosDestKey`. A value that fails there falls back to the `/bios` root, which is
a real firmware location (`rg_logos.c:49` opens `/bios/logo.bin`) rather than a
guess. Both checks reuse `converterRun.ts`'s `isPlainFilename`.

## Still open

Two things this field does not settle, kept here because the evidence for them
is below:

- **Videopac loads its BIOS as a ROM-folder entry**, outside `/bios` entirely
  (`main_videopac.c:208,210`). A directory-under-`/bios` field cannot express
  that; such a core has to declare the file as content rather than as a `bios[]`
  slot.
- **The build invents names the manifest does not declare** (`PANASONICDISK_.rom`,
  `Makefile.common:1404-1421`). Same root cause — placement and naming living in
  a Makefile — and still unaddressed.

## The evidence

All line references are to `game-and-watch-retro-go-sd` as vendored at
`references/game-and-watch-retro-go-sd`.

**1. The constant that would have answered this is dead.**
`Core/Inc/retro-go/rg_storage.h:10` defines
`RG_BASE_PATH_BIOS = RG_BASE_PATH "/bios"`, which expands to `/retro-go/bios`.
It has **zero call sites** — a repo-wide grep returns only the definition. Its
sibling `RG_BASE_PATH_ROMS` is used five times in `rg_emulators.c`. So the ROM
path is composed from a constant and the BIOS path is not composed at all.

**2. Every core opens a hardcoded absolute literal, and they do not agree on a
scheme.**

| Literal | Source |
|---|---|
| `/bios/coleco/coleco.bin` | `Core/Src/porting/smsplusgx/main_smsplusgx.c:127` |
| `/bios/nes/palettes.bin` | `Core/Src/porting/nes_fceu/main_nes_fceu.c:89` |
| `/bios/nes/disksys.rom` | `external/fceumm-go/src/fds.c:838` |
| `/bios/nes/gamegenie.nes` | `external/fceumm-go/src/fceu-cart.c:411` |
| `/bios/mini/bios.min` | `Core/Src/porting/pkmini/main_pkmini.c:431` |
| `/bios/msx/MSX2PEXT.rom` (and nine siblings) | `Core/Src/porting/msx/main_msx.c:1055` |
| `/bios/msx/msxromdb.bin` | `Core/Src/porting/msx/msx_database.c:34` |
| `/bios/logo.bin` | `Core/Src/retro-go/rg_logos.c:49` |

**3. `dirname` is not the BIOS directory.** ColecoVision registers as
`add_emulator("Colecovision", "col", …)` (`Core/Src/retro-go/rg_emulators.c:1351`),
so its ROMs live in `roms/col/` — and its BIOS is read from `/bios/coleco/`.
This single case is enough to refuse any derivation from `id`. That NES, MSX and
Pokémon Mini happen to agree with their `dirname` makes it worse, not better: a
host that derived the directory would be right four times and silently wrong
once, and "silently" is exact — spec/07 already records that the ColecoVision
core ignores `odroid_sdcard_read_file`'s return value, so a BIOS at the wrong
path boots into uninitialised heap with no error.

**4. `/bios/<something>/` is not even the universal shape.** `rg_logos.c:49`
opens `/bios/logo.bin` at the `/bios` root, with no system directory. And
Videopac loads its BIOS as a *ROM entry* — `Core/Src/porting/videopac/main_videopac.c:208,210`
call `rom_manager_get_file(rom_system, "bios.lzma")` then `"bios.bin"`, i.e. the
file sits in that system's own ROM folder (`roms/vectrex/bios.bin`), outside
`/bios` entirely. Whatever field we add cannot be a "subdirectory under
`/bios`"; it has to be a path.

**5. The host already hardcodes what little it knows, and that is the thing that
does not scale.** `packages/fs-builders/src/flashImage.ts` merges three source
trees into a FrogFS root `/bios`, drops `bios/msx` when no MSX games are present,
and maps a user's `<sys>_bios/` folder to `bios/<sys>/`. Those literals are a
faithful port of `scripts/gen_frogfs_image.py` (lines 660-673 and 739-742). They
are correct for the cores that shipped inside this firmware tree. They cannot be
correct for a core published as a third-party source, which is the entire point
of the ABI migration — and note that **no GBA, Lynx or PC Engine CD core exists
in the reference tree at all**, so the two `gwrg.json` files that already declare
BIOS in the wild (`gba-retro-go-sd`, `blueMSX-retro-go-sd`) describe paths this
firmware tree cannot be grepped for.

**6. The build already invents filenames the manifest does not declare.**
`Makefile.common:1404-1421` copies the blueMSX ROMs into `sd_content/bios/msx/`
and byte-patches one of them into `PANASONICDISK_.rom` (offset 6124 → `0x00`),
which `main_msx.c:913` opens by that name. `blueMSX-retro-go-sd/gwrg.json`
declares `PANASONICDISK.rom` and nothing else. That is a separate gap from this
one and is out of scope here, but it is the same root cause: placement and
naming currently live in a Makefile rather than in the manifest.

**7. Flash and SD do not differ.** `Core/Src/syscalls.c:441-448` routes
top-level `roms`/`covers`/`bios`/`fonts`/`font` to FrogFS read-only on internal flash;
the `SD_CARD == 1` build routes the same strings to FatFs. `scripts/sd_cores_pack.py:11`
states it outright — "FrogFS `/bios` when SD_CARD=0, SD path `/bios` when
SD_CARD=1". One declared path serves both media, so this field does not need a
per-medium variant.

## Status in this repo

Implemented. `apps/web/src/lib/sources/bios.ts` resolves `biosDir ?? id` and
`biosDestKey` installs against it; `BIOS_DIR_BY_SYSTEM` and the speculative
`declaredDir` helper are gone. `client.ts` parses and validates the field.
Coverage is in `apps/web/src/lib/sources/test/validate.mjs`.
