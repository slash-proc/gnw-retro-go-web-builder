# Dark-theme contrast PAIRS audit

Scope: `apps/web/src/lib/**/*.svelte`, `apps/web/src/App.svelte`, `apps/web/src/styles/*.css`.
Date: 2026-09-08. Branch: `design/ui-mockups` worktree `wt-darkpairs`.

The defect hunted here is **not** "a hardcoded colour". It is a **pair**: one half of a
contrast pair themed, the other half not.

## Method (and how comments were excluded)

The sweep is a Python pass, not a grep. For every file it:

1. takes only the `<style>` region(s) (`<style ...>(.*?)</style>`) for `.svelte`, whole file for
   `.css`;
2. **blanks every `/* ... */` run in place**, substituting spaces for non-newline characters so
   byte offsets — and therefore reported line numbers — stay exact. This is the step the earlier
   "118 hardcoded colours" sweep skipped: 105 of its 118 hits were prose *inside* comments
   (e.g. tokens.css's own long explanations, which name dozens of hexes);
3. matches paint properties only (`color`, `background*`, `border*`, `fill`, `stroke`,
   `box-shadow`, `outline*`, `caret-color`, `accent-color`, `color-scheme`, `text-shadow`, and
   custom-property definitions) and discards `none|inherit|transparent|currentColor`.

A second pass did the same over **markup** (with `<style>` and `<!-- -->` stripped) for
`fill=`/`stroke=` attributes and inline `style=`.

Result outside `tokens.css`: **3** hardcoded-literal `background` declarations
(`GeometryBar.svelte` partition fills `#1565c0/#8d6e63/#6a4ca5/#546e7a`, `OverviewTab.svelte:1044`
`#000` behind a screenshot `<img>`, and the rgba modal scrims), and a handful of `#fff`/`#ffffff`
inks that sit on saturated *themed* fills. There is no hard-literal panel/surface background
anywhere in the app.

## 1. Which tokens have a dark override

Derived by diffing the custom-property names defined in `:root` against those in
`@media (prefers-color-scheme: dark) :root:not([data-theme="light"])` **plus**
`:root[data-theme="dark"]` (the two dark blocks are identical by design — tokens.css:239-250
explains why).

- 72 properties defined in `:root`; 34 have a dark override; 38 do not; **0 dark-only**
  (nothing is defined in dark that is missing from light).
- Of the 38 without an override, 31 are non-colour (`--fs-*`, `--pad-*`, `--r-*`, `--grid-*`,
  `--page-pad-*`, `--maxw`, `--label-track`, `--font-*`).
- The remaining 7 are colour-bearing and each is deliberate:

| Token | Why no dark override is correct |
|---|---|
| `--ink-on-face` `#161616` | ink printed on a *device face* (silver cap, amber chip) that is the same colour in both themes — tokens.css:36-40 |
| `--seg-games` / `--seg-saves` / `--seg-free` | aliases (`var(--zelda-green)`, `var(--silver-edge)`, `var(--surface-sunk)`) — they follow their targets automatically |
| `--status-red` / `--status-yellow` / `--status-green` / `--status-gray` | the connection LED; saturated indicator colours, no text ever sits on them |
| `--chip-inset` / `--chip-inset-soft` | `rgba(0,0,0,…)` inset shadows, not colours |

So: **every colour token that needs to flip, flips.** No pair defect in this audit is caused by
a missing token override.

## 2. `color-scheme` — checked, present, correct

`tokens.css:237` `color-scheme: light` in `:root`; `:287` and `:326` `color-scheme: dark` in both
dark blocks. It is declared on `:root` and `color-scheme` inherits, so every browser-painted
control (native checkbox/radio, popup lists, scrollbars, focus rings) is UA-painted dark when the
dark theme is live. **Nothing to fix here.**

The owner's original language-dropdown complaint was *not* a missing `color-scheme` — as
`DeviceHeader.svelte:454-465` records, the old native `<select>` had `background: none`
(transparent) plus an author `color: var(--ink-soft)`; an author-declared `color` wins for option
text and a transparent author background is not a dark one, so `color-scheme: dark` could not
rescue it. That control is now a custom `.lang-menu`/`.lang-item` list on `--surface`/`--ink`.
The same defect in `RangeField.svelte`'s unit `<select>` was fixed the same way
(`RangeField.svelte:131-145`: `background: transparent` → `var(--surface)`).

Re-checked every remaining native control for that exact shape. All are clean — each declares a
themed background *and* a themed ink:

| Control | file:line | Paint |
|---|---|---|
| `.cover-select` | `lib/views/GameDetailsPanel.svelte:1954` | `background: var(--surface); color: var(--ink)` |
| `.detected-game-select` | `lib/views/GameDetailsPanel.svelte:1811` | same |
| `.variant-select` | `lib/views/GameDetailsPanel.svelte:2260` | same |
| `.core-version-select` | `lib/views/RomManagementTab.svelte:2646` | same |
| `.vpick` / `.vpick option` | `lib/views/Sources.svelte:988` | same (options explicitly themed) |
| `input, select` | `lib/advanced/RomSection.svelte:1101` | same |
| `input[type="text"]` | `lib/ui/AddSource.svelte:286`, `lib/ui/AddSourcesModal.svelte:220` | same |
| `.manual-input-*` | `lib/views/GameDetailsPanel.svelte:1797` | same |

No `accent-color`, no `::placeholder`, no `::-webkit-scrollbar` rule exists anywhere in
`apps/web/src` — all three are left to the UA, which is correct given `color-scheme`.

## 3. Genuine pairs found

| file:line | Rule | Themed half | Unthemed half | What you SEE in dark theme |
|---|---|---|---|---|
| `apps/web/src/lib/advanced/OfficialFirmwareSection.svelte:644` | `.disc { background: var(--ink); color: #ffffff }` | the disc fill (`--ink` `#1b1b1b` → `#ececec`) | the numeral (`#ffffff` literal) | The Official-Firmware step spine's numbered discs invert to near-white circles while the "1"/"2" inside stays white — the step numbers disappear entirely (~1.1:1). **FIXED** |
| `apps/web/src/lib/ui/GeometryBar.svelte:233` | `.littlefs span, .littlefs-changed span { color: var(--ink-on-face) }` over `background: var(--seg-saves)` (`:262`) | the fill (`--seg-saves` → `--silver-edge` `#9a9aa0` → `#6b6b71`) | the ink (`--ink-on-face` `#161616`, deliberately never flips) | The "Cores & saves" label on the storage bar goes from ~6.5:1 to ~3.6:1 — legible but noticeably muddier at 11px/600. **NEEDS-OWNER-DECISION** (see below) |

### Why the GeometryBar one is not fixed here

`--ink-on-face` is correct wherever it sits on `--silver` (`#c9c9cd`/`#9a9aa0` — ~6.5:1 in both
themes: `StatusChip.svelte:90`, `SplitButton.svelte:136`, `DeviceControls.svelte:190`,
`RomManagementTab.svelte:2626`). `--seg-saves` is the *darker* `--silver-edge`, and it is the one
consumer where the pairing degrades in dark. Flipping the label to `#fff` would fix dark (~5.1:1)
and break light (~2.8:1 — which is exactly why `GeometryBar.svelte:229-231` chose dark ink in the
first place). Every unambiguous fix therefore needs either a new theme-flipping "ink on the saves
segment" token or a palette change, both of which are out of scope for a contrast-bug pass.

## 4. Explicitly checked and found NOT to be defects

- **`#fff`/`#ffffff` on saturated themed fills** — `Button.svelte:70,129`, `SplitButton.svelte:122`,
  `StatusChip.svelte:72,78`, `Sources.svelte:811`, `GameDetailsPanel.svelte:1899,2003,2292`,
  `RomManagementTab.svelte:2638,3005`, `GeometryBar.svelte:221,239`, `Carousel.svelte:536`,
  `RomSection.svelte:1093`, `OfficialFirmwareSection.svelte:775`, and the `stroke="#fff"` check
  glyphs in `ConnectGateModal.svelte:65` / `FolderGateModal.svelte:38,66`. The fills
  (`--action-red`, `--zelda-green`, `--info-blue`, `--model-accent`, `--danger`) do flip, but they
  stay mid-to-dark saturated colours in both theme blocks, so white stays the right ink. Both
  halves are effectively themed; not pairs.
- **`Button.svelte:107-108` `.ink-solid`** — `background: var(--ink); color: var(--surface)`. This
  is the *correct* form of the `.disc` bug and is the precedent the fix follows.
- **`background: var(--ink)` fills with no text** — `Carousel.svelte:496` (scrubber handle),
  `GameDetailsPanel.svelte:2053` (progress fill), `RomManagementTab.svelte:2740` (3px dot). No
  contrast pair exists.
- **`GeometryBar.svelte:278-287`** — four hardcoded partition fills (`#1565c0`, `#8d6e63`,
  `#6a4ca5`, `#546e7a`). Unthemed, but they carry the unthemed `#fff` label: self-consistent in
  both themes. A palette question, not a pair bug.
- **`OverviewTab.svelte:1044` `background: #000`** — the letterbox behind a device screenshot
  `<img>`. Deliberately theme-independent; the image is the content.
- **rgba scrims** — `ModalShell.svelte:63`, `GameDetailsPanel.svelte:2075`, `Carousel.svelte:510`
  and the assorted `rgba(0,0,0,…)` shadows/`rgba(255,255,255,…)` bevels. Alpha over whatever is
  beneath; they compose correctly in both themes by construction.
