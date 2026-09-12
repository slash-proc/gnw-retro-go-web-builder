# Documentation

Start here. The project is a browser app that flashes/manages firmware on a
Nintendo Game & Watch, entirely client-side over WebUSB/SWD.

(Top-level [`README.md`](../README.md) is the front door; [`CLAUDE.md`](../CLAUDE.md) is the
quick orientation for contributors, and [`STATUS.md`](../STATUS.md) tracks what is currently working and what needs to be fixed).

## Map

Five core technical documents carry the durable knowledge. Everything else in
this directory is either a live scoreboard, a dated record, or design material —
see the sections below them.

| Doc | What it covers |
|---|---|
| [ARCHITECTURE.md](./ARCHITECTURE.md) | The layered design, the packages, device classification, and the key decisions (e.g., why no OpenOCD, dependency-injection). Also includes the **Master Glossary & Hardware Quick Reference**. |
| [DEVELOPMENT.md](./DEVELOPMENT.md) | How to build, run, and test (the validation oracles), plus the Docker/dev-container gotchas. Also details the CI Artifact pipeline. |
| [FILESYSTEMS.md](./FILESYSTEMS.md) | The definitive guide to how data is stored. Explains FrogFS (ROMs/BIOS) vs LittleFS (Cores/Saves), WASM integrations, LZMA compression for ROMs, and the client-side content packing pipeline. |
| [PATCHING.md](./PATCHING.md) | How the firmware patcher works (stock Mario/Zelda OFW → dual-boot), the byte-exact `liblzma` requirement, and the `GnwLayoutSuperblock` v2 used to dynamically size partitions at flash-time. |
| [UX_DESIGN.md](./UX_DESIGN.md) | The UI structure and components mapping directly to the `apps/web/src/` Svelte codebase. Covers the Guided Wizard vs Advanced Mode tabs, accordion structures, and the mental model for ROM and game management. |
| [UI_VOICE.md](./UI_VOICE.md) | **Binding on every user-visible string and every artboard.** No narration, no filler, state carried by structure rather than wording, nothing invented that no board draws. Every rule in it is quoted from a correction the owner made, because each was fought over at least once. Read it before writing copy, every time. |

### Live working documents

| Doc | What it is |
|---|---|
| [CONFORMANCE.md](./CONFORMANCE.md) | The artboard-conformance scoreboard. **Guarded** — `apps/web/test/conformance-counts.mjs` re-derives its counts and fails the build if the table disagrees. |
| [ELECTRON.md](./ELECTRON.md) | The desktop build's filesystem plan: what a native `FsDirHandle` changes, and the open questions the owner still has to answer. |
| [DECISIONS.md](./DECISIONS.md) / [DECISIONS-MAP.md](./DECISIONS-MAP.md) | Open design questions, and what each candidate policy would decide. |
| [BLOCKED-AUDIT.md](./BLOCKED-AUDIT.md) | Audit rows waiting on an owner ruling. |
| [design/mockups/](./design/mockups) | The approved artboards plus their index. **Guarded** — `apps/web/test/artboard-index.mjs` requires the index, `canvas.json` and the files on disk to agree. |
| [design/proposals/](./design/proposals) | Design proposals not yet accepted. Deliberately outside `mockups/`, so the guard ignores them and nothing lands on the canvas by accident. |

### Reference tables and narrower subjects

| Doc | What it is |
|---|---|
| [SDCARD_CAPACITY.md](./SDCARD_CAPACITY.md) | How much space an SD card of a given nominal size really has, per filesystem, **measured by formatting sparse images** rather than computed. Backs `apps/web/src/lib/data/sdCapacity.json`, which the app reads because no browser API reports a picked directory's volume. Records the cluster sizes too, which matter as much as capacity when a library is thousands of small files. |
| [MAPPED_ARTIFACTS.md](./MAPPED_ARTIFACTS.md) | The mapped/XIP half of a core's install. |
| [VIRTUAL_CONSOLE.md](./VIRTUAL_CONSOLE.md) | The virtual-console concept and how a core declares one. |
| [RETRO_GO_EXTFLASH_WRITES.md](./RETRO_GO_EXTFLASH_WRITES.md) | What the firmware itself writes to external flash, and when. |
| [proposals/](./proposals) | Narrow written proposals (BIOS placement, derived files), separate from the visual `design/proposals/`. |

### Dated records

`AUDIT_NOTES.md`, `audit-*.md`, `OPEN-QUESTIONS-SURVEY-A.md`, `RESUME-HERE.md`
and `CORE_ABI_MIGRATION.md` are point-in-time findings, kept for the reasoning
behind decisions already taken. Each states its date; **read the code before
acting on any of them**.

## Where the code lives

- `packages/` — the core engine (TypeScript packages). Zero dependencies, no bundlers. See ARCHITECTURE.md for the map.
- `apps/web/` — The production UI built with Svelte 5 and Vite. This replaces the old legacy `backend/` and `frontend/` throwaway harnesses.
- `backend/` + `frontend/` — Legacy /dev test harnesses.
- `references/` — **gitignored local clones**, not submodules, so a fresh clone
  or an agent worktree has none and the reference-oracle tests only run from the
  main clone:
  - `gnwmanager` (branch `remove-keystone-engine`) — the host tool + patcher.
  - `game-and-watch-retro-go-sd` — the firmware (layout constants, Python tools).
- `external/` — real submodules: sylverb's `zelda3` and `smw` forks, the sources
  for those two homebrew titles.

## Conventions for doc upkeep

- Keep the five core docs accurate as things land — when a planned capability ships, update `STATUS.md` and the relevant core doc.
- Prefer correcting a core doc over adding a new file. A dated record is worth keeping only when it holds reasoning the code cannot show you.
- Anything claiming byte-exactness or correctness should name its **oracle test** (so a reader can re-verify), not just assert it.
