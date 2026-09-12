# Audit: implementation structure vs the approved artboards

> ## Standing, as of 2026-09-08: mostly historical, partly still the only home
>
> **Do not measure conformance against this document.** `docs/CONFORMANCE.md` is the live
> scoreboard and `docs/audit-artboard-conformance-a.md` / `-b.md` are the element-by-element
> walks that replaced it. This file is a *findings list*; its "38 of 46 closed" was quoted as
> progress once and was wrong for exactly that reason — the surveys then found hundreds of
> deltas it never looked for.
>
> **It is not dead, though, and must not be deleted.** Two things keep it live:
>
> 1. **The surveys defer to it by finding number rather than re-reporting.** Survey A states
>    this in its "Relationship to `docs/audit-ui-conformance.md`" note and excludes those rows
>    from its own counts. So for the findings the surveys point at — the Guided per-step
>    descriptions, Overview's dynamic region order, the empty bank card, the Landing summary
>    row, the Wizard's unbacked chooser controls, the busy-lip decision, the mode switch — the
>    *text of the finding lives only here*. Following a survey pointer lands in this file.
> 2. **A handful of findings are recorded nowhere else at all.** Listed under
>    *Live and untracked elsewhere* below.
>
> Everything else — the S0–S5 findings marked FIXED, and the closed S6/S8 items — is history.
> Keep it: it records why several rejected ideas were rejected.
>
> ### Live and untracked elsewhere
>
> Verified 2026-09-08 by searching both surveys, `docs/CONFORMANCE.md`, `docs/BLOCKED-AUDIT.md`,
> `docs/DECISIONS-MAP.md`, `docs/AUDIT_NOTES.md` and `STATUS.md` for each open finding's number
> and for its subject by name. These matched nothing:
>
> - **S6.2** — `StubLoadModal.svelte` has no artboard. (The component is named in other
>   documents; the *unbacked-surface* question is not.)
> - **S6.3** — `ConfirmModal.svelte` has no artboard. Survey B mentions it only by quoting a
>   line of this file.
> - **S6.9** — ROMs `.gate-empty` no-folder state, unbacked.
> - **S6.10** — ROMs `spaceAlertMessage` modal, unbacked.
> - **8.2** — the two literal gradient buttons in `GameDetailsPanel` that match no token.
> - **8.12** — no `--shadow-modal` token.
> - **8.15** — whether `ReposDetail`'s `Installs to` row and the BIOS-placement proposal agree.
> - **Some of the 19 S7 items** — the surveys cite "S7" generically but track no individual
>   item, and both say plainly that they rendered nothing either. Which of the 19 are still
>   live, and which a standing instruction has already settled, is worked through in
>   *Reconciliation against HANDOVER §3* at the head of S7. **The dark theme (S7.16-18) is
>   not among the live ones** — the owner ruled on it (*"looks good, don't sweat it"*) and
>   asked us to stop listing it.
>
> Every bullet above is a question this side can answer or a mockup this side owes — not one
> to hand back. Where a ruling already covers an item it is marked in place; see the
> reconciliation notes under S6, S7 and S8.
>
> **8.14's gaps 3–7 are the exception**: they are tracked in `docs/audit-write-progress.md`,
> their own document. Read them there.
>
> ### 16 findings cite an artboard that `31cc2f7` replaced
>
> `31cc2f7` re-synced 19 boards from the published canvas after the repo copies had drifted a
> generation behind; `e68d6f1` / `570a196` caught four more. Two shipped defects came from
> building to superseded board text. Every finding below cites one of those boards and was
> written before the sync, so **its quoted artboard values may be dead text**:
>
> **1.2, 1.6, 3.14, 5.1, 5.2, 5.3, 5.4, 5.5, 5.9, 5.10, 5.12, 5.13, S6.1, 8.3, 8.5, 8.6.**
>
> Re-read the board before acting on any of them. The two most affected are called out in
> place, below.


Scope: the redesign as it stands on `agent/wt-conform` (branched from `design/ui-mockups`).
Compared against the `.dc.html` artboards on the design canvas and the design-language rules
stated in `docs/design/mockups/README.md`.

**Standard applied:** a section, control, state, or design-language rule is a defect if the
artboard shows it and the implementation lacks it (or vice versa). Copy defects are out of
scope — `docs/audit-invented-copy.md` covered those and they are fixed.

**Method and its limit:** this was read entirely from markup and CSS. **Nothing was rendered
in a browser.** Every finding below is one that can be established statically; a separate
list at the end says what genuinely cannot be.

**Counts:** 5 cross-cutting defects, 41 per-screen defects, 12 components/states implemented
with no artboard behind them, 1 outright rendering bug.

**The one-line verdict:** the *routing and information architecture* landed well — the
Firmware rail, the ROMs footer dock, the summary-row order, the tab structure are all right.
What did not land is the **visual language**. The de-boxing pass was applied to roughly two
screens and skipped on the rest; the 12-column grid was never built; the gold lip is
inverted; and the bottom half of the Library tab will not survive a dark-theme toggle.

---

---

## Re-audit, 2026-09-07

The original audit above was written on `agent/wt-conform`. Roughly eighty commits have landed
since (`git log --oneline design/ui-mockups..HEAD`), many of them naming a finding number in
their subject. This pass re-read every finding against the code at `f37b3b6` and against the
42 artboards now in `docs/design/mockups/`. **No application code was changed by this pass.**

Each finding carries a `> **STATUS:**` block giving one of:

- **FIXED** — no longer true; a commit is named where `git log` made it cheap to find.
- **OPEN** — still true as written.
- **WRONG** — the finding is mistaken; the corrected statement is given.
- **SUPERSEDED** — measured against an artboard generation that no longer governs.
- **BLOCKED** — needs an owner decision or an artboard that does not exist.
- **IN PROGRESS** — being implemented on another branch right now; not judged here.

> **This whole "two generations" paragraph is obsolete (2026-09-08).** `31cc2f7` re-synced the
> repo boards from the published canvas: `Main`, `Roms`, `Guided`, `Firmware`, `Dump`,
> `BackupPatch*` and the rest now draw the app's **four** tabs, not three. There is no older
> generation left in `docs/design/mockups/`. Every "measured against the older generation"
> caveat below, and the SUPERSEDED-count note that follows, rest on a split that no longer
> exists. Left in place because the reasoning it records is still worth reading.

**The artboards are two generations.** `RomsNewSystem.dc.html` and `RomsSdNoCard.dc.html` are
the newer generation and the only ones showing the app's real four tabs (Overview / Firmware /
Sources / Library). `Main.dc.html`, `Roms.dc.html`, `Guided.dc.html`, `Firmware.dc.html` and
the `BackupPatch*` family are older (three tabs, and they carry the Guided/Advanced mode
switch). Where the two disagree, the newer generation wins. Findings measured against an older
artboard where a newer one covers the same surface are flagged in their status block.

New gaps found by later work that the original audit never had are in **S8**, at the end.

---

## Re-audit summary — 2026-09-07

Counts over the 46 original findings (S0.1–S5.13 plus the S6 and S7 lists).

| Status | Count | Findings |
| --- | ---: | --- |
| **FIXED** | 38 | 0.1, 0.2, 0.3, 0.4, 0.5, 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.8, 1.9, 1.10, 1.12, 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.8, 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.8, 3.10, 3.11, 3.13, 3.14, 3.15, 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7, 5.2, 5.3, 5.5, 5.6, 5.7, 5.8, 5.9, 5.11, 5.12, 5.13 |
| **FIXED in part** | 2 | 1.11 (grid landed, `height: 500px` residual), 2.9 (two clauses fixed, one WRONG) |
| **OPEN** | 4 | 1.7, 3.9, 3.12, 5.4 |
| **WRONG** | 2 | 2.7, and the third clause of 2.9 |
| **SUPERSEDED** | 0 | see the note below |
| **IN PROGRESS** | 0 | — (5.1 and 5.10 landed as `3b827c1` / `3744532` just after this re-audit) |
| **BLOCKED** | 9 + S7 | S6 items 1, 2, 3, 8, 9, 10, 11, 12; plus S7 in its entirety (19 items, none resolvable without a browser). **This row overstates it** — see the reconciliation notes under S6 and S7: almost none are blocked *on the owner*. |

(The FIXED row lists 52 numbers because several findings had multiple clauses; counted as whole
findings it is 38 fully fixed, 2 partly fixed, 4 open, 2 wrong.)

**On SUPERSEDED: nothing was superseded, and that is itself worth recording.** The
two-generation problem was checked at the one place it could have bitten — the Library tab's
selection model. `grep -c checkbox` over `Roms.dc.html`, `RomsNewSystem.dc.html` and
`RomsSdNoCard.dc.html` is `0` in all three, and the implementation's list rows already end in a
`StatusChip` rather than a checkbox, so the older and newer generations **agree** and no S1
finding falls. The generation split does bite one thing, but it is a *new* gap rather than a
stale finding: the Guided/Advanced mode switch (S8.5), whose type is now taken from an artboard
generation the tabs beside it no longer come from.

### The OPEN findings, in priority order

1. **5.4 — Overview's regions are stacked full-width, and their order is dynamic.**
   Highest, because it is half-done and the code is explicitly waiting on it
   (`OverviewTab.svelte:625-634`). It is also **partly a decision, not a patch**: `extFirst`
   and `bankOrder` have no artboard behind them and every Overview artboard fixes the order,
   so someone has to say whether the dynamic ordering dies before the grid work can finish.
2. **3.9 — per-step description lines in Guided Setup.** The only place the flow explains bank
   behaviour, so it is a comprehension gap and not decoration. Costed higher than it looks: one
   key per step means a **seven-file i18n edit** each.
3. **1.7 — the `RomsNewSystem` "NEW" state.** The whole point of that artboard, but blocked on
   spec (S8.7) before any of it can be built.
4. **3.12 — the Bundle tab's row shape.** Lowest, and **blocked on an owner decision** rather
   than open work: a native `<input type="file">` cannot be styled into the artboard's
   field+button row without a custom wrapper, so the choice is "accept the native control and
   update the artboard" or "commission a wrapper". Nothing should change until that is answered.

Behind those sit the S6 unbacked
surfaces — of which **S6.1, `GameDetailsPanel.svelte`, is by far the largest and is still 2236
lines with no artboard** even after its token sweep — and S8, where the newly recorded gaps live.

### What this pass could NOT determine

Stated plainly, because guessing here would be worse than the gap:

- **Every S7 item.** This pass, like the original, read only markup and CSS. Nothing was
  rendered. **The dark theme (S7.16-18) is settled and is not on that list any more** — the
  owner looked at it and ruled *"looks good, don't sweat it"* (HANDOVER §3). It remains true
  that no pass of ours ever rendered it; that is a fact about our method, not an open
  question, and it must not be put back to him as one.
- **5.1 and 5.10** were not judged at all: `agent/wt-foot` is editing those exact files, so
  their current state is not evidence. Only the extflash-collision half of 5.10 was checked,
  and it is already done.
- **8.10 — whether `HeaderBusy`'s caption or its markup is right.** The artboard contradicts
  itself; no reading of the code can settle it.
- **8.1 and 8.11** — the on-accent ink and the derived dark busy-band values have no artboard
  to check against, because the artboards are light-only.
- **Attribution is best-effort.** Where a hash is named it was found with
  `git log --oneline design/ui-mockups..HEAD` matching the finding number in the subject line;
  a few fixes landed inside broader changes and the hash there is the merge, not the precise
  hunk. No status depends on it — every status also cites the current code.

---

## S0 — Cross-cutting. These are visible on every screen.

### 0.1 The gold is a band, not a 3px lip — the rule is inverted app-wide

> **STATUS: FIXED** (re-audit 2026-09-07). `App.svelte:125-139` is now `background: var(--surface); border-bottom: 1px solid var(--hairline)`, with a single 3px `.lip { background: var(--grad-gold) }` as the header's last child (`App.svelte:96-97`). Commits `9cb8b10` / `a61047a` ("one face-plate lip") and `09c7f7c`.


README, verbatim: *"Gold is a 3px face-plate lip, **not a band**."*

Every artboard header is a light band whose **last child** is the lip:

```html
<div style="height: 3px; background: linear-gradient(180deg, #d9bc5e 0%, #c09a32 100%);"></div>
```

`apps/web/src/App.svelte:100-108` does exactly the opposite — the whole header is gold and
the 3px strip is the model accent:

```css
  .app-header {
    background: var(--grad-gold);
    border-bottom: 3px solid var(--model-accent);
  }
```

This is the single most visible non-conformance in the app: it is on screen at all times, on
every tab, and it is the specific thing the design language names. It is also why
`DeviceHeader`'s `#161616` text is "always-dark chrome" — that exemption exists to serve the
gold band, so fixing this has knock-on effects on `DeviceHeader`/`DeviceControls` colours.

**Action:** make `.app-header` `background: var(--surface)` with `border-bottom: 1px solid
var(--hairline)`, and append a 3px `var(--grad-gold)` strip as the last child. Then re-check
the `#161616` chrome literals in `DeviceHeader`/`DeviceControls`/`StatusChip`/`SplitButton`,
which are currently exempt only because the band is gold. (This list also named `FilePick`;
that component was deleted unreferenced in `863290c`, and the literals now live behind the
`--ink-on-face` token — see `styles/tokens.css:33`.)

The same lip is missing from every modal — see S4.1.

### 0.2 The 12-column grid does not exist anywhere in the codebase

> **STATUS: FIXED** (re-audit 2026-09-07). The grid was built once: `--grid-cols: 12` / `--grid-gap: 32px` / `--page-pad-x: 40px` in `styles/tokens.css:132-134` and `.grid12` in `styles/global.css:75-81`, with `.page-body` at `global.css:99-105`. Adopted by `OverviewTab.svelte:383` (`span 7` / `span 5` at `:746,753`) and `RomManagementTab.svelte:1975` (`span 5` / `span 7` at `:2553,2679`). Commits `8a822af`, `cc65b94`, `2666f1a`. Note the grid is applied per pane, not globally, because the nav band and the Firmware rail are full-bleed — see the comment at `global.css:87-96`.


README: *"**Alignment comes from one 12-column grid**, not from boxes lining up."*

Every artboard body is `padding: 36px 40px 40px; display: grid; grid-template-columns:
repeat(12, minmax(0, 1fr)); gap: 32px`, with children on `grid-column: span 7` / `span 5` /
`4 / span 7`.

```
$ grep -rn 'repeat(12' apps/web/src --include=*.svelte --include=*.css
(no matches)
$ grep -rn 'grid-column' apps/web/src/lib
apps/web/src/lib/ui/StatPanel.svelte:169:    grid-column: 1 / -1;
```

