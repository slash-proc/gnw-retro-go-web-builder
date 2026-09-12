# Audit: invented copy and unmocked structure

Scope: `d4a09a6..HEAD` on `feat/ui-redesign-foundation`. Compared against the approved
artboards on the design canvas. The flash layout questionnaire is excluded — its removal
is already in hand.

**Standard applied:** a user-visible string is a defect unless it appears in an approved
artboard, or is a minimal factual label an existing pattern demands. Prefer deletion over
rewording.

**Good news first:** no hardcoded user-visible text was found inline in any `.svelte` file,
and no `aria-label` strings were added. Everything routes through i18n, so every fix below
is a strings edit plus, in one case, a deletion.

**Counts:** 1 structural defect, 7 wording defects where an approved artboard already says
it differently, 6 unsupported-prose defects. 14 total.

---

## S1 — Structure with no mockup

### 1. `BiosPanel.svelte` mounted on the Overview tab

`apps/web/src/lib/views/OverviewTab.svelte:427` renders `<BiosPanel />`.

**No artboard shows a BIOS panel on Overview.** `Main.dc.html` (the Overview tab) contains
exactly: Device · Internal flash (Bank 1 / Bank 2) · Screen · External flash · Device log.

The approved design handles BIOS in two places, neither of them a panel:

- **`ModalFilesBios.dc.html`** — a modal at add-to-library time, structurally identical to
  the converter file prompt:

  > PC Engine CD needs additional files
  > PC Engine CD games will not start without it.
  > **System Card 3** · required · `syscard3.pce or syscard3.bin` · Choose
  > **Game Genie** · optional · `gamegenie.nes` · Found
  > 8 more optional files
  > Cancel — Add to library

- **`LibrarySummary.dc.html`** — one row in the summary drawer, three words:

  > `BIOS | needs a file | 1`

**Action: remove `<BiosPanel />` from Overview.** The discovery/status logic in
`sources/bios.ts` and `sources/biosState.svelte.ts` is sound and worth keeping — it is the
*presentation* that has no basis. Re-surface it as (a) the summary row above, and (b) the
approved modal, which is the same component as the file prompt with a different title and
submit label. That also disposes of `bios.intro` and `bios.placementNote` (below).

Note the approved modal collapses the tail: **"8 more optional files"** — the panel lists
everything unconditionally.

---

## S2 — An approved artboard says it, and we said something else

All seven live in `sources.filePrompt` (`i18n/strings/roms.ts` → `sources.ts`) and render
in `ui/FilePromptModal.svelte`. The approved source is `ModalFilesConvert.dc.html`; the
error form is `ModalFilesBiosError.dc.html`.

| # | Landed | Approved | Action |
|---|---|---|---|
| 2 | `title: (tool) => \`Files needed for ${tool}\`` | `Zelda 3 needs additional files` / `PC Engine CD needs additional files` | Change to `` (name) => `${name} needs additional files` ``. Note the artboard uses the **title** (`Zelda 3`), not the tool id. |
| 3 | `subtitle: "This converter builds from files you supply. Nothing you pick leaves your browser."` | `Files are converted in your browser. Nothing is uploaded.` | Replace verbatim with the approved line. It is shorter and it is the one that was approved. |
| 4 | `required: "Required"` / `optional: "Optional"` | `required` / `optional` (lowercase) | Lowercase both. |
| 5 | `recognised` / `recognisedAs` / `notRecognised` / `checking: "Checking..."` | `Found` · `Added` · `2 added` · `Choose` | Delete all four. The approved vocabulary is state-as-outcome (`Found`, `Added`, `N added`) and one action (`Choose`). |
| 6 | `addFile: "Add file"` / `addAnother: "Add another"` / `removeFile: "Remove"` | `Choose`; repeat count shown as `2 added` | Replace with `Choose`; drop the other two. |
| 7 | `continueText: "Continue"` | `Prepare` (convert) / `Add to library` (BIOS) | Delete the key. The call site already passes `submitText`; the fallback exists only to render unapproved copy if someone forgets. |
| 8 | `notRecognisedNote` + `errUnrecognised` (two long sentences, near-duplicates) | `The provided System Card 3 file is invalid` + `Expected SHA-1 <hash>` / `Current <hash>` | Delete both. Replace with `` (name) => `The provided ${name} file is invalid` `` and show the two hashes as labelled rows, per the artboard. |

Exact text of the two strings in #8, for the record:

> `notRecognisedNote: "This file matches none of the versions this converter knows about. It will be used anyway and may not work."`
> `errUnrecognised: "This file matches none of the versions this converter knows about, and this input only accepts known files."`

The approved design conveys the same distinction with a status word and a hash comparison.

---

## S3 — Prose in chrome, no artboard support

### 9. `bios.intro` and `bios.placementNote`

