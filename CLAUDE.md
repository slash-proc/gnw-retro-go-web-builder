# CLAUDE.md

A browser app (WebUSB, Chromium-only) that flashes and manages firmware on a Nintendo
Game & Watch (STM32H7B0). A from-scratch browser port of gnwmanager's host side plus the
firmware patcher. Everything runs client-side; `backend/` and `frontend/` are a throwaway
`/dev` harness, `apps/web` is the real UI.

## How to read the docs, and this is not optional

Documentation here is two tiers, and **both are read in full, never skimmed and never grepped.**

**Tier 1 is this file.** It is read at the start of every session, whole. Nothing else is
required reading up front.

**Tier 2 is the table below.** Each entry is read **in full, before the first edit**, whenever
your task touches its subject. The trigger column is the test. It is deliberately mechanical:
"when relevant" is the wording an agent talks itself out of, so match the trigger literally and
read the file. Reading half of one and grepping the rest is how the rules in them were broken
in the first place.

| Read in full | Before you |
|---|---|
| [docs/UI_VOICE.md](./docs/UI_VOICE.md) | write or change any user-visible string, or draw any artboard |
| [docs/I18N.md](./docs/I18N.md) | add, change or remove any string (a new string is a **15-file edit**) |
| [docs/FRONTEND.md](./docs/FRONTEND.md) | edit anything under `apps/web/src/lib/`: components, stores, styles, routing |
| [docs/SOURCES.md](./docs/SOURCES.md) | touch `sources/`, the Library tab, the SD card pane, or what a console is |
| [docs/DEVICE_IO.md](./docs/DEVICE_IO.md) | touch `swd-transport`, `gnw-flasher`, `engine/`, or anything that halts, resets or writes the device |
| [docs/GUARDS.md](./docs/GUARDS.md) | add a test, or change a doc a guard reads |
| [docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md) | add a package, move a file between layers, or change where a core's files land |
| [docs/DEVELOPMENT.md](./docs/DEVELOPMENT.md) | build, test, set up a worktree, or touch the firmware-distribution client |
| [docs/FILESYSTEMS.md](./docs/FILESYSTEMS.md) | touch FrogFS, LittleFS, staging or ROM compression |
| [docs/PATCHING.md](./docs/PATCHING.md) | touch the firmware patcher or the layout superblock |

[docs/README.md](./docs/README.md) indexes everything else: live scoreboards, dated records and
design material. Dated records are point-in-time findings: **read the code before acting on
one.**

## Golden rules

- **Never install to the host.** All npm, build and test work runs in Docker:
  `docker compose exec dev …`. Regenerate the lockfile in a throwaway container with
  `--package-lock-only`, which writes only `package-lock.json`.
- **Byte-exactness is verified, not assumed.** Anything mirroring an upstream tool (Thumb asm,
  `liblzma`, the patcher) has a reference oracle test. Run it. Anything claiming correctness
  names its oracle rather than asserting it.
- **Keep packages dependency-free and bundler-free.** The browser imports built `dist/*.js`
  directly; cross-package runtime deps go through dependency injection or an import map.
- **Branch for feature work; never commit straight to `main`.**
- **Run the gates before committing**, not after. For UI or store changes that means
  `npm run check --workspace @gnw/web` **and** `npx vite build`: `check` does not run the
  bundler, and has passed while the build was broken.
- **Verify a test by breaking what it guards.** A check that still passes with the fix reverted
  is worth nothing, and several in this repo silently were. Break the thing, not a spelling of
  it, and quote the failure line.
- **Rendering beats reading for anything in a `.svelte` file.** Three static gates and 22
  targeted checks once passed on a component whose tabs did not work. See
  [docs/GUARDS.md](./docs/GUARDS.md).
- **Flag visual changes for a look, but do not stop for one.** Do not stockpile blockers.

## Conventions

- TypeScript packages compile with `tsc -b` to `dist/`; imports use explicit `.js` extensions;
  `type: "module"`. No test framework: validation is plain `node` scripts diffing against
  oracles.
- LZMA: **two compressors on purpose.** Flashing uses LZMA-JS (browser, decode-only on device).
  Patching uses WASM `liblzma` (must be byte-exact with Python). Do not mix them up.
- Ports from gnwmanager are 1:1 and cite the source file. The patch reference is the
  `remove-keystone-engine` branch; runtime blobs are pinned to gnwmanager v0.22.1.
- `references/` is gitignored local clones, not submodules. A fresh clone or an agent worktree
  has none, so the reference-oracle tests only run from the main clone.

## Memory

Durable project facts live in `.claude/projects/.../memory/`. Consult them before re-deriving
anything. A recalled memory reflects what was true when written: if it names a file, function or
flag, verify that still exists before acting on it.

---

`GEMINI.md` is a symlink to this file, so Gemini-based tools read the same rules. Edit this one.
