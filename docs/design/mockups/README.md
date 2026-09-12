# UI redesign mockups (2026-09-04)

**These are mockups, not code.** Nothing here is imported by `apps/web`. They are
standalone HTML artboards that borrow the app's real tokens, fonts and logo
assets so the design can be judged against the actual visual language, but they
share no components with the app.

**This directory is for APPROVED boards only.** `apps/web/test/artboard-index.mjs`
scans it and fails the build unless every `*.dc.html` here appears in the index
table below *and* in `canvas.json`. Work the owner has not accepted yet goes in
[`../proposals/`](../proposals), which the guard ignores — so a proposal can be
drafted, published as its own canvas and rejected without ever touching the
approved set.

Published canvas: <https://claude.ai/code/artifact/b6078f69-a823-4256-9c3c-5cd21f5bbcdc>

**Nothing keeps the canvas and these files in sync, and the newer side is not always this
one.** The canvas is edited and saved in the browser; the owner looks at it, not at the repo.
In `31cc2f7` the repo copies of **19** boards turned out to be a generation behind — still
drawing the retired three-tab `Overview / Firmware Setup / ROMs` chrome — and the drift had gone
unnoticed for days while conformance work measured against them. `GuidedFlashing` and the three
boards drawn from it were missed in that pass and needed `e68d6f1` / `570a196`. So: **always
read the published canvas back and diff file by file before publishing** — a blind publish of
the repo copies would have destroyed the owner's newer edits. Diff *every* board, not one: the
divergence was reported as chrome-only from a single sample, but `Roms` (89 lines), `RomsOptions`
(106) and `Guided` (67) had structural body changes too. When a board is refreshed, re-check
whatever cited it.

## What is here

One `.dc.html` file per artboard (a Claude Design "design component" — plain
HTML with inline styles), plus `canvas.json` describing where each sits on the
canvas, plus copies of the three asset files the header uses.