Instead, `App.svelte:110-118` caps the body at `--maxw` (1200px) with `padding: 0 1.25rem`,
and each screen invents its own columns from fixed pixels — `Advanced.svelte:258` `max-width:
1000px`, `RomManagementTab.svelte:2504` `grid-template-columns: 350px 1fr`,
`OverviewTab.svelte:695` `minmax(0,1fr) 320px`. Nothing lines up with anything on another
screen, which is precisely the failure the rule was written to prevent.

**Action:** build the grid once at the `.body` level and convert the per-screen fixed columns
to `span` values. This is the largest single piece of work in this audit and it blocks
several findings below (S1.11, S2.8, S5.4, S5.13).

### 0.3 Three CSS custom properties are referenced but never defined — a real rendering bug

> **STATUS: FIXED** (re-audit 2026-09-07). `grep -rn -- '--bg-soft|--border-light|--bg-hover' apps/web/src` returns nothing; so do `--brand-blue`, `--brand-gold`, `--err`, `--ok`. Commits `6b37021` / `2e07a40`.


```
$ grep -rn -- '--bg-soft:\|--border-light:\|--bg-hover:' apps/web/src
(no matches)
```

They are used seven times, six of them with **no fallback**
(`apps/web/src/lib/views/RomManagementTab.svelte:2593, 2594, 2611, 2615, 2616, 2622`):

```css
  .action-btn {
    background: var(--bg-soft);
    border: 1px solid var(--border-light);
  }
```

`border: 1px solid var(--border-light)` is invalid-at-computed-value-time, so the whole
shorthand resolves to `unset` → `border-style: none`. **Select all / Unselect all currently
render as borderless, fill-less text**, and `.games-pane-header` has neither its tint nor its
divider. This is not a conformance nit; it is broken CSS shipping today.

Four more undefined properties exist but do have fallbacks, so they merely bypass the token
system: `--brand-blue` (`GameDetailsPanel.svelte:1593,1595`, `FileBrowserSection.svelte:244,260`),
`--brand-gold` (`Carousel.svelte:356` → `#f39c12`), `--err` (`GameDetailsPanel.svelte:1146` →
`#c00`), `--ok` (`OfficialFirmwareSection.svelte:578` → `#2e7d32`). None of those fallback
hexes flip in dark theme.

**Action:** replace all seven with real tokens (`--surface-sunk`, `--hairline`/`--rule`), and
delete the four fallback-only properties in favour of `--danger` / `--zelda-green` / `--gold`.

### 0.4 The dark theme is broken below the fold on the Library tab

> **STATUS: FIXED** (re-audit 2026-09-07). None of the named literals survive: `grep -n '#ffffff|#d8d8d8|#1b1b1b|#ececec|#b03030|#b8b8b8|#3a3a3a|#e0e0e0'` over `RomManagementTab`, `Advanced`, `FirmwareRail`, `OverviewTab`, `BankCard`, `StatusChip`, `Wizard` returns only comments quoting artboard values, plus two genuine `color: #ffffff` on-fill inks (`StatusChip.svelte:72,78`, `RomManagementTab.svelte:2835`). Commits `2e07a40`, `fe39c40`, `6d0a8ff`, `b86e1c6`.
>
> **Residual, split out as a new gap (see S8.1):** the surviving `#ffffff` literals are white ink on a saturated fill, for which no `--ink-on-fill` / on-accent token exists. Not a dark-theme break (the fill is saturated in both themes) but still an untokenized literal.


`RomManagementTab.svelte:2629-2769` — the summary tab notch, the drawer, the footer bar and
the install button — is written entirely in light-theme literals:

```css
  .summary-tab { color: #1b1b1b; background: #ffffff; border: 1px solid #d8d8d8; }
  .drawer      { background: #ffffff; border-top: 1px solid #d8d8d8; }
  .bar         { background: #ffffff; border-top: 1px solid #d8d8d8; }
```

Every one of these has a token that flips (`--ink`, `--surface`, `--hairline`). As written,
a user on dark theme gets a white dock and white drawers welded to a dark page — and
`.gname { color: #1b1b1b }` (`:2432`) is near-black text that will sit on `--surface` `#212121`.

The same class of defect, smaller, in: `Advanced.svelte:304` `.tab.active { color: #1b1b1b }`
(near-invisible on a dark tab strip), `FirmwareRail.svelte:132` `.item { color: #3a3a3a }`,
`OverviewTab.svelte:805` `.err { color: #b03030 }`, `BankCard.svelte:163,197-201`
(`#e0e0e0`/`#444`/`#888`), `StatusChip.svelte:96-106` and `RomManagementTab.svelte:2545-2552`
(`background: #333; color: #fff`), `RomManagementTab.svelte:2664` `.meter { background: #ececec }`,
`Wizard.svelte:1113` `.choice:hover { border-color: #b8b8b8 }`.

**Note this is the one finding that has *not* been visually verified in either theme** — but
it needs no rendering to establish, because the tokens exist and are not being used.

### 0.5 `--model-accent` is being used as generic chrome

> **STATUS: FIXED** (re-audit 2026-09-07). Every site the finding named is gone: `ModalShell.svelte:11` defaults `borderColor = "var(--hairline)"`; `AccordionSection.svelte` was deleted outright (commit `f143953`); `ConnectGateModal`, `FolderGateModal`, `Wizard` and `FilePromptModal` no longer reference `--model-accent` at all (`grep -rn model-accent apps/web/src`). Commits `e396b3f` ("bank action is success-green, not the device-model accent"), `8fd0b8f`, `d3d7176`.
>
> Remaining `--model-accent` uses are legitimate: focus rings (`global.css:48`, `DeviceHeader.svelte:340,362`, `OverviewTab.svelte:865,909`, `Landing.svelte:202`, `Wizard.svelte:1415`, `RomManagementTab.svelte:2781`), progress-bar fills (`OfficialFirmwareSection.svelte:956`, `ConfirmModal.svelte:132`, `RomManagementTab.svelte:2613`, `RomSection.svelte:1231`), `Landing.svelte:198`'s hover border and `FileBrowserSection.svelte:383`, and `GameDetailsPanel.svelte` (`:1514,1897,1898,1985,2283`) — which is the unbacked surface of S6.1 and inherits that finding's status rather than this one's. *(Re-verified and re-listed 2026-09-08: this line previously named "the device-model `Badge`", a component deleted in `ef34572`, and its other line numbers had all moved.)*


README: *"**Semantic colour stays semantic.**"* `--model-accent` is the Mario-scarlet /
Zelda-green *device model* mark. It is currently the border colour of every modal
(`ModalShell.svelte:12,55`), the "done" state of both gate-modal checklists
(`ConnectGateModal.svelte:120`, `FolderGateModal.svelte:298`), the active wizard step number
(`Wizard.svelte:1201`), the "required" file badge (`FilePromptModal.svelte:481`), and the
border of every accordion panel (`AccordionSection.svelte:70`).

None of those is a device-model statement. The artboards use `--hairline` for dialog chrome
and `--zelda-green` (`#3e9e4e`) for success/done.

---

## S1 — Library (ROMs) tab

`views/RomManagementTab.svelte` vs `Roms` / `RomsOptions` / `RomsNewSystem` /
`LibrarySummary` / `RomsSdNoCard`.

**What is right, briefly:** the bottom dock is the best-conforming thing in the app. The
footer bar (`:2225-2288`, CSS `:2649-2672`) is `min-height: 72px`, `padding: 0 40px`,
`border-top: 1px solid #d8d8d8`, context left / one action right — exactly the artboard. The
storage meter is fused as a 3px absolute strip that adds no bar height (`:2228`, `:2662-2676`),
which is the specific ROMs exception the README calls out. The summary-tab notch and drawer
shell are byte-for-byte the artboard. The summary row order (`sources/summaryRows.ts:34-42`)
matches `LibrarySummary` and is pinned by a test.

### 1.1 Select all / Unselect all render unstyled — see S0.3. **Rendering bug, user-visible.**

> **STATUS: FIXED** — follows S0.3. The undefined properties are gone; `.action-btn` is now a text link (`RomManagementTab.svelte`, S1.3 block). Commit `6b37021`.


### 1.2 Three nested boxes where the artboard has none

> **STATUS: FIXED** (re-audit 2026-09-07). `.layered-panel` is now `padding: 0` and nothing else (`RomManagementTab.svelte:2481-2483`, with a comment citing this finding). `.games-pane:2560-2570` is `background: var(--surface); border-radius: var(--r-card); overflow: hidden` — no border, no shadow. `.info-pane:2571-2580` is bare type on the ground, no surface. Commits `f81b19a` / `5dbcaff`.


`Roms.dc.html`'s only surface is the list's own white ground: `background:#ffffff;
border-radius:6px; padding:2px 16px` — **no border, no shadow**. The coverflow has no
container at all.

The implementation wraps everything (filters, list, carousel, info block **and the dock**) in
a bordered shadowed card, then boxes two children again inside it:

```css
  .layered-panel { background: var(--surface); border-radius: var(--r-card);
                   box-shadow: var(--shadow-card); padding: 1rem;
                   border: 1px solid var(--surface-sunk); }   /* :2440 */
  .games-pane   { border: 1px solid var(--surface-sunk); }    /* :2519 */
  .info-pane    { border: 1px solid var(--surface-sunk); }    /* :2528 */
```

None wraps "a real object". The card border also means the footer bar's `border-top` is a
rule *inside* a card rather than a region edge, which is what the 72px bar is supposed to be.
Note also `--surface-sunk` is a *fill* token used as a border colour — in dark theme it is
`#101010`, a black outline.

**Action:** strip all three borders/shadows; give the list its white ground with radius only.

### 1.3 The list header is a different control, most of it unbacked

> **STATUS: FIXED** (re-audit 2026-09-07). `RomManagementTab.svelte:1978-1990` renders `<span class="sel-count">{selectedCount(selectedTotal)}</span>` left and `Select all` right; the collapse chevron and `Unselect all` are deleted. `.sel-count:2632-2638` is `--fs-label` / 700 / `--label-track` uppercase, `.games-pane-header:2619-2630` is on the white surface with only `border-bottom: 1px solid var(--rule)`. Commits `3be8351` / `4f2968d`.
>
> One deliberate deviation, documented in the code comment at `:1982-1987`: the in-pane folder button **stays**, because the artboard puts `Change folder` in the tab strip and this view does not own the tab strip.


Artboard: one header row on the white surface — `6 selected` as an 11px/700/`0.11em` uppercase
label left, `Select all` as a **green 13px text link** right, `border-bottom: 1px solid #e0e0e0`.

Implementation (`:1953-2001`): an `<h2>Games</h2>` at 1.1rem in a tinted strip, **plus** a
collapse chevron, **plus** an in-pane folder button, **plus** a separate row of two equal
full-width grey buttons (`.action-btn { flex: 1; padding: 0.5rem; font-weight: 600 }`, `:2600`).

There is **no selection count anywhere**. `Unselect all`, the collapse toggle and the in-pane
folder button appear in no ROMs artboard — the artboard puts "Change folder" in the top nav.

**Action:** add the "N selected" label, demote `Select all` to a green text link, and either
get artboards for collapse / unselect / in-pane-folder or delete them.

### 1.4 Summary grid has no row rules and no measure

> **STATUS: FIXED** (re-audit 2026-09-07). `StatPanel.svelte:135-137` gives every `.sg-row` a `border-bottom: 1px solid var(--rule)`, `:182-184` exempts `.total`, and `:109-114` caps the measure. Commit `a7c567f`.


`LibrarySummary.dc.html` gives every row `border-bottom: 1px solid #ededed` and caps the table
at `width: 560px; margin: 0 auto`, with the caution aside `position:absolute; right:0;
width:270px; border-left:1px solid #ededed`.

`ui/StatPanel.svelte:110-165` has **no row rules at all** (only `.sg-row.total` gets a
`border-top`) and no width cap, so rows stretch the full ~1120px drawer with nothing tying a
label to its figure. The aside stacks underneath instead of sitting beside (`:2207,2211`).
Type is under-scaled: `.sg-name` 13px (artboard 14px/500), `.sg-num` 12px (artboard 14px/13px).

### 1.5 System tag chip is inverted and dark-theme-fixed

> **STATUS: FIXED** (re-audit 2026-09-07). `StatusChip.svelte:95-101` now carries an explicit comment naming this finding and renders the tag at `width: 40px`, 10px/600, `--ink-soft` on a quiet grey — the `#333`/`#fff` pair is gone. Commit `a7c567f`.


Artboard tag: `font-size:10px; color:#5c5c5c; background:#e8e8e8; border-radius:2px; width:40px`
— a quiet grey label. `ui/StatusChip.svelte:96-106`:

```css
  .console { width: 3rem; padding: 4px 6px; border-radius: 4px;
             background: #333; color: #fff; }
```

A near-black chip on every row, far louder than designed, in literals that do not flip. Same
pair at `RomManagementTab.svelte:2545-2552` (`.info-tag`).

### 1.6 Options drawer: no column rules, headings are the wrong object

> **STATUS: FIXED** (re-audit 2026-09-07). `GameDetailsPanel.svelte:1524` is `grid-template-columns: repeat(3, minmax(0, 1fr))` with `:1534-1537` `border-left: 1px solid var(--rule)` on columns 2-3, and the comment at `:1534` quotes the artboard's `#ededed` / `28px`. Commits `f881d6e` / `073ba0c`.


`RomsOptions.dc.html`: `repeat(3, minmax(0,1fr)); gap: 28px`, columns 2-3 carrying
`border-left: 1px solid #ededed; padding-left: 28px`, each heading an 11px/700/`0.11em`
uppercase label **with no rule under it**.

`views/GameDetailsPanel.svelte:1508-1512` has `grid-template-columns: 1fr 1.25fr; gap: 1rem`
— no column rules, wrong ratio, wrong gap. Headings (`:1543`) are `1.1rem` sentence case,
each followed by an `<hr>` (`:1548-1552`) the artboard does not have, using the **structural**
`--hairline` level inside a white surface (should be `--rule` if it stays at all).

The `bare` de-boxing at `:1499-1506` is correct and well-commented — this is the other half
of that same job, unfinished.

### 1.7 `RomsNewSystem` state is not implemented

> **STATUS: OPEN** (re-audit 2026-09-07). `grep -rn 'newSystem|isNew' apps/web/src/lib/views/RomManagementTab.svelte` matches only `isNewHomebrewCover` (`:1542,1548`), an unrelated cover-art concept. The filter buttons at `:1960-1972` are still uniform and no previously-seen-systems state exists.
>
> **Also BLOCKED on a spec.** Implementing this needs persisted "systems seen on a previous scan" state so the app can tell what is new — new behaviour that `RomsNewSystem.dc.html` shows the *result* of but never specifies (when is a system no longer new? does connecting a different device reset it?). Recorded again as S8.7.


