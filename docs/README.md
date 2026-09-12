# Documentation

Start here. The project is a browser app that flashes/manages firmware on a
Nintendo Game & Watch, entirely client-side over WebUSB/SWD.

(Top-level [`README.md`](../README.md) is the front door; [`CLAUDE.md`](../CLAUDE.md) is the
quick orientation for contributors, and [`STATUS.md`](../STATUS.md) tracks what is currently working and what needs to be fixed).

## Map

Documentation is two tiers, and **both are read in full, never skimmed.**
[`CLAUDE.md`](../CLAUDE.md) is tier 1: under 100 lines, read at the start of every session.
Everything below is tier 2, read **in full before the first edit** whenever the work touches its
subject. `CLAUDE.md` carries the trigger for each.

### Tier 2 — the rules, by subject

| Doc | Read it before you |
|---|---|
| [UI_VOICE.md](./UI_VOICE.md) | write or change any user-visible string, or draw any artboard. **Binding.** Every rule in it is quoted from a correction the owner made. |
| [I18N.md](./I18N.md) | add, change or remove any string. A new string is a 15-file edit across fifteen locales. |
| [FRONTEND.md](./FRONTEND.md) | edit anything under `apps/web/src/lib/`. The scroll container, routing, tokens, the `dbg()` reactive hazard, and the shared primitives to check before hand-rolling one. |
| [SOURCES.md](./SOURCES.md) | touch `sources/`, the Library, the SD card, or what counts as a console. |
| [DEVICE_IO.md](./DEVICE_IO.md) | touch the transport, the flasher, or anything that halts, resets or writes the device. |
| [GUARDS.md](./GUARDS.md) | add a test, or change a doc a guard reads. |

### Tier 2 — how it is built

| Doc | What it covers |
|---|---|
| [ARCHITECTURE.md](./ARCHITECTURE.md) | The codebase map, the layered design, device classification, and the key decisions (why no OpenOCD, dependency injection). Includes the **Master Glossary & Hardware Quick Reference**. |
| [DEVELOPMENT.md](./DEVELOPMENT.md) | How to build, run and test (the validation oracles), the Docker and worktree gotchas, and the CI artifact pipeline. |
| [FILESYSTEMS.md](./FILESYSTEMS.md) | How data is stored: FrogFS (ROMs/BIOS) vs LittleFS (cores/saves), the WASM integrations, LZMA for ROMs, and the client-side packing pipeline. |
| [PATCHING.md](./PATCHING.md) | The firmware patcher (stock Mario/Zelda to dual-boot), the byte-exact `liblzma` requirement, and the `GnwLayoutSuperblock` v2. |
| [UX_DESIGN.md](./UX_DESIGN.md) | The UI structure mapped to `apps/web/src/`: Guided vs Advanced, and the mental model for ROM and game management. |

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

`AUDIT_NOTES.md`, `audit-*.md`, `OPEN-QUESTIONS-SURVEY-A.md`
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
