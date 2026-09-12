# Proposal: `systems[].bios[].derivedFrom`

A spec proposal for `gwrg-dist-spec`, written from the host side. It concerns
[`spec/07-cores.md`](https://github.com/gwrg-ng/gwrg-dist-spec) — the "BIOS"
section — and adds one field. It is the second half of the gap opened by
[`bios-placement.md`](./bios-placement.md), which named this case in its
evidence item 6 and put it out of scope.

## The problem

`bios[]` is a list of files the *user* supplies. A core can also open a BIOS
file the user never supplies and no manifest names, because the build system
**manufactures** it from a file the user did supply.

A host that follows the manifest exactly — collects every declared filename,
hash-checks it, installs it — produces a device that is missing a file the core
will `fopen`. Nothing in the manifest reveals this. The host cannot detect the
omission, cannot warn about it, and the core fails at run time on a subset of
games rather than at install time.

## The evidence

All line references are to `game-and-watch-retro-go-sd` as vendored at
`references/game-and-watch-retro-go-sd`, and to `blueMSX-retro-go-sd` as
published at `gwrg-ng/blueMSX-retro-go-sd`. Every line below was read at the
cited line number.

**1. The MSX core opens a file no manifest names.**
`Core/Src/porting/msx/main_msx.c` opens `/bios/msx/PANASONICDISK_.rom` — trailing
underscore — at three sites, one per machine generation: line **913** (MSX1),
line **979** (MSX2), line **1069** (MSX2+). Each is the true branch of

```c
if (ctrl_needed) {
    strcpy(machine->slotInfo[i].name, "/bios/msx/PANASONICDISK_.rom");
} else {
    strcpy(machine->slotInfo[i].name, "/bios/msx/PANASONICDISK.rom");
}
```

nested inside `if (msx_game_type == MSX_GAME_DISK)`. So the underscore file is
read only for disk images, and only for some of them.

**2. Which of them is decided on-device, per game, from a data file.**
`ctrl_needed` is `game_info.ctrl_required` (`main_msx.c:868`). `game_info` is
filled by `msx_get_game_info(ACTIVE_FILE, &game_info)` at `main_msx.c:2059`; on
a miss the fields are defaulted and `ctrl_required` is set `false`
(`main_msx.c:2063`). The lookup is a SHA-1 binary search through
`/bios/msx/msxromdb.bin` (`Core/Src/porting/msx/msx_database.c:34`). A host
therefore cannot compute from the user's ROM set whether the underscore file
will be needed: the answer lives in a database keyed by ROM hash, and the set of
titles that trip it is not enumerable from the manifest.

**3. The build manufactures it; the user never has it.**
`Makefile.common`, target `prepare_msx_bios_files` (lines **1404-1420**), copies
nine blueMSX ROMs into `$(SD_FOLDER)/bios/msx/`. `PANASONICDISK.rom` is copied at
line **1413**. Lines **1419-1420** then produce the second file:

```make
	@cp $(SD_FOLDER)/bios/msx/PANASONICDISK.rom $(SD_FOLDER)/bios/msx/PANASONICDISK_.rom
	@printf '\x00' | dd of=$(SD_FOLDER)/bios/msx/PANASONICDISK_.rom bs=1 seek=6124 count=1 conv=notrunc status=none
```

One byte, offset **6124**, set to `0x00`. The comment at lines 1414-1418 states
the purpose: it disables the second floppy controller so the extra RAM is free
without the user holding Ctrl at boot, and it cannot simply replace the
unpatched ROM because some titles require the second drive to be present. That
is why both files must exist side by side.

**4. What the manifest declares.** `blueMSX-retro-go-sd/gwrg.json` declares ten
`bios[]` entries for system `msx`: `MSX.rom`, `MSX2.rom`, `MSX2EXT.rom`,
`MSX2P.rom`, `MSX2PEXT.rom`, `MSX2PMUS.rom`, `MSXKANJI.rom`, `PANASONICDISK.rom`
(entry id `disk`, `gwrg.json:94`), `Nextor.rom`, `msxromdb.bin`. All ten are
`required: false`, `strict: false`. `PANASONICDISK_.rom` appears nowhere in that
file, nor in `README.md`, whose BIOS table (line 44) lists only
`PANASONICDISK.rom`. A repo-wide grep of `gwrg-ng` finds the underscore name in
exactly two places: the core's own `src/porting/main_msx.c` (lines 942 and 944,
the ported copy of the code in item 1) and one parenthetical in
`EMULATOR-MANIFEST-EXAMPLES.md:423`. It is in no manifest.

**5. So a conforming host ends up one file short.** It asks the user for
`PANASONICDISK.rom`, gets it, hashes it, installs it at `/bios/msx/`, and
reports the MSX BIOS set complete. Every disk title whose `msxromdb.bin` entry
sets `ctrl_required` then boots a machine whose disk-controller slot points at a
file that does not exist. This repo's own installer has the same hole:
`apps/web/src/lib/sources/bios.ts` matches candidate files by filename against
the manifest and nothing else, so it cannot produce a name the manifest does not
carry.

