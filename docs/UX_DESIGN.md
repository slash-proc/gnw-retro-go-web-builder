# GNW Web Builder — UX Design & Workflows

A browser app (Chrome / Edge, WebUSB + SWD) that flashes firmware to a Nintendo Game & Watch and manages its games, covers, cheats, and saves — **entirely client-side**. Your ROMs and backups never leave the machine.

This document describes the *actual* User Interface structure as implemented in the Svelte components. The source of truth for the UI is the `apps/web/src/` codebase.

## 1. Top-Level Modes

The application runs in a single-page view under a persistent `DeviceOverview` header. There are two overarching modes:

### 1.1 Easy Setup (Guided Wizard)
Implemented in `Wizard.svelte`. This is a guided, three-step linear process designed for safe defaults. It automatically routes the user based on the device's current state on connect.
1. **Step 1: Backup & Patch Official Firmware (`patch`)**
   - Prompts the user to save a backup of the original firmware.
   - Patches the device to dual-boot into Retro-Go.
2. **Step 2: Install Retro-Go (`retrogo`)**
   - Installs the Retro-Go base system into internal/external flash.
3. **Step 3: Install ROMs (`roms`)**
   - Renders the ROM Management UI to select games, build the FrogFS/LittleFS images, and flash them.

### 1.2 Advanced Mode
Implemented in `Advanced.svelte` and `App.svelte` (via deep-link or toggle). It presents a tabbed interface for granular control and recovery.

## 2. Advanced Mode Tabs

The Advanced view contains three main tabs:

### 2.1 Device Information (`DeviceInfoTab.svelte`)
Displays read-only information about the connected device.
- Flash chip size, lock status, detected firmware versions, partitions, and an active geometry visualizer (`GeometryBar.svelte`).

### 2.2 Device / Retro-Go Management (`RetroGoTab.svelte`)
Handles system-level operations. It is split into three functional accordion groups:
1. **Official Firmware:**
   - **Backup & Patch:** Allows manual backup and patching of the stock Nintendo firmware.
2. **Retro-Go:**
   - **Install Retro-Go:** Flash the Retro-Go core system (offers "Flash" vs "SD" install modes).
   - **File Browser:** Browse the device's filesystems (LittleFS and FrogFS). Currently read-only.
3. **Flash Management:**
   - **Dump flash:** Read arbitrary regions of the flash chip to a local `.bin` file.
   - **Flash image:** Write an arbitrary `.bin` file to internal or external flash.

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