The artboard adds, when a scan finds a system not previously present, a filter chip
`WonderSwan 4` with `border: 1px solid #3e9e4e` plus a `NEW` badge
(`background:#3e9e4e; color:#fff; 9px/700 uppercase`). The filter buttons at `:1936-1947` are
uniform and no new-system concept exists in `romSelection.svelte.ts`. Everything else on that
artboard is identical to `Roms`, so this state is the whole point of it.

### 1.8 Meter strip: wrong track colour, one segment instead of two — cosmetic

> **STATUS: FIXED** (re-audit 2026-09-07). `RomManagementTab.svelte:2765-2785`: track is `var(--hairline)` with a comment naming this finding, and two segments (`.meter-fill` `--zelda-green`, `.meter-pending` `--silver-edge`) laid side by side. Commit `a7c567f`.


Artboard: `<div style="height:3px; background:#d8d8d8">` with **two** segments (installed
`#3e9e4e` + pending `#9a9aa0`). `:2664-2676` has one segment on `#ececec` (not a token, and
nearest is `--hairline`/`--rule`), with `#3e9e4e`/`#c8372b` literals for `--zelda-green`/`--action-red`.

### 1.9 `.row { border-bottom: 1px solid var(--surface-sunk) }` (`:2413`) — cosmetic

> **STATUS: FIXED** (re-audit 2026-09-07). `RomManagementTab.svelte:2437-2439` is `border-bottom: 1px solid var(--rule)` with a comment explaining the `--surface-sunk` fill-token mistake. Commit `5dbcaff`.


`#e8e8e8` is none of the three permitted divider levels. A rule inside a white surface is
`--rule`.

### 1.10 Remaining literals where tokens exist — cosmetic, but see S0.4

> **STATUS: FIXED** (re-audit 2026-09-07). Spot-checked every cited site: `.gname`/`.drawer-title` (`:2734-2737`, now `--fs-label` + `--label-track`), the dock button block and `StatPanel.svelte` all read tokens. `grep` over the file finds no remaining light-theme hex except comments quoting artboard values and the on-fill `#ffffff` at `:2835` (S8.1). Commits `fe39c40`, `6d0a8ff`, `a7c567f`.


`:2432-2439` (`--ink`, `--ink-soft`, `--fs-chip`), `:2678-2692` (`--ink`, `--zelda-green`,
`--ink-soft`), `:2700-2702`, `:2711-2716` (`--action-red`, `--action-red-deep`, `--r-btn`,
`--pad-btn`, `--fs-btn`), `:2644` (`.drawer-title` 12px/`0.08em` vs the artboard's
11px/`--label-track` `0.11em`), `StatPanel.svelte:122` (`#8a8a8a` → `--ink-dim`).

### 1.11 Fixed two-pane instead of the grid — cosmetic/responsive

> **STATUS: FIXED, with one residual.** The grid half landed: `.two-pane` is `.grid12` (`:1975`) with `.left-column { grid-column: span 5 }` (`:2553`) and the right pane on `span 7` (`:2679`), and the comment at `:2541-2549` explains the alignment fix. Commit `cc65b94`.
>
> **Residual, still OPEN and cosmetic:** the viewport-independent `height: 500px` survives at `:2550-2552`. No artboard states a height for this row, so this is BLOCKED on a measurement rather than simply open — see S7.2, which is the same box.


`:2504-2511` `grid-template-columns: 350px 1fr; gap: 1rem; height: 500px` against the
artboard's `span 5` / `span 7` with `gap: 32px`. The hard `height: 500px` is independent of
viewport. Blocked on S0.2.

### 1.12 Dead code found while reading

> **STATUS: FIXED** (re-audit 2026-09-07). `grep -n 'AccordionSection|clearSelection|showMissing' apps/web/src/lib/views/RomManagementTab.svelte` returns nothing; `AccordionSection.svelte` no longer exists in `lib/ui/`. Commit `f143953`.


`AccordionSection` imported at `:31` and never used; `clearSelection` (`:274`) never
referenced from the template; `showMissing` (`:281`) is `$state` nothing can set to `true`.

---

## S2 — Sources tab

`views/Sources.svelte`, `ui/AddSource.svelte`, `ui/AdditionalFiles.svelte` vs `Repos` /
`ReposAdd` / `ReposDetail` / `ReposDetailReady`.

**What is right, briefly:** the list itself (`Repos.dc.html`) is a good structural match —
two columns, uppercase captions, white row surface with `#ededed` rules, name/repo/meta left,
version + Active/Inactive in a 104px right column, green-tint selected row with a 2px green
inset marker, footer with the selected name and Configure/Activate.

The *detail* and *add* screens are the problem: both artboards are full-page routes that
replace the list, and neither is implemented that way.

### 2.1 Detail renders **below** the footer bar, producing two action zones

> **STATUS: FIXED** (re-audit 2026-09-07). Detail is now a **replacing view**: `Sources.svelte:256-270` renders the `.dhead` header (title / mono repo / kind chip) with a `← {t.backToSources}` button at `:268`, guarded by `{#if detail}` so the list is unmounted, and the single `<footer class="bar">` at `:504` is the last child. `.bar:680-692` is `min-height: 72px; margin-top: auto; padding: 0 40px; background: var(--surface); border-top: 1px solid var(--hairline)`. The bar's context line at `:505-511` now reads `activeHint` / `notActiveHint` on the detail view. Commits `3f7e55b` / `5d34ead`, `40d1997` / `e7aba7e`.


`ReposDetail`/`ReposDetailReady` replace the whole page body: title (24px) + mono repo path +
a kind chip, `← Back to sources` right-aligned, `max-width: 900px`, and one pinned bar:

```html
<div style="border-top: 1px solid #d8d8d8; background: #ffffff; padding: 0 40px;
            min-height: 72px; margin-top: auto;">
  <span>Not active. Activating adds it to the Library tab.</span>
  <div>Activate</div></div>
```

`views/Sources.svelte:242-261` keeps the list mounted and renders `.details` +
`<AdditionalFiles>` **after** `<footer class="bar">` (`:223-240`). The user gets
list → footer bar → more content, with the Activate button *above* the detail it acts on.
That breaks the README's "one footer bar on every screen" on the screen where it matters most.

Also absent: the detail header, the `← Back to sources` affordance (the only way back is
re-clicking Configure), and the bar's context sentence — the bar shows only
`selected.card?.title` (`:224`).

### 2.2 "What gets installed" section entirely absent

> **STATUS: FIXED** (re-audit 2026-09-07). `Sources.svelte:201-238` builds the `InstallRow[]` from `targets[].artifacts[]` with a type chip and size, rendered at `:380-410`; `installTotal` (`:239-247`, comment: *"The artboard's Total row exists only once every row has a real size (ReposDetailReady)"*) renders the Total row at `:399-403`. Commits `ed87c34` / `b7de74e`.


The artboard devotes a full section to it: one row per artifact with a `binary`/`data`/`built`
type chip, mono filename and size; `built` reads `not built yet` in `#9a9a9a` before prepare
and `12.4 MB` after, and `ReposDetailReady` adds a **Total 13.7 MB** row.

`Sources.svelte:242-258` shows only a `<dl>` of repo URL / ABI / systems. The user has no
answer to "what will this put on my device, and how big is it" — and the entire
before/after payoff of supplying a file (`ReposDetail` → `ReposDetailReady`) is invisible.

### 2.3 Compatibility is a raw `<dl>` and the ABI row is mislabelled

> **STATUS: FIXED** (re-audit 2026-09-07). The three artboard rows are separate and correctly paired: ABI at `Sources.svelte:361` (`{card.abiVersion}`), `Installs to` at `:365-366` (`installsTo`, derived at `:188`, `.mono`), `Published` at `:370` (`published(card.publishedAt)`). Commit `b7de74e` ("fix the ABI/published mislabel").


Artboard: three label/value rows on `#ededed` rules — `Firmware ABI` → `2` (green `#3e9e4e`),
`Installs to` → `/roms/homebrew` (mono), `Published` → `12 Aug 2026`.

`Sources.svelte:244-256`:

```svelte
<dt>{t.abiVersion(selected.card.abiVersion)}</dt>
<dd>{selected.card.publishedAt}</dd>
```

The *label* is "Firmware ABI 2" and the *value* is the publish date — two artboard rows
collapsed into one mismatched pair. No `Installs to` row exists at all.

### 2.4 No version picker / "Get older version"

> **STATUS: FIXED** (re-audit 2026-09-07). A real picker exists: `Sources.svelte:285-345` — the `Version` caption, a bordered `.vbox` (`:795-804`) wrapping a `<select class="vpick">` over `card.versions`, and the `Get older version` affordance at `:343` styled as a green text link (`:832`). Backed by `sources.selectVersion` (`:319`) and `resolveVersion`. Commits `a4f2ad4`, `ac59970`, `45c52a7` / `0bd020c`; parity is pinned by `a409d86`.


Artboard: caption `Version`, a 40px bordered select showing `v1.1.0  12 Aug 2026`, and a
green `Get older version` link. Implementation shows version only as read-only text in the
list row (`:211`). The capability is missing, not just its styling.

### 2.5 Add-source has no look-up step

> **STATUS: FIXED** (re-audit 2026-09-07). `AddSource.svelte:9` documents the two-step path verbatim (*"ReposAdd makes the URL path TWO steps: `Look up` resolves the repo and shows a 'Found' preview"*); `found` state at `:44`, resolve at `:65`, `canAdd` gated on `found !== null` at `:49`, `foundTarget`/`foundAbiOk` at `:103,114`. The mode switch is underlined text tabs — `box-shadow: inset 0 -2px 0 var(--zelda-green)` at `:264`, the only `box-shadow` in the file. Commits `91a72bc`, `3a545f6`, `f881d6e` (dropped the double resolve).


`ReposAdd.dc.html` is a full page: `URL` / `Bundle zip` as **underlined text tabs**
(`box-shadow: inset 0 -2px 0 #3e9e4e`), a 44px field with a red `Look up`, then a **`Found`
preview panel** (Name / Type / Version / `Firmware ABI 2 · supported` in green / `Installs
minesweeper.bin · 34 KB`), and `Add` in the 72px footer.

`Sources.svelte:172-174` + `AddSource.svelte:57-110` render a bordered card wedged between
header and columns; the mode switch is a **segmented button group** (`:122-147`), not
underlined tabs; and submit goes straight from URL to added. There is **no resolve→confirm
step**, so the user never sees what they are about to add. `Add` is inline (`:84`), not in
the bar.

### 2.6 White surfaces carry a `#d8d8d8` border the language forbids

> **STATUS: FIXED** (re-audit 2026-09-07). `.list` is now `background: var(--surface); border-radius: var(--r-card); padding: 2px 18px` (`Sources.svelte:590-592`) — borderless, and with the artboard's `2px 18px`. `grep -n 'border: 1px solid var(--hairline)'` across `Sources.svelte`, `AddSource.svelte`, `AdditionalFiles.svelte` now returns only two hits, both legitimate controls rather than surfaces: the URL input (`AddSource.svelte:292`) and the version-picker box (`Sources.svelte:802`). Commit `45c52a7` / `0bd020c`.


Artboard panels are `background: #ffffff; border-radius: 6px; padding: 2px 18px` — borderless.
`--hairline` is reserved for region edges. Four offenders:
`Sources.svelte:303-309` `.list` (also `padding: 18px` vs `2px 18px`),
`Sources.svelte:405-409` `.details`, `AddSource.svelte:113-121` `.add`,
`AdditionalFiles.svelte:272-277` `.filelist`.

### 2.7 `curated` provenance chip missing

> **STATUS: WRONG** (re-audit 2026-09-07). The chip is in `Repos.dc.html` (six occurrences), but it was **deliberately dropped from the design after that artboard was drawn**. `docs/UX_DESIGN.md:130`, verbatim: *"**Dropped from the design:** the `curated` and `Installed` source chips."*
>
> **Correct statement:** `Repos.dc.html` is stale on this point; the absence of a `curated` chip and of any provenance field in the data model is the intended state, not a defect. Nothing to do. (If the owner later wants a trust signal back, that is a new design request, not this finding.)


Artboard rows carry, for first-party sources only:

```html
<span style="font-size:10px; font-weight:600; letter-spacing:0.06em; text-transform:uppercase;
             color:#5c5c5c; background:#f0f0f0; border-radius:2px; padding:3px 6px;">curated</span>
```

`grep -rn curated apps/web/src` returns nothing — no chip and no data model. The user loses
the trust signal separating a vetted core from a stranger's repo.

### 2.8 Inactive pill is filled where the artboard outlines it — cosmetic

> **STATUS: FIXED** (re-audit 2026-09-07). `Sources.svelte:659-665` is `padding: 3px 12px; border-radius: 999px; background: var(--surface); border: 1px solid var(--ink-faint)`, with a comment at `:658` naming this finding. The second clause is also fixed: `.row` is `align-items: center` at `:602`. Commit `91a72bc`.


Artboard: `background:#ffffff; border:1px solid #c8c8c8; border-radius:999px; padding:3px 12px`.
`Sources.svelte:373-381` uses `--surface-sunk` + `--chip-inset-soft`, no border, `2px 10px`.
Also `.row` is `align-items: flex-start` (`:318`) where the artboard centres, so rows with a
meta line will hang the version/pill at the top.

### 2.9 Token nits — cosmetic

> **STATUS: two clauses FIXED, one WRONG** (re-audit 2026-09-07).
>
> - **FIXED:** `AdditionalFiles.svelte:318` `.filedesc` is `font-size: var(--fs-caption)`; `:339-341` `.fileerr` is `color: var(--danger)` with no dead fallback. Commit `91a72bc`.
> - **WRONG — the required/optional clause.** The artboard renders the two chips **identically**. `ReposDetail.dc.html`, both chips verbatim:
>   ```html
>   <span style="font-size: 10px; font-weight: 600; letter-spacing: 0.06em; text-transform: uppercase;
>                color: #5c5c5c; background: #f0f0f0; border-radius: 2px; padding: 3px 6px;">required</span>
>   <span style="… color: #5c5c5c; background: #f0f0f0; …">optional</span>
>   ```
>   `AdditionalFiles.svelte:304-313` `.need` is `--fs-chip` / 600 / `--label-track` uppercase, `--ink-soft` on `--surface-sunk`, `border-radius: 2px`, `padding: 3px 6px` — that **is** the artboard, for both values. `--tint-required` belongs to a different artboard family (`ModalFilesBios.dc.html`, finding 4.4), where required genuinely is tinted red.
>
>   **Correct statement:** required and optional rendering identically in the Additional-files section is conformant. `--tint-required` must NOT be applied here.


