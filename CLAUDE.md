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
- **Run the push gate before pushing executable changes**, not after. For changes to JavaScript,
  TypeScript, Svelte, CSS, assets, package metadata or other build inputs, run
  `npm run check:push` in Docker and do not push unless it passes. This runs the internal
  package builds and the complete production web build. Documentation-only changes such as
  Markdown do not require this gate. The gate is honor-system rather than a Git hook; see
  [docs/PUSH_GATE.md](./docs/PUSH_GATE.md).
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

## Official curated distribution retrieval

When obtaining a curated core or homebrew artifact, use the project's published GitHub Pages
distribution metadata. Never guess a GitHub release URL, tag asset path, repository name, or
GitHub API endpoint, and never treat a device copy as the original distribution artifact.

The discovery chain is:

1. Start with the Retro-Go SD distribution index hard-coded by the app:
   `https://slash-proc.github.io/game-and-watch-retro-go-sd/dist/versions.json`.
2. Select the requested firmware entry (the newest default is `versions[0]`; there is no
   `latest` file), resolve its `manifest` relative to that index URL, then resolve the
   manifest's `projects` URL relative to the manifest URL.
3. For a curated project, use the exact absolute `versionsUrl` published in `projects.json`.
   For example, if the curated list publishes
   `https://slash-proc.github.io/ccleste-retro-go-sd/dist/versions.json`, fetch that URL;
   do not reconstruct it from memory.
4. In that project's `versions.json`, select the exact requested tag (for example `v0.0.4`,
   `v0.2.0`, or `v1.1.2`). Resolve its manifest relative to the project's `versions.json`,
   then resolve every artifact URL relative to that manifest URL.
5. Download and verify the manifest-declared artifact bytes (including `sha256` and size) via
   the source client path. If an exact tag is absent, report it unavailable rather than
   silently substituting another release.

The implementation of this protocol is in `apps/web/src/lib/firmwareDist/client.ts` and
`curated.ts` for the Retro-Go SD index and curated project list, and
`apps/web/src/lib/sources/client.ts` for project `versions.json`, manifests, URL resolution,
and artifact verification (`resolveVersion`/`fetchTargetArtifacts`).

## Memory

Durable project facts live in `.claude/projects/.../memory/`. Consult them before re-deriving
anything. A recalled memory reflects what was true when written: if it names a file, function or
flag, verify that still exists before acting on it.

---

`GEMINI.md` is a symlink to this file, so Gemini-based tools read the same rules. Edit this one.

## Product direction note

The current text-heavy source and status rows are an interim presentation. Replace their explanatory
copy with tasteful icon-based infographics when the visual system is ready, while preserving clear
accessible labels and equivalent information for assistive technology.
