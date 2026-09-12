# GNW Web Builder — UX Design & Workflows

A browser app (Chrome / Edge, WebUSB + SWD) that flashes firmware to a Nintendo Game & Watch and manages its games, covers, cheats, and saves — **entirely client-side**. Your ROMs and backups never leave the machine.

This document describes the *actual* User Interface structure as implemented in the Svelte components. The source of truth for the UI is the `apps/web/src/` codebase.

## 0. Target Media: Flash vs SD Card

Before anything else, the user declares which storage path their device uses. This choice persists across sessions and drives the entire install pipeline.

- **Flash (internal):** ROMs and assets are packed into FrogFS/LittleFS images and flashed to the device's external SPI flash chip. Standard path for all devices.
- **SD Card:** ROMs and assets live on a physical SD card. The install only writes the SD-capable Retro-Go intflash blob; extflash is untouched. The user grants the browser access to their SD card directory (File System Access API), and the app reads/writes ROM files there directly.

The selected media mode is stored in `targetMedia` (persisted to localStorage). The SD card folder handle is persisted via IndexedDB so permission doesn't need to be re-granted on every reload.

## 1. Top-Level Modes

The application runs in a single-page view under a persistent device header (`DeviceHeader.svelte`). There are two overarching modes. Both modes support both Flash and SD Card target media — the pipeline branches internally based on `targetMedia`.

The header's status LED (`DeviceControls.svelte`, a console-icon SVG colored red/yellow/green by connection state) doubles as the device-actions menu trigger — a single control, not two. It's a permanent fixture of the header (renders regardless of connection state); only the Retro-Go/OFW version readouts next to it are connection-gated. A click always opens a dropdown (a small caret badge signals this); options vary by state:
- **Connected, recovery mode:** Rescan / Restart Recovery Mode / Change Adapter / Disconnect Device
- **Connected, app running (Retro-Go/OFW):** Start Recovery Mode / Change Adapter / Disconnect Device
- **Disconnected:** Connect / Change Adapter

> **Note:** The entry-point flow (how the user lands in Guided vs Advanced mode and picks their media) is actively being redesigned. The below describes the stable behavioral contracts, not the specific current UI chrome.

### 1.1 Easy Setup (Guided Wizard)
Implemented in `Wizard.svelte`. This is a guided, linear process designed for safe defaults. It automatically routes the user based on the device's current state on connect.
1. **Step 1: Backup & Patch Official Firmware (`patch`)**
   - Prompts the user to save a backup of the original firmware.
   - Patches the device to dual-boot into Retro-Go.
   - **Restore-to-Stock** is offered as a peer option in the intent chooser (`engine/ofw.ts`'s
     `restoreStock()`): flashes the backed-up internal image to bank 1 and the backed-up
     external image to bank 0. This is a two-phase write, not three — restoring the stock
     reset vector to bank 1 IS the Retro-Go removal, so there is no separate uninstall step.
     **Never yet run on real hardware.**
2. **Step 2: Install Retro-Go (`retrogo`)**
   - Installs the Retro-Go base system. For Flash mode: flashes intflash + extflash (FrogFS/LittleFS). For SD Card mode: flashes only intflash (SD blob) and writes `sdContent` to the user's SD card directory.
3. **Step 3: Install ROMs (`roms`)**
   - Renders the ROM Management UI to select games and pack/flash them.

**Add Sources without leaving the wizard:** the sources step's button reads **Add Sources** and
opens `ui/AddSourcesModal.svelte` in place, rather than navigating to the Sources tab.

**External-flash floors:** below 8 MB, Guided Setup offers only Restore-to-Stock — the chip is
not fit for modern Retro-Go. Below 16 MB, dual boot is not offered. These are hard hardware
floors, not preferences; Advanced mode has no such gate for anyone who wants to push a smaller
chip anyway. The check only fires once the chip size is actually known — unknown size (pre-scan)
does not gate, since hiding options on "haven't looked yet" would be worse than briefly showing
one the device turns out not to support.

### 1.2 Advanced Mode
Implemented in `Advanced.svelte` and `App.svelte` (via deep-link or toggle). It presents a tabbed interface for granular control and recovery.

