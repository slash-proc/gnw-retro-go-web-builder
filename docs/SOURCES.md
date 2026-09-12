# Sources, cores, the Library and the SD card

Read this in full before touching `apps/web/src/lib/sources/`, the Library tab,
the SD card pane, or anything that decides what a console is or where a file lands.

## The SD card and the two install paths

- **SD mode vs Flash mode share UI, not budget logic.** `RomManagementTab.svelte`'s game-selection table (Select All / per-game toggles) is rendered ABOVE the `device.targetMedia === "sd"` split, so it's common to both modes. Anything reading `device.partitions`/`device.info`-derived state (`frogfsOffset`, `ceilingOffset`, `fitsGap`, `validateFit()`, the FrogFS-preview-build effect) is a Flash-only concept (the device's real flash-chip gap) and MUST early-out on `device.targetMedia === "sd"`: a device merely being connected while the user manages SD content is not a signal that Flash's constraints apply. This bit us once already (docs/AUDIT_NOTES.md item #14); don't reintroduce it when touching this shared table.
- `runInstall()` (Flash) and `doSdSync()` (SD) in `RomManagementTab.svelte` are two separate functions, not one function branching on `targetMedia`: don't conflate them when reading/editing this file.
- **`device.targetMedia` decides which of those two the Library's dock draws, and both buttons
  carry the SAME label.** It is persisted, defaults to `"flash"`, and has exactly three writers:
  `App.svelte:87`, `Landing.svelte:21`, and `romScan.ts`'s `pickSdCardFolder` adopt callback.
  That third one is new and is the fix for a real bug: the Sources SD pane set `device.sdHandle`
  without setting the mode, so `Sync Library` rendered the **Flash** button under the SD label
  and pressing it connected and booted the RAM stub, resetting a running Retro-Go. A card write
  must reach no device primitive at all (`test/sdsyncdevice.mjs` drives `doSdSync` against a
  device stub whose every hardware method throws). Second symptom of the same cause, worth
  knowing because it is silent: `scanSdCardGames()` early-returns on `targetMedia !== "sd"` and
  **clears `installedGames`**, so a card picked in the wrong mode was never read and the next
  sync called itself a fresh target and rewrote the whole selection.
- **`device.sdHandle` persists, and persistence hangs off ASSIGNMENT, not off the picker.** It is
  a getter/setter pair mirroring `targetMedia`, so a caller that only sets the field cannot
  half-register a card — which is exactly how the Sources pane arrived. The restore is started by
  a **field initializer** (not a lazy getter — see the `dbg()`/favourites hazard above), and
  `whenSdRestored()` is the contract every reader awaits. A reader that checks `sdStorage.state`
  must admit `"unknown"`, which is what the store is constructed at: a guard written against an
  assumed `"unavailable"` returned early on the one case it existed for, and the Library saw the
  card while the Sources page showed nothing.
- **The SD card is a source, with its own modules**: `sdStorage.svelte.ts` (the walk, nine
  `SdCategory` buckets, `truncatedBy` naming which of three limits was hit), `sdCapacity.ts` (a
  user-STATED capacity, because no browser API reports a picked directory's volume — see
  `docs/SDCARD_CAPACITY.md` and `src/lib/data/sdCapacity.json`), `sdHomebrewMigration.ts` (the
  `roms/homebrew` to `/homebrews` move) and `ui/SdCardPane.svelte`. Two rules that are easy to
  break: **used bytes are measured and free bytes are inferred**, so the page must not present a
  stated capacity with the same confidence as a walked total; and **cluster slack matters as much
  as capacity**, because every file rounds up to a cluster and exFAT uses 128 KiB clusters from
  64 GB up, which loses more to slack than the safety margin withholds.
- **Only `roms/<console>/` and the homebrew directories hold games** (`classifySdScanKey`). That
  used to be a deny-list naming three asset directories and treating every other top-level
  directory as a console, so `cores/`, `fonts/`, `lang/`, `data/` and `screenshots/` all became
  phantom systems and a core binary drew a `cores` chip in the Library. It is now derived from
  the manifest's own roles rather than typed. Note the shape trap: `romScan.ts` strips one
  leading `roms/` per key before the classifier sees it, so after the strip a game and a firmware
  asset are the same shape and the prefix that an allow-list needs is already gone. Preserving
  that prefix is the real fix and has not been done.
## Sources, cores and the Library

- **A source declares what a console is; the scan says which ones have files.** `sources/coreRegistry.ts`
  builds the registry from **active** sources' declared systems (folder, names, extensions,
  browse mode), and a console button exists only where an active core declares the system AND
  the scan found files. This replaced three hardcoded tables that never consulted Sources —
  `romScan.ts`'s `CONSOLE_DIRS`, `romSelection.svelte.ts`'s `CONSOLE_WHITELISTS`, and
  `engine/consoles.ts`'s `LABELS`. **They still exist as a fallback for the empty case** (no core
  registered yet) and to name a console already on the device whose core was later disabled — do
  not delete them, and do not add a fourth. Note that whether a directory *is* a console
  directory is structural and does not depend on activation; whether it gets a *button* does.
- **Three transitional compatibility shims**, each in exactly one place with a documented sunset.
  Do not "tidy" them away, and do not scatter the comparison — that is how the last rename broke
  ten call sites: `isCoreKind()` (`sources/types.ts`) accepts the pre-rename `kind: "emulator"`
  alongside `"core"`; `allowMultipleOf()` (`sources/inputGate.ts`) accepts the pre-rename
  `repeatable` when `allowMultiple` is absent; `outputSpecFor()` (`sources/converterTypes.ts`)
  resolves a module that emits an output's declared *filename* where the spec now requires its
  *id*. Each names the spec commit that renamed the thing and the publisher that still lags.