`AdditionalFiles.svelte:338` `font-size: 0.8rem` (`--fs-caption` is 0.875rem);
`:339` `var(--danger, #d32f2f)` — dead fallback whose hex is neither the light nor the dark
token value; `:309` the required/optional badge uses `--surface-sunk` where `--tint-required`
exists and is documented for exactly this, so required and optional currently render
identically.

---

## S3 — Guided Setup

`views/Wizard.svelte`, `ui/AddSourcesModal.svelte`, `views/Landing.svelte` vs `Guided` /
`GuidedRetroGoOnly` / `GuidedStockOnly` / `GuidedSkipBackup` / `GuidedFlashing` /
`GuidedLayout` / `GuidedLayoutStock` / `ModalSources` / `ModalSourcesEmpty` / `Landing1` /
`Landing2`.

### 3.1 The wizard is a bordered white card. No artboard has one.

> **STATUS: FIXED** (re-audit 2026-09-07). `Wizard.svelte:1094-1099` is now `display: flex; flex-direction: column; gap: 2rem; width: 470px; max-width: 100%` — no background, no border, no shadow, and the artboards' 470px column. Commit `637a811`.


All four Guided artboards put the pips and the step spine directly on the `#f4f4f4` ground in
a bare `width: 470px` column — no border, no surface, no shadow. `GuidedFlashing` places it
on the grid at `grid-column: 4 / span 7`.

```css
  .wizard-container {                                    /* Wizard.svelte:1069-1080 */
    background: var(--surface); border-radius: var(--r-card);
    border: 1px solid var(--surface-sunk); max-width: 460px; margin: 4rem auto;
    box-shadow: 0 8px 30px rgba(0, 0, 0, 0.05); }
```

The clearest violation of "a container earns a border only when it wraps a real object" — a
wizard is not an object. It also pushes every child rule onto white instead of the ground,
and `border: 1px solid var(--surface-sunk)` is a fill token used as a border, so in dark
theme this is a black outline.

### 3.2 The stock path is missing its third step

> **STATUS: FIXED** (re-audit 2026-09-07). `Wizard.svelte:862` declares `"remove-rgo"` in `SpineId` and `:865` is `["select-backup", "restore", "remove-rgo"]`; the `OPTIONAL` chip is applied to it at `:968` (`stepOptional = id === "sources" || id === "remove-rgo"`), with the title at `i18n/strings/wizard.ts:127` `removeRetroGo`. Commit `637a811`.


`GuidedStockOnly` has three: 1 Select Backup (Done), 2 Restore Original Firmware (active),
3 **Remove Retro-Go** with an `OPTIONAL` chip. `Wizard.svelte:856-860`:

```js
path === "stock" ? ["select-backup", "restore"] : […]
```

### 3.3 Step status chips (`DONE` / `OPTIONAL`) are not implemented at all

> **STATUS: FIXED** (re-audit 2026-09-07). `Wizard.svelte:985-990` renders `<span class="chip chip-done">{w.spine.chipDone}</span>` / `<span class="chip chip-optional">{w.spine.chipOptional}</span>` on the title's baseline; strings at `i18n/strings/wizard.ts:130-131` (`Done` / `Optional`), CSS at `:1295+`. Commit `637a811`.


Artboards render them on the title's baseline:

```html
<span style="font-size:12px;font-weight:600;letter-spacing:0.05em;color:#3e9e4e;
             text-transform:uppercase;">Done</span>
```

The title is a bare `<h3>` (`:957`); "done" is conveyed instead by a *disabled button* reading
"Patched"/"Backed up" (`:960-969`), and the Sources step has no Optional marker (`:1008-1009`).
Losing "Optional" on Sources is a comprehension hit — users will read it as required.

### 3.4 Step-number marks diverge in all three states

> **STATUS: FIXED** (re-audit 2026-09-07). `Wizard.svelte:1241-1248` is 24×24, `background: var(--surface)`, `border: 1px solid var(--hairline)`, `color: var(--ink-soft)` (pending); `:1258-1262` active is `var(--ink)` fill with a `--surface` digit; `:1264-1267` done is `--zelda-green` with the digit replaced by the check SVG at `:971-979`. All three states now match. Commit `637a811`.


Artboard, all 24px: done = green filled circle with a white check SVG, **no digit**; active =
`#1b1b1b` fill, white digit; pending = white fill + `1px #d8d8d8` border, `#5c5c5c` digit.

```css
  .step-num { width: 2rem; height: 2rem; background: var(--surface-sunk); }  /* :1187 */
  .wizard-step.active .step-num { background: var(--model-accent); }         /* :1200 */
  .wizard-step.done   .step-num { background: var(--zelda-green); }          /* :1204 */
```

32px not 24px; done keeps the digit; active is the model accent (a neutral grey when the
model is unknown) instead of black; pending is a grey fill instead of white-with-border.

### 3.5 Progress pips: wrong shape, wrong colour, wrong place

> **STATUS: FIXED** (re-audit 2026-09-07). `Wizard.svelte:901-904` puts `.pips` **above** the content as the container's first child; `:1112-1121` is a 6×6 `--hairline` dot that becomes a 22×6 `--zelda-green` bar when `.on`. Commits `637a811`, `9b3f734` (the 26px spacer).


Artboard (all Guided screens and both Landings): a 22×6 rounded **bar** in `#3e9e4e` for the
current step, a 6×6 `#d8d8d8` dot otherwise, sitting **above** the content.
`Wizard.svelte:1055-1058, 1253-1266` renders two equal 7px circles **last** in the container,
filled `--ink-mute` grey.

### 3.6 Active step is not typographically promoted

> **STATUS: FIXED** (re-audit 2026-09-07). `Wizard.svelte:1292-1294` `.wizard-step.active .step-content h3 { font-size: 21px }` against the base size — the artboards' 21px active / 16-17px inactive promotion. Commit `637a811`.


Artboards: active title 21-22px, non-active 16-17px. `:1213-1217` is one uniform `1.1rem`.

### 3.7 Version caption next to Install is missing

> **STATUS: FIXED** (re-audit 2026-09-07). `Wizard.svelte:1026-1035` renders the Install button with `{#if latestVersion}<span class="version">{cleanTag(latestVersion)}</span>{/if}` beside it, with the comment *"The artboards run the version you are about to install, in mono, beside the button."* Commit `637a811`.


`Guided` shows `Install` + mono `v1.4.1 (latest)`; `GuidedFlashing` `v1.4.1-44`.
`:1002-1006` renders the Button only — `latestVersion` is fetched (`:382-387`) and used only
in the upgrade label. The user is not told what version they are about to install.

### 3.8 "Run again" on a completed backup step is missing

> **STATUS: FIXED** (re-audit 2026-09-07). `Wizard.svelte:993-997`: a done backup step renders `<button class="run-again">{w.spine.runAgain}</button>` instead of the permanently-disabled Button; string at `i18n/strings/wizard.ts:132`. Commit `637a811`.
>
> Related, and now recorded separately as **S8.8**: the *install* step's done state renders `Reinstall` / `Upgrade to vX` (`Wizard.svelte:1018-1025`) where `ModalSources.dc.html` shows `Run again`. That divergence is deliberate but has no artboard behind it.


Both `Guided` and `GuidedFlashing` show a quiet `Run again` under the done Backup & Patch
step. `:960-969` is a permanently `disabled` Button. (Step 2 correctly has `Reinstall` at `:999`.)

### 3.9 Per-step description lines are missing

> **STATUS: OPEN** (re-audit 2026-09-07). Still missing. `grep -n 'stepDesc|step-desc' apps/web/src/lib/views/Wizard.svelte` returns nothing, and `i18n/strings/wizard.ts:119-138` (`spine`) carries only titles, chips and button labels — no description strings for any step. `GuidedFlashing.dc.html`'s 14px `#5c5c5c` per-step line, including the only place the flow explains bank behaviour, is unimplemented.
>
> Note this is a **seven-file i18n edit** when it lands (one English key per step plus six translations), which is why it is more work than its size suggests.