## 2. Advanced Mode Tabs

The Advanced view contains four tabs: **Overview / Firmware / Sources / Library** (the
`RomManagementTab.svelte` content is presented under the "Library" label; its internal `Tab`
value and hash segment remain `"roms"` — routing internals, not user-facing text).

### 2.1 Overview (`OverviewTab.svelte`)
Displays read-only information about the connected device as a two-column dashboard (`grid-template-columns: 2fr 2.5fr`, capped at 900px via a `.shell.narrow` modifier scoped to just this tab — see `Advanced.svelte`).
- **Left column:** an "Info" card (Running / Game & Watch / Retro-Go / Storage / Read protection) and, below it, a "Controls" card (Start/Restart Flash Util, Capture Screenshot) — two separately-boxed cards, same chrome.
- **Right column, top:** the screenshot viewport, in its own card — fixed at the G&W's native 320x240 (never fluid/scaled), centered.
- **Bottom row (both columns):** the internal-flash bank cards (`BankCard.svelte`) and the external-flash geometry bar (`GeometryBar.svelte`) with a partition-detail footer.
- The top and bottom rows deliberately share the same grid columns so they stay lined up as one grid, not independently-sized rows.

### 2.2 Firmware (`RetroGoTab.svelte`)
Handles system-level operations. The sections are listed in a 244px left-hand rail
(`advanced/FirmwareRail.svelte`) and **exactly one is mounted at a time**, chosen by click or hash
deep-link — this replaced the earlier accordion stack. (An older "auto-open the
firmware-appropriate section" mechanism was removed before that: it reacted to the device scan
mid-flight and would pop sections open/closed on their own.) Any section reading device
bank/partition state shows a "Scanning device…" placeholder instead of its real content while
`device.scanning` is true.
1. **Official Firmware:**
   - **Backup & Patch:** Allows manual backup and patching of the stock Nintendo firmware.
2. **Retro-Go:**
   - **Install / Repair:** Flash the Retro-Go core system. Offers a Flash vs SD Card toggle; SD mode flashes the intflash SD blob only (SD content sync from Advanced is a known open TODO — use the Wizard for a full SD install).
   - **File Browser:** Browse the device's filesystems (LittleFS and FrogFS). Currently read-only.
3. **Flash Management:**
   - **Dump Flash:** Read arbitrary regions of the flash chip to a local `.bin` file.
   - **Write Flash:** Write an arbitrary `.bin` file to internal or external flash.
   - **Erase Flash:** Erase (fill with `0xFF`) one or more selected partitions.

**Unlocking is automatic, and its ordering is the opposite of the obvious one.** There is no
opt-in checkbox: any flow that writes to the device clears RDP first, via `device.ensureUnlocked()`
over `engine/unlockGate.ts`, which is the only caller allowed to reach the flasher's `unlock()`.

The counter-intuitive part, and the reason the gate exists as a separate testable thing: **a locked
device cannot be backed up first.** RDP level 1 makes internal flash unreadable over SWD, so there
is nothing to read. Clearing RDP is defined by the hardware to mass-erase internal flash, and the
stock image is unique per unit and cannot be re-downloaded. So the backup flows deliberately do
*not* auto-unlock, because unlocking is precisely what would destroy the image they exist to save;
the write flows do. What survives as a prompt is the genuinely irreversible case: a first-time
locked device whose original firmware cannot be saved first.

**Guided Setup no longer walls off a locked device** (2026-09-12). It used to replace the whole
chooser with a "this device is locked" page that sent the user to gnwmanager's `unlock` command;
that page described a capability the app has since gained, and it is gone. A locked device now
draws the same chooser as any other, and unlocking happens inside Backup without a prompt. The
owner's framing: *"WE DON'T CARE! We unlock the device if it is locked. Unlocking is an inherent
part of the Backup phase. The Backup phase succeeding is incredibly important for that reason."*
`test/locked-copy.mjs` §4b now fails on any `"locked"` test in `Wizard.svelte`, so the wall cannot
be rebuilt without new copy; the only `"locked"` strings left in that file are comments saying why
there is no branch.