| File | Screen |
|---|---|
| `Landing1` / `Landing2` | Entry wizard — flash vs SD, then manage device vs games |
| `Landing2Unsupported` | Step 2 on a browser without WebUSB: the device card is dead and names the browsers that work |
| `Main` | Overview — stock patched (bank 1) + Retro-Go (bank 2) |
| `NoStockBank2` | Overview — no stock, Retro-Go in bank 2 |
| `NoStockBank1` | Overview — no stock, Retro-Go in bank 1 |
| `StockUnpatched` | Overview — stock unpatched, bank 2 free |
| `BothEmpty` | Overview — both banks empty |
| `ModalConnect` / `ModalFolder` | Overview with the adapter dialog / the ROM + SD folder dialog |
| `ModalFolderSdUnreadable` | …the SD card folder the user picked could not be read |
| `HeaderBusy` | The header's three states stacked — idle, writing, finishing |
| `Guided` | Firmware → Guided, all four steps |
| `GuidedRetroGoOnly` | …from a clean device — step 1 offers `Back Up` or `Skip` |
| `GuidedSkipBackup` | …`Skip` taken, and what it warns before `Skip anyway` |
| `GuidedStockOnly` | …the return-to-stock path — select backup, restore, remove Retro-Go |
| `GuidedLayout` | The setup chooser — Dual Boot / Only Retro-Go / Return to Stock |
| `GuidedLayoutStock` | …with no stock to return to, so two options |
| `GuidedLocked` | …with a locked device, so no options: it must be unlocked elsewhere first |
| `GuidedFlashing` | Guided mid-write — step 2 expanded to a phase checklist |
| `ModalSources` / `ModalSourcesEmpty` | Guided step 3 with the `Add Sources` dialog, populated and empty |
| `Firmware` | Firmware → Advanced → Install Retro-Go |
| `FirmwareUpgrade` | Firmware → Advanced → Upgrade Retro-Go (a newer release is available) |
| `FirmwareLayout` | …with the footer's `Advanced layout` drawer open |
| `BackupPatch` | Advanced → Backup & patch, one backup |
| `BackupPatchBoth` | …two backups found, plus an extflash collision warning |
| `BackupPatchCross` | …Zelda firmware on Mario hardware (blocked behind an ack) |
| `BackupPatchAllowed` | …Mario firmware on Zelda hardware (allowed, noted) |
| `FileBrowser` / `Write` / `Dump` / `Erase` | Advanced → Flash management |
| `FileBrowserFrogfs` | File browser with the FrogFS partition selected instead of LittleFS |
| `EraseCustomRange` | Erase with the `Custom range…` fields open |
| `Repos` | Sources — emulator and homebrew repositories, active and inactive |
| `ReposAdd` | Sources → add by URL, after the lookup succeeds |
| `ReposDetail` | A homebrew source — base ROM supplied, assets not built yet |
| `ReposDetailReady` | …a language added, assets built, source active |
| `SourcesRail` | Sources rebuilt on the Firmware tab's rail + anchored-footer layout |
| `SourcesRomFolders` | Sources → Local · ROMs: the folders that feed the Library |
| `SourcesLocalHomebrew` | Sources → Local · Homebrew: shared vs dedicated folders |
| `SourcesAddRoms` | Sources → add a local ROM folder |
| `SourcesAddHomebrewDir` | Sources → add a shared homebrew folder |
| `SourcesConfigureRoms` | Sources → configure an existing ROM folder — de-boxed rows, not the add page's fields |
| `SourcesConfigureHomebrewDir` | …the same for a homebrew folder, its `Used by` list open |
| `SourcesCache` | Sources → Local · Cache: what the app keeps, by category |
| `SourcesCuratedUnreadable` | Sources → Homebrew: curated entries that would not resolve, and the offline case |
| `SourcesUpdateAll` | Sources → a remote pane: Update all, idle and running |
| `SourcesFilesSupplied` | …a supplied file: the check, the picker and `Remove` on one row |
| `SourcesHomebrewConfig` | A homebrew source's page: release facts, files it takes, folders searched |
| `SourcesEmulatorConfig` | An emulator source's page: release facts, systems it adds, folders searched |
| `Roms` / `RomsOptions` | Library, and Library with additional options open |
| `RomsNewSystem` | Library after a source adds a console (WonderSwan) |
| `RomsSdNoCard` | Library in SD mode with no card chosen |
| `LibrarySummary` | Library with the Summary sheet raised — the After / Change table |
| `LibraryComposedOptions` | The options modal over the composed tab, Cover art tab active |
| `LibraryComposedOptionsSaves` | The same modal on the Saves tab: SRAM and slot picker, preview, written date, download |
| `LibraryComposedOptionsCheats` | The same modal on the Cheats tab: detected game, presets, manual entry, configured count |
| `LibraryComposed` | Library as built: Favorites beside All, a favourite star per row, search, Additional options at the foot of the info pane, the summary dock collapsed |
| `LibraryComposedSummary` | The same tab with the summary dock expanded, the carousel ridden up rather than covered |
| `RomsPrepare` | A core whose ROMs must be converted — one row per game, prepare then install |
| `RomsNoFolder` | Library before a ROM folder is chosen — the panel's gate |
| `RomsLoading` | …the same gate while the folders are being walked |
| `RomsNotice` | A converter's note under the row that produced it — not an error, not on its siblings |
| `RomsActivityLog` | The activity log — the row keeps a short status, the detail moves off it |
| `ModalInstallConfirm` / `ModalInstallConfirmSd` | The install confirmation, flash wording and SD wording |
| `ModalFilesBios` | Library — a system needs BIOS files before it can install |
| `ModalFilesBiosError` | …the supplied file fails its hash |
| `ModalFilesConvert` | …a homebrew title converting a base ROM in the browser |
| `ModalFilesFolder` | …a whole folder answering an `allowMultiple` input at once |
| `ModalSpaceAlert` | Library — the selection no longer fits the flash gap |
| `ModalNameCollision` | …two selected files that are one file on the card |
| `ModalRecoveryMode` | The Recovery Mode confirmation any flash-touching action raises |
| `ModalConfirm` | The generic confirm dialog, in its opening phase |
| `ModalConfirmRunning` | …its `running` phase — the indeterminate bar, the state the one live caller produces |
| `ModalConfirmProgress` | …`running` with progress reported — the main bar plus a sub-step bar |
| `ModalConfirmDone` | …its `done` phase |
| `ModalConfirmError` | …its `error` phase — note the lip stays gold, unlike `FlashFailure` |
| `FlashingCancel` | A running flash, with the way out — cancel takes effect at the next block |
| `FlashingCancelConfirm` | The destructive confirm over it (`Keep writing` / `Stop`) |
| `FlashFailure` | The end of the retry-twice rule — blocks named, chrome out of its busy state |
| `Specimen` | Reference sheet — every type size and grey in `tokens.css`, rendered |

`assets/` holds copies of `icon-console.svg`, `logo-rgo.png` and
`logo-gnw-badge.svg` from `apps/web/src/assets/`, so this directory renders
standalone. They are copies — the app's originals remain the source of truth.

## The design language these encode

- **A container earns a border only when it wraps a real object** — a bank, a
  game, a choice. Sections are a small-caps label plus content on the page.