`GuidedFlashing` gives every step a 14px `#5c5c5c` line ("Goes to bank 2. Your stock firmware
stays put and still boots."). It is the only place the flow explains bank behaviour.

### 3.10 AddSourcesModal: mode switcher is boxed; artboard is underlined text tabs

> **STATUS: FIXED** (re-audit 2026-09-07). `AddSourcesModal.svelte:206` `box-shadow: inset 0 -2px 0 var(--zelda-green)` on the active word, with no border or fill on either. Commit `637a811`.


Artboard: `box-shadow: inset 0 -2px 0 #3e9e4e; padding: 4px 0` on the active word, nothing on
the other. `AddSourcesModal.svelte:190-211` gives both a border and a fill.

### 3.11 AddSourcesModal empty state is a left-aligned hint

> **STATUS: FIXED** (re-audit 2026-09-07). `AddSourcesModal.svelte:141` is `<div class="empty"><span>…</span></div>`, styled at `:242-249` as a centred band with `border-top: 1px solid var(--rule)`. Commit `637a811`.


`ModalSourcesEmpty`: a centred band, `padding: 26px 0; border-top: 1px solid #ededed`, text
`#9a9a9a`. `:141` is `<p class="hint">` — left aligned, no rule, no band, `--ink-soft`.

### 3.12 Bundle tab changes the row shape

> **STATUS: OPEN — but explicitly a platform concession, not a defect to fix blindly.** `AddSourcesModal.svelte:123-133` still swaps the URL row for a stacked `<span class="label">` plus a native `<input type="file">`, where `ModalSources.dc.html` keeps the identical `[field][Add]` row shape.
>
> The audit already flagged this as "worth confirming". Re-audit position: a native file input cannot be restyled into the artboard's field+button row without a custom picker wrapper, so this is **BLOCKED on an owner decision** — either accept the native control (and update the artboard) or commission a wrapper. Nothing should change here until that is answered.


Artboard keeps the identical `[field][Add]` row in both tabs; `:124-133` swaps to a stacked
label + native `<input type=file>`. May be a deliberate platform concession — worth confirming.

### 3.13 Footer divider uses the wrong level — cosmetic

> **STATUS: FIXED** (re-audit 2026-09-07). `AddSourcesModal.svelte:283` and `:303` are both `border-top: 1px solid var(--rule)` — the `--hairline` inside a white surface is gone. Commit `637a811`.


`AddSourcesModal.svelte:293` `border-top: 1px solid var(--hairline)` inside a white surface;
artboard uses `#ededed`. (`.row + .row` at `:273` correctly uses `--rule`.)

### 3.14 Landing: no pips, no card descriptions, wrong rubric

> **STATUS: FIXED** (re-audit 2026-09-07). All four clauses: pips at `Landing.svelte:32-35` (`.pip`/`.pip.on` at `:115-124`); card descriptions at `:46,54,67,77` (`.sub` at `:190`); the rubric is a plain grey sentence at `:135-139` with a comment saying so, and `h1` is `--fs-display-lg` (`:125-132`, with a comment noting the artboard's 34px vs the 32px token); the advanced link is `align-self: flex-start`, `--ink-soft`, no underline and no `--model-accent` (`:194-206`). Commit `637a811`.
>
> **Not covered by this finding and still unimplemented:** `Landing2.dc.html`'s "Modded with / Flash memory / Change" row and its two card icons. Recorded as **S8.6**.


- **No pips** on either Landing step, though `Landing1`/`Landing2` both carry them — the
  two-step entry reads as two unrelated screens.
- `Landing1` cards are icon + 18px title + 14px `#5c5c5c` sub ("Games live on the internal
  flash chip."). `Landing.svelte:35-43` renders icon + label only.
- Artboards put a 15px sentence-case grey line under a 34px title; `:96-103` renders it as an
  11px uppercase small-caps label, and `h1` is `--fs-display` (24px) against 34px.
- `Landing2` places "Manage Device (advanced) →" as a plain 13px grey line **below both
  cards**; `:61-66, 155-163` nests it in the left column as an underlined `--model-accent` link.

### 3.15 Cosmetic token nits

> **STATUS: FIXED** (re-audit 2026-09-07). Spot-checked: `#b8b8b8` and the inline `stroke="#c0c0c0"` are gone from `Wizard.svelte`; the raw `0 8px 30px` shadow is gone with the container (S3.1); `.caution` has `border-radius: 0 3px 3px 0` at `:1339`; `.chooser-title` is left-aligned 28px/600 at `:1124-1128`. Commit `637a811`.


`:1113` `#b8b8b8` hover; `:898` inline `stroke="#c0c0c0"` (should be `--ink-faint`);
`:1079` raw shadow instead of `--shadow-card`; `:1107,1140,1147,1174,1224` literal `6px`/
`16px`/`13px` where `--r-card`/`--fs-body`/`--fs-btn-sm` exist; `.skip-anyway` (`:1250`) and
`.wayout` (`AddSourcesModal.svelte:304`) are underlined where the artboards are not;
`.caution` (`:1228-1236`) is missing the artboard's `border-radius: 0 3px 3px 0`;
`.chooser-title` (`:1083`) is centred at 1.15rem against a left-aligned 28px/600.

---

## S4 — Modals

`ui/ModalShell.svelte`, `ui/FilePromptModal.svelte`, `ui/ConnectGateModal.svelte`,
`ui/FolderGateModal.svelte` vs `ModalFilesConvert` / `ModalFilesBios` / `ModalFilesBiosError` /
`ModalConnect` / `ModalFolder` / `ModalInstallConfirm` / `ModalInstallConfirmSd`.

Every artboard modal has an implementation. Coverage is complete; conformance is not.

### 4.1 The modal frame matches no artboard — every modal in the app

> **STATUS: FIXED** (re-audit 2026-09-07). `ModalShell.svelte:11` defaults `borderColor = "var(--hairline)"`, `:65-67` is `border: 1px solid; border-radius: var(--r-card); box-shadow: 0 12px 40px rgba(0,0,0,0.32)`, and `:46` renders `<div class="gold-lip">` as the modal's FIRST child with `background: var(--grad-gold)` (`:71-73`), clipped by `overflow: hidden`. The comment at `:44-45` cites the artboards. Commits `9cb8b10`, `88dac2c` / `af8f901`.


All seven artboards use one frame: `background: #ffffff; border: 1px solid #d8d8d8;
border-radius: 6px; box-shadow: 0 12px 40px rgba(0,0,0,0.32)`, with a **3px gold lip** as the
first child. `ModalShell.svelte:53-60` renders `border: 2px solid` coloured
`var(--model-accent)` (`:12`), `box-shadow: 0 8px 30px rgba(0,0,0,0.3)`, and **no lip**
(`grep grad-gold` over `lib/**/*.svelte` returns nothing).

Wrong border weight, wrong border colour, and the gold face-plate lip that identifies every
artboard modal is absent app-wide. Same root cause as S0.1.

**Action:** add the lip inside `.modal` using `var(--grad-gold)` (which flips), set
`border: 1px solid var(--hairline)`, default `borderColor` to `--hairline`, add
`overflow: hidden` so the lip clips to `--r-card`, raise the shadow to `0 12px 40px rgba(0,0,0,0.32)`.

### 4.2 The files modals have no footer bar

> **STATUS: FIXED** (re-audit 2026-09-07). `FilePromptModal.svelte:309` passes `padded={false}` to `ModalShell` specifically so the footer rule can run edge to edge (comment at `:463`), and `:356-361` is a real `<footer class="actions">` styled at `:715-717` as *"A real footer band: full-bleed, ruled off the body, outside its padding."* The scoping note held: `ConnectGateModal` / `FolderGateModal` / the install confirm still have no footer rule. Commits `d3d7176`, `7d9ab88`.


`ModalFilesConvert`/`Bios`/`BiosError` put actions in a real footer, full-bleed and outside
the padded body: `border-top: 1px solid #d8d8d8; padding: 16px 26px; justify-content: flex-end;
gap: 16px`. `FilePromptModal.svelte:344` + `:624-629` renders an inline flex row inside the
same padding with no rule.

**Important scoping:** `ModalConnect`/`ModalFolder`/`ModalInstallConfirm` deliberately have
**no** footer rule (`padding-top: 20px|22px`). The small dialogs are correct as-is and must
not gain one — this fix applies only to `FilePromptModal`.

### 4.3 The BIOS error state is loose text, not the artboard's danger panel

> **STATUS: FIXED** (re-audit 2026-09-07). `FilePromptModal.svelte:607-608` is `background: var(--tint-danger); border-left: 2px solid var(--danger)` with the comment at `:597-599` describing the stacked hashes and *"The offending one carries --danger; the expected one is [neutral]"*; markup at `:420-430`, offending hash coloured at `:634`. Commits `f3c5697` / `8fcf80a`.


`ModalFilesBiosError` attaches a tinted panel under the offending row:

```html
<div style="background: #fbf1ef; border-left: 2px solid #8a241b; border-radius: 0 3px 3px 0;
            padding: 9px 12px; margin-top: 9px;">
```

containing a 12px/600 `#8a241b` headline, then `Expected SHA-1` (grey label, `#1b1b1b` mono
value) and `Current` (grey label, **`#8a241b` mono value**), stacked, `word-break: break-all`.

`FilePromptModal.svelte:394-402` renders three unwrapped paragraphs, with
`.hash { display:flex; gap:0.6rem; align-items:baseline }` (`:546-552`) putting label and
hash **side by side on one line**, both in `--ink-soft` (`:553-561`). No tint, no left rule,
and the wrong hash is not coloured — so nothing distinguishes expected from actual. This is
the failure state a user actually hits when they supply the wrong BIOS file.

Both `--tint-danger` and `--danger` already exist and flip correctly.

### 4.4 `required` / `optional` are plain text, not badges

> **STATUS: FIXED** (re-audit 2026-09-07). `FilePromptModal.svelte:522-533` `.tag` is `--fs-label` / 600 / uppercase / `letter-spacing: 0.06em` / `padding: 3px 6px` on `--surface-sunk`, and `:534-537` `.tag.req` is `color: var(--danger); background: var(--tint-required)`. The `--model-accent` colouring is gone. Commit `d3d7176`.
>
> (Contrast S2.9: `--tint-required` is correct **here** — `ModalFilesBios.dc.html` tints required red — and incorrect in `AdditionalFiles.svelte`, where `ReposDetail.dc.html` draws both chips grey.)


Artboard: `color:#8a241b; background:#f6e9e7; border-radius:2px; padding:3px 6px;
font-size:10px; letter-spacing:0.06em; text-transform:uppercase` (required) and
`#5c5c5c` on `#f0f0f0` (optional). `--tint-required` exists in `tokens.css:88` for exactly this.

`FilePromptModal.svelte:474-482` has no background, no padding, 14px instead of 10px, `0.04em`
instead of `0.06em`, and colours required `--model-accent` instead of `--danger` (see S0.5).

### 4.5 Gate-modal rows are boxed; the artboards de-box them

> **STATUS: FIXED** (re-audit 2026-09-07). `ConnectGateModal.svelte:120-125` is now `padding: 0.875rem 0; border-bottom: 1px solid var(--rule)` — no border, no radius, no `--model-accent`. `.mark` (`:127-128`) is an 18px disc, and the check is a stroked SVG (`FolderGateModal.svelte:38,66`) rather than the literal `"✓"`. Commits `8fd0b8f` / `77d470f`.


`ModalConnect`/`ModalFolder` rows are borderless list rows on white, separated only by
`border-bottom: 1px solid #ededed; padding: 14px 0`, with an 18px **filled green circle**
carrying a white check for a satisfied row, and the action as a **green text link**.

`ConnectGateModal.svelte:117-128` and `FolderGateModal.svelte:295-306` are byte-identical:

```css
  .item { padding: 0.75rem 1rem; border: 1.5px solid var(--surface-sunk);
          border-radius: var(--r-control); }
  .item.done { border-color: var(--model-accent); }
```

A checklist row is a step, not an object. The action is an outlined button (`.pick`) instead
of a link, and the check is the literal character `"✓"` (`ConnectGateModal.svelte:72`,
`FolderGateModal.svelte:231,255`) instead of the filled disc.

### 4.6 `ModalFolder` loses the mono path line — minor

> **STATUS: FIXED** (re-audit 2026-09-07). `FolderGateModal.svelte:47` and `:75` render a separate `<span class="item-path">` line below the description, styled `font-family: var(--font-mono)` at `:154-155`. Commit `77d470f`.


Artboard shows three stacked lines: title, description, then `~/roms` in
`ui-monospace; font-size:12px`. `FolderGateModal.svelte:223-228` *replaces* the description
with the folder name when selected, in the same non-mono 0.75rem style as the hint.

### 4.7 Extras and omissions — cosmetic

> **STATUS: FIXED** (re-audit 2026-09-07), all five bullets:
> - The extensions/max-size hints line is gone; `spec.maxBytes` now appears only inside error text (`FilePromptModal.svelte:180,207`).
> - `:395-408` renders the `Choose` cap only when `spec.repeatable || good.length === 0`, and repeatable inputs get the 12px square `+` SVG instead.
> - `:438-450` chips show `variantName(spec, slot.variantId)`, with `:654-656` commenting *"A chip is a filled token, not an object: no border"*; the previously-captured-but-unused `variantId` is now displayed.
> - Widths: files modal `maxWidth="38.75rem"` = 620px (`:309`); both gates `maxWidth="26rem"` = 416px (`ConnectGateModal.svelte:55`, `FolderGateModal.svelte:25`). All three now match their artboards.
> - Token nits: no `var(--danger, #d32f2f)` remains in `ConnectGateModal`; `--font-mono` is used rather than an inline stack.
>
> Commits `d3d7176`, `7d9ab88`, `af8f901` / `88dac2c`.
>
> One item from the original list is **deliberately not closed** and stays a gap: `ModalShell.svelte:67`'s modal shadow is still a literal with no dark-theme variant — no `--shadow-modal` token was added. Recorded as S8.12.


- `FilePromptModal.svelte:369-374` adds an extensions/max-size hints line no artboard has
  (in `ModalFilesBios` the accepted filenames *are* the description).
- `:382-390` always renders the `Choose` cap; both artboards drop it for a satisfied
  non-repeatable input (showing only ✓ Found), and use a 24px square outline `+` for
  repeatable ones.
- `:408-420, 580-602` "Added" chips are bordered boxes on white showing filename + size; the
  artboard chips are `#f0f0f0`, borderless, showing **variant name** + filename
  (`German  zelda3_de.sfc`). `slot.variantId` is captured at `:220` and never displayed.
- Widths: files modal `34rem`/544px vs artboard 620px (`:301`); gates `28rem`/448px vs 416px
  (`ConnectGateModal.svelte:55`, `FolderGateModal.svelte:210`). Install confirm is correct.
- Token nits: `ConnectGateModal.svelte:176` dead `var(--danger, #d32f2f)`; `:142`/`FolderGateModal.svelte:320`
  `0.75rem` (`--fs-micro`); `:170`/`:363` `1rem` (`--fs-body`); `FilePromptModal.svelte:491`
  inline mono stack (`--font-mono`); `:586` `border-radius: 3px`; `ModalShell.svelte:57`
  hardcoded shadow with no dark-theme variant (consider a `--shadow-modal` token).

---

## S5 — Overview / Firmware (Advanced) / Header

`views/OverviewTab.svelte`, `views/Advanced.svelte`, `advanced/*`, `ui/DeviceHeader.svelte`,
`ui/BankCard.svelte`.

**What is right, briefly:** the **rail landed correctly** — `FirmwareRail.svelte`'s two
groups, their order, the six ids and the `inset 2px 0 0 var(--zelda-green)` selection marker
match `Firmware.dc.html` essentially markup-for-markup. Each rail item is one route and one
file, as the README requires. `AccordionSection` is gone from the Firmware tab. The Expert
group is gone. External flash **is** labelled bank 0
(`i18n/strings/shared.ts:96`, `advanced/addr.ts:58-68`).

### 5.1 No 72px footer bar on any Advanced screen

> **STATUS: FIXED** — landed as `3b827c1` after this re-audit was written. The bar is declared per section with `lib/advanced/PaneFooter.svelte` and rendered by `FirmwareRail` as the pane column's second child (`lib/advanced/paneFooter.svelte.ts`), because the artboards' pane column is `justify-content: space-between` with the bar OUTSIDE the capped 880px body. Adopted by Write, Dump, Erase, File browser and Backup & patch; Erase and the cross-model patch use the destructive outline button, per their artboards.
>
> Two parts deliberately NOT adopted, both now tracked in S8: `FileBrowser.dc.html`'s "Re-read partition" (no such handler exists — wiring one is new device-touching behaviour), and `Firmware.dc.html`'s Install-pane bar (it carries an "Advanced layout" affordance and a split button with a dropdown caret).
>
> For the record only: at `f37b3b6`, `grep -rn 'min-height: 72' apps/web/src/lib` returns `Sources.svelte:685` and `RomManagementTab.svelte:2759` — so the ROMs dock plus the Sources bar (added by S2.1), and nothing in `lib/advanced/`.


Every Advanced artboard ends with the same bar: `border-top: 1px solid #d8d8d8;
background: #ffffff; padding: 0 40px; min-height: 72px; justify-content: space-between`.

```
$ grep -rn 'min-height: 72' apps/web/src/lib
apps/web/src/lib/views/RomManagementTab.svelte:2702
```

One screen in the app has it. Everywhere else the primary action is a loose inline
`<Button variant="action">` at the bottom of a flex column: `FlashSection.svelte:165`,
`DumpSection.svelte:183`, `EraseSection.svelte:198`, `OfficialFirmwareSection.svelte:~470`.
`FirmwareRail.svelte:144` `.pane { min-width: 0 }` has nothing to anchor a bar to.

Note Erase and `BackupPatchCross` use a **destructive outline** footer button
(`border: 1.5px solid #8a241b; color: #8a241b`), not the red fill.

### 5.2 The flash-range unit picker does not exist; the quick-fill chips the README retires are still there

> **STATUS: FIXED** (re-audit 2026-09-07). A new component, `lib/advanced/RangeField.svelte`, is the unit picker; its header comment at `:3-12` quotes the README rule verbatim and explains the hex/KB/MB round-tripping (`type Unit = "hex" | "kb" | "mb"` at `:16`, `SCALE` at `:30`). `grep -n 'qf\b|quickFill' apps/web/src/lib/advanced/DumpSection.svelte` returns nothing — the retired chips are gone. Commits `55f1444` / `d82ef34`.


README, verbatim: *"Start + size with a unit picker (hex / KB / MB) **replaces the quick-fill
buttons**."* `Dump.dc.html` shows two 40px fields each with an inline unit segment
(`border-left: 1px solid #d8d8d8` + `hex`/`MB` + chevron), size as `2.51`.

`advanced/DumpSection.svelte:152-162` has a plain `Length` input plus the retired chip row:

```svelte
<button class="qf" …>{locale.t.dumpSection.quickFillWholeRegion}</button>
<button class="qf" …>{locale.t.dumpSection.quickFill128Kib}</button>
<button class="qf" …>{locale.t.dumpSection.quickFill1Mib}</button>
<button class="qf" …>{locale.t.dumpSection.quickFillStockOfw}</button>
```

`FlashSection.svelte:118-120` has a bare `Offset` input and no unit picker either. The only
unit-input pattern in the codebase is `RomSection.svelte:897-904`, a fixed `MB` suffix.

### 5.3 Bank is still a `<select>`; the bars are not the shortcut the README describes

> **STATUS: FIXED** (re-audit 2026-09-07). The `<select>` is gone from all three sections (`grep -n '<select' FlashSection DumpSection EraseSection` → no hits). Bank is now **derived from the address**: `FlashSection.svelte:35` `const bank = $derived(bankForAddr(startAddr, device.extSizeMB))`. `FlashSection` now renders bars (`:135`, `:145`) and click-to-fill works, so `Write.dc.html`'s "Click a partition to fill the destination" holds. Commits `64ef0eb`, `b66d690`, `aea8102` (which also bounded `bankForAddr` and added a test).


README: *"the flash bars are a shortcut that writes into the range fields; the fields are the
source of truth… Bank 1 and bank 2 are divided."* Write/Dump/Erase/FileBrowser artboards all
show two labelled 34px bars — `Internal flash · bank 1 · bank 2 … 2 × 256 KB` and
`External flash · bank 0 … 64 MB` — with in-segment labels ("Bank 1 · stock", "Bank 2 ·
Retro-Go", "FrogFS", "LittleFS", "Free") and the selected segment ringed
`inset 0 0 0 2px #3e9e4e`.

`FlashSection.svelte:113-117` and `DumpSection.svelte:144-148` use
`<select class="mono" bind:value={bank}>`; `DumpSection.svelte:120-138` /
`EraseSection.svelte:149-167` pass raw hex addresses as `leftLabel`/`rightLabel` to
`GeometryBar` instead of the segment labels. **`FlashSection` renders no bars at all**, so
Write image has no click-to-fill — directly contradicting `Write.dc.html`'s "Click a
partition to fill the destination".

### 5.4 Overview's regions are stacked full-width, and their order is dynamic

> **STATUS: OPEN** (re-audit 2026-09-07). Partially converted, and deliberately stopped half-way. `OverviewTab.svelte:87` `extFirst` and `:89` `bankOrder` still exist, and `:445-451` still flips the region order at runtime. The dashboard half landed (`.left-col { grid-column: span 7 }` `:746`, `.screenshot-col { span 5 }` `:753`, `.dashboard { display: contents }` `:742`), but `.regions` and the log accordion are still full-width rows underneath.
>
> The code says so explicitly at `:625-634`: *"Moving them into their artboard columns means splitting `.regions`, which is entangled with audit 5.4 (`extFirst`/`bankOrder` have no artboard behind them at all) — so it is deliberately left to that finding, not done half-way here."*
>
> **This makes 5.4 partly BLOCKED:** the layout work cannot land until the owner decides whether the dynamic ordering survives. Every Overview artboard shows Bank 1 left, Bank 2 right, extflash in the right column, so "delete `extFirst`/`bankOrder`" is the artboard-conformant answer — but it removes behaviour someone added on purpose, so it needs a decision, not a patch.


`Main.dc.html` is one 12-col grid, fixed across all five Overview states: **left `span 7`** =
Device stats → Internal flash (2-up bank cards) → "Restart flash utility"; **right `span 5`** =
Screen → External flash.

`OverviewTab.svelte:358-408` is a 2-col `.dashboard` holding only Device+Controls | screenshot,
then `:413-421` a separate full-width column whose order flips at runtime:

```svelte
{#if extFirst}
  {@render extRegion()}{@render intRegion()}
{:else}
  {@render intRegion()}{@render extRegion()}
{/if}
```

`extFirst` (`:87`) and `bankOrder` (`:89` — which can put Bank 2 *left* of Bank 1) have **no
artboard behind them**. Every Overview artboard shows Bank 1 left, Bank 2 right, extflash in
the right column.

### 5.5 The empty-bank prompt is shared across banks, and the Install Retro-Go case is missing

> **STATUS: FIXED** (re-audit 2026-09-07). `emptyBankPrompt` is gone; `OverviewTab.svelte:121` is now `const bankPrompt = (n: 1 | 2): BankPrompt | null` with per-bank results at `:157-158`, and the comment at `:483` states the rule (*"the step that fits THAT bank's own state … never a generic [one]"*). The missing Retro-Go branch was added (`:142`, scoping the offer to bank 1). Commits `57ca8e5` / `6148351`, `e26acea` / `7966c94`.


`StockUnpatched.dc.html` shows *different* prompts per bank: bank 1 "Patch stock firmware",
bank 2 "Install Retro-Go". `BothEmpty` shows "Start guided setup" on both. README: *"Empty
states offer the step that fits that state."*

`OverviewTab.svelte:106-131` computes a **single** `emptyBankPrompt` from device-wide state
and passes it to every empty bank (`:434-438`), and the chain has no Retro-Go branch — it
falls through to `return null` at `:130`. So the most common real state (stock patched,
bank 2 empty, no Retro-Go) shows an empty bank with **no next step at all**, where the
artboard offers "Install Retro-Go".

### 5.6 Header install slots are in the wrong order, and only one side dims

> **STATUS: FIXED** (re-audit 2026-09-07). `DeviceHeader.svelte:132-141` now renders the OFW slot (`logoGnw`) **first** and Retro-Go second, and **both** carry `class:dim={scanned && !…}` — `:132` `class:dim={scanned && !ofw}`, `:139` `class:dim={scanned && !isRetroGo}`. The pair is symmetric and in bank order. Commit `9cb8b10` / `6998870`.


README: *"two independent install-state slots **in bank order**: stock firmware (bank 1),
then Retro-Go (bank 2)… a missing side dims to 42% rather than disappearing."* `Main` and
`HeaderBusy` both render `logo-gnw-badge.svg` "Zelda (Patched)" first, then `logo-rgo.png`.

`ui/DeviceHeader.svelte:120-126` is reversed:

```svelte
<img class="logo-key" src={logoRgo} … /><span class="val">{retroGoStatus}</span>
<span class="divider"></span>
<img class="logo-key logo-key-gnw" src={logoGnw} … /><span class="val ofw" class:dim={!ofw}>{ofwText}</span>
```

`class:dim` is only on the OFW slot — a "Not installed" Retro-Go slot never dims, so the two
slots are not the symmetric pair the rule describes. (`.dim { opacity: 0.4 }` at `:250` vs
42% is immaterial.)

### 5.7 The busy header is an extra strip, not the header changing state

> **STATUS: FIXED** (re-audit 2026-09-07). The separate `.unsafe-lip` strip is gone; the header now changes **in place**. `DeviceHeader.svelte:105` `<header class="band" class:busy={deviceSafety.unsafe}>`; `:194-201` carries the comment citing `HeaderBusy.dc.html` and sets `.band.busy { background: var(--band-busy) }` and `.band.busy .status { color: var(--band-busy-ink) }`. The single 3px lip lives in `App.svelte` and only swaps fill (S0.1). Commits `a61047a`, `30266d7`, `09c7f7c` / `f37b3b6`.
>
> Three deliberate divergences from `HeaderBusy.dc.html` survive and are recorded separately, not as defects: the busy lip stays **3px** where the artboard uses 5px (S8.9), the install slots do **not** go stale/dim (S8.10), and the dark-theme `--band-busy` values are derived rather than artboard-backed (S8.11).


`HeaderBusy.dc.html` changes the header **in place**: band `#ffffff` → `#fdf8ec`, status text
→ `color: #8a6508; font-weight: 700`, the console chip → `background: #b8860b` with
`animation: throb`, and the 3px gold lip → a crawling hazard lip
(`repeating-linear-gradient(…#b8860b…#e8c25a…); animation: crawl`). The caption states the
install slots go **stale and dim**.

`DeviceHeader.svelte:149-168` instead appends a separate `.unsafe-lip` row *below* the band,
with its own `⚠` glyph and two flanking `.hazard` bars, while the band itself never changes
(`:186-197` sets no background) and the slots are unaffected. The file's own comment claims
"the gold face-plate's lip becomes the alert carrier", but `:313-322` renders a padded band
with two 2px borders — which is what the README's "not a band" clause forbids.

The animations themselves (`unsafe-throb`, `unsafe-march`, the `prefers-reduced-motion` guard
at `:378-383`) are good work — they are attached to the wrong element.

### 5.8 Each rail pane is missing its page title and subtitle

> **STATUS: FIXED** (re-audit 2026-09-07). The title moved up one level — instead of each section rendering its own heading, `FirmwareRail.svelte:105-108` renders one `<header class="pagehead">` with `<h2 class="pagetitle">{pagehead.title}</h2>` and `{#if pagehead.subtitle}<p class="pagesub">…` for whichever pane is selected, so every rail pane gets the artboards' title + subtitle from one place. Commits `152f1f2` / `b75c3a3`, `825cf70`.


Every Advanced artboard opens with a `24px/600/-0.015em` title + a `14px #5c5c5c` subtitle
("Write image" / "Write a raw .bin to a bank at an offset."). `FlashSection.svelte:105`,
`DumpSection.svelte:115`, `EraseSection.svelte:144`, `FileBrowserSection.svelte:123-125`
render only the intro `<p class="muted">` — **no heading at all**. `RetroGoTab.svelte:20` has
an `<h3>` at `--fs-body` (16px) against 24px.

### 5.9 Erase: no "Custom range…", and the warning is a plain paragraph

> **STATUS: FIXED** (re-audit 2026-09-07). Both halves. `EraseSection.svelte:27` opens a block commented *"--- Custom range (artboard: 'Custom range…')"* with `customOpen`/`customStart`/`customSize` (`:32-34`), validation at `:40`, a live preview segment at `:51-58`, and the toggle rendered right-aligned opposite the warning at `:240-242`. The warning itself now has the artboard's rule: `:334-339` `.warn-text { color: var(--caution); border-left: 2px solid var(--caution); padding-left: 12px }`. Commit `64ef0eb`.


`Erase.dc.html`: `border-left: 2px solid #b8860b; padding-left: 12px` on the caution sentence,
with `Custom range…` right-aligned opposite it. `EraseSection.svelte:190-194` is a
`<p class="warn-text">` (`:254-259`, bold `--caution`, no left rule) and the file has no
custom-range control at all.

### 5.10 Backup & patch: no step spine, no per-file rows, and **no extflash-collision warning**

> **STATUS: FIXED** — landed as `3744532` after this re-audit was written (spine `cefc2af`, rows `b9b9bc7`). The radios stayed real `<input type="radio">` inside a `<fieldset>` with a visually-hidden legend — only their paint changed — so grouping, single-selection and arrow-key navigation survive. `evaluateRestore`, `restoreVerdict`, `dangerous`, `canPatch` and the standalone `!tooBig` check are untouched (verified: no changed line matches them).
>
> **But the most consequential half of this finding is already FIXED and should not be re-done.** The extflash-collision warning exists: `OfficialFirmwareSection.svelte:116` opens *"Extflash collision. `patchAndFlash` writes the patched external image to bank 0 at …"*, `:128` derives `overlapsInstalled`, and `:479-483` renders `overlapWarnBold` + `overlapWarnBody(mbShort(patchExtBytes))`. Commit `9cb8b10` / `6998870`.
>
> ~~Still outstanding at `f37b3b6`: `:354` and `:454` are still `<h4 class="steph"><Badge>1</Badge>` with no connector spine, and `:380-395` is still a `<fieldset class="picklist">` of radios rather than the artboards' row list with a `Valid` chip.~~ **CLOSED 2026-09-08.** All three landed: the 30px spine column is at `OfficialFirmwareSection.svelte:362-378` with the step headings now plain `<h4 class="steph">` (`:384`, `:548`) and no `Badge` (that component was deleted unreferenced in `ef34572`), and the row list carries the uppercase `Valid` chip at `:438`, `:447`, `:465` (`locale.t.officialFirmware.rowValid`).


`BackupPatch*.dc.html` use a `grid-template-columns: 30px minmax(0,1fr)` spine (a 22px
green-check / `#1b1b1b` numbered disc joined by a `1px #d8d8d8` connector) and list backups as
rows on a white surface with `#ededed` rules and an uppercase green `Valid` chip.
`BackupPatchBoth` adds the caution aside: *"**Overlaps installed data:** patching writes 4 MB
at the start of external flash, over some of your installed games."*

`OfficialFirmwareSection.svelte:333,434` use `<h4 class="steph"><Badge>1</Badge>…` with no
spine, and `:380-395` a `<fieldset class="picklist">` of radios rather than the row list.
*(As surveyed, pre-redesign. `ui/Badge.svelte` no longer exists — see the CLOSED status above.)*
Grep finds **no overlap or collision warning anywhere in the file** — so the user is given no
notice that patching is about to overwrite their installed games. That is both a missing state
and a violation of *"Warnings say what you are about to lose."* It is the most consequential
omission in this section.

### 5.11 The tab strip and the Guided/Advanced switch don't match the nav chrome

> **STATUS: FIXED** (re-audit 2026-09-07). `Advanced.svelte:193-199` carries a comment naming this finding, and `:199` `.navband` is the full-bleed strip sitting **outside** `.page-body` (which the panes apply individually, `:252-257`). Both pills are gone: `.tabbar:349-353` is a plain 34px-gap flex row, `.tab.active:367-371` is `box-shadow: inset 0 -3px 0 var(--zelda-green)`, and `.modeswitch:378-400` is right-aligned 13px plain words with `inset 0 -2px 0 var(--zelda-green)` on the active one. `.shell` no longer caps width (`:299` `max-width: none`). Commits `152f1f2` / `b75c3a3`, `825cf70`, `5e301d9`.
>
> **Generation caveat:** the Guided/Advanced switch is drawn only in the *older* three-tab artboards. `5e301d9` ("tab type from the four-tab artboard generation") took the **tab** type from the newer generation, which leaves the mode switch's 13px matched to an artboard that no longer governs. Recorded as S8.5 — this needs a newer-generation artboard, not a code change.


Artboards: a full-bleed white strip, `padding: 0 40px; border-bottom: 1px solid #d8d8d8`,
46px tabs left-aligned, with Guided/Advanced **right-aligned in the same row** as plain text
(`box-shadow: inset 0 -2px 0 #3e9e4e` on the active one).

`Advanced.svelte:277-287` makes the tabbar a **centred rounded pill on `--surface-sunk`**
(`width: fit-content; margin: 0 auto; background: var(--surface-sunk)`), and `:312-336`
renders the mode switch as a **second** `border-radius: 999px` segmented pill *below* it.
Two pills where the artboard has one region edge and one pair of underlined words.

### 5.12 The rail is boxed inside a 1000px centred column

> **STATUS: FIXED** (re-audit 2026-09-07). `FirmwareRail.svelte:132-146` carries a comment citing `Firmware.dc.html:75` and is now `grid-template-columns: 244px minmax(0, 1fr); gap: 0` with `border-right: 1px solid var(--hairline)` on the rail, and the rail's own asymmetric `padding: 32px 20px 40px var(--page-pad-x)` at `:148`. `Advanced.svelte:296-300` `.shell` is `max-width: none`, so the rail's border-right runs the region edge instead of floating inside a 1000px column. Commits `152f1f2` / `b75c3a3`.


Artboard: the whole Advanced body is `grid-template-columns: 244px minmax(0,1fr); gap: 0;
flex-grow: 1`, rail padded `32px 20px 40px 40px` with a full-height `border-right`.
`FirmwareRail.svelte:100-113` gets the columns right but uses `gap: 1.75rem` (artboard: `0`),
and it sits inside `Advanced.svelte:258-268` `.shell { max-width: 1000px; margin: 0 auto }`,
so the rail's border-right floats mid-page and stops at content height instead of running the
region edge. Blocked on S0.2.

### 5.13 Cosmetic

> **STATUS: FIXED** (re-audit 2026-09-07), bullet by bullet:
> - **Bank action.** `OverviewTab.svelte:779-795` `.bank-action` is `background: none; border: 0`, `--fs-btn-sm` / 600, `color: var(--zelda-green)`, with a 6px-gap chevron — the comment at `:771-778` explains why it must not follow `--model-accent`. Commit `3fa47e2` / `23c7ba3`, `e396b3f`.
> - **BankCard occupied state.** `BankCard.svelte:43` `let occupied = $derived(segs.some(isRetro))`, applied at `:94` and styled `:115-116` `border-color: var(--zelda-green)`, with the retro segment filled green at `:214`. Commit `b86e1c6`.
> - **Boxes on non-objects.** `EraseSection`'s `.bars`/`.selection-box` and `FlashSection`'s `.sub` no longer carry a border (`FlashSection.svelte:263` `border: 0`); `FileBrowserSection.svelte:229-230` `.fs-view` is `background: var(--surface); border-radius: var(--r-card)` with no border and no shadow, matching `FileBrowser.dc.html`. Commit `f143953`.
> - **AccordionSection.** Deleted from the codebase (`lib/ui/AccordionSection.svelte` no longer exists). Commit `f143953`.
> - **FileBrowser emoji.** `grep -n '📁|📂|📄|⏳' FileBrowserSection.svelte` returns nothing — replaced with stroked SVGs. Commit `f143953`.
> - **Literals.** None of the cited hexes survive in `BankCard`, `OverviewTab`, `Advanced`, `FirmwareRail`, `RomSection` or `OfficialFirmwareSection`. Commits `b86e1c6`, `f143953`, `2e07a40`.
> - **Screenshot bezel.** `OverviewTab.svelte:888-899`: the inset bezel is gone, `border-radius: var(--r-card)`, and the comment at `:892-893` explains that the black ground is kept deliberately because it is the device's own screen. Commit `b86e1c6`.


- **Bank action is a red primary button; the artboard is a green text link.** `Main.dc.html`:
  `<span style="color: #3e9e4e; font-weight: 600;">Start Retro-Go</span>` + chevron.
  `OverviewTab.svelte:724-728` `.bank-boot-btn.primary { background: var(--action-red) }` —
  this is navigation, not the A/B action colour (S0.5).
- **`BankCard` never shows the occupied-green state.** `Main.dc.html` gives the Retro-Go bank
  `border: 1px solid #3e9e4e` and a `#3e9e4e` fill; `ui/BankCard.svelte:114-117` applies
  `--model-accent` only when `selected`, so Overview's cards are always neutral.
- **Boxes on non-objects:** `EraseSection.svelte:220-229` `.bars` (artboard puts bars bare on
  the ground), `:235-242` `.selection-box`; `FileBrowserSection.svelte:217-223` `.fs-view`
  (`FileBrowser.dc.html` is `#ffffff` + `6px`, **no border, no shadow**, with `#ededed` row
  rules the implementation's tree lacks entirely); `FlashSection.svelte:219-222` `.sub`
  (Write.dc.html has the two checkboxes bare in a row).
- **`AccordionSection` survives** in `RomSection.svelte:23` and `RomManagementTab.svelte:31`
  (unused there — S1.12), carrying `border: 1px solid var(--model-accent)` (`:68-74`) on a
  disclosure panel. The README named the accordion stack as the thing being replaced; it is
  gone from Firmware but not from ROMs.
- **FileBrowser uses emoji glyphs** (`📁 📂 📄 ⏳`, `FileBrowserSection.svelte:137-143,158,166`)
  where the artboard uses stroked SVG icons, and makes the whole row a button with `(N KB)`
  inline where the artboard puts size + a green download arrow on the file row.
- Literals: `BankCard.svelte:163,197-201` (`#e0e0e0`/`#444`/`#888` → `--surface-sunk`/`--silver-edge`),
  `:184` `color: white` on `.v-seg` (unreadable on the `#e0e0e0` free segment),
  `OverviewTab.svelte:805` `#b03030` → `--danger` (`DumpSection.svelte:310` gets this right —
  inconsistent), `Advanced.svelte:304-306`, `FirmwareRail.svelte:132`,
  `AccordionSection.svelte:141,145`, `RomSection.svelte:1147` `#b03030`,
  `OfficialFirmwareSection.svelte:578` `var(--ok, #2e7d32)` (undefined token, S0.3).
- `OverviewTab.svelte:824` `.screenshot-area { background: #000 }` with an inset bezel at
  320×240; `Main.dc.html` has a flat 232px `#e8e8e8` panel and no bezel. The black is
  defensible (it is a device screen) — the bezel is not in the design.

---

## S6 — Implemented with no artboard behind it

This is the category that caused a whole screen to be reverted before. Listed largest first.
Being unbacked does not automatically make something wrong — several are functionally
justified — but each needs an explicit decision.

1. **`views/GameDetailsPanel.svelte` — 1835 lines, 83 inline `style=` attributes, no artboard.**
   By far the largest unbacked surface in the app. `RomsOptions.dc.html` covers only its
   three-column drawer layout (S1.6); everything else — cover-art import, MCF/cheat editing,
   the import modal — was designed in code. It also carries 23 of the app's 32 hardcoded
   `border-radius: 4px` (against `--r-control` 2px / `--r-card` 6px) and an off-scale type
   ramp (`0.65rem`, `0.7rem`, `0.8rem`, `0.85rem`, `1.1rem`, `1.2rem` — none are tokens),
   plus inline `background: var(--model-accent, #3b82f6)` at `:949,1452`.
2. **`ui/StubLoadModal.svelte`** — a whole modal, no artboard.
3. **`ui/ConfirmModal.svelte`** — generic confirm, used by `DeviceHeader.svelte:171` and
   `OverviewTab.svelte:550`. `ModalInstallConfirm` is the `installProgress` path, not this.
4. **`InstallProgressModal`'s non-confirm phases** — `GuidedFlashing.dc.html` specifies a
   phase/substep tree with `✓ ● ○` glyphs, an inline 4px `#3e9e4e` bar under the active row,
   mono `[137/137]` counters and a collapsible `Log (23)` footer. `Wizard.svelte:466-510`
   declares matching phase *data*; the rendering was never compared to an artboard.
5. **`OverviewTab`'s `extFirst` / `bankOrder` dynamic ordering** (`:87,89`) — S5.4.
6. **Overview's per-bank prompt fallthrough to `null`** (`:130`) — S5.5.
7. **ROMs list collapse chevron, Unselect all, in-pane folder button** (`:1953-2001`) — S1.3.
8. **ROMs Firefox / no-native-picker warning banner** (`:1908-1919`) — a bordered caution box
   on the ground, styled entirely with inline literals.
9. **ROMs `.gate-empty` no-folder state** (`:1925-1932`).
10. **ROMs `spaceAlertMessage` modal** (`:2306-2318`) — uses `ModalShell` correctly, no artboard.
11. **ROMs LZMA "coming soon" disabled checkbox** (`:2212-2216`) and the **SD `syncCores` +
    core-version `<select>` row** (`:2251-2266`) inside the Summary drawer — `LibrarySummary`
    shows only the grid and the caution aside.
12. **Wizard ext-flash floor gating + `.floor-note`** (`:94-96, 927-936, 1152-1160`), the
    **`Back` link at the top of the spine** (`:940, 1167-1177` — only `Landing2` has a back
    control), and the **ellipsis Skip button** (`:976-987`, where `GuidedRetroGoOnly` shows a
    bare `Skip` link). The floor gating is justified in its comments, but the design has never
    seen the resulting one-card or zero-card chooser.

### Re-audit of S6, 2026-09-07

Statuses for the twelve unbacked items, in the same order.

1. **`GameDetailsPanel.svelte` — PARTLY FIXED, still OPEN as a whole.** The mechanical half
   landed (commit `f9ba513` / `63ebf3b`, "bring GameDetailsPanel onto the design tokens"):
   `grep -c 'style='` is now **3**, down from 83; `grep -c 'border-radius: 4px'` is **0**; the
   off-scale `0.65rem` / `0.7rem` / `0.85rem` / `1.2rem` sizes are gone; and S1.6's three-column
   drawer now matches `RomsOptions.dc.html` (`:1524-1537`). The file is 2236 lines.
   **Still OPEN, and BLOCKED on artboards:** cover-art import, MCF/cheat editing and the import
   modal remain designed-in-code with nothing to check them against. This is still the largest
   unbacked surface in the app and still needs an explicit owner decision, not a patch.
2. **`StubLoadModal.svelte` — OPEN / BLOCKED.** Still present in `lib/ui/`, still no artboard.
3. **`ConfirmModal.svelte` — OPEN / BLOCKED.** Still present, still no artboard. Note it now
   also renders a `--model-accent` shimmer at `:130`, which inherits item 1's situation rather
   than S0.5's (S0.5's named sites are all closed).
4. **`InstallProgressModal`'s non-confirm phases — FIXED.** The rendering was brought to
   `GuidedFlashing.dc.html`: `InstallProgressModal.svelte:26-29` emits the artboard's
   `✓` / `●` / `○` glyphs, `:47-49` formats both counter forms (`[137/137]` items and
   `[1.6/3.4 MB]` bytes), and `:115` carries the artboard citation for a done phase dropping
   its counter. Commits `0e3f1bc`, `224736f` / `12e66c0`, `c32019e`.
5. **`extFirst` / `bankOrder` — OPEN.** Unchanged; see S5.4, which now carries the full
   evidence and the blocking decision.
6. **Per-bank prompt fallthrough to `null` — FIXED.** See S5.5; the prompt is now derived per
   bank and the Retro-Go branch exists.
7. **ROMs collapse chevron / Unselect all / in-pane folder button — FIXED for two of three.**
   The chevron and `Unselect all` were deleted (`RomManagementTab.svelte:1981` states so). The
   folder button was **kept on purpose**, with the reason in the code: the artboard puts
   `Change folder` in the tab strip, which this view does not own. See S1.3.
8. **ROMs Firefox / no-native-picker banner — OPEN / BLOCKED.** Still there
   (`RomManagementTab.svelte:49` `dismissedFirefoxWarning`, with the Firefox ZIP fallback at
   `:1760`). It is functionally necessary and has no artboard.
9. **ROMs `.gate-empty` no-folder state — OPEN / BLOCKED.** Still present, still unbacked.
10. **ROMs `spaceAlertMessage` modal — OPEN / BLOCKED.** Still present, still unbacked.
11. **ROMs LZMA "coming soon" checkbox and the SD `syncCores` row — OPEN / BLOCKED.** Both
    survive (`syncCores` at `:788`; the two `<input type="checkbox">` at `:2193` and `:2221`
    are the *only* checkboxes left in the file). `LibrarySummary.dc.html` still shows only the
    grid and the caution aside. Worth noting these two are now the **only** thing keeping a
    checkbox anywhere on the Library tab — see the S1 generation note.
12. **Wizard floor gating, the `Back` link and the ellipsis Skip — OPEN / BLOCKED.**
    `.floor-note` survives at `Wizard.svelte:946,950,1194`; `w.spine.back` is still in the
    string table (`i18n/strings/wizard.ts:120`); the ellipsis Skip is still at `:1005-1007`.
    The gating is justified in its comments, but the resulting one-card and zero-card choosers
    have still never been drawn. Same blocking question as S7.19.

> **"BLOCKED" above overstates it (2026-09-08).** None of these are blocked on the owner.
> Two standing instructions apply to every one of them:
>
> - *Nothing is cut for not appearing in a mockup* (HANDOVER §3) — so the surface stays. There
>   is no "should this exist" question to ask about **S6.2** (`StubLoadModal`), **S6.3**
>   (`ConfirmModal`), **S6.8** (the Firefox banner), **S6.9** (`.gate-empty`), **S6.10**
>   (`spaceAlertMessage`) or **S6.11**. Each is functionally load-bearing and each stays.
> - *Producing mockups is this side's job* (HANDOVER §2, from *"I don't owe shit. Did you
>   prepare a mockup or not?"*). The missing artboard is therefore **our work item**, not his
>   decision.
>
> So the honest state of S6.2, S6.3, S6.9, S6.10 and S6.12 is: **live, ours, design work
> owed** — draw the board, then bring the surface to it. S6.1 (`GameDetailsPanel`) is the same
> shape but far larger, and is the one worth doing first.

---

## S7 — Cannot be judged without rendering

Everything above was established from markup and CSS. These need eyes on a browser.

> **This list was written as "what the owner has to look at himself". That framing is wrong
> and is corrected below.** Needing a browser does not make something his. Only the
> hardware-dependent items are his track (HANDOVER §3: *"all of these questions dependent on
> running against real hardware — don't worry about that. it's on my list"*), and exactly one
> item here is that. The rest are ours to look at and fix.

### Reconciliation against HANDOVER §3 (2026-09-08)

Each of the 19, marked **settled** (a standing instruction or an answered decision already
covers it — do not raise it) or **live** (genuinely ours, still unverified). No item was
closed to shrink the number.

| # | Verdict | Why |
| ---: | --- | --- |
| 1 | live | `.bar` now has `min-height`/`margin-top: auto`; only the pin against `App.svelte`'s `.body` is unverified. |
| 2 | live | The drawer still has neither `max-height` nor `overflow`. Real risk of pushing the footer off-screen. |
| 3 | live | Actions sit inside the scrolling `.wrap`. |
| 4 | live | `--maxw` vs the bar's `padding: 0 40px`. **Do not change `--maxw`** — CLAUDE.md: it is the global page cap; scope any fix to the bar. |
| 5 | live | Does the page grid read as the artboards' 7/5. |
| 6 | **moot** | `.shell` no longer caps width (`Advanced.svelte:299`). Recorded moot by the 2026-09-07 re-audit; not reopened. |
| 7 | live | Rail marker against the artboards' asymmetric padding, which is what shipped. |
| 8 | **moot** | The tab-strip pill no longer exists (S5.11). |
| 9 | **settled** | Artboard wins on pure paint (HANDOVER §4). The board says 124px in an 18px-padded card; build that. Not a question. |
| 10 | live | Scrollbar colliding with the row rules. |
| 11 | **settled** | Same ruling — the artboards' `13px 0` / `14px 0` govern; the rem values are the thing that changes. |
| 12 | live | The coverflow is interactive; only its CSS was ever read. |
| 13 | live | Throb legibility, and the 3px two-segment meter at realistic gap sizes. |
| 14 | **settled** | No artboard depicts hover/focus-visible, and *nothing is cut for absence from a mockup* (HANDOVER §3). Build sensible states and record the call; do not ask. |
| 15 | **settled** | Artboard wins on pure paint: flat text tabs, one dark active pill. |
| 16 | **settled** | **The dark theme is settled** — *"looks good, don't sweat it."* Stop listing it. |
| 17 | **settled** | Part of the same ruling. `--zelda-green`'s dark value is unmeasured by us; that is a note, not a question for him. |
| 18 | live | Despite sitting under *Theme*, this is a clipping/focus-outline question in **both** themes, not a dark-theme judgement — the ruling above does not reach it. |
| 19 | **his track** | Confirming a zero-card chooser needs the classifier running against real hardware. HANDOVER §3 puts that on him; do not re-raise. The *other* half — that the one-card and zero-card choosers have never been drawn — is ours: **producing mockups is this side's job** (HANDOVER §2), so it is design work we owe, not a blocker. Same for S6.12. |

Net: **ten live items** (1, 2, 3, 4, 5, 7, 10, 12, 13, 18), all of them ours, all of them
"open the browser and look". Two moot, six settled by a ruling, one his.

**Layout / does it fit**

1. Whether `Sources.svelte`'s `.bar` (`:388-395`) pins to the bottom and reaches 72px at all
   — it has no `min-height`, no `background`, no `margin-top: auto`; it is a `padding-top`
   divider in flow layout, and the answer depends on `App.svelte`'s `.body`.
2. Whether the ROMs `.drawer` (`:2639`) pushes the footer bar off-screen — the artboards cap
   it (`min-height:180px; max-height:46%; overflow-y:auto`); the implementation has **neither
   a max-height nor an overflow**, and `GameDetailsPanel` is tall. Structurally suspicious;
   only a render proves it.
3. Whether `FilePromptModal`'s `.wrap { max-height: 74vh; overflow-y: auto }` (`:430-434`)
   scrolls the actions away with the body — they are inside `.wrap` (`:344`), which a fixed
   footer would not do.
4. Whether `--maxw` (1200px) clips the ROMs bar's `padding: 0 40px` so its edges stop reading
   as region edges.
5. Whether `.dashboard`'s `minmax(0,1fr) 320px` (`OverviewTab.svelte:695`) reads as the
   artboards' 7/5 proportion at the real page width.
6. Whether `Advanced.svelte`'s `.shell.narrow` (900px) leaves Overview too cramped for the
   2-up bank cards.
7. Whether `FirmwareRail`'s `.item.selected` marker (`:136-143`, `margin-left: -14px`) lands
   exactly on the `border-right` edge given `.rail`'s symmetric `padding-right: 1rem` versus
   the artboard's asymmetric `20px 40px`.
8. Whether the tab-strip pill overflows or wraps at narrow widths.
9. Whether `BankCard`'s 200px bar body (`:138`) plus its boot-button footer matches the
   artboard's 124px bar in an 18px-padded card.
10. Whether `.games-pane`'s `overflow: hidden` + `.rows { overflow-y: auto }` produces a
    scrollbar that collides with the row rules.
11. Actual vertical rhythm in the modals — artboards specify `13px 0` / `14px 0`; the
    implementation uses rem values that do not map 1:1.

**Feel / interaction**

12. The coverflow (`ui/Carousel.svelte`) versus the artboard — perspective, card sizing,
    scrubber. Only its CSS was read; it is a live interactive component.
13. Whether the `.unsafe-lip` throb reads as the artboard's crawl (S5.7) — and whether the
    two-segment 3px ROMs meter would even be legible at realistic gap sizes (S1.8).
14. Every hover and focus-visible state. No artboard depicts them, and `.pick`, `.cap`,
    `.chip`, `.tail` define nothing beyond `cursor: pointer` — whether that reads as broken
    can only be felt.
15. Whether the ROMs console filter pills (`:2385-2404`) read acceptably against the
    artboard's flat text tabs with one dark active pill, at real density.

**Theme**

16. **The dark theme has not been looked at.** S0.4 lists what will break by inspection, but
    the composite effect — a white dock welded to a dark page, `#1b1b1b` text on `#212121` —
    is a judgement that needs the toggle flipped. This is the highest-value single thing on
    this list.
17. Whether `--zelda-green`'s dark value (`#4fb163`) holds white-text contrast on the Active
    pill and the `#3e9e4e` "Hash matches ✓".
18. Whether the gold lip, once moved (S0.1), clips correctly against `overflow: hidden` and
    the focus outline.

**Reachability**

19. Whether the Wizard chooser can render **zero** cards (`extMB < 8` **and** `isStock`) — the
    conditionals at `:893, 906, 917` permit it; confirming needs the classifier running.

### Re-audit of S7, 2026-09-07

S7 is by construction **not determinable from source** — every item needs a browser. This pass
did not render anything either, so **no S7 item is resolved here.** What changed is that the
code several of them point at has moved, so the questions need restating before anyone looks:

- **Items 1, 4, 12 — now answerable differently.** Item 1 (does `Sources.svelte`'s `.bar` reach
  72px) is largely settled by inspection: `.bar` at `:680-692` now has `min-height: 72px`,
  `margin-top: auto`, `background` and `border-top`, which is what it was missing. What still
  needs eyes is only whether it *pins* correctly given `App.svelte`'s `.body`. Item 4's
  `--maxw` question now applies to `.page-body` (`global.css:99-105`), not `App.svelte`.
- **Items 5, 6, 7, 8 — restated by the S5 fixes.** `.dashboard` is now `display: contents` with
  real `span 7` / `span 5` children (`OverviewTab.svelte:742-753`), so item 5 is now "does the
  page grid read as 7/5" rather than "does `minmax(0,1fr) 320px`". `.shell` no longer caps
  width at all (`Advanced.svelte:299`), so item 6 is moot as written and item 7's rail-marker
  question now applies to the artboards' own asymmetric padding (`FirmwareRail.svelte:148`),
  which is what shipped. Item 8's tab-strip pill no longer exists (S5.11), so that item is
  moot.
- **Items 2, 3, 9, 10, 11, 13, 14, 15 — unchanged and still open.** Item 2 is the same box as
  the `height: 500px` residual under S1.11.
- **Items 16, 17 — the theme block. SETTLED, and this paragraph used to say the opposite.**
  It read "still the highest-value item on this list". The owner has since looked at the dark
  theme and ruled *"looks good, don't sweat it"* (HANDOVER §3). We never rendered it
  ourselves; that stays on the record as a limit of our method, and it is not grounds to put
  the theme back in front of him.
- **Item 18 — still open, and not a theme item** despite its heading. `ModalShell.svelte`
  relies on `overflow: hidden` to clip the lip to `--r-card`; that and the focus outline are
  light-theme questions too.
- **Item 19 — still open**, and now paired with S6.12: the reachability question and the
  missing artboard for the one-card/zero-card chooser are the same problem.

---

## S8 — Gaps found by later work, never in the original audit

Added by the 2026-09-07 re-audit. These are real gaps against the design language or the
artboards that the original 46 findings do not cover. Several are **accepted** — recorded so
nobody re-discovers them as bugs — and several are **BLOCKED** on an artboard or a decision.

### 8.1 No on-fill / on-accent ink token exists — ACCEPTED GAP, needs a token decision

White text on a saturated fill is a bare literal in several components:
`StatusChip.svelte:72` and `:78` (`color: #ffffff` on `--zelda-green` and `--info-blue`),
`RomManagementTab.svelte:2835`. This is not a dark-theme break — the fill under it is
saturated in both themes — but the token system has no name for "ink that sits on an accent
fill", so every such site hardcodes it. `--ink-on-face` exists and is used for the caution
chip (`StatusChip.svelte:82`), which is the nearest thing but is not the same role.

**Needs:** either an artboard that states the on-accent ink, or an owner decision to add an
`--ink-on-fill` token and sweep. Not fixable by guessing.

### 8.2 Two gradient buttons in `GameDetailsPanel` match no token — OPEN

`GameDetailsPanel.svelte:1684` `.download-btn { background: linear-gradient(180deg, #ffde6a 0%,
#d4aa18 100%) }` and `:1842` `.add-cheat-btn { background: linear-gradient(180deg, #99e075 0%,
#68a34a 100%) }`.

`--grad-gold` (`tokens.css:16`) is `#d9bc5e → #c09a32` — a **different, muted** pair, so
`.download-btn` is not simply an untokenized `--grad-gold`. There is **no green gradient token
at all**; the only other gradient in the system is `--grad-hazard` (`:21`).

This survived the `GameDetailsPanel` token sweep (commit `f9ba513`) because there was nothing
to sweep it onto.

> **Not blocked (2026-09-08).** HANDOVER §3: *"Missing token? Mint it. Colour between two
> tokens? Take the nearest and note it."* Mint the green gradient, point `.download-btn` at
> `--grad-gold`, and record the call in the commit. Live and ours; no owner decision.

### 8.3 Bank cards have no empty-state treatment — OPEN

`BothEmpty.dc.html` gives an empty bank a **dashed** border (`dashed #d8d8d8`, twice), grey
ink and a lighter track. `BankCard.svelte` has no empty-state class at all: `:216`
`.v-seg.bank-empty { background: var(--surface-sunk); color: transparent }` is the only
acknowledgement, and the card's own border stays the solid neutral (`:115-116` only handles
the `occupied` green from S5.13).

Straightforwardly implementable — the artboard exists and states every value. It simply was
never picked up, because S5.13 only asked for the *occupied* state.

### 8.4 (reserved — see 8.5)

### 8.5 The Guided/Advanced mode switch is drawn only in the older artboard generation — BLOCKED

`Advanced.svelte:378-400` `.modeswitch` is 13px/500 with a 2px green underline, taken from
`Main.dc.html` / `Guided.dc.html` — **older-generation, three-tab** artboards. Commit `5e301d9`
("tab type from the four-tab artboard generation") re-typed the *tabs* from the newer
generation, so the tabs and the switch beside them now come from two different generations and
their type no longer relates.

**Needs a newer-generation artboard showing the nav band with the four real tabs *and* the
mode switch.** No amount of code reading settles what size the switch should be.

> **LIKELY UNBLOCKED by `31cc2f7` — not re-verified against the app, flagged only (2026-09-08).**
> That artboard now exists. `Dump.dc.html:65-72` (and every other re-synced rail board) draws
> the four-tab bar at 14px/0.02em with a 3px underline **and**, directly beneath it, the mode
> switch: `Guided` 13px/500 `#5c5c5c`, `Advanced` 13px/600 with `inset 0 -2px 0 #3e9e4e` — which
> is what `Advanced.svelte:378-400` already ships. The stated blocker ("the tabs and the switch
> come from two different generations") is gone. Survey A cites this finding as BLOCKED in
> several places; whoever closes it should re-check those too.

### 8.6 `Landing2.dc.html`'s "Modded with / Flash memory / Change" row is unimplemented — OPEN

The artboard carries a summary row above the choices (`Modded with` / `Flash memory` /
`Change`) plus two card icons. `Landing.svelte` renders neither; S3.14's four clauses covered
the pips, the card sub-lines, the rubric and the advanced link, and stopped there.

### 8.7 `RomsNewSystem`'s "NEW" badge needs behaviour with no spec — BLOCKED

Restating S1.7's second half, because it is a *design* gap and not just an unimplemented
style: the badge requires persisted "systems seen on a previous scan" state. The artboard
shows the result and specifies nothing about the mechanism — when does a system stop being
new, does it reset on a different device, is it per-folder or global?

### 8.8 A completed install step says `Reinstall` / `Upgrade to vX`; the artboard says `Run again` — OPEN, low

`Wizard.svelte:1018-1025` branches a done install step into `upgradeButtonLabel(…)` when an
update exists and `reinstallButtonLabel` otherwise. `ModalSources.dc.html` shows `Run again`.
The implementation is arguably more informative, but it diverges from an approved artboard
without a recorded decision. (The *backup* step's `Run again` is correct — S3.8.)

### 8.9 `HeaderBusy`'s busy lip is 5px; the app keeps 3px — DELIBERATE, recorded

`HeaderBusy.dc.html` draws the busy band's lip at **5px** where idle is 3px. `App.svelte:136-139`
keeps the lip at a constant `height: 3px` and swaps only the fill, with the comment at `:134-135`:
*"Exactly one lip, always 3px: only the fill changes between states, so there is no layout
shift when a write starts or ends."* Growing to 5px would shift the whole page by 2px at the
exact moment a write begins. **Not a defect — the artboard is what should change.**

### 8.10 `HeaderBusy`'s caption and its own markup contradict each other — BLOCKED on the artboard

The caption on `HeaderBusy.dc.html` states the install slots "go stale and dim" during a write
(finding S5.7 quotes it). **The artboard's own markup renders those slots identical to the idle
state.** The implementation follows the markup: `DeviceHeader.svelte:132,139` dim a slot only on
`scanned && !ofw` / `scanned && !isRetroGo`, never on `deviceSafety.unsafe`.

**Needs the owner to say which half of the artboard is right.** Implementing the caption is a
handful of lines; implementing the wrong one is a regression.

### 8.11 The dark-theme busy-band values are derived, not artboard-backed — ACCEPTED

`--band-busy` `#2c2411` and `--band-busy-ink` `#e8c25a` (`styles/tokens.css`, dark blocks) have
no artboard behind them: **every artboard is light-only.** They were derived to hold the same
relationship to the dark surface that `#fdf8ec` / `#8a6508` hold to the light one. Recorded so
they are not mistaken for measured values — they need eyes on the dark theme (S7.16) before
anyone trusts them.

### 8.12 No `--shadow-modal` token — OPEN, cosmetic

`ModalShell.svelte:67` `box-shadow: 0 12px 40px rgba(0, 0, 0, 0.32)` is the artboards' value
but is a literal with no dark-theme variant. Carried over from S4.7's last bullet, which every
other clause of closed. **Mint the token** (HANDOVER §3) — live, ours, no decision needed.

### 8.13 No artboard for a Cancel control on the flashing screen, or for a confirmation over it — BLOCKED

The owner has queued both as work that needs mockups first. Neither exists in
`docs/design/mockups/`. Until they do, there is nothing to implement and nothing to audit
against. (`docs/audit-write-progress.md` and commit `21ebe62`, "queue the flash-cancel design
and the write-progress audit", are the paper trail.)

### 8.14 Open items carried in from `docs/audit-write-progress.md`

That audit's prioritized list is separate work, but two of its seven items are now closed and
the rest are still open, so the current state belongs here:

- **Gap 1 (sub-step progress invisible) — FIXED.** `InstallProgressModal.svelte:108-109`:
  *"There is deliberately no expand/collapse: docs/design/mockups/GuidedFlashing.dc.html shows
  one flat list, and the old collapsed-by-default disclosure hid the real byte [progress]."*
  Commit `0e3f1bc`.
- **Gap 2 (Wizard step 2's intflash write has no progress row) — FIXED.** `Wizard.svelte:509`
  still filters `intflash` out of the sub-steps, but `:680-684` now reports it at **phase**
  level, which the modal always draws; the comment at `:503-506` explains why the sub-step row
  was not simply added back. Commit `224736f` / `12e66c0`.
- **Gaps 3-7 — still OPEN**, unchanged: the SD cores/bios/fonts counter, the unreported RAM
  stub load, migration reads passing no `onProgress`, the unreported bundle download, and the
  unreported ZIP fallback generation.

### 8.15 Open item carried in from `docs/audit-invented-copy.md`

That audit closes with one question left outside its own scope, still unanswered:
`ReposDetail.dc.html` shows an `Installs to` / `/roms/homebrew` row (now implemented —
`Sources.svelte:188,365-366`, S2.3), while the BIOS-placement proposal argues placement cannot
be derived. **Worth confirming the two are consistent before that proposal is finalised.**
Everything else in that audit is fixed; the doc's own header already says so.

> **Genuinely live, genuinely tracked nowhere else (2026-09-08).** No standing instruction
> reaches it: it is not paint, not a mockup gap, not hardware. It is a substantive
> contradiction between a shipped row and a proposal, and it is answerable from the source
> data by reading `ReposDetail.dc.html`, `Sources.svelte:188` and the proposal together — so
> it is ours to resolve, not his to rule on, but it does need doing.

