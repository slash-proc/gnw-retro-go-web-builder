# Remote source manifests and install file accounting

Read this before changing source discovery, manifests, converters, file naming, selection,
install summaries, or Flash/SD placement. Read it with [SOURCES.md](./SOURCES.md),
[FILESYSTEMS.md](./FILESYSTEMS.md), and the placement section of [ARCHITECTURE.md](./ARCHITECTURE.md).

## The published distribution chain is the source of truth

Remote cores and homebrew are GWRG distribution projects. Their release metadata is published
to GitHub Pages by CI. The discovery path is one chain:

```text
Retro-Go firmware dist/versions.json
  -> newest firmware release's manifest.json
    -> that manifest's projects.json
      -> each curated project's exact versionsUrl
        -> that project's versions.json
          -> selected release entry's manifest.json
            -> target metadata, converter WASM, and artifact files
              -> converter run on supplied inputs produces additional files
```

The app already implements this chain:

- `firmwareDist/types.ts` defines the firmware `versions.json` URL.
- `firmwareDist/curated.ts` and `firmwareDist/client.ts` resolve the newest firmware release,
  its manifest, and the `projects.json` it publishes.
- `sources/store.svelte.ts` imports curated projects into Sources using the project references
  from that list.
- `sources/client.ts` resolves a project release and its manifest. With no pinned tag, the app
  selects `versions[0]` (newest first; there is no `latest` manifest). With a pinned tag,
  `resolveVersion()` re-reads the live index and resolves that exact published tag.
- The resolved manifest supplies `targets[]`, their `systems`, `artifacts`, `tools`, and `uses`.
  The client resolves file URLs relative to the manifest and verifies downloaded bytes against
  the published lengths and SHA-256 hashes. `sources/converter.ts` fetches/verifies the named
  converter and runs it in a Worker.

For a curated project, follow the exact `versionsUrl` in the **published firmware release's**
`projects.json`. Do not start from a guessed repo name or stop at the firmware bundle manifest.
The five foundational cases—SMW, Zelda 3, OpenLara, Doom, and GBA/gpSP—must be located in that
live curated list first. The checked-in `apps/web/test/fixtures/firmwaredist/projects.json` is a
parser fixture from an older firmware release, not the current curated list. For a manually
added project, `normaliseRepoRef()` / `versionsUrlFor()` in `sources/client.ts` defines the
accepted repository-to-Pages convention. A project's checked-out `gwrg.json` is useful
authoring context, but it is not the manifest the app resolved for a particular release.
Likewise, tests and old local copies are not substitutes for the live published documents.

When writing a bug analysis or example, record the firmware release, project tag, and manifest
URL actually followed. Those documents change as projects publish. Do not copy a transient
“current latest” manifest into permanent prose and then treat it as timeless.

## Build the complete candidate file set before assigning destinations

A manifest's artifact list is only one part of the eventual install tree. The candidate set for
the user's selected projects and games must account for:

1. Firmware-bundle content included for the selected firmware release.
2. Every selected project's manifest-declared artifact, including core binaries and mapped
   artifact metadata.
3. Files produced by every selected converter run. A converter output with a derived name
   cannot be enumerated by looking at `outputs[]` alone: its actual filename and count come from
   the converter result and the supplied inputs. `runPerFile` may produce one output for every
   accepted input.
4. Shipped games declared by a core's `systems[].games`, plus selected user games and their
   recognized converter variants. The converted output is the installable game; the consumed
   input is not copied as a second game.
5. BIOS files, covers, and cheats selected or retained for this install, including generated
   cover sidecars whose owner is a recognized installed game.
6. Retained device-only files when the Flash image rebuild preserves them.

This is why a recursive tree comparison matters. A filename can be declared in a manifest, be
created only by the converter, or be attached to a recognized game by its canonical output
name. The input filename, converter output filename, and cover sidecar filename are not
interchangeable identities.

### Reference cases to keep in view

These cases deliberately exercise different manifest shapes. Read each project's published
release manifest and converter output; the UI and planner must follow the declarations, not
recognize project names.