- **Alignment comes from a grid, not from boxes lining up.** Overview, Library
  and Landing share one 12-column grid; Advanced sets a fixed 244px rail beside
  its body, Guided a 30px step gutter.
- **Rules only exist on white; the grey page ground separates with space.**
  Three levels and no more: structural `#d8d8d8` at region edges (header, nav,
  footer, rail), `#ededed` rules inside a white surface, nothing on the ground.
  Dense lists move onto a white surface so their rules have contrast — a ground
  change, not a box.
- **A 72px footer bar wherever a screen has one primary action**: vertically
  centred, context text left, action right. Library, Sources and every Advanced
  panel carry one. Overview and Guided close with a full-width disclosure row
  instead (`Device log`, `Log (23)`); Landing, `HeaderBusy` and `Specimen` are
  not full screens and carry neither, and `RomsNoFolder` puts its one action in
  the gate itself. Library fuses its storage meter to the bar's top edge as a
  3px strip rather than growing the bar.
- **Semantic colour stays semantic.** `#c8372b` primary (the A/B button),
  `#8a241b` destructive outline and error lip, `#b8860b` caution, `#3e9e4e`
  model accent / success, `#007bff` the pill for a queued change. The gold
  face-plate lip is 3px of `#d9bc5e`→`#c09a32`, and crawls in `#b8860b`/
  `#e8c25a` stripes while writing — a lip, never a band.
- **The header is two independent install-state slots** in bank order: stock
  firmware (bank 1), then Retro-Go (bank 2). Each badge is a *label* for its
  own value; a missing side dims to 42% rather than disappearing.
- **Empty states offer the step that fits that state** — never a generic
  "install". No stock at all → offer stock, *on bank 1 only*. Stock unpatched →
  offer the patch. Nothing anywhere → hand it to guided setup. Where no step
  fits, the fitting offer is none: an empty bank 2 with no stock anywhere shows
  `Empty` and nothing else, because stock firmware only ever boots from bank 1
  (`0x08000000`) and there is nothing that could be installed there.

One board broke the above and should be redrawn rather than excused: the Library
family rules its Summary head at `#e0e0e0`, a fourth grey (`#ededed`). Fixed —
the twelve rules drawn at `#e0e0e0` (the Summary head across eleven boards, plus
`FlashFailure`'s "Blocks that failed" caption) are now `#ededed`; all sit inside
a white surface. The two remaining `#e0e0e0` values in the tree are the disabled
"Add to library" button *fill* in `ModalFilesBios` / `ModalFilesBiosError`, not
rules, and are out of scope for the three-grey rule.

`NoStockBank1` was also named here as a board to redraw, on the grounds that its
empty bank 2 offers nothing. **That verdict was wrong; the board is correct and
must not be "fixed".** Stock firmware only ever boots from bank 1, so there is no
step that fits an empty bank 2 — offering nothing *is* the fitting offer, and
`NoStockBank2` correctly puts "Install stock firmware" on the empty bank 1. See
the comment at `apps/web/src/lib/views/OverviewTab.svelte:120-122`, which the app
already implements this way. No other board named above was misjudged the same
way: `BothEmpty`'s guided-setup offer covers both banks because with nothing
installed anywhere the guided flow *is* the fitting step for either.

## Structural decisions worth carrying into the code

- Advanced splits into **Firmware management** (Backup & patch, Install
  Retro-Go) and **Flash management** (File browser, Write image, Dump, Erase) —
  a rail, not an accordion stack. Each rail item is one route and one file.
- **Layout is not a rail item.** It is a parameter of an install that requires
  reflashing to change, so it lives inside the install flow.
- **The Expert group is gone** — device locking is not offered (use gnwmanager)
  and raw patch options never made sense.
- In Flash management, **the flash bars are a shortcut that writes into the
  range fields; the fields are the source of truth.** Start + size with a unit
  picker (hex / KB / MB) replaces the quick-fill buttons. Bank 1 and bank 2 are
  divided; external flash is labelled bank 0.
- Warnings say **what you are about to lose**, not which addresses are touched.

## Working on them

Edit the `.dc.html` files, then re-seed and republish the canvas with the
`design` skill's helper (`seed-canvas.mjs --template … --artboard … --image …
--canvas canvas.json`), publishing to the URL above so the link stays stable.
If the canvas has been edited in the browser since, read it back first
(`--extract`) and build on that — the published version is authoritative.

The seeded output file is a ~3 MB single page with the canvas editor baked in.
It is regenerable from these sources and is deliberately **not** committed.