**The consequence, which nothing gates and which you should know before debugging it:** because
unlock runs after the dump, and a locked device cannot be dumped, **Dual Boot on a locked device
fails at the dump and never reaches unlock**, while Only Retro-Go works, since its step-2 flash
calls `ensureUnlocked()` before writing. That is the honest behaviour of the ordering above rather
than a defect, but it means a locked unit takes the Retro-Go path or none. If a card gate for
Dual Boot is ever wanted, it is a *card* gate, not a return of the page wall.

gnwmanager recovers that image with a payload dance (an XOR-obfuscated payload flashed to external
flash, then a user-performed power cycle that dumps internal flash to SRAM, then the RDP clear).
**That is not implemented here.** `blobs/unlock.bin` is vendored and ready, but the flow needs a
mid-operation power cycle, a WebUSB reconnect and a confirmation step, which is real UI rather
than a bolt-on. Until it exists, a locked device's stock firmware is lost on unlock.

Re-locking is not implemented, deliberately: `lock()` is a stub whose comment is the record of
that decision. Locking buys the owner of a device they are already modifying nothing, and costs
them the debug access everything else here depends on.

**The firmware-backup state is read from the folder, not remembered.** `lib/backupPresence.svelte.ts`
answers whether a usable backup exists by probing the folder the user picked (metadata only, so
opening Overview never reads a 16 MB image); full hash validation stays in the patch flow that
needs it. It distinguishes *no backup* from *folder not connected*, because claiming "no backup"
when nothing has been looked at is its own kind of wrong. `engine/ofw.ts` walks the dated
`backups-*` subfolders newest-first, which fixed a real bug: `writeBackup` drops into a dated
subfolder whenever the picked folder is not empty, and the scan only ever read the top level, so
a backup could be invisible to the check meant to find it.

### 2.3 Sources (`Sources.svelte`)
Manages which homebrew publishers' manifests the app trusts, per the `gwrg-dist-spec`. This
is what makes the Library tab's homebrew list possible; there is no hardcoded catalogue left.
- **Add a source** by repo reference; the client resolves `dist/<tag>/versions.json` then the
  target manifest (`lib/sources/client.ts`), sha256/length-verifying every artifact it later
  fetches (`fetchVerified`).
- **Bundle Zip import**: add a source from a local `dist/<tag>/` zip instead of the network —
  the archival form of a release, for when the Pages mirror is gone or there is no network at
  all (`lib/sources/bundle.ts`). An imported source is labeled **UNVERIFIED** in the UI: a
  bundle proves its own internal integrity (nothing was corrupted or tampered with in
  transit), not that its publisher is honest — that would need comparing against the
  project's live manifest, a network operation this import deliberately does not do.
