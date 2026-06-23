# Documentation

Start here. The project is a browser app that flashes/manages firmware on a
Nintendo Game & Watch, entirely client-side over WebUSB/SWD.

(Top-level [`README.md`](../README.md) is the front door; [`CLAUDE.md`](../CLAUDE.md) is the
quick orientation for contributors, and [`STATUS.md`](../STATUS.md) tracks what is currently working and what needs to be fixed).

## Map

The documentation has been consolidated into 5 core technical documents to keep navigation simple and DRY.

| Doc | What it covers |
|---|---|
| [ARCHITECTURE.md](./ARCHITECTURE.md) | The layered design, the packages, device classification, and the key decisions (e.g., why no OpenOCD, dependency-injection). Also includes the **Master Glossary & Hardware Quick Reference**. |
| [DEVELOPMENT.md](./DEVELOPMENT.md) | How to build, run, and test (the validation oracles), plus the Docker/dev-container gotchas. Also details the CI Artifact pipeline. |
| [FILESYSTEMS.md](./FILESYSTEMS.md) | The definitive guide to how data is stored. Explains FrogFS (ROMs/BIOS) vs LittleFS (Cores/Saves), WASM integrations, LZMA compression for ROMs, and the client-side content packing pipeline. |
| [PATCHING.md](./PATCHING.md) | How the firmware patcher works (stock Mario/Zelda OFW → dual-boot), the byte-exact `liblzma` requirement, and the `GnwLayoutSuperblock` v2 used to dynamically size partitions at flash-time. |
| [UX_DESIGN.md](./UX_DESIGN.md) | The UI structure and components mapping directly to the `apps/web/src/` Svelte codebase. Covers the Guided Wizard vs Advanced Mode tabs, accordion structures, and the mental model for ROM and game management. |

## Where the code lives

- `packages/` — the core engine (TypeScript packages). Zero dependencies, no bundlers. See ARCHITECTURE.md for the map.
- `apps/web/` — The production UI built with Svelte 5 and Vite. This replaces the old legacy `backend/` and `frontend/` throwaway harnesses.
- `backend/` + `frontend/` — Legacy /dev test harnesses.
- `references/` — pinned submodules used as porting references:
  - `gnwmanager` (branch `remove-keystone-engine`) — the host tool + patcher.
  - `game-and-watch-retro-go-sd` — the firmware (layout constants, Python tools).

## Conventions for doc upkeep

- The documentation hierarchy is strictly limited to 3 hops: `CLAUDE.md` -> `STATUS.md` -> `docs/<micro-doc>.md`. Do not create fragmented micro-documents.
- Keep this set accurate as things land — when a planned capability ships, update `STATUS.md` and the relevant core doc.
- Anything claiming byte-exactness or correctness should name its **oracle test** (so a reader can re-verify), not just assert it.