**6. No other core in the reference tree derives a BIOS from a user file.** A
grep of `Makefile.common`, `Makefile`, `scripts/*.py`, `scripts/*.sh` and
`tools/*.py` for `dd of=`, `seek=` and `conv=notrunc` returns exactly one hit:
`Makefile.common:1420`, the line above. The byte-patch pattern is unique to MSX
in this tree. That is a statement about this tree at this commit, not a
guarantee about third-party cores, which is precisely why the field belongs in
the manifest rather than in a host-side special case.

**7. A related but different thing does happen widely: files under `/bios` that
the build *generates from project sources*, with no user input at all.** Inside
`$(SD_CONTENT_STAMP)` in `Makefile.common`:

| File | Produced by | Line |
|---|---|---|
| `bios/nes/palettes.bin` | `tools/gen_fceu_palettes_table.py`, fixed tables | 1465 |
| `bios/msx/msxromdb.bin` | `external/blueMSX-go/create_compact_database_file.py` from `Databases/msxromdb.xml` | 1467 |
| `bios/coleco/coleco.bin` | `objcopy --only-section=.coleco_bios_data` out of the built ELF | 1487 |
| `bios/logo.bin` | `objcopy --only-section=.overlay_graphics` out of the built ELF | 1488 |

`coleco.bin` is worth stating plainly: the ColecoVision BIOS is compiled into the
firmware as `ColecoVision_BIOS[]` in
`retro-go-stm32/smsplusgx-go/components/smsplus/coleco_bios.h:2`, placed in the
`.coleco_bios_data` section by `STM32H7B0VBTx_SDCARD.ld:309-311`, and extracted
back out to a file at build time. Nothing in that chain involves the user.

These are not derived files in the sense of this proposal — they are ordinary
build outputs, and the correct place for them is `targets[].artifacts[]`, which
already exists and is already hash-checked and mirrored. The point of listing
them is that one of them is currently in the wrong list: `blueMSX-retro-go-sd`
declares `msxromdb.bin` as `bios[]` entry `romdb`, asking the user for a file the
project builds from a checked-in XML database it ships itself. That is a
manifest bug, not a spec gap, and it needs no new field to fix.

## What a manifest cannot express today

Three things, in order of severity.

1. **That a file exists at all.** `bios[]` has no entry for
   `PANASONICDISK_.rom`, and adding one as an ordinary entry would be a lie: it
   would tell the host to ask the user for a file the user cannot obtain,
   because it exists nowhere outside this build.
2. **Where its bytes come from.** It is a copy of another declared entry with
   one byte changed. No field relates one `bios[]` entry to another.
3. **That it is conditionally read.** `required` is a boolean and `requiredFor`
   takes file extensions. The real condition here is "this disk image's SHA-1 has
   `ctrl_required` set in `msxromdb.bin`" — not expressible, and not worth trying
   to express. The honest treatment is to install it unconditionally whenever
   its source entry is installed: it is 16 KiB and the alternative is a run-time
   failure on an unknowable subset of titles.

## The proposal

Add one optional field to each entry of `systems[].bios[]`.

| Field | Required | |
|---|---|---|
| `derivedFrom` | no | This entry is produced from another entry, not supplied by the user |

```json
{
  "id": "disk-nofdd2",
  "filename": "PANASONICDISK_.rom",
  "path": "/bios/msx",
  "required": false,
  "derivedFrom": {
    "source": "disk",
    "patch": [
      { "offset": 6124, "value": "00" }
    ]
  },
  "label": { "en": "Disk controller ROM, second drive disabled" },
  "description": {
    "en": "Produced from PANASONICDISK.rom. Used automatically for disk titles that need the extra RAM."
  }
}
```

**Shape.** An object.

| Field | Required | |
|---|---|---|
| `source` | yes | The `id` of another `bios[]` entry in the same system |
| `patch` | yes | Ordered list of byte edits applied to a copy of the source |

Each `patch` element is `{ "offset": <integer ≥ 0>, "value": <hex string> }`.
`value` is lowercase or uppercase hex, an even number of digits, at least one
byte, and is written at `offset` overwriting what is there. The file length never
changes: an edit whose `offset + length` exceeds the source's length is an error,
not an append. Edits apply in array order; overlapping edits are permitted and the
later one wins, which keeps the operation trivially deterministic.

**Why a byte-patch list and not a tool.** The manifest already has `tools[]` for
converters, and a converter is the general answer. It is the wrong answer here.
`tools[]` describes a program the host must fetch and run; this is one byte. A
declarative patch list is verifiable at publish time, needs no execution
sandbox, and produces bit-identical output on every host — which matters because
the result is hashable and the source is `strict`-checkable. If a future core
needs a real transformation, `tools[]` is where it goes; `derivedFrom` covers the
case where the transformation is small enough to write down.