| Example | Manifest and prepared-file facts | UI decision | Logical install tree and placement |
|---|---|---|---|
| **SMW and Zelda 3** | Homebrew targets declare artifacts and converter inputs/outputs. The executable alone does not describe the converter's complete output. | Present one homebrew title choice; preparing it must account for its artifact and every produced file. | Keep declared homebrew artifacts and actual converter outputs under the title's homebrew tree. Flash routes that tree according to the firmware's homebrew role; SD projects it to the firmware's declared homebrew directory. |
| **OpenLara** | Its homebrew manifest declares `dataDir: "openlara"`; one selected input can produce its own `.PKD` file. | The title row owns all `.PKD` outputs. They are not independent game rows, so deselecting the title removes its whole generated subtree. | Count `OpenLara.bin` and all produced levels together. The binary remains at the homebrew root; levels land under `/homebrews/openlara/`. |
| **Doom** | This is a **core** manifest: `targets[].systems[]` declares `doom`; `tools[].inputs[]` consumes WADs and produces WHDs; `systems[].games[]` can separately declare a shipped shareware WHD. | Show WAD inputs as Doom game rows using the converter's final WHD identity. A shipped WHD is its own selectable row. Covers follow the selected row's installable WHD name, not its consumed WAD name. | Keep `doom.bin` in the core role, converted and shipped WHDs under `roms/doom/`, and the matching `.img` under `covers/doom/`. Do not install a consumed WAD as a second game. |
| **GBA / gpSP** | The core manifest declares both `gba.bin` and `gba.xip`; the latter has `mapped: true` and `relocBase`. | The Cores row and missing-file check must account for every artifact, including sidecars. `gba.bin` alone does not satisfy this target. | On Flash, put mapped `cores/gba.xip` in contiguous FrogFS and ordinary `cores/gba.bin` in LittleFS. On SD, both use their declared core paths; the firmware handles its SD cache. See [MAPPED_ARTIFACTS.md](./MAPPED_ARTIFACTS.md). |

The table is a comparison guide, not a substitute for the release chain above. Record the
firmware release, project tag, and actual manifest URL when investigating a live version. The
network was unavailable while these notes were updated, so no moving “latest” manifest data or
guessed version has been copied into this document.

These are patterns, not hardcoded filename rules. Re-read the release documents for the exact
tag being installed, then use the bytes and names the app resolved from them.

## Placement is a projection of that complete set

Keep the logical candidate tree separate from its medium-specific destinations:

- **SD** projects each logical file into the card's flat namespace using the firmware
  manifest's `paths` and the SD destination rules. There is no FrogFS/LittleFS split.
- **Flash** assigns files to the contiguous FrogFS image or LittleFS according to the file's
  runtime requirements. A `mapped` artifact such as `cores/gba.xip` must have contiguous,
  addressable storage; ordinary core binaries and writable files have different requirements.
  Do not infer placement from a top-level directory alone. See
  [FILESYSTEMS.md](./FILESYSTEMS.md) and [MAPPED_ARTIFACTS.md](./MAPPED_ARTIFACTS.md).

For Flash, the source-side plans must form an exact partition of the selected candidate set:

```text
candidate files = FrogFS files ∪ LittleFS files
FrogFS files ∩ LittleFS files = ∅
```

After path normalization and explicit collision handling, every candidate appears exactly once
in the destination plan. The sync/install summary must be derived from that same plan, so it
cannot disagree with what the writer will place. SD uses the same logical candidate set and
selection decisions, then applies its own destination projection.

## Current implementation boundary

`selectedPreparedAssets()` applies one selection/provenance rule to preview, Flash, and SD.
`sources/logicalInstallPlan.ts` first merges materialized library files, selected prepared
artifacts and converter outputs into the medium-independent candidate tree. Cover destinations
are then derived only for recognized ROM outputs and selected homebrew `.bin` artifacts that
actually exist in that tree. Input rows contribute cover-source aliases (for example, a WAD's
cover and an existing WHD `.img` both resolve to the final WHD sidecar name); they do not invent
output destinations. The resolved sidecars are added, then the final logical tree feeds both
summary and writer. A missing expected sidecar is reported from that same plan. Flash passes it
to `planFlashImage()`; the returned FrogFS and LittleFS lists are the placement projection. SD
passes the same tree through its inventory-based add/update diff, then writes each path to the
firmware-declared SD location. Its diff may omit unchanged files, but it does not independently
rediscover or rename selected files.

For converted games, cover planning keeps both the source image path and the input game's
device-side `.img` alias. The source image wins when it is available; otherwise an existing
device `.img` can be copied to the final output-name sidecar. This is how a Doom WAD cover can
follow the generated or shipped `Doom - Shareware.whd` identity without leaving
`covers/doom/doom.img` orphaned. The summary sees the result because cover materialization happens
before the shared logical candidate tree is built.

The Flash size summary is taken from the built FrogFS projection. The other summary rows report
selection counts and pending changes using the same selection, cover, cheat, and core-inventory
decisions; they are not a second file enumerator. Keep them that way: if a summary starts claiming
candidate file counts or bytes, derive that claim from `LogicalInstallPlan` or the final media
projection rather than adding another path walk. SD's incremental inventory diff remains a
medium-specific write policy. For every change, trace keys and bytes from manifest resolution
through converter output and selection to the final placement and write.