- **Manifest-driven file prompt** (`lib/ui/FilePromptModal.svelte`): when a homebrew target's
  converter needs an input file (e.g. a ROM to convert), the app asks for it explicitly per
  what the manifest declares, rather than guessing by scanning the ROM folder for a matching
  extension (the old `findSourceFile` heuristic, removed). Required inputs are always visible;
  **every** optional input lives behind one disclosure, or none of them — an all-or-nothing tail.
  (The artboard's literal "8 more optional files" implied a partial tail; that was ruled out.)
  The same modal serves a core's BIOS slots, because the manifest asks the same question
  there with the same two localised fields.
- **A bundle survives a reload**: the original zip is kept in IndexedDB and the whole import —
  entry-name guards, schema gating, every length and sha256 — is re-run on restore. There is no
  "already checked once" fast path; a local store is not a trust boundary. If the store is
  unavailable or the zip no longer verifies, the row asks for the zip again, exactly as before.
- **One meta line per row**, saying what the source gives you. A core names the systems it
  emulates and their extensions (`WonderSwan, WS Color · .ws .wsc`), then how many files in the
  user's picked folder those extensions match. A homebrew source carries nothing there — it is
  already under the Homebrew heading. **No title counts anywhere.**
- **Firmware compatibility** is three-valued. When the connected device publishes a firmware ABI
  table (read at `ORIGIN(FLASH) + 0x400`, see `engine/firmwareAbi.ts`) and a source's build needs
  a newer one, the row says **"Needs newer firmware"** in that same plain meta text — it is a
  statement about the device, not a warning, and it is styled like one. When the ABI is unknown
  (nothing connected, no scan yet, stock OFW, a pre-ABI Retro-Go) the row makes **no claim at
  all**: the same "no data, no assertion" rule cover scraping follows when a homebrew omits
  `originalSystem`.
- **"Additional files" section** (the `ReposDetail` artboard) is built: one section per selected
  source, combining a core's BIOS slots (`sources/bios.ts`) and a homebrew source's
  deduplicated converter inputs (`tools[].inputs`) under one idea — files the source needs and
  cannot ship itself. A converter-input row used to render inert here; it is now actionable
  ("Add a file" opens the same `FilePromptModal`, gated through the input's own accept rule) —
  `sources/prepareState.svelte.ts` lifted the Library's per-title prepare flow into a
  store-backed singleton the Sources tab shares, because the prepared bytes must outlive
  whichever tab produced them (a tab switch used to unmount the Library and drop them). The
  section itself is now `ui/AdditionalFiles.svelte`, extracted out of `views/Sources.svelte`.
  **Dropped from the design:** the `curated` and `Installed` source chips.
- Sources feed the Library tab's homebrew rows; asset extraction and the source-vs-bundle
  engine `.bin` are covered under 2.4 below.

**User-facing vocabulary:** the UI says **core**, and so do the code, the manifest and the
firmware. This paragraph used to state the reverse, that the UI said "emulator" where everything
else said "core"; that rename was run the other way and then carried into internal identifiers as
well. "Core" is the general word: an emulator is one kind of core, and DOOM is a core that
emulates nothing. See `docs/ARCHITECTURE.md` for the definition and why a core is not a kind of
homebrew. Holds in every wired locale, guarded by `test/core-vocabulary.mjs`.

### 2.4 Library (`RomManagementTab.svelte`)
Handles user content (games). Internal `Tab` value and hash segment are still `"roms"`.
- Scans the registered local folders for ROM files (many folders, deduplicated).
- **Which consoles exist comes from Sources, not from a table.** `sources/coreRegistry.ts` builds
  the console set from *active* cores' declared systems; a button appears only where an active
  core declares the system AND the scan found files for it. Deactivating a source removes its
  console even with the files still on disk. Three hardcoded tables used to decide this between
  them and now survive only as a fallback for the no-core-registered case, and to name a console
  already on the device whose core was later disabled.
- **One row per game, not per file** (`sources/gameRows.ts`). A file a converter must process
  (a Doom `.wad`, an OpenLara `.PHD`) and the output it becomes are one entry, paired by the
  output's declared name so the pairing costs no hashing. The row carries state rather than kind:
  it offers **Prepare** until its output exists, then the install control in the same place. An
  unprepared row has no install control at all. The list shows the original filename without its
  extension; the carousel shows the published pretty name above the full filename, and identity
  stays the input's so a row never renames itself mid-flow.
- Highlights which games are installed vs new.
- Compiles the selected games into a FrogFS (and optionally LittleFS) image structure.
- Flashes the new ROM structure to the device's external flash.
- **Homebrew Ports:** Which homebrew titles exist is decided by the active Sources' manifests, not by anything hardcoded in the app. A title's engine `.bin` and any files shipped beside it come from the source's own `targets[].artifacts[]`, fetched hash- and length-verified (`lib/sources/installArtifacts.ts`), overriding whatever copy the firmware bundle carries. There is deliberately no total-size ceiling on an install — what it has to fit in is a property of the device (the FrogFS gap in Flash mode; the SD card plus the extflash ROM cache in SD mode), not a constant. Asset extraction (anything a converter must DERIVE from the user's own ROM, as opposed to what the publisher ships) runs in-browser through the spec's ABI-1 WASM converter host (hash-verified module, no import object). When a manifest does not publish `originalSystem`, no cover-scrape fallback is attempted for that title — no name-based search, no console lookup table; the old `virtualConsole`-driven guessing is gone. Homebrew games are seamlessly integrated into the primary ROM list and can be generated and managed directly alongside standard emulated games.
- **BIOS files** appear as rows in this same list — one per installable slot an active core
  source declares, the direct mirror of a homebrew title's row, with a chip reading Found /
  Needs a file / optional that opens the same `FilePromptModal`. Worst-first ordering. Which
  slots are offered follows the install policy, so a slot this medium would not write is never
  shown. The install summary carries a BIOS row and an unconditional Cores row.
  - **SD installs an active source's BIOS regardless of whether the user has ROMs for it today**
    — a card is open, ROMs land on it outside this app, and a missing BIOS means those games
    silently do not boot (ColecoVision does not even fail loudly). Space on a card is not the
    scarce resource.
  - **Flash installs a system's BIOS only when that system has games** — the content set is
    closed and the gap between the FrogFS image and LittleFS is scarce, so a BIOS for a system
    with no games is dead weight.
  - **Where a file goes is declared, not derived**: `systems[].biosDir` names the directory under
    `/bios`, omitted when it equals the system `id`. Two systems diverge — ColecoVision
    (`roms/col` → `bios/coleco`) and PC Engine CD (`roms/pcecd` → `bios/pce`). The old hardcoded
    `col`→`coleco` table is gone; an unknown system's file goes to the `/bios` root rather than a
    guessed subdirectory.
  - **Two prompts, neither of them a gate.** Selecting a ROM for a system with an unmet BIOS
    opens the prompt once per system (not once per ROM; dismissing counts, and merely arriving on
    the tab never opens one). A still-unmet *required* slot gets one last offer at install time,
    then the install runs either way. Optional slots are never raised. Supplied files are policed
    by `inputGate.ts` — the same hash/size/`strict` rules as any converter input.
- **Saves & Screenshots:** Implemented using a fast, lazy-loading LittleFS browser (`SavesSection.svelte`). Allows viewing available save slots and downloading both the save file `.sav` and automatically decodes and displays the accompanying raw RGB565 screenshots (`.raw`) as standard PNGs.
- **Cover Art:** A full 3D Cover Flow carousel (`Carousel.svelte`) visualizes games with high-quality box art. Includes integration with ScreenScraper (`GameDetailsPanel.svelte`) for both single-game and bulk batch scraping directly within the browser, seamlessly converting covers to the device's native format while caching full-res versions for the UI.
- **Cheat Codes:** Natively supports parsing `.ggcodes` files, presenting an interactive UI to toggle cheats on/off per game, and seamlessly packing modified configurations back into the FrogFS payload stripped of descriptions to ensure Retro-Go compatibility.

## 3. Expert Corner (removed)
There is no Expert Corner and no `#expert` hash route. It was deleted along with
`AccordionSection.svelte`/`DeferredSection.svelte` when the Firmware tab moved to the section rail
(see 4.1), and its two contents went separate ways:

- **Manual locking and unlocking (RDP bytes).** Unlocking is no longer a hidden opt-in at all. Any
  flow that writes to the device unlocks first, automatically. Re-locking is not implemented and
  deliberately so. See the "Unlocking is automatic" block in 2.2.
- **Patch model overrides.** Still reachable, as the `dangerous` override in
  `OfficialFirmwareSection.svelte`, guarded rather than hidden.

## 4. Visual Design System & Interactions

Both modes use off-white or off-black surfaces, keeping Game & Watch cues tactfully: Mario-red/Zelda-green outlines, silver/red buttons, gold accents, and black-on-gold/silver legends. Advanced Mode uses a monospace typeface for technical outputs (addresses, hex, hashes, sizes).

### 4.1 Interaction Patterns
- **Cancelable Read**: Read operations show a `Progress` bar and a `Cancel` button.
- **Blocking Write**: Destructive actions (Erase, Flash) open a `ConfirmModal.svelte` that traps focus until completion.
- **Section Rail**: The Firmware tab's complex operations live one-at-a-time behind a left rail (`FirmwareRail.svelte`), the pattern the Sources tab also uses. Both `AccordionSection.svelte` and `DeferredSection.svelte` are **deleted** — the rail replaced the accordion stack, and the Expert Corner went with it.