**Interaction with the other fields.** A derived entry:

- **Is never requested from the user.** It has no place in a "files you must
  supply" list. A host that shows BIOS status shows the source entry, and shows
  the derived one as a consequence of it, or not at all.
- **Takes `path` from `bios-placement.md` like any other entry.** The derived
  file's directory is stated, not inherited from `source` — they happen to match
  in the MSX case and there is no reason to require it.
- **May carry `bytes` and `sha1`.** They describe the *result*, and a publisher
  that fills them in gives the host a free self-check after applying the patch.
  They are not a substitute for the patch: a host cannot manufacture bytes from a
  hash.
- **Must not be `strict`.** `strict` means "refuse a file whose hash does not
  match", and the user never presents this file. Strictness on the *source* entry
  already covers the only input.
- **Inherits its condition from `source`.** If the source is installed, the
  derived file is installed. `required` on a derived entry is meaningless and
  should be omitted; `requiredFor` likewise — the source entry's `requiredFor`
  is the real gate.

**Where it hangs.** On the derived entry, not the source. The relation is
one-directional and a source may have several derivations (the MSX case has one
today; nothing prevents a second variant). Putting a `derivations[]` array on the
source would nest a full entry inside an entry — same fields, one level deeper,
for no gain.

**Why it belongs on the manifest and not in the host.** Same argument as
`path`, and it lands harder. The path at least has a plausible-looking wrong
answer a host could derive; the patch offset has none. `6124` is a fact about
the internals of a specific Panasonic disk ROM, known only to whoever wrote the
Makefile line. There is no rule, no convention, and no way to discover it from
the file. Either the manifest carries it or no host can ever produce this file.

## What a host does when the field is absent

It must not guess, and it must not silently skip the file. This is the same
stance as `bios-placement.md` and for a stronger reason: there is nothing here to
guess *with*.

- **Discovery, status and hash-checking are unaffected.** They operate on
  user-supplied entries, and a derived entry is not one. A host with no support
  for `derivedFrom` at all still asks for the right source files and still
  reports them correctly.
- **The derived file is simply not installed, and that is invisible.** This is
  the part that distinguishes this gap from the placement gap. A missing `path`
  is a *visible* omission — the host knows there is a file it does not know where
  to put, and can say so. A missing `derivedFrom` entry is an omission with no
  trace: the manifest does not mention the file, so the host has nothing to
  report. **A host cannot detect this case.** Only the publisher can close it.
- **A host may keep a built-in table for cores that shipped inside the reference
  firmware tree.** `packages/fs-builders/src/flashImage.ts` is that table today
  for placement, and the MSX byte-patch is the one entry such a table would need
  to grow. It must not extend that table by derivation — there is no derivation —
  and a fallback hit must be reported as a host-side workaround, not as the
  manifest's answer.
- **Refuse, never guess, applies to the malformed case.** A `derivedFrom` whose
  `source` names no entry in the same system, or whose `patch` writes past the
  end of the source, is a manifest error. The host refuses to install that entry
  and names the core, exactly as it refuses an entry with no `path`. It does not
  fall back to installing the unpatched source under the derived name — that
  produces a device that boots and then misbehaves, which is the failure mode
  both proposals exist to prevent.

Making the field's absence an error is not available: absence is the current
state of every published manifest, and absence is indistinguishable from "this
core has no derived files", which is true of all but one of them.

## Conformance

Four rules, in the conformance checker rather than the JSON Schema, because they
are cross-field:

1. `derivedFrom.source` must name another `bios[]` entry in the same system, and
   that entry must not itself be derived (no chains — one level, or the checker
   needs a cycle detector for a case nobody has).
2. `derivedFrom` and `strict: true` on the same entry is an error.
3. If the source declares `bytes`, every patch element must satisfy
   `offset + len(value)/2 ≤ bytes`.
4. Warn on a `bios[]` entry whose file the project itself builds — not
   mechanically detectable in general, but the specific shape worth flagging is an
   entry with no `sha1` and no `strict` whose filename also appears in the
   project's own published `artifacts[]`. `msxromdb.bin` in
   `blueMSX-retro-go-sd/gwrg.json` is the live instance.

## Status in this repo

`apps/web/src/lib/sources/bios.ts` matches candidate files to `bios[]` entries by
filename and does not write anything to the device. It has no concept of a
derived entry and would need one: apply `patch` to the accepted source bytes,
then install the result alongside it. That is a small change and it is blocked on
the same thing `path` is — the field existing.

Until then, this repo's MSX installs are missing `/bios/msx/PANASONICDISK_.rom`
whenever the BIOS set is assembled from the manifest rather than copied from a
reference `sd_content/` tree built by `make`.