> `intro: "Emulator sources declare the files they need that are not games."`
> `placementNote: "These files are not installed yet. A core does not declare where on the device its BIOS files belong, so this tool checks them and stops there."`

`placementNote` is three clauses explaining an internal limitation to the user. Nothing in
any artboard explains a limitation this way. **Delete both** with the panel (S1). The
unresolved placement question belongs in `docs/proposals/bios-placement.md`, where it
already is — not in the UI.

### 10. `bundleHint` and `bundleUnverifiedNote`

> `bundleHint: "Pick a bundle zip published by the project. Everything its manifest names is checked before the source is added."`
> `bundleUnverifiedNote: "A bundle proves only that its files match its own manifest. It is added as unverified."`

`ReposAdd.dc.html` is the approved add flow: two tabs (`URL` · `Bundle zip`), one field,
`Look up`, a `Found` table, `Add`. **There is no hint text anywhere in it.**

**Delete both.** The unverified state is already carried by the badge `bundleUnverified:
"From a bundle, unverified"` — which is fine, and matches how `Repos.dc.html` labels rows
with short chips (`curated`, `Active`, `Installed`).

### 11. `errBundleConflict`

> `"This project is already added from its repository. Remove that source first to import a bundle for it."`

A sentence plus an instruction. **Shorten to `"Already added from its repository."`** The
user can see the existing row; telling them to remove it is the UI's job, not the string's.

### 12. `bundleReimport`

> `"Import the bundle zip again to install from it."`

**Shorten to `"Re-import to install"`** — it labels an action, so it should read as one.

### 13. Wizard flash-floor strings — *written by the manager, not an agent*

> `tooSmallAlreadyStock: "This device has ${mb} MB of external flash, below the 8 MB Retro-Go needs, and it is already running its original firmware — so Guided Setup has nothing to offer. The Advanced tab is not restricted."`
> `tooSmallForRetroGo: "This device has ${mb} MB of external flash. Retro-Go needs at least 8 MB, so Guided Setup only offers returning to stock firmware. The Advanced tab is not restricted."`
> `tooSmallForDualBoot: "Dual boot needs at least 16 MB of external flash; this device has ${mb} MB."`

Three sentences, two sentences, one sentence. The chooser artboard's entire secondary copy
is **`Something else?` / `Use the Advanced tab`** — a fragment and a link.

**Action:** cut to the fact and reuse the existing escape hatch that is already rendered
directly beneath them:

- `tooSmallForDualBoot` → `` (mb) => `Dual boot needs 16 MB. This device has ${mb} MB.` ``
- `tooSmallForRetroGo` → `` (mb) => `Retro-Go needs 8 MB. This device has ${mb} MB.` ``
- `tooSmallAlreadyStock` → `` (mb) => `Retro-Go needs 8 MB. This device has ${mb} MB.` `` —
  the "already stock" case does not need its own sentence; the chooser is simply empty and
  the existing `Something else? Use the Advanced tab` line already covers the way out.
  That collapses three keys to two across seven files.

Dropping "The Advanced tab is not restricted" is deliberate: the artboard already puts
`Use the Advanced tab` on screen, so the sentence restates a link the user can see.

### 14. `roms.gameDetailsPanel.coverArt.errNoOriginalSystem`

> `"This title does not publish an original system, so no cover can be looked up for it."`

Causal explanation of an internal rule. **Shorten to `"No original system published."`** —
it appears in the preview box where the cover would be, so the consequence is visible.

---

## Not defects

- `bios.needRequired` / `needOptional` / `notFound` / `foundOnDevice` / `foundInFolder` —
  short factual labels matching the artboards' `required` / `optional` / `Found` vocabulary.
  They survive wherever the BIOS status is re-surfaced. Lowercase `required`/`optional` to
  match `ModalFilesBios`.
- `importing: "Checking the bundle..."` — matches the artboards' progress idiom.
- `errBundleInvalid`, `errBundleMissingFile` — single factual clauses.
- `filePrompt.extensionsHint` (`Usually .sfc .smc`) and `maxSizeHint` (`Up to 4 MB`) — the
  artboard carries an equivalent per-input hint line (`US (NTSC) cartridge dump.`,
  `syscard3.pce or syscard3.bin`). Keep.
- `filePrompt.errMissing`, `errNotRepeatable`, `errUnusable`, `errRead` — short, factual,
  one clause each.
- `filePrompt.repeatableNote: "More than one file can be added."` — borderline. The
  artboard conveys this with the count (`2 added`) and the `optional` chip rather than a
  sentence. Recommend deletion, but it is the least offensive of the prose strings.

---

## One thing to check that is outside this audit

`ReposDetail.dc.html` shows an **`Installs to` / `/roms/homebrew`** row. The BIOS placement
proposal argues placement cannot be derived — worth confirming the two are consistent
before the proposal is finalised.
