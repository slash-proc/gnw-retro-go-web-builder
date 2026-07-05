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
2. **Step 2: Install Retro-Go (`retrogo`)**
   - Installs the Retro-Go base system. For Flash mode: flashes intflash + extflash (FrogFS/LittleFS). For SD Card mode: flashes only intflash (SD blob) and writes `sdContent` to the user's SD card directory.
3. **Step 3: Install ROMs (`roms`)**
   - Renders the ROM Management UI to select games and pack/flash them.

### 1.2 Advanced Mode
Implemented in `Advanced.svelte` and `App.svelte` (via deep-link or toggle). It presents a tabbed interface for granular control and recovery.

## 2. Advanced Mode Tabs

The Advanced view contains three main tabs:

### 2.1 Overview (`OverviewTab.svelte`)
Displays read-only information about the connected device as a two-column dashboard (`grid-template-columns: 2fr 2.5fr`, capped at 900px via a `.shell.narrow` modifier scoped to just this tab — see `Advanced.svelte`).
- **Left column:** an "Info" card (Running / Game & Watch / Retro-Go / Storage / Read protection) and, below it, a "Controls" card (Start/Restart Flash Util, Capture Screenshot) — two separately-boxed cards, same chrome.
- **Right column, top:** the screenshot viewport, in its own card — fixed at the G&W's native 320x240 (never fluid/scaled), centered.
- **Bottom row (both columns):** the internal-flash bank cards (`BankCard.svelte`) and the external-flash geometry bar (`GeometryBar.svelte`) with a partition-detail footer.
- The top and bottom rows deliberately share the same grid columns so they stay lined up as one grid, not independently-sized rows.

### 2.2 Firmware Setup (`RetroGoTab.svelte`)
Handles system-level operations. It is split into three functional accordion groups. Every section
starts closed and opens only on an explicit click or hash deep-link (an earlier "auto-open the
firmware-appropriate section" mechanism was removed — it reacted to the device scan mid-flight and
would pop sections open/closed on their own). Any section reading device bank/partition state
shows a "Scanning device…" placeholder instead of its real content while `device.scanning` is true.
1. **Official Firmware:**
   - **Backup & Patch:** Allows manual backup and patching of the stock Nintendo firmware.
2. **Retro-Go:**
   - **Install / Repair:** Flash the Retro-Go core system. Offers a Flash vs SD Card toggle; SD mode flashes the intflash SD blob only (SD content sync from Advanced is a known open TODO — use the Wizard for a full SD install).
   - **File Browser:** Browse the device's filesystems (LittleFS and FrogFS). Currently read-only.
3. **Flash Management:**
   - **Dump Flash:** Read arbitrary regions of the flash chip to a local `.bin` file.
   - **Write Flash:** Write an arbitrary `.bin` file to internal or external flash.
   - **Erase Flash:** Erase (fill with `0xFF`) one or more selected partitions.

### 2.3 ROM Management (`RomManagementTab.svelte`)
Handles user content (games).
- Scans a local folder for ROM files.
- Displays games by console, highlighting which are installed vs new.
- Compiles the selected games into a FrogFS (and optionally LittleFS) image structure.
- Flashes the new ROM structure to the device's external flash.
- **Homebrew Ports:** Homebrew extraction (Super Mario World, Zelda 3) is implemented natively in the browser via a WASM port of `restool`. Homebrew games are seamlessly integrated into the primary ROM list and can be generated and managed directly alongside standard emulated games.
- **Saves & Screenshots:** Implemented using a fast, lazy-loading LittleFS browser (`SavesSection.svelte`). Allows viewing available save slots and downloading both the save file `.sav` and automatically decodes and displays the accompanying raw RGB565 screenshots (`.raw`) as standard PNGs.
- **Cover Art:** A full 3D Cover Flow carousel (`Carousel.svelte`) visualizes games with high-quality box art. Includes integration with ScreenScraper (`GameDetailsPanel.svelte`) for both single-game and bulk batch scraping directly within the browser, seamlessly converting covers to the device's native format while caching full-res versions for the UI.
- **Cheat Codes:** Natively supports parsing `.ggcodes` files, presenting an interactive UI to toggle cheats on/off per game, and seamlessly packing modified configurations back into the FrogFS payload stripped of descriptions to ensure Retro-Go compatibility.

## 3. Expert Corner
Accessible only via the `#expert` hash. Contains deeply hidden, dangerous, or uncommonly used functionality.
- Manual device locking and unlocking (modifying RDP bytes).
- Patch model overrides.

## 4. Visual Design System & Interactions

Both modes use off-white or off-black surfaces, keeping Game & Watch cues tactfully: Mario-red/Zelda-green outlines, silver/red buttons, gold accents, and black-on-gold/silver legends. Advanced Mode uses a monospace typeface for technical outputs (addresses, hex, hashes, sizes).

### 4.1 Interaction Patterns
- **Cancelable Read**: Read operations show a `Progress` bar and a `Cancel` button.
- **Blocking Write**: Destructive actions (Erase, Flash) open a `ConfirmModal.svelte` that traps focus until completion.
- **Accordion Sections**: Complex operations are housed in collapsible accordions (`AccordionSection.svelte`).
- **Deferred Sections**: Features that are planned but not yet implemented are shown explicitly as "not yet available" (`DeferredSection.svelte`) rather than throwing errors.