- **A per-file tool may not also name a fixed output filename** (`sources/converter.ts`'s
  `checkRunShape`, from `gwrg-dist-spec` `44b0bf3`). `runPerFile` means one run per input file,
  so a fixed `filename` would have every run write the same name and clobber its predecessors.
  **The boundary is narrower than that reasoning suggests, and matters**: the refusal fires only
  on the *mixed* shape (a `runPerFile` input AND a derived output AND a fixed filename). A
  per-file tool whose outputs are *all* fixed is an upstream WARN, not an error, and refusing it
  here would break manifests whose publishers were told they were publishable. It lives in
  `prepareTool`, the one chokepoint that sees both halves -- `parseToolInputs`/`parseToolOutputs`
  each see only one. No published project changes status under it.
- **Two older run-shape rules are enforced beside it**, from the same block of the spec's checker.
  State them exactly; loose paraphrases of these have twice nearly caused a publisher-facing break.
  1. `runPerFile && !allowMultiple` is refused (`converter.ts:124`). It is read from the **parsed**
     input, so it resolves through the `allowMultipleOf()` shim -- judging the raw key instead
     would refuse the pre-rename manifests that shim exists to keep working.
  2. `derived.length > 0 && perFile.length !== 1` is refused (`converter.ts:131`). Note `!== 1`:
     this refuses **zero** per-file inputs as well as several, because a name derived from the
     iterated file has no file to derive from. It is gated on a derived output existing, which is
     what keeps the all-fixed WARN shape accepted.
  A fourth ERROR in the same loop (`maxCount` without `allowMultiple`) is deliberately **not**
  implemented: `parseToolInputs` silently drops a non-integer `maxCount`, so checking the parsed
  input would mean something different from the spec's raw-key check. That is a decision, not an
  oversight. All refusals reuse `SourceError("malformed")` with the diagnosis in `detail`, which
  already maps to the `unreadable` prepare group, so none of them needed a full-locale i18n edit.
  **An over-broad refusal here cascades silently**: wrongly refusing every per-file tool stops
  cores becoming titles at all and surfaces as unrelated `titles:` failures with no mention of the
  real cause. Read whole failure lists, not first lines.
- **A converter's output size is not knowable before it runs.** A title's size sums real bytes
  from `prepareState`'s provenance (`produced` + `assetSource`), never a declared-name list —
  `deviceFiles` cannot contain a derived output, which is why a size built from it counted only
  the shipped binary.
- **The firmware's homebrew directory is `/homebrews`, plural; the ROLE is `homebrew`, singular.**
  They differ on purpose and both spellings are load-bearing. An SD scan classifies a key with
  `classifySdScanKey()` (`engine/devicePaths.ts`), which resolves against the manifest's paths —
  it used to take the top path segment literally, so every file under `/homebrews` classified as
  system `homebrews` and was filtered out of every "is it installed" check. **Placement was
  always correct**: do not "fix" this by renaming the on-card directory, which would break a
  working install. The read side is the only side that was wrong.
- **`romScan.ts` must not import `engine/devicePaths.ts`.** That barrel resolves through
  `@gnw/fs-builders`, which re-exports the littlefs WASM vendor, which imports node's `module` —
  and every suite that bundles the scan under `platform: "neutral"` breaks. A caller that has the
  manifest passes the resolved prefixes in (`scanRomDirectory(dir, onFile, hbPrefixes)`); the
  pre-manifest default is spelled out locally as `LEGACY_HOMEBREW_PREFIXES`. A dynamic import is
  no escape — esbuild bundles those too. `sources/discoveryWire.svelte.ts:145-147` records the
  same hazard about the same module.
- **A core's destination is decided in two places that must agree** — `sdDestPath()`
  (`engine/devicePaths.ts`) and `userDest()` (`fs-builders/src/flashImage.ts`). Neither had a
  `paths.cores` case, so a source-supplied core became `roms/cores/<file>` on both. On flash there
  was a second, separate defect: only *bundle* content was split into the cores tree, so the path
  fix alone would have put a correctly-named core in the wrong filesystem. See
  `docs/ARCHITECTURE.md`'s "Where a core's files land". The flash-only split itself is **under
  review** and is not settled — read that section before designing against it.
- **A converter's INPUT is never copied to the device.** `Game.role`'s `ingestable` has said so
  since `gameRows.ts` collapsed an input and its output into one row, but nothing enforced it:
  a row's identity is the INPUT's key, so selecting a Doom game selected `doom/doom.wad` and it
  shipped beside the `.whd` it becomes. Both install flows share that map, so Flash packed them
  into FrogFS too. `romSelection.svelte.ts`'s `plannedInstallNames` now skips them.
- **Multiplicity is carried by structure, never by wording.** `prepareState.supplied` is a
  `Map<string, Set<string>>` (per-input filenames), not a set of input keys — presence with no
  cardinality is what made a row say `2 added` with one Remove that dropped both. Configure draws
  one row per held file, each with its own remove; whether another fits is the picker being
  present or absent (`slotsLeft`), not a pluralised label. `chooseFiles` is deleted in every
  locale. Two i18n keys differing only in plurality are a smell.

