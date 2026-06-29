# Project Status

This document is the definitive source of truth for the current state of the Game & Watch Web Builder project. 

## Overarching To-Do / Feature Matrix

### Implemented & Working
- [x] **WebUSB / Device Flasher:** Read/Write flash operations, verification, and chunking (via `@gnw/gnw-flasher`).
- [x] **FrogFS Building:** Creating valid FrogFS images from user ROMs (`@gnw/fs-builders`).
- [x] **LittleFS Building:** Formatting and packing `cores/` into LittleFS (`@gnw/fs-builders`).
- [x] **Thumb Assembler:** Assembling ARM Thumb-2 patches for the firmware.
- [x] **Firmware Patching:** Modifying Mario/Zelda/etc. OFWs dynamically.
- [x] **File Browser (Read-Only):** Extracting and viewing file structures from FrogFS and LittleFS partitions on the device.
- [x] **Artifact Pipeline:** GitHub Actions workflow correctly packs and tags `retro-go` release bundles (`v1.3.1-xx-gXXXXX`) for consumption.

### Not Properly Implemented Yet (TODO)
- [ ] **ROM Management: Version Independence:** When adding ROMs, the tool currently repacks the FrogFS using `bios`, `fonts`, and `lang` files from the *latest GitHub bundle*. Because the device's `cores` (living in LittleFS) are left untouched during a ROM flash, this can create a severe version mismatch. **Fix:** We must extract the `bios/fonts/lang` system files directly from the device's existing FrogFS (just like we do for missing ROMs) to guarantee the newly packed FrogFS perfectly matches the untouched LittleFS cores.
- [ ] **ROM Management: Idempotency & Block Shifting:** Adding new ROMs currently re-alphabetizes the FrogFS payload, shifting the byte addresses of all subsequent games. This invalidates the 256KB block hashes and breaks differential flash skipping. **Fix:** When repacking the FrogFS, we must parse the device's existing FrogFS offsets and pack the files back in that exact order (lowest to highest address). This guarantees an append-only strategy where new ROMs are tacked onto the end, preserving all existing 256KB block boundaries.
- [x] **Screenshots:** The Device / Retro-Go Management tab now properly decodes and displays RGB565 screenshots natively in the browser.
- [x] **Cover Art:** Supported through scanning `covers/` in the ROM folder and appending them to the FrogFS image.
- [x] **Saves Management:** Implemented a fast, lazy-loading LittleFS browser (`lfsBrowser.ts`) to view saves and screenshots without dumping the entire partition. Saves and raw screenshots can be downloaded directly from the UI. (Upload/Restore functionality may still need work).
- [x] **Cheat Codes:** Implemented. UI natively supports parsing `.ggcodes` files sitting next to ROMs, displaying them in a ledger, and automatically packing modified cheats back into the FrogFS payload natively without descriptions to ensure Retro-Go compatibility.
- [x] **LittleFS Migration during Upgrade:** Implemented. When upgrading the firmware (and deploying new emulator cores to LittleFS), the UI seamlessly extracts existing `/data` and `CONFIG` elements from the device's LittleFS and splices them natively into the newly generated LittleFS filesystem.
- [x] **Homebrew Ports (SMW/Zelda3):** Implemented using a native WASM `restool` port rather than Pyodide. The UI smoothly integrates Homebrew directly into the ROM selection table, tracking missing assets, triggering extraction, and cleanly showing footprint sizes just like standard emulated games.

## Architecture

**Cores vs ROMs:**
- **ROMs** are packed into a **FrogFS** image which is flashed to the lower section of external flash.
- **Cores** are packed into a **LittleFS** image which is flashed to the upper section of external flash (this partition also holds Saves, Screenshots, and Settings).

When adding ROMs through the ROM Management Tab, the application extracts the existing FrogFS contents and repacks them alongside the new ROMs. This process must be **version independent** to ensure we don't accidentally create a mismatch between the firmware version and the installed cores (which live in LittleFS).

## Documentation Navigation

The documentation hierarchy is strictly limited to 3 hops (`CLAUDE.md` -> `STATUS.md` -> `docs/*.md`). When you need specific technical details, consult the appropriate core document:

- [**`docs/ARCHITECTURE.md`**](./docs/ARCHITECTURE.md): The overall architecture, how the host communicates with the device over SWD, WebUSB transport (`packages/swd-transport`, `packages/gnw-flasher`), device scanning, classification, and the Master Glossary & Hardware Quick Reference.
- [**`docs/DEVELOPMENT.md`**](./docs/DEVELOPMENT.md): The development environment, Docker container setup, testing, and CI artifact pipelines (how `retro-go` bundles are built and tagged).
- [**`docs/FILESYSTEMS.md`**](./docs/FILESYSTEMS.md): Detailed information on how data is stored. Explains FrogFS (ROMs, BIOS, Fonts) vs LittleFS (Cores, Saves), WASM integrations, LZMA sidecar compression for ROMs, and the client-side content packing pipeline.
- [**`docs/PATCHING.md`**](./docs/PATCHING.md): Details the byte-exact `gnw-patch` mechanism (stock Mario/Zelda to dual-boot) and the `GnwLayoutSuperblock` format used to dynamically size partitions at flash-time.
- [**`docs/UX_DESIGN.md`**](./docs/UX_DESIGN.md): The UI specs, workflows, phase models (Guided vs Advanced mode), visual design system, and the user's mental model for ROM and game management.
