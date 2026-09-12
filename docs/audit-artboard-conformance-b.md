# Audit B: artboard-by-artboard conformance survey (19 artboards)

**This is a survey. No application code was changed by this pass** — the only file it adds is
this document. It complements `docs/audit-ui-conformance.md`, which measured the
implementation against a *findings list*; this pass instead walks each artboard's DOM in order,
element by element, and records every delta. A sibling document covers the other 23 artboards
(Landing / Guided / Overview / Firmware families).

**Method and its limit.** Every artboard in `docs/design/mockups/` was read in full as markup;
every claim about the implementation cites `file:line`; every claim about the design quotes the
artboard. **Nothing was rendered in a browser** — per-artboard "Could not determine" lists say
what that leaves unsettled. Runtime data (byte counts, game and system names, version strings,
filenames, hashes) is *not* copy and is never reported as missing; only the literal surrounding
text is.

**Severities.** **MISSING** — not implemented at all. **WRONG** — implemented differently.
**EXTRA** — in the app, in no artboard. **COSMETIC** — token/spacing nit. Rows marked
*conforms* are recorded too, so a screen with few deltas can be told apart from one that was
walked shallowly.

**Relationship to the earlier audit.** Anything that audit records as OPEN is cited by finding
number, not restated. Items it marks FIXED were re-checked; where this walk agrees, that is
said, and where it disagrees (audit 2.1's `max-width: 900px` clause) the disagreement is the
finding.

## Two artboard generations

`RomsNewSystem`, `RomsSdNoCard` **and `LibrarySummary`** are the newer generation — they carry
the real four-tab strip (`Overview` / `Firmware` / `Sources` / `Library`), pill-ended list rows
with no checkbox, and the red `Sync Library` action. **This corrects the brief for this task,
which listed `LibrarySummary` as older**; a diff against `Roms.dc.html` settles it. Only
`Roms.dc.html` and `RomsOptions.dc.html` are the older three-tab generation. Where the two
disagree the newer wins, and each delta states which generation it was measured against.

## Status of this survey — 2026-09-08 (re-status against the merges since `8ed21e6`)

**This survey's arithmetic is closed. It does sum to 293.** Counting every status cell
mechanically: FIXED 88, CLOSED — DECIDED 9, CONFIRMED 173, CANCELLED 2, BLOCKED 16,
COULD NOT DETERMINE 2, no status of their own 3 — **293**. The previous pass reported the columns
summing to 274 and attributed the 19-row gap to an inherited undercount. It was not an undercount
of rows. It was **two status values the header table had no column for** — the nine
`CLOSED — DECIDED` rows and a second `CANCELLED` — plus eight rows the header filed under
CONFIRMED whose own cells read FIXED. Nothing is missing; the header was.

**Independently re-counted 2026-09-08 (counts pass) and confirmed unchanged — every figure above
and in the fifth column of the status table below is correct as it stands, and no correction was
needed here.** The method, so the next pass does not re-derive it: every line beginning `|` is
parsed; a table counts as a *row* table only if it has a `Status …` column that is not column 0
(which excludes the four summary tables in this file, whose first column is `Status`, `Artboard`
or `the row said`). Cells are split on `|` **outside** backtick spans, so inline code containing a
pipe cannot shift the columns, and a row's status is the **leading** token of its status cell only
— a `**BLOCKED**` inside a FIXED cell's prose is not counted. The parse reproduces the
per-artboard `rows` column of the summary table below, board for board, all nineteen; `HeaderBusy`
(31 rows) was additionally counted by hand and matched exactly.

Two rows split their verdict and are counted as FIXED, which is what the header has always done:
`HeaderBusy`'s **Band padding** (`FIXED in part`) and **Grid/divider glyph**
(`FIXED (glyph) / CONFIRMED (the swap)`). The three rows with no status of their own are
`RomsSdNoCard`'s *Everything else* pointer, `ReposAdd`'s *Field placeholder* and its *ABI green
when unknown* — only the first is a cross-reference; the other two record a deliberate,
non-verdict outcome.

### The `Roms` / `RomsOptions` premise died with `31cc2f7`, and the 29 rows are now walked

Both tables below opened with *"older generation — superseded where it conflicts"*. `31cc2f7`
synced both boards from the published canvas: they draw the app's real four tabs and are the
same generation as `RomsNewSystem` and `LibrarySummary`. They moved further than any other board
in the sync — 79 and 95 substantive lines outside the tab bar — and **29 rows (Roms 7,
RomsOptions 22) were closed on a premise that no longer existed.** `cadf918` marked them rather
than flipping them, correctly.

**Walked, 2026-09-08.** Every one of the 29 was re-read against the corrected board. **No status
cell changes value, and no new delta was found** — because on each of the seven contested points
the corrected board now draws what the code already does:

| the row said | the corrected board draws | verdict |
|---|---|---|
| checkbox superseded | no checkbox at all; the row ends in a right-aligned pill | conformant on the board's own text |
| name weight split superseded | one weight, `14px`, `#1b1b1b`, every row | conformant |
| `Installed` caption superseded | the pill: `12px/600`, `radius 999px`, `padding 4px 12px`, `min-width 80px`, green `#3e9e4e` + `inset 0 -1px 0 rgba(0,0,0,0.18)` / blue `#007bff` / grey `#e8e8e8` + `rgba(0,0,0,0.06)` | conformant — `StatusChip.svelte` is that spec token for token |
| `Install to device` superseded | `Sync Library` | conformant |
| footer caption one span | two spans, `13px #5c5c5c` + `13px #3e9e4e/500` at `margin-left: 14px` | conformant |
| "this artboard has no summary tab" | it has one — the `translate(-50%,-100%)` notch, `12px/600`, `radius 7px 7px 0 0` | conformant (`0ebbe67`) |
| drawer is a free-standing card, dock "almost certainly right" | the bottom dock: `border-radius: 10px 10px 0 0`, `padding: 26px 40px 30px`, `box-shadow: 0 -10px 28px`, with an `Additional options — <game>` section caption and a close X | conformant on the board's own text (`0ebbe67`) |

The RomsOptions column geometry (`repeat(3, minmax(0,1fr))`, `gap: 28px`, `border-left` rules,
11px/700/0.11em headings) was untouched by the sync, so those verdicts stand unchanged. The
remaining BLOCKED cells in that table are the Q11–Q13 behaviour questions, which the sync did
not touch either.

**The re-walk this survey owed is done. No "still superseded" cell remains unverified.**

Nothing else in this survey sits on a board that moved: `31cc2f7` touched no other board of the
19 surveyed here, and the four backdrop-only refreshes (`e68d6f1` / `570a196`) are survey A's.

### What the merges since `8ed21e6` closed here

`a0ae34b` conformed `AddSourcesModal` and `AddSource` to `ModalSources` / `ModalSourcesEmpty` /
`ReposAdd` (four gaps in the modal, two in the form). `497f558` closed four measured `Repos`
deltas and `6ae26cf` floored its two scroll regions. `8cf8edd` fixed `SplitButton`'s menu under
the new pane scroller. Each was verified against the rows here: **all of them land on rows this
survey already records as FIXED or CONFIRMED, so no status cell moves.** None of the 16 BLOCKED
rows was touched — `0ebbe67` explicitly left `doSdSync()` and every `targetMedia === "sd"`
early-out alone, so the five SD rows and row 318 stand exactly as the blocked audit left them.

## Status of this survey — 2026-09-08 (blocked audit)

**Every BLOCKED row in this survey was re-walked against current code and its artboard.** The
header count of 43 was stale; the real number of BLOCKED status cells was **24**. Of those,
**8 were never blocked** — four under *nothing is cut merely for not appearing in a mockup*
(365, 410, 637, 825) and four under CLAUDE.md's SD-vs-Flash budget rule (319, 320, 798, 799),
where the code is right and the artboard reuses a Flash affordance on an SD screen. **4 are
duplicates**: 361/362/363 are row 358, and 548 is row 477.

**Twelve rows remain genuinely blocked: 318, 358, 367, 368, 373, 407, 477, 634, 830, 831, 840,
841.** Two of them are the same question as a row in survey A — 841 is A2 (the language control)
and 830 is GF5 (the busy lip) — so across both surveys they are one question each. Every row
carries a dated `RE-STATUSED 2026-09-08` clause naming its verdict and question number in
[`docs/BLOCKED-AUDIT.md`](./BLOCKED-AUDIT.md).

## Status of this survey — 2026-09-08 (sweep)

A third pass re-verified every **OPEN** and **BLOCKED** row in this survey; all of them fall in
this sweep's scope except the two `ModalInstallConfirm` spacing nits, which live in
`ui/InstallProgressModal.svelte` and are owned by a concurrent pass. **Forty-three rows were
re-walked and twenty-three moved.**

**Six were already done and had not been re-marked** — `RomsNewSystem`'s footer unit (now **MB**
throughout, applying the owner's ruling), `RomsOptions`' `Source` label, `LibrarySummary`'s
`Games` and `Total` labels, `ModalSources`' `Close` footer, and `ModalFilesConvert`'s `Added`
block placement. **One is CANCELLED**: the `new` system badge is dropped from the design, so
row 204 is not a gap and nothing will be built for it. (`cc09387` / `5992ad8` then took the badge
off `RomsNewSystem` itself, so that row is now conformance on both sides rather than a cancelled
gap. Its status does not move.)

**Fourteen were never work.** Eight OPEN and six BLOCKED rows are now **CONFIRMED as decisions**
under two standing rulings. *Nothing is cut merely for being absent from a mockup* closes the
BIOS/emulator rows, the unknown-homebrew rows, the now-playing chip, the Firefox ZIP button, the
list header's folder glyph, the `Unsupported Console` state, the BIOS-missing aside being a
button, the `ModalConnect` error and `Connecting…` states, and `ModalFolder`'s SD row and
disabled gate. *"I'd rather lose text than have too much of it"* closes the per-row system tag
(under a per-console filter it would repeat the active filter chip on every line) and
`"8 optional files"` (the word *more* is the padding). The survey's own newer-generation rule
closes the `RomsOptions` drawer surface.

**Twenty stayed BLOCKED**, in three clean groups. The colour group is now CLOSED (tokens pass,
2026-09-08, `852df8d`), leaving seventeen, none of which is paint:

- ~~**Three colour rows** (213, 598, 653)~~ — **CLOSED.** They were one decision and it split two
  ways. `#f0f0f0` is one value in one role, 13 times across six boards, always a badge/chip
  `background`: minted as `--chip-fill` (dark `#2e2e2e`) and applied at the four call sites.
  `#e0e0e0` carries two different roles and is a near-miss on an existing token in each — a
  divider (`--rule`) and a disabled fill (`--surface-sunk`) — so it gets no token and snaps by
  role, deliberately and on the record.
- **Five SD rows** (252, 253, 254, 732, 733) sit on the SD/Flash budget split CLAUDE.md guards
  (`AUDIT_NOTES` #14). In two of them the artboard is arguably the defect — it reuses Flash's
  meter and total on an SD screen that structurally has neither.
- **The rest are behaviour, not conformance**: the `RomsOptions` conditional presences, the
  cheats footer, the `Written` row, `FolderGateModal`'s `Choose…`/`Change…` swap (copy that
  *carries state*, which the artboard-wins-on-paint ruling does not reach) and its
  `Reconnect last folder` pair.

## Status of this survey — 2026-09-07

**Every row in every table below now carries a `Status (2026-09-07)` column, re-verified on
2026-09-07** after the branches that closed most of the first pass's OPEN rows landed. The survey
text is unchanged — rows were marked, never rewritten or deleted. Statuses are **FIXED** (closed,
naming the commit), **OPEN** (still true), **BLOCKED** (needs an owner decision, named in the
cell), **CONFIRMED** (walked again, still conforms) and **COULD NOT DETERMINE** (needs a browser).

**The re-verification moved rows in both directions.** Eight rows the first pass left OPEN are
closed — `f7a8d4b` (the scrubber and the now-playing block), `ad92c77` (the drawer envelope, body
scroll and close glyph), `ff33d9e` (`Box art`, the Detected-game row shape, the connect
apostrophe) — and four more were already conformant when the pass recorded them OPEN
(`ModalFilesBiosError`'s three 11px hash rows and `ModalFilesBios`' `Found` state, both under
`d3d7176` / `7fd667f`). Nine were mis-sorted the other way and are now BLOCKED: `RomsOptions`'
three conditional presences and its neutral `Save preview` caption (all four are behaviour or
undrawn states, not paint), `LibrarySummary`'s aside filename mono (a seven-locale
Pre/Mid/Post fragment split), `ModalFilesBios`' disabled submit cap (it lives in `Button.svelte`'s
shared `:disabled` rule and repaints every disabled button app-wide), and (until `852df8d`) the three `#e0e0e0` /
`#f0f0f0` fills — now settled: one token minted for `#f0f0f0`, none for `#e0e0e0`. The `LibrarySummary` `Change` cell row was a **false
positive**: `tokens.css:41` is `--danger: #8a241b`, the artboard value exactly.

| Status | rows (2026-09-07) | rows (2026-09-08 sweep) | rows (2026-09-08 icons pass) | rows (2026-09-08 blocked audit, as stated) | rows (2026-09-08 re-status, counted) |
|---|---:|---:|---:|---:|---:|
| FIXED | 65 | 71 | 72 | 72 | **88** |
| CLOSED — DECIDED (ruled on, code kept) | — | — | — | — | **9** |
| OPEN | 18 | 10 | 0 | 0 | **0** |
| BLOCKED | 57 | 44 | 43 | 16 | **16** |
| CONFIRMED (walked again, still conforms) | 149 | 163 | 173 | 181 | **173** |
| CANCELLED (dropped from the design by the owner) | — | 1 | 1 | 1 | **2** |
| COULD NOT DETERMINE | 1 | 1 | 1 | 1 | **2** |
| rows with no status of their own | 3 | 3 | 3 | 3 | **3** |
| **total rows walked** | 293 | 293 | 293 | 274 (short by 19) | **293** |

**Sixth reading — 2026-09-08 (merge sweep).** Re-counted by the same rule after this pass's edits:
**293 rows** (unchanged; no row was added or removed) — FIXED **90**, CLOSED — DECIDED **9**,
OPEN **0**, BLOCKED **15**, CONFIRMED **172**, CANCELLED **2**, COULD NOT DETERMINE **2**, no
status of their own **3**. Two rows moved, both in `HeaderBusy`, both re-read against the code:

- **Language control** — BLOCKED → **FIXED** (`9e0f750`). The chromed silver `<select>` is gone;
  the control is the boards' bare `12px/500 #5c5c5c` text showing the uppercase locale code, and
  it is still a working seven-locale switcher. This is the same finding as survey A's **A2**, with
  which `docs/BLOCKED-AUDIT.md` merged it as Q1 — that question is now closed by code, though the
  file itself is outside this pass.
- **Caution ring on the chip while busy** — CONFIRMED → **FIXED** (`352e8af`). The EXTRA was
  removed rather than accepted: the busy chip now keeps the idle chip's border and inset shadow,
  and only the fill and the throb change, exactly as the four busy boards draw it. One consequence
  worth noting: the `Busy state disables destructive controls` row still cites the amber ring as
  the app's substitute signal for the un-disabled controls. That clause is now stale; the row's
  status (BLOCKED, Q18) does not move, and the question it asks is unaffected.

**The `43` in the third column was itself stale** — a header never re-cut after the rows moved.
Counting the actual status cells on 2026-09-08 gave **24**, and that is the number the blocked
audit walked. The fourth column's 274 was the gap that left. **The fifth column closes it**: see
the re-status section at the top of this file. The gap was two missing status values and eight
mis-filed rows, not 19 missing rows.

**Icons pass (2026-09-08), fourth column. This survey has no actionable rows left.** Row 822 (the
header glyph) moved BLOCKED → FIXED; see the row. The other change is a correction: **the
`OPEN, in priority order` list below is entirely stale.** Every one of its ten rows was re-read
against its own table entry, and each is already recorded there as FIXED, CLOSED or CONFIRMED —
the summary list was simply never re-cut after the rows moved. Specifically: item 1's two
`ModalInstallConfirm` spacing nits are both **FIXED (`f2c7c83`)** in their rows; item 2 is
**FIXED (`a15a495`)** for the URL field's height/radius and **CLOSED** for both the placeholder
copy and the 40vh scroller; item 7's `Repos` no-selection footer is **CLOSED — decided, kept**;
and items 3–6, 8 and 9 the sweep itself had already marked CONFIRMED. The 10 OPEN therefore
becomes 0, and those rows are counted under CONFIRMED/FIXED where their tables already put them.

The `CONFIRMED` count is much larger than the original summary's "(rows conforming)" column
because that column was only ever filled in for Part A; Parts B–D recorded their conformances as
`OK` rows inside the tables. As of the 2026-09-08 sweep, of the 140 counted deltas **71 are
closed, 1 is cancelled and 54 remain**, **44 of them behind an owner decision** — leaving **10**
rows anyone could pick up today, and 2 of those 10 belong to a concurrently owned file
(`ui/InstallProgressModal.svelte`). The 2026-09-07 reading, kept for comparison: *65 closed, 75
remain, 57 behind a decision, 18 actionable.*

| Artboard | FIXED | OPEN | BLOCKED | CONFIRMED | undetermined | rows |
|---|---:|---:|---:|---:|---:|---:|
| `RomsNewSystem` | 13 | 2 | 7 | 11 | 1 | **34** |
| `RomsSdNoCard` | 1 | 0 | 3 | 1 | 0 | **6** |
| `Roms` | 0 | 0 | 0 | 7 | 0 | **7** |
| `RomsOptions` | 7 | 1 | 9 | 5 | 0 | **22** |
| `LibrarySummary` | 5 | 1 | 4 | 13 | 0 | **23** |
| `Repos` | 4 | 1 | 2 | 12 | 0 | **19** |
| `ReposAdd` | 0 | 0 | 4 | 7 | 0 | **13** |
| `ReposDetail` | 4 | 0 | 3 | 8 | 0 | **15** |
| `ReposDetailReady` | 0 | 0 | 2 | 3 | 0 | **5** |
| `ModalSources` | 5 | 2 | 3 | 5 | 0 | **15** |
| `ModalSourcesEmpty` | 0 | 0 | 1 | 2 | 0 | **3** |
| `ModalConnect` | 5 | 2 | 1 | 10 | 0 | **18** |
| `ModalFolder` | 1 | 2 | 3 | 7 | 0 | **13** |
| `ModalFilesBios` | 4 | 0 | 5 | 8 | 0 | **17** |
| `ModalFilesBiosError` | 3 | 0 | 0 | 6 | 0 | **9** |
| `ModalFilesConvert` | 1 | 0 | 3 | 9 | 0 | **13** |
| `ModalInstallConfirm` | 5 | 2 | 1 | 16 | 0 | **24** |
| `ModalInstallConfirmSd` | 1 | 0 | 2 | 3 | 0 | **6** |
| `HeaderBusy` | 6 | 5 | 4 | 16 | 0 | **31** |
| **Total (19 artboards)** | **65** | **18** | **57** | **149** | **1** | **293** |

**Two rows are WRONG as originally recorded** and are marked so in place:

- **`ReposAdd` → URL field radius.** `--r-control` **is** `2px` (`tokens.css:118`), so the field
  already carries the artboard's flat 2px. There was never a delta here.
- **`Repos` → `curated` chip.** Correctly dismissed by the row itself: the chip was dropped from
  the design (`docs/UX_DESIGN.md:130`), so its absence is conformance, not a gap.

Also re-verified and still **not** a finding: `Add languages from translated ROMs` /
`Additional Language` are converter-input manifest text resolved through `pickText`
(`AdditionalFiles.svelte:100-111`), not missing copy.

### OPEN, in priority order

Only rows marked **OPEN**. BLOCKED rows are listed under *Deltas needing an owner decision* at the
foot of this document. Eighteen rows, re-derived 2026-09-07 — the clusters that used to head this
list (the `RomsOptions` cover-art column, the `LibrarySummary` drawer, the now-playing block and
scrubber, the hash-stack type scale) are now either closed or BLOCKED, and what is left is
genuinely small.

**2026-09-08:** eight of the eighteen rows below have left OPEN as **CONFIRMED decisions** —
items **3**, **4**, **6**, **8** and **9** in full. What remains actionable is item 1 alone —
**and it is not this sweep's to build**: both nits live in `ui/InstallProgressModal.svelte`,
owned by a concurrent pass. Items 2 (`ModalSources`' URL box model) and 7 (the `Repos`
no-selection footer) were not re-walked by this sweep and stay exactly as recorded.

1. **`ModalInstallConfirm` — two spacing nits.** The title→body gap is 8px against the artboard's
   4px, and the action row's gap is 9.6px against 20px.
2. **`ModalSources` — the URL field's box model** (no fixed 40px height, different padding) and the
   defensive `max-height: 40vh` group-list scroller that no artboard claims.
3. **`ModalFolder` — two correct-behaviour extras**: the SD row rendered only in SD mode, and the
   Continue button's disabled gate where the artboard draws it enabled. Both recorded, not defects.
4. **`RomsNewSystem` — the two accepted extras.** The list header's folder glyph (deliberate,
   accepted under S6.7) and the Firefox `Download SD ZIP` button that replaces the primary action
   (S6.8's family). Both are keep-or-drop, no decision needed.
5. **`HeaderBusy` — closed out 2026-09-07.** None of these five was ever actionable and all
   five have left OPEN. The scanning pulse and the lost-link precedence are **CONFIRMED as
   intentional** under the owner's rule that nothing is cut for not appearing in a mockup. The
   busy lip height and the slot dimming are **BLOCKED**: the first needs an approved board
   overruled, the second is a board that contradicts its own caption and so specifies no value
   to implement. The dark-theme band is **COULD NOT DETERMINE** — it needs a browser, not a patch.
6. **`ModalConnect` — the two justified extra states** (the error line, the `Connecting…` label
   swap). Neither is in an artboard and both are real behaviour; recorded, not urgent.
7. **`Repos` — the no-selection footer filler.** Defensive, no artboard claim.
8. **`RomsOptions` — the `Unsupported Console` state**, inheriting S6.1.
9. **`LibrarySummary` — the BIOS-missing aside being a button.** Behaviour justified in the comment
   at its call site; recorded so the divergence is not forgotten.

**2026-09-08 (icons pass) — this list is stale in full; read the status table above instead.**
All ten rows are already FIXED, CLOSED or CONFIRMED in their own tables. Item 1's two spacing
nits landed in `f2c7c83`; item 2's URL field landed in `a15a495` and both of its remaining halves
(the placeholder copy, the 40vh scroller) were CLOSED as decisions; item 7's footer copy was
CLOSED as a decision. Nothing in Part A–D of this survey is actionable today.

---

## Summary (as first written — superseded by the status table above)

| Artboard | MISSING | WRONG | EXTRA | COSMETIC | deltas | (rows conforming) |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| `RomsNewSystem` | 1 | 6 | 5 | 10 | **22** | 11 |
| `RomsSdNoCard` | 1 | 2 | 0 | 0 | **3** | 1 |
| `Roms` | 0 | 0 | 0 | 0 | **0** | 1 |
| `RomsOptions` | 1 | 12 | 2 | 2 | **17** | 5 |
| `LibrarySummary` | 1 | 2 | 2 | 6 | **11** | 12 |
| `Repos` | 0 | 2 | 2 | 2 | **6** | 0 |
| `ReposAdd` | 0 | 2 | 2 | 1 | **5** | 0 |
| `ReposDetail` | 0 | 3 | 1 | 3 | **7** | 0 |
| `ReposDetailReady` | 0 | 2 | 0 | 0 | **2** | 0 |
| `ModalSources` | 0 | 2 | 1 | 5 | **8** | 0 |
| `ModalSourcesEmpty` | 0 | 1 | 0 | 0 | **1** | 0 |
| `ModalConnect` | 0 | 1 | 2 | 5 | **8** | 0 |
| `ModalFolder` | 0 | 2 | 4 | 1 | **7** | 0 |
| `ModalFilesBios` | 1 | 3 | 0 | 5 | **9** | 0 |
| `ModalFilesBiosError` | 0 | 1 | 0 | 3 | **4** | 0 |
| `ModalFilesConvert` | 0 | 2 | 1 | 1 | **4** | 0 |
| `ModalInstallConfirm` | 2 | 3 | 1 | 3 | **9** | 0 |
| `ModalInstallConfirmSd` | 1 | 2 | 0 | 0 | **3** | 0 |
| `HeaderBusy` | 0 | 4 | 6 | 4 | **14** | 0 |
| **Total (19 artboards)** | **8** | **52** | **29** | **51** | **140** | 30 |

*Deltas* is MISSING+WRONG+EXTRA+COSMETIC. `Roms` shows 0 because the newer generation supersedes
every part of it that this walk touched (6 rows marked superseded in its section); it is kept for
the one composition rule it still governs.

**The headline: the Library footer dock, the Sources vocabulary, and Cancel's treatment are the
three deltas that recur across the most artboards.**

---
# Part A — Library tab conformance survey
### `Roms` / `RomsOptions` / `RomsNewSystem` / `RomsSdNoCard` / `LibrarySummary`

Worktree: `/home/doug/Nerd/git/gnw-web-builder/.worktrees/wt-re2`. No application code changed.
Read statically; nothing rendered in a browser.

**Generation correction (important).** The brief said `LibrarySummary` is older three-tab.
It is not. `diff` of `Roms.dc.html` against `LibrarySummary.dc.html` shows LibrarySummary
carries the **four-tab strip** (`Overview` / `Firmware` / `Sources` / `Library`, 14px/600,
`inset 0 -3px 0 #3e9e4e`), the **pill-ended rows with no checkbox**, and the **`Sync Library`**
button — i.e. it is the **newer** generation, same as `RomsNewSystem` / `RomsSdNoCard`.
Only `Roms.dc.html` and `RomsOptions.dc.html` are the older three-tab generation
(`Overview` / `Firmware Setup` / `ROMs`, 15px/500, `inset 0 -2px 0`, checkbox rows,
`Install to device`). Every delta below states which generation it was measured against.

`RomsSdNoCard.dc.html` differs from `RomsNewSystem.dc.html` in **exactly three places**
(verified by diff): no WonderSwan/NEW filter chip; one list row differs (runtime data); and the
footer's left caption reads `Choose an SD card to install` with the net-change span emptied.
Everything else — the red `Sync Library` button, the two-segment meter, the Summary notch — is
byte-identical, so the "no card" state is a *caption* change and nothing else.

Audit findings re-checked and **confirmed still true as recorded**: 1.7 (OPEN — no new-system
state), S6.1 (GameDetailsPanel, 2236 lines, still largely unbacked), S6.8/9/10/11 (OPEN).
Audit findings re-checked and **confirmed FIXED** by my own walk: 1.2, 1.3, 1.4, 1.5, 1.6, 1.8,
1.9, 1.10, 1.11 (grid half). 1.11's `height: 500px` residual is still present
(`RomManagementTab.svelte:2577-2579`) — agrees with the audit's "residual".

---

## RomsNewSystem.dc.html  (newer generation — governing)

| Element | Artboard specifies (quoted) | Implementation (file:line) | Severity | Owner decision needed? | Status (2026-09-07) |
| --- | --- | --- | --- | --- | --- |
| New-system filter chip | ~~`WonderSwan 4` + `<span …>new</span>`, `border: 1px solid #3e9e4e; border-radius: 3px`, badge `9px/700 … uppercase; color:#ffffff; background:#3e9e4e`~~ — **the board no longer draws this** (`cc09387` / `5992ad8`); the WonderSwan chip is now the plain sibling form, `13px #5c5c5c`, same padding as NES/Genesis/GW | Not implemented. `RomManagementTab.svelte:1989-2001` renders uniform `.console` buttons only; no `isNew` concept | MISSING | Yes — already recorded as **finding 1.7 / S8.7 (BLOCKED on spec)**; cited, not re-opened | **CANCELLED (owner ruling, 2026-09-08 sweep)** — the `new` system badge is dropped from the design. Not a gap; nothing to build. Closes 1.7 / S8.7. **Now closed from the board side too** (`cc09387` / `5992ad8`): the drawing this row measured against has been withdrawn, so the row records conformance rather than a cancelled gap. The direction was *board draws it, app does not*; both sides now agree. Verdict unchanged. |
| Filter chip, active state | `font-size: 13px; font-weight: 600; background: #1b1b1b; color: #ffffff; border-radius: 3px; padding: 5px 11px` — a **dark filled** chip, square-ish | `.console.active` (`:2446-2451`) = `background: var(--surface)` (white), `color: var(--ink)`, `border-color: var(--model-accent)`, `border-radius: 999px` (`:2442`) | WRONG | No | **FIXED** (`bc71f68`) — `.console.active` is now the dark filled chip (`RomManagementTab.svelte:2477-2482`), using `--ink`/`--surface` so it inverts in dark theme |
| Filter chip, inactive state | `font-size: 13px; color: #5c5c5c; padding: 5px 11px` — **bare text, no border, no fill** | `.console` (`:2436-2445`) = `background: var(--surface-sunk); border: 1px solid var(--hairline); border-radius: 999px` — a filled outlined pill | WRONG | No | **FIXED** (`bc71f68`) — `.console` is now bare text, no fill, no border (`RomManagementTab.svelte:2467-2476`) |
| Filter chip type size | `font-size: 13px` | `font-size: var(--fs-micro)` = `0.75rem`/12px (`tokens.css:60`, used `:2438`) | COSMETIC | No | **FIXED** (`bc71f68`) — the chip is now `var(--fs-btn-sm)` = 13px (`RomManagementTab.svelte:2469`) |
| Filter row spacing | `padding: 22px 40px 0; gap: 6px` | `.consoles { gap: 0.3rem }` (`:2434`) ≈ 4.8px; vertical rhythm from `.seltable{gap:0.6rem}` (`:2429`) | COSMETIC | No | **FIXED** (`bc71f68`) — `.consoles { gap: 6px }` (`RomManagementTab.svelte:2455`) |
| List container | `background:#ffffff; border-radius:6px; padding:2px 16px` | `.games-pane:2588-2598` = `background: var(--surface); border-radius: var(--r-card)`, **no `padding: 2px 16px`** — rows carry their own `padding: … 0.5rem` (`:2463`) instead | COSMETIC | No | **FIXED in effect** (`bc71f68`) — the artboard's 16px horizontal is carried on `.row` instead of `.games-pane`, deliberately, so rows line up with the header's padding (`RomManagementTab.svelte:2489-2492`) |
| List header, left | `6 selected` at `11px/700; letter-spacing:0.11em; color:#5c5c5c; text-transform:uppercase` | `.sel-count` (`:2658-2664`) exactly that via `--fs-label`/`--label-track`/`--ink-soft`; string `selectedCount` (`i18n/strings/roms.ts:23`) | conforms (audit 1.3 FIXED — agree) | No | **CONFIRMED** — unchanged, still conforms |
| List header, right | `Select all` at `13px/500; color:#3e9e4e` | `.action-btn` (`:2685-2696`) = `--fs-btn-sm` 13px / 500 / `--zelda-green`; copy `selectAll: "Select all"` (`roms.ts:24`) | conforms | No | **CONFIRMED** — unchanged, still conforms |
| List header — folder glyph | Header row has **only** the two items above | Extra `.folder-btn` (`:2037-2039`) | EXTRA | No — deliberate, reason stated at `:2007-2012`; audit S6.7 accepts it | **CONFIRMED — keep.** Re-walked 2026-09-08 sweep: still renders, still deliberate (reason at `RomManagementTab.svelte:2007-2012`), still accepted under S6.7. Leaving OPEN implied work; there is none. |
| Header underline | `border-bottom: 1px solid #e0e0e0` | `border-bottom: 1px solid var(--rule)` = `#ededed` (`:2654`, `tokens.css:73`) | COSMETIC | No | **CLOSED — decided (tokens pass, 2026-09-08).** No token. `#e0e0e0` appears in **two** roles across the boards and is a near-miss on an existing token in each: as this `1px solid` underline it is a divider inside a white surface, which is exactly `--rule` (#ededed, 13/255 away) and what every sibling row rule already uses; as a disabled submit fill it is `--surface-sunk` (#e8e8e8, 8/255). Nearest by role, taken deliberately. Recorded in `tokens.css`'s off-ramp-greys comment. |
| Row: system tag | `10px/600; letter-spacing:.07em; #5c5c5c on #e8e8e8; border-radius:2px; width:40px; text-align:center` — present on **every** row | `StatusChip.svelte:99-111` matches exactly. But the tag is rendered **only when `consoleFilter === "all"`** (`RomManagementTab.svelte:2065-2067`) | WRONG (conditional) | Yes — artboard only ever shows the "All" filter, so whether the tag should persist under a per-system filter is undrawn | **CONFIRMED — decided (2026-09-08 sweep).** The tag stays conditional. Under a per-console filter every visible row is the same system, so the tag would repeat the active filter chip on every line — the definition of filler under the owner's *"I'd rather lose text than have too much of it."* The artboard only ever draws the `All` filter, so it does not contradict this. |
| Row: name | `font-size: 14px; color: #1b1b1b; flex-grow: 1` — **one weight for every row** | `.gname` (`:2478-2487`) = 14px/400/`--ink`, comment states the same intent | conforms | No | **CONFIRMED** — unchanged, still conforms |
| Row: size | `12px; #5c5c5c; ui-monospace` | `.gsize` (`:2489-2497`) = `--fs-chip` 12px, `--ink-soft`, mono, tabular | conforms | No | **CONFIRMED** — unchanged, still conforms |
| Row: status pill | `12px/600; border-radius:999px; padding:4px 12px; min-width:80px; text-align:center` + `inset 0 -1px 0 rgba(0,0,0,0.18)`; palettes `installed`=#3e9e4e/#fff, `install`=#007bff/#fff, `not installed`/`prepare`=#e8e8e8/#5c5c5c with the softer inset | `StatusChip.svelte:49-93` — 999px, 4px 12px, `min-width: 5rem` (=80px), `--fs-chip`, `--chip-inset`/`--chip-inset-soft`, `--zelda-green`/`--info-blue`/`--surface-sunk`. Labels `installed`/`install`/`not installed`/`prepare` at `roms.ts:32-38` | conforms — character-identical copy | No | **CONFIRMED** — unchanged, still conforms |
| Row geometry | `padding: 11px 0; gap: 12px`, last row `padding: 10px 0` and **no** bottom rule | `.row` (`:2458-2468`) = `padding: 0.25rem 0.5rem` (4px 8px), `gap: 0.55rem` (8.8px); `:last-child` drops the rule (`:2469-2471`) — a much denser row than drawn | COSMETIC | No | **FIXED** (`bc71f68`) — `.row { gap: 12px; padding: 11px 1rem }` (`RomManagementTab.svelte:2491-2492`) |
| Row rule | `border-bottom: 1px solid #ededed` | `border-bottom: 1px solid var(--rule)` (`:2467`) = `#ededed` | conforms (audit 1.9 FIXED — agree) | No | **CONFIRMED** — unchanged, still conforms |
| Row: no checkbox | Rows end in the pill; no checkbox anywhere | No checkbox in the list (only the two drawer checkboxes, S6.11) | conforms | No | **CONFIRMED** — unchanged, still conforms |
| BIOS/emulator rows | Nothing of the kind in any Library artboard | `biosRows` `{#each}` at `:2047-2055` renders extra non-selectable rows above the games with their own chip | EXTRA | Yes — a whole row class in the list with no artboard; not recorded in S6's list | **CONFIRMED — keep (2026-09-08 sweep).** An unbacked row class, but nothing is cut merely for being absent from a mockup, and BIOS/emulator rows carry information no other row does. Recorded, not a gap. |
| Unknown-homebrew rows + `remove` chip | Not drawn | `:2085-2094`, copy `removeButton: "remove"` (`roms.ts:26`) | EXTRA | Yes — unbacked, not in S6's list | **CONFIRMED — keep (2026-09-08 sweep).** Same ruling as the BIOS/emulator rows: unbacked, but real information and a real action. Not cut for absence from a mockup. |
| Coverflow | `height: 330px; perspective: 900px`, 7 cards 168×218, `rotateY(±48deg)`, scales 1 / .84 / .74 / .66 | `Carousel.svelte` (`:291-330`), grid column `span 7` (`:2706-2712`) | Could not determine (computed at runtime) | No | **COULD NOT DETERMINE** — unchanged; runtime-computed geometry, needs a render |
| Scrubber track | `height: 6px; border-radius: 3px; background: #e8e8e8` | `.scrubber-track` (`Carousel.svelte:460-470`) = `height: 4px; background: var(--surface-sunk)` | COSMETIC | No | **FIXED** (`f7a8d4b`) — `.scrubber-track` is now `height: 6px; border-radius: 3px` on `--surface-sunk` (`Carousel.svelte:465-468`) |
| Scrubber thumb | `width: 46px; height: 14px; border-radius: 7px; background: #9a9aa0` | `.scrubber-handle` (`Carousel.svelte:471-483`) = `width: 32px; height: 14px; radius 7px; background: var(--ink-soft)` (#5c5c5c, not `--silver-edge` #9a9aa0) | COSMETIC | No | **FIXED** (`f7a8d4b`) — `.scrubber-handle` is now `width: 46px; height: 14px; border-radius: 7px; background: var(--silver-edge)` = #9a9aa0 (`Carousel.svelte:475-479`) |
| Now-playing title | `font-size: 24px; font-weight: 600; letter-spacing: -0.015em; text-align: center` | `.info-title` (`:2614-2622`) = `--fs-lg` *(token since deleted)*, weight **700**, no letter-spacing; centred inline at `:2123` | COSMETIC | No | **FIXED** (`f7a8d4b`) — `.info-title` is `font-size: var(--fs-display)` (24px), `font-weight: 600`, `letter-spacing: -0.015em` (`RomManagementTab.svelte:2786-2796`) |
| Now-playing sub-line | `Genesis / Mega Drive` (14px, #5c5c5c) · a 3px round dot · mono `Aerobiz Supersonic.md · 1 MB` | `:2124-2127` renders an **`.info-tag` chip** (`MD`, uppercase, filled `--surface-sunk`, `:2628-2636`), a separate `.info-size`, and a filename with a `border-left` divider — no dot separator, no full system name | WRONG | No | **FIXED** (`f7a8d4b`) — the chip and the border-left divider are gone: `.info-system` (full console name) · a 3px round `.info-dot` · `.info-meta` as one run (`RomManagementTab.svelte:2802-2818`) |
| Status pill in the now-playing block | Artboard's now-playing block has **no** control (`<div …gap:8px>` is empty in the markup) | `StatusChip` at `:2129-2136` | EXTRA | Yes — the artboard's empty action slot may be an omission rather than a decision | **CONFIRMED — keep (2026-09-08 sweep).** The artboard's empty action slot specifies no value to implement, and the chip carries live state. Not cut for absence. |
| Summary notch | `position: absolute; left:50%; translate(-50%,-100%)`, white, `border: 1px solid #d8d8d8; border-bottom: none; border-radius: 7px 7px 0 0; padding: 7px 20px 8px; 12px/600; color:#5c5c5c` + chevron | `.tabrow`/`.summary-tab` (`:2721-2739`) — same radius/border/white; `padding: 5px 16px 6px`, `color: var(--ink)` (artboard `#5c5c5c` here, `#1b1b1b` in LibrarySummary) | COSMETIC | No | **FIXED in part** (`bc71f68`) — the notch padding is now the artboard's `7px 20px 8px` (`RomManagementTab.svelte:2766`); the ink is `--ink`, which matches LibrarySummary but not RomsNewSystem — the two artboards disagree |
| Footer dock width | The dock is a **sibling** of the scrolling body, not a child of it: `Roms.dc.html:89` caps the body at `padding: 22px 40px 32px` while the dock below runs the artboard's full width, edge to edge | The `--maxw` cap sat on `.tabpane` itself, so the dock was nested **inside** it. A child can cancel its parent's padding with negative margins but cannot cancel a `max-width`, so above a 1440px viewport (1360 + 2x40) the dock stopped short of the page edge — 280px short each side at 1920 | WRONG | No | **FIXED** (`f2ad9db`) — `.tabpane.docked` drops `.page-body` and the view re-applies the cap to its own `.pagecol`, making the dock a sibling of the capped column. The negative margins are gone with it. **Found by the owner looking at the running app at his own window width**, not by this survey — the delta is invisible below 1440px, and every static pass read the CSS rather than resolving it at a width |
| Meter strip | `display:flex; height:3px; background:#d8d8d8` with two children `7%` `#3e9e4e` and `5%` `#9a9aa0` | `.meter`/`.meter-fill`/`.meter-pending` (`:2797-2813`) = `--hairline` track, `--zelda-green` + `--silver-edge` segments | conforms (audit 1.8 FIXED — agree) | No | **CONFIRMED** — unchanged, still conforms |
| Footer bar | `background:#ffffff; padding: 0 40px; min-height:72px; max-height:88px` | `.bar` (`:2781-2792`) — identical, plus `border-top: 1px solid var(--hairline)` | conforms | No | **CONFIRMED** — unchanged, still conforms |
| Footer left caption | `3.54 MB of 50 MB projected` — the words **`of` … `projected`** are copy | `budgetText` (`:1454-1458`) returns `` `${MiB(meterUsed)} MiB / ${MiB(gapBytes)} MiB` `` — a bare slash; no such string exists (`grep "projected"` over `i18n/strings/*.ts` hits only `totalProjectedSizeLabel` and `gamesProjected`) | **WRONG (copy)** | Yes — needs a new i18n key, i.e. a seven-file edit | **FIXED** (`bc71f68`) — new key `summary.projected` (`roms.ts:154`) in all seven locales, wired at `RomManagementTab.svelte:1467` |
| Footer net-change | `+0.12 MB net change`, `13px; color:#3e9e4e; font-weight:500; margin-left:14px` | `netChangeText` (`:1461-1467`) returns `+0.12 MiB` only — the words `net change` are dropped. The key `summary.netChange` (`roms.ts:152`) exists but is used for the summary row detail (`:1348`), not the bar | **WRONG (copy)** | No — the string already exists; the bar just doesn't use it | **FIXED** (`bc71f68`) — the dock now uses the existing `summary.netChange` sentence (`RomManagementTab.svelte:1477`) |
| Footer unit | `MB` throughout the footer | `MiB` throughout (`:1455-1466`) | COSMETIC | Yes — MB vs MiB is a product-wide wording call, not a typo | **FIXED** (2026-09-08 sweep) — every user-facing unit in the footer is now **MB**: `budgetText` (`RomManagementTab.svelte:1464`), `summary.projected` and `summary.netChange`. The remaining `MiB` occurrences are a local *helper identifier* (`const MiB = …`, `:178`) and log/comment text, not rendered copy. Applies the owner's MB ruling. |
| `Additional options` | `13px/600; color:#1b1b1b` + chevron | `.opts-toggle` (`:2846-2858`) = `--fs-btn-sm`/600/`--ink` + caret; copy `additionalOptions: "Additional options"` (`roms.ts:153`) | conforms — character-identical | No | **CONFIRMED** — unchanged, still conforms |
| Primary action | `Sync Library`, `#c8372b`, `#ffffff`, `14px/600`, `padding: 9px 22px`, `border-radius: 5px`, `inset 0 -2px 0 #9e2a20` | `.install-btn` (`:2859-2870`) = `--action-red`, `--r-btn`, `--pad-btn`, `inset 0 -2px 0 var(--action-red-deep)`; copy `syncLibraryButton: "Sync Library"` (`roms.ts:58`), used at `:2291` and `:2309` | conforms — character-identical | No | **CONFIRMED** — unchanged, still conforms |
| Firefox ZIP button | Not drawn | `downloadZipButton: "Download SD ZIP"` replaces the primary action at `:2294-2301` | EXTRA | No — recorded under S6.8's family | **CONFIRMED — keep.** Re-walked 2026-09-08 sweep: unchanged and correct; Firefox has no File System Access API, so the ZIP path is the only way to finish. Recorded under S6.8, no work implied. |

**Could not determine (RomsNewSystem)**
- Whether the coverflow's rendered card geometry/perspective matches (runtime-computed).
- Whether the two-segment meter's proportions read correctly at small percentages.
- Whether the header/tab strip conforms — it belongs to `App.svelte`, outside this survey's files.

---

## RomsSdNoCard.dc.html  (newer generation — governing)

| Element | Artboard specifies (quoted) | Implementation (file:line) | Severity | Owner decision needed? | Status (2026-09-07) |
| --- | --- | --- | --- | --- | --- |
| Footer left caption, no-card state | `Choose an SD card to install` | No such string anywhere: `grep -rn "Choose an SD" apps/web/src` returns nothing. In SD mode `flashGateNote` returns `null` unconditionally (`:1408-1409`) so the `.gate-note` branch (`:2266-2267`) can never fire, and `budgetText` falls through to `` `${MiB(selectedTotalBytes)} MiB` `` (`:1455`) — a size, where the artboard names the missing prerequisite | **MISSING (copy + state)** | Yes — new i18n key (seven-file edit) plus a decision on whether SD gets a gate-note equivalent of Flash's | **FIXED** (`c7aae47`) — a separate `sdGateNote` derived from `device.sdReady` alone now feeds the bar (`RomManagementTab.svelte:1419-1423`), copy `roms.sdSync.chooseCardPrompt` (`roms.ts:90`) in all seven locales. No `device.partitions`-derived state is consulted in SD mode. One of the five real bugs |
| Net-change span, no-card state | Present but **empty** (`<span …>` with no text) — i.e. the slot is kept, the value withheld | `netChangeText` returns `null` in SD mode (`:1462`) and the span is `{#if}`-guarded away (`:2270`) — same visual result | conforms in effect | No | **CONFIRMED** — unchanged, conforms in effect |
| Primary action, no-card state | `Sync Library`, drawn **identically** to the ready state (no disabled treatment drawn) | `:2285-2292` renders `Sync Library` with `disabled={!device.sdReady || !sdSyncHasChanges}`, `.install-btn:disabled { opacity: 0.5 }` (`:2871-2874`) | EXTRA (a disabled state the artboard doesn't draw) | Yes — the artboard shows no disabled affordance for this exact state; someone must say whether 50% opacity is right | **BLOCKED** — re-verified 2026-09-08 sweep: unchanged, and deliberately so. Touching the SD path's disabled gate is behaviour on the SD/Flash split CLAUDE.md guards (AUDIT_NOTES #14). Needs the owner's call, not a repaint. **RE-STATUSED 2026-09-08** (`docs/BLOCKED-AUDIT.md`): Q10 — the SD no-card disabled treatment. |
| Meter strip, no-card state | Still drawn (`3px`, `#d8d8d8` + `7%` green + `5%` grey) | Suppressed in SD mode by design — `{#if device.targetMedia !== "sd" …}` (`:2261`), with a comment citing CLAUDE.md's SD-vs-Flash budget rule | WRONG vs artboard, but **the code is right** | Yes — the artboard is arguably the defect here (it reuses Flash's meter on an SD screen); needs an explicit call | **CONFIRMED** — re-verified 2026-09-08 sweep: unchanged; **the code remains right**. The artboard reuses Flash's meter on an SD screen, and SD has no gap total to meter against. **RE-STATUSED 2026-09-08** (`docs/BLOCKED-AUDIT.md`): settled: CLAUDE.md's SD-vs-Flash budget rule forbids SD mode reading `device.partitions`-derived state, and SD has no gap total to meter against. The code is right and the artboard is the defect; this needed a rule, not a ruling, and the rule already exists. |
| Summary notch, no-card state | Present and identical | `{#if targetValid}` (`:2167`) — and `targetValid` is `device.sdReady` in SD mode (`:1430`), so with **no card the notch disappears** | WRONG | Yes — same question as the meter: artboard shows the summary reachable with no card | **CONFIRMED** — re-verified 2026-09-08 sweep: unchanged; same question as row 253 and the same SD/Flash guard. **RE-STATUSED 2026-09-08** (`docs/BLOCKED-AUDIT.md`): settled by the same SD-vs-Flash rule as row 319. |
| Everything else | Byte-identical to `RomsNewSystem` | see that table | — | — | — see the `RomsNewSystem` table |

**Could not determine (RomsSdNoCard)**
- Whether the artboard intends the meter/notch to be live-but-empty or is simply a copy of the
  ready-state artboard with one caption swapped. The markup cannot distinguish the two.

---

## Roms.dc.html  (re-walked 2026-09-08 against the `31cc2f7` correction)

**The "older generation" caveat this section carried is retired.** The corrected board is the
four-tab generation. Each row's verdict survives, but the reason changes: the board no longer
conflicts with the code, so "superseded" becomes "conformant".

| Element | Artboard specifies (quoted) | Implementation (file:line) | Severity | Owner decision needed? | Status (2026-09-07) |
| --- | --- | --- | --- | --- | --- |
| Four-tab strip | `Overview` / `Firmware` / `Sources` / `Library`, `14px/600`, `0.02em`, `gap: 34px`, active `inset 0 -3px 0 #3e9e4e` | `Advanced.svelte:381-388` — same tabs, same gap, same inset | conforms | No | **CONFIRMED** — re-walked 2026-09-08: the board now draws the app's own four tabs, so this is conformance, not supersession |
| Row checkbox | **The corrected board draws none.** The row is name / size / pill | Absent by design; rows end in a `StatusChip` (`RomManagementTab.svelte:2095-2104`) | conforms | No | **CONFIRMED** — re-walked 2026-09-08: the checkbox is gone from the board too |
| Row name weight | `font-size: 14px; color: #1b1b1b`, one weight for every row | `.gname` is `14px / 400 / var(--ink)` for every row (`:2535-2544`), with the reasoning at `:2533-2534` | conforms | No | **CONFIRMED** — re-walked 2026-09-08: the corrected board is single-weight too |
| Status pill | `12px/600`, `border-radius: 999px`, `padding: 4px 12px`, `min-width: 80px`, centred, nowrap; green `#3e9e4e` + `inset 0 -1px 0 rgba(0,0,0,0.18)` (`installed`), blue `#007bff` (`install`), grey `#e8e8e8` + `rgba(0,0,0,0.06)` (`not installed` / `prepare`) | `StatusChip.svelte` — `--fs-chip` 12px, 600, `999px`, `4px 12px`, `min-width: 5rem`, `--zelda-green` / `--info-blue` / `--surface-sunk`, `--chip-inset` / `--chip-inset-soft` | conforms, token for token | No | **CONFIRMED** — re-walked 2026-09-08: the corrected board replaced the uppercase caption with this pill, which is what shipped |
| Primary action label | `Sync Library` | `roms.install.syncLibraryButton` (`:2320`, `:2338`) | conforms | No | **CONFIRMED** — re-walked 2026-09-08: the corrected board says `Sync Library` itself |
| Footer caption composition | Two spans: `3.54 MB of 50 MB projected` (`13px #5c5c5c`) and `+0.12 MB net change` (`13px #3e9e4e/500`, `margin-left: 14px`) | Two spans — `budgetText` / `netChangeText` (`:2299`), both via `formatSize`, so the whole-MB trim holds | conforms | No | **CONFIRMED** — re-walked 2026-09-08: the corrected board splits it too, and drops the `.00` |
| Summary notch | A centred tab handle above the bar: `translate(-50%,-100%)`, `12px/600 #5c5c5c`, `border-radius: 7px 7px 0 0`, `padding: 7px 20px 8px`, chevron `M5 12l5-5 5 5` | Implemented (`0ebbe67`) | conforms | No | **CONFIRMED** — re-walked 2026-09-08: the row's premise ("no summary tab at all") was false as of `31cc2f7`; the board draws the notch |

**Could not determine (Roms)** — nothing beyond what is listed for `RomsNewSystem`; this
artboard adds no surface the newer one lacks.

---

## RomsOptions.dc.html  (re-walked 2026-09-08; only its three-column drawer is surveyed)

The rest of `GameDetailsPanel.svelte` (2236 lines) has **no artboard behind it** — recorded as
**S6.1**, still OPEN/BLOCKED. Nothing below invents a comparison for those parts.

| Element | Artboard specifies (quoted) | Implementation (file:line) | Severity | Owner decision needed? | Status (2026-09-07) |
| --- | --- | --- | --- | --- | --- |
| Drawer surface | The bottom dock: `border-top: 1px solid #d8d8d8; border-radius: 10px 10px 0 0; box-shadow: 0 -10px 28px rgba(0,0,0,0.09); padding: 26px 40px 30px`, with an `Additional options — <game>` section caption (11px/700/0.11em uppercase) and a 15px close X | `.drawer` / `.drawer-head` / `.drawer-title` / `.drawer-x` (`RomManagementTab.svelte:2850-2892`), title composed at `:1487-1493` | conforms | No | **CONFIRMED — re-walked 2026-09-08 against the corrected board.** The row's premise is gone: the board no longer draws a free-standing card, it draws this dock. What was decided on "the newer generation wins" is now settled by the board's own text, and `0ebbe67` built the caption. |
| Three columns | `repeat(3, minmax(0, 1fr)); gap: 28px` | `GameDetailsPanel.svelte:1520-1526` (`.bare` path) — identical | conforms (audit 1.6 FIXED — agree) | No | **CONFIRMED** — unchanged, still conforms |
| Column rules | cols 2-3 `border-left: 1px solid #ededed; padding-left: 28px` | `:1536-1539` — identical, `--rule` = `#ededed` | conforms | No | **CONFIRMED** — unchanged, still conforms |
| Column headings | `11px/700; letter-spacing:.11em; color:#5c5c5c; text-transform:uppercase`, **no rule under** | `:1541-1548` matches; `:1555-1557` hides the `<hr/>` at `:907` in `.bare` | conforms | No | **CONFIRMED** — unchanged, still conforms |
| Heading copy | `Cover art` / `Saves` / `Cheats` | `"Cover Art"` (`roms.ts:162`), `"Saves"` (`:190`), `"Cheats"` (`:206`) — casing differs on the first | COSMETIC (copy) | No — CSS uppercases it, so it is invisible in en; still differs at source | **FIXED** (`ce09a2b`) — the heading is sentence-cased to `Cover art` (`roms.ts:164`) |
| Cover-art header icons | Two 15px glyphs (download-tray, gear), `stroke #5c5c5c` | `.panel-head-actions` (`:881-905`), 16px, same two glyphs; the download/import one is gated on `ssUsername` | WRONG (conditional presence) | No | **BLOCKED** — re-verified 2026-09-08 sweep: unchanged. Behaviour, not paint (un-gating offers a ScreenScraper fetch with no credentials behind it). **RE-STATUSED 2026-09-08** (`docs/BLOCKED-AUDIT.md`): Q11 — the cover-art panel in file mode. Rows 361, 362, 363 and 367 are the same question. |
| `Source` row | Label `Source` (13px, #5c5c5c) + a 32px control, `border:1px solid #dcdcdc; border-radius:2px; min-width:148px`, value `ScreenScraper` | `:909-918` label `sourceLabel: "Source:"` (`roms.ts:165`) — trailing colon the artboard does not have; options are `File`/`Scraper` (`:166-167`), not `ScreenScraper` | WRONG (copy) | Yes — is the scraper named in the option, or is the source picker a different axis? | **FIXED** (2026-09-08 sweep) — `sourceLabel: "Source"` (`roms.ts:167`); the trailing colon the artboard does not draw is gone. The `File`/`Scraper` option naming is a separate, still-open question. |
| `Variant` row | Label `Variant`, value `Box art` | `variantLabel: "Variant:"` (`roms.ts:168`), option `variantBoxart: "Boxart"` (`:169`) | WRONG (copy: `Variant:` vs `Variant`, `Boxart` vs `Box art`) | No | **FIXED** (`ce09a2b` + `ff33d9e`) — `variantLabel: "Variant"` (colon dropped, `roms.ts:170`) and `variantBoxart: "Box art"` (`roms.ts:171`), English only; de/pl keep `Boxart`, which is the native spelling |
| Variant row visibility | Always present | Only rendered when `coverSource === 'scraper'` (`:921`) | WRONG (conditional) | No | **BLOCKED** — re-verified 2026-09-08 sweep: unchanged. Behaviour: no artboard says what the Variant row should control in file mode. **RE-STATUSED 2026-09-08** (`docs/BLOCKED-AUDIT.md`): duplicate of row 358 — Q11. |
| Preview box | `height:152px; background:#e8e8e8; border-radius:4px`, centred caption `Preview` | `.cover-preview-box` (`:937-947`), caption is `generatingPreview`/`configureToPreview`/`coverPreviewAlt` (`roms.ts:174-175,187`) — never the word `Preview`; and the box only exists in scraper mode | WRONG | No | **BLOCKED** — re-verified 2026-09-08 sweep: unchanged. Behaviour: an always-on preview box has no source in file mode. **RE-STATUSED 2026-09-08** (`docs/BLOCKED-AUDIT.md`): duplicate of row 358 — Q11. |
| Apply + drop hint on one row | `Apply` (green `#3e9e4e` fill, `13px/600`, `7px 16px`, radius 4px) **beside** `Drop an image to override` | Mutually exclusive in code: `Apply` only in scraper mode (`:949-951`), the drop area only in file mode (`:955-975`). Copy is `dragDropOverride: "Drag & Drop or Click to override cover"` (`roms.ts:177`) | **WRONG (structure + copy)** | Yes — the artboard shows one row doing both; the code makes them alternatives | **BLOCKED** — re-verified 2026-09-08 sweep: unchanged. Structure follows from the mutually exclusive scraper/file modes; merging the row means deciding what `Apply` applies to in file mode. **RE-STATUSED 2026-09-08** (`docs/BLOCKED-AUDIT.md`): duplicate of row 358 — Q11. |
| Requests meter | `Requests today` / `842 / 20000` (11px), `height:3px; background:#d8d8d8`, fill `#1b1b1b` | `.requests-bar` (`:978-987`), copy `requestsPerDay: "Requests/Day"` (`roms.ts:178`); only when `ssUsername` | WRONG (copy) | No | **FIXED** (`ce09a2b`) — renamed to `requestsToday: "Requests today"` (`roms.ts:180`) |
| Download-covers row | Not drawn | `.download-row` (`:990-1010`), `downloadConvertedCovers` / `downloadScrapedCovers` (`roms.ts:179-180`) | EXTRA | Yes — unbacked, inherits S6.1 | **CONFIRMED** — re-verified 2026-09-08 sweep: unchanged; inherits S6.1. **RE-STATUSED 2026-09-08** (`docs/BLOCKED-AUDIT.md`): settled by *nothing is cut merely for not appearing in a mockup*. |
| Saves slot tabs | `SRAM` (dark filled `#1b1b1b`/white) / `Slot 0` / `Slot 1` (`12px`, `#5c5c5c`, radius 3px) | `:1055-1065`, copy `sram: "SRAM"`, `slotLabel: (slot) => \`Slot ${slot}\`` (`roms.ts:193-194`) | conforms (copy); chip styling not verified | No | **CONFIRMED** — copy unchanged; chip styling still unverified without a render |
| Save preview + arrows | 20px chevrons flanking a `height:168px; background:#e8e8e8; radius:4px` box captioned `Save preview` | `:1071-1101`; captions are `Loading...` / `Failed to render` / `No preview` (`roms.ts:198-200`) — the neutral `Save preview` caption has no equivalent | COSMETIC | No | **BLOCKED** — re-verified 2026-09-08 sweep: unchanged. The three shipped captions are states, not a neutral placeholder; adding a fourth is a new key with no state behind it. **RE-STATUSED 2026-09-08** (`docs/BLOCKED-AUDIT.md`): folded into row 358 — Q11 (the neutral save-preview caption is the same file-mode-vs-scraper-mode question). |
| `Written` row | `Written` (13px, #5c5c5c) right-aligned against a bold timestamp | **Not implemented** — no `Written` string in `roms.ts` and no such row between `:1101` and `:1109` | MISSING | Yes — needs the mtime plumbed plus a new key (seven-file edit) | **BLOCKED** — re-verified 2026-09-08 sweep: unchanged; still needs the mtime plumbed plus a seven-file edit. **RE-STATUSED 2026-09-08** (`docs/BLOCKED-AUDIT.md`): Q12 — the `Written` timestamp row. |
| `Download save` | Bare green text link, `13px/600; color:#3e9e4e` | `.btn download-btn` (`:1103-1109`) — a button, not a text link; copy `downloadSave: "Download Save"` (`roms.ts:201`) vs artboard `Download save` | WRONG | No | **FIXED** (`ce09a2b`) — rendered as the bare green text link the artboard draws, copy `downloadSave: "Download save"` (`roms.ts:203`) |
| Cheats `Detected game` | Label `Detected game` + the same 32px select control | `:1153` `detectedGameHeading: "Detected Game"` (`roms.ts:216`), rendered as an `<h4 class="cheats-row-head">` above the control rather than a label beside it | WRONG (copy casing + shape) | No | **FIXED** (`ce09a2b` + `ff33d9e`) — copy is `Detected game` (`roms.ts:216`) and the control is now a label-beside-select row, the same shape as the Cover art column (`GameDetailsPanel.svelte:1153-1166`) |
| Cheats `Presets` | `11px/700; letter-spacing:.09em` uppercase sub-label, then 15px checkbox rows | `:1172` `presetsHeading: "Presets"` (`roms.ts:220`) | conforms (copy) | No | **CONFIRMED** — unchanged, still conforms |
| Cheats `Manual entry` | Sub-label `Manual entry`, then `Code` / `Description` fields + a green `Add` text link | `:1185` `manualEntryHeading: "Manual Entry"` (`roms.ts:222`); `codePlaceholder: "Code"`, `descriptionPlaceholder: "Description"`, `add: "Add"` (`:223-225`) | WRONG (copy casing on the heading only) | No | **FIXED** (`ce09a2b`) — `manualEntryHeading: "Manual entry"` (`roms.ts:224`) |
| Cheats footer | `Configured` / `2 codes` on one row, `border-top: 1px solid #d8d8d8; margin-top:auto` — a closing aggregate | `:1208` renders `configuredHeading: (count) => \`Configured (${count})\`` (`roms.ts:226`) as a heading above a list of cheat rows | WRONG (structure + copy) | Yes — the artboard's closing summary row vs the code's editable list are different objects | **BLOCKED** — re-verified 2026-09-08 sweep: unchanged. The artboard's closing summary row and the code's editable cheat list are different objects; collapsing one into the other is behaviour. **RE-STATUSED 2026-09-08** (`docs/BLOCKED-AUDIT.md`): Q13 — the cheats footer. |
| `Unsupported Console` state | Not drawn | `:1114` `class:disabled` + `unsupportedConsole` (`roms.ts:207`) | EXTRA | No — inherits S6.1 | **CONFIRMED — keep (2026-09-08 sweep).** A real state with real information; not cut for absence from a mockup. Inherits S6.1. |

**Could not determine (RomsOptions)**
- Whether the drawer's rendered column heights let `margin-top: auto` footers align as drawn.
- Whether the 32px select controls render at the artboard's `border:1px solid #dcdcdc; radius:2px`
  — native `<select>` chrome varies by platform and none of this is settled statically.
- Everything in `GameDetailsPanel.svelte` outside these three columns (S6.1).

---

## LibrarySummary.dc.html  (newer generation — governing; see the generation correction above)

| Element | Artboard specifies (quoted) | Implementation (file:line) | Severity | Owner decision needed? | Status (2026-09-07) |
| --- | --- | --- | --- | --- | --- |
| Drawer shell | `background:#ffffff; border-top:1px solid #d8d8d8; border-radius:10px 10px 0 0; box-shadow: 0 -10px 28px rgba(0,0,0,0.09); padding: 26px 40px 30px` | `.drawer` (`RomManagementTab.svelte:2748-2754`) — identical, value for value | conforms | No | **CONFIRMED** — unchanged, still conforms value for value |
| Drawer height envelope | `min-height:180px; max-height:46%` on the drawer container | No equivalent constraint on `.drawer` | COSMETIC | No | **FIXED** (`ad92c77`) — `.drawer { min-height: 180px; max-height: 46vh }` (`RomManagementTab.svelte:2787-2793`) |
| Drawer title | `Install summary`, `11px/700; letter-spacing:.11em; uppercase; color:#5c5c5c` | `.drawer-title` (`:2762-2768`) at `--fs-label`/`--label-track`/uppercase but `color: var(--ink)` (artboard `#5c5c5c`); copy `summaryDrawerTitle: "Install summary"` (`roms.ts:155`) | COSMETIC | No | **FIXED** (`bc71f68`) — `.drawer-title` is now `--ink-soft` (`RomManagementTab.svelte:2791-2797`) |
| Drawer close | 15px `×` glyph, `stroke #9a9a9a` | `.drawer-x` (`:2769-2777`), 16px, `--ink-soft` | COSMETIC | No | **FIXED** (`ad92c77`) — the glyph is `width="15" height="15"` (`RomManagementTab.svelte:2199`) and `.drawer-x` takes `--ink-dim` = #9a9a9a (`:2820-2824`) |
| Table measure | `width: 560px; margin: 0 auto` | `.stat-grid` (`StatPanel.svelte:110-116`) — identical plus `max-width: 100%` | conforms (audit 1.4 FIXED — agree) | No | **CONFIRMED** — unchanged, still conforms |
| Column template | `minmax(0, 1fr) 86px 104px` | `StatPanel.svelte:121` — identical | conforms | No | **CONFIRMED** — unchanged, still conforms |
| Column headers | `After` / `Change`, `11px/600; letter-spacing:.07em; uppercase; color:#9a9a9a`, right-aligned | `.sg-head` (`:125-132`, `:164-167`); copy `colAfter: "After"`, `colChange: "Change"` (`roms.ts:156-157`) | conforms — character-identical | No | **CONFIRMED** — unchanged, still conforms |
| Row rule / padding | `border-bottom: 1px solid #ededed; padding: 9px 0` | `.sg-row` (`:135-138`) — identical | conforms | No | **CONFIRMED** — unchanged, still conforms |
| Row label type | `14px/500` | `.sg-name` (`:139-147`) — identical | conforms | No | **CONFIRMED** — unchanged, still conforms |
| `After` cell | `14px/600`, mono, `tabular-nums`, right | `.sg-num` (`:155-163`) — identical | conforms | No | **CONFIRMED** — unchanged, still conforms |
| `Change` cell | `13px`, `+N` in `#3e9e4e/600`, `−N` in `#8a241b/600`, nothing = `—` in `#c8c8c8` | `.sg-num.change` (`:168-176`) — `+` → `--zelda-green`, `−` → `--danger`, dash → `--ink-faint` | COSMETIC (`--danger` vs the artboard's darker `#8a241b`) | No | **CONFIRMED — the row is a false positive.** `tokens.css:41` is `--danger: #8a241b`, exactly the artboard value; `.sg-num.change` was always conformant in light theme (the artboards are light-only). Nothing to do |
| Total row | `border-top: 1px solid #d8d8d8; margin-top:3px; padding: 11px 0 2px`, label and figure at `700`, **no bottom rule** | `.sg-row.total` (`:180-191`) — identical | conforms | No | **CONFIRMED** — unchanged, still conforms |
| Row set + order | `Games`, `Homebrew`, `Emulators`, `BIOS`, `Cover art`, `Cheats`, `Total` | `SUMMARY_ROW_ORDER` (`sources/summaryRows.ts:32-40`) — same keys, same order, pinned by a test | conforms (order) | No | **CONFIRMED** — unchanged, still conforms (pinned by a test) |
| First row's label | `Games` | `romsLabel: "ROMs"` (`roms.ts:135`), used at `:1317` and `:1357` | **WRONG (copy)** | Yes — "ROMs" vs "Games" is a naming decision that also touches the tab name | **FIXED** (2026-09-08 sweep) — `romsLabel: "Games"` (`roms.ts:136`), the artboard label. The tab-name conflict the row worried about is gone: the newer generation names the tab **Library**, not ROMs. |
| Total row's label | `Total` | `totalProjectedSizeLabel: "Total projected size"` (`roms.ts:140`) | **WRONG (copy)** | Yes — same call; the artboard's `Total` is deliberately terse under a `Change` column | **FIXED** (2026-09-08 sweep) — `totalProjectedSizeLabel: "Total"` (`roms.ts:141`), the artboard's terse label. Also the shorter string, per the owner's no-filler rule. |
| `Homebrew` / `Emulators` / `Cover art` / `Cheats` labels | as quoted | `homebrewLabel`, `emulatorsLabel`, `coverArtLabel`, `cheatsLabel` (`roms.ts:136-139`) | conforms — character-identical | No | **CONFIRMED** — unchanged, still character-identical |
| BIOS inline note | `BIOS` + `needs a file` at `12px/600; color:#b8860b; margin-left:9px` | `.sg-note` (`StatPanel.svelte:148-153`) = `--fs-micro`/600/`--caution` (=`#b8860b`); copy `needsAFile: "needs a file"` (`i18n/strings/sources.ts:121`) | conforms — character-identical | No | **CONFIRMED** — unchanged, still character-identical |
| Caution aside | `position:absolute; right:0; top:26px; width:270px; border-left:1px solid #ededed; padding-left:16px` | `.summary-layout > .bios-missing` (`RomManagementTab.svelte:2368-2378`) — identical, behind `@media (min-width: 1100px)` | conforms (audit 1.4 FIXED — agree) | No | **CONFIRMED** — unchanged, still conforms |
| Aside label | `Missing file`, `12px/600; color:#b8860b`, with a 13px warning triangle | `.bm-label` (`:2393-2397`) + `missingFile: "Missing file"` (`sources.ts:122`) — **no triangle glyph** | MISSING (icon) | No | **FIXED** (`bc71f68`) — the 13px caution triangle now sits 6px before the label (`RomManagementTab.svelte:1965-1968`, `.bm-label` `:2411-2415`) |
| Aside body | `Atari Lynx needs lynxboot.img.` — `<system> needs <file>.` | `missingDetail: (system, filename) => \`${system} needs ${filename}.\`` (`sources.ts:123`) — same sentence; the mono treatment of the filename is not reproduced (`.bm-text` is one span, `:2398-2403`) | COSMETIC | No | **BLOCKED** — re-verified 2026-09-08 sweep: unchanged. Mono-setting only the filename means splitting `missingDetail` into Pre/Post fragments across seven locales — exactly the fragment-composition bug class CLAUDE.md warns about — to win a font change on one word. **RE-STATUSED 2026-09-08** (`docs/BLOCKED-AUDIT.md`): Q14 — mono-setting the filename in the BIOS-missing aside. |
| Aside is a button | Static text in the artboard | `<button class="bios-missing">` (`:1952-1955`) that opens the file prompt, styled to look like the note | EXTRA (behaviour only) | No — justified in the comment at `:1949-1951` | **CONFIRMED — keep (2026-09-08 sweep).** Justified in the comment at its call site; the note is the fastest route to fixing what it reports. Recorded, no work implied. |
| Drawer scroll | `flex: 1 1 auto; min-height: 0; overflow-y: auto` on the drawer body | No overflow handling on `.drawer` | COSMETIC | No | **FIXED** (`ad92c77`) — `.drawer-body { flex: 1 1 auto; min-height: 0; overflow-y: auto }` and `.drawer-head { flex-shrink: 0 }`, so the body scrolls and the title/close stay reachable (`RomManagementTab.svelte:2795-2806`) |
| Extra drawer content | Artboard shows the table and the aside, nothing else | LZMA checkbox (`:2248-2251`) and the SD `syncCores` + core-version `<select>` (`:2220-2236`) | EXTRA | Yes — already recorded as **S6.11 (OPEN/BLOCKED)**; cited, not re-opened | **CONFIRMED** — re-verified 2026-09-08 sweep: unchanged; recorded as S6.11. **RE-STATUSED 2026-09-08** (`docs/BLOCKED-AUDIT.md`): settled by *nothing is cut merely for not appearing in a mockup*. |

**Could not determine (LibrarySummary)**
- Whether the aside actually clears the 560px table at real drawer widths (the `1100px` media
  query is a static guess at the crossover; only rendering settles it).
- Whether `--danger` reads as the artboard's `#8a241b` in either theme.
- Dark theme for the whole drawer (audit S7.16, still unlooked-at).
# Part B — Sources / Repos artboards vs implementation

Worktree: `/home/doug/Nerd/git/gnw-web-builder/.worktrees/wt-re2`. No code changed.
Line numbers are from that worktree at survey time.

Artboards walked in full: `Repos.dc.html`, `ReposAdd.dc.html`, `ReposDetail.dc.html`,
`ReposDetailReady.dc.html`, `ModalSources.dc.html`, `ModalSourcesEmpty.dc.html`.

Conventions used: values that are manifest/device/user data (repo slugs, titles, tags, dates,
byte counts, console names, extension lists, BIOS/converter input labels) are **runtime data**
and are never reported as missing copy. The shared page chrome (header badges, tab strip, gold
lip) is Part A's subject and is not re-audited here.

---

## Repos

| Element | Artboard specifies (quoted) | Implementation (file:line) | Severity | Owner decision needed? | Status (2026-09-07) |
|---|---|---|---|---| --- |
| Page title | `"Sources"` at `font-size: 24px; font-weight: 600; letter-spacing: -0.015em` | `views/Sources.svelte:444` `{t.heading}`; `h2` is `--fs-display` (24px) `Sources.svelte:554-557`; `strings/sources.ts:8` | — (conformant) | no | **CONFIRMED** — unchanged, still conforms |
| Subheading under the title | Artboard has **no** sub-line: the header row is title + Add only (`Repos.dc.html:73`) | `Sources.svelte:445` `<p class="sub">{t.subheading}</p>` = `"Projects this tool can install emulators and homebrew from."` (`strings/sources.ts:9`) | EXTRA | yes — keep the explanatory line or match the artboard's bare header | **FIXED** (`88db01a`) — DECIDED: dropped. The artboard's bare header wins; the line restated what the page and its two column captions already say. `subheading` removed from all seven locales |
| Add affordance | A green **text** affordance: `<svg … stroke="#3e9e4e" …><path d="M10 4v12M4 10h12">` + `<span style="font-size: 14px; font-weight: 600; color: #3e9e4e;">Add</span>` — a plus glyph and the word `Add`, no box | `Sources.svelte:447-453` `<Button variant="ink">{t.addSource}</Button>`; `ink` is a bordered white button (`ui/Button.svelte:80-88`); label is `"Add source"` (`strings/sources.ts:18`) | WRONG (shape, colour and copy: no plus icon, boxed not text, `Add source` vs `Add`) | yes — the green text+plus link vs a button is a design call | **FIXED** (`88db01a`) — the header Add is now the artboard's bare green plus-glyph + `Add` at 14px/600 green, no box; `addSource` survives as the button's accessible name |
| Column captions | `"Emulators"`, `"Homebrew"`, `font-size: 11px; font-weight: 700; letter-spacing: 0.11em; text-transform: uppercase; color: #5c5c5c` | `Sources.svelte:457,460`; `.col h3` `:579-585` (`--fs-label` 11px, `--label-track`, uppercase, `--ink-soft`) — but `font-weight` is not set, so it inherits the `h3` default (bold, ~700) | — (conformant) | no | **CONFIRMED** — unchanged, still conforms |
| Two-up grid | `display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 30px; align-items: start` | `Sources.svelte:568-573`, lifted verbatim (comment at `:564`) | — | no | **CONFIRMED** — unchanged, still conforms |
| Footer bar width | `Repos.dc.html:76` draws the 72px bar as a sibling of the two-up body, full width — `border-top: 1px solid #d8d8d8; padding: 0 40px; min-height: 72px` with no cap | Same defect as the Library dock: the `--maxw` cap lived on `.tabpane`, so the bar was inside it and stopped at the capped column above 1440px | WRONG | no | **FIXED** (`f2ad9db`) — same change; `Sources.svelte` re-applies `.page-body` to its own `.pagecol` (`:262`) and the bar is a sibling of it. The Firmware pane was already correct — `.tabpane.bleed` drops the cap, which is why that tab was the one that "just sits" |
| Row panel | `background: #ffffff; border-radius: 6px; padding: 2px 18px`, rows split by `1px solid #ededed` | `Sources.svelte:589-593`, `.row + .row` `:607-609` | — (S2.6 FIXED confirmed) | no | **CONFIRMED** — unchanged, still conforms |
| Row name | `font-size: 15px; font-weight: 600` | `Sources.svelte:481`; `.name` `:621-624` uses `--fs-body` = **16px** (`styles/tokens.css:62`) | COSMETIC | no | **FIXED** (`884ebdd`) — `.name` is now the artboard's literal 15px (`Sources.svelte:640-642`), with a comment noting no 15px token exists |
| Row `curated` chip | Six occurrences, e.g. `<span style="… text-transform: uppercase; color: #5c5c5c; background: #f0f0f0; …">curated</span>` | Absent (`grep -rn curated apps/web/src` → nothing) | — | no — **already recorded**, and the artboard is stale: audit **finding 2.7** (STATUS: WRONG) cites `docs/UX_DESIGN.md:130` dropping the `curated`/`Installed` chips. My walk agrees with the audit, not the artboard. | **CONFIRMED WRONG (row is right to dismiss it)** — the `curated` chip was dropped from the design (`docs/UX_DESIGN.md:130`); not a gap and never was |
| Homebrew row meta `Installed` | `"Installed"` on the Mine Sweeper row | Absent | — | no — same dropped-chip decision, audit **2.7** | **CONFIRMED** — same dropped-chip decision; not a gap |
| Row meta line | `WonderSwan, WS Color · .ws .wsc` `<span style="color:#c8c8c8; margin:0 8px;">|</span>` `4 ROMs matched`, `font-size: 13px; color: #5c5c5c` | `Sources.svelte:483-488` + `sources/metaLine.ts`; `.meta` `:630-634` is `--fs-caption` = **14px** (`tokens.css:61`), `.sep` `:635-638` is `--ink-faint`, `margin: 0 8px` | COSMETIC (13px vs 14px) | no | **FIXED** (`884ebdd`) — `.meta` is now `--fs-btn-sm` 13px (`Sources.svelte:651`) |
| Meta variants | `"No ROMs"`, `"Needs newer firmware"`, and a row with extensions only | `strings/sources.ts:63-69`; mapped at `Sources.svelte:102-126` | — | no | **CONFIRMED** — unchanged, still conforms |
| Right column | `width: 104px`, centred, `gap: 6px` | `Sources.svelte:643-650` | — | no | **CONFIRMED** — unchanged, still conforms |
| Version in right column | `<span style="font-size: 13px; font-weight: 600; color: #1b1b1b; white-space: nowrap;">v1.2.0</span>` — 13px, **bold**, full-strength ink, **not** monospace | `Sources.svelte:491`; `.version` `:651-655` is `font-family: var(--font-mono); font-size: var(--fs-micro)` (12px) `color: var(--ink-soft)`, no weight | WRONG (mono + soft + 12px vs proportional bold ink 13px) | no | **FIXED** (`884ebdd`) — `.version` is now proportional 13px/600 ink (`Sources.svelte:671-676`) |
| Active pill | `color:#ffffff; background:#3e9e4e; border:1px solid #3e9e4e; border-radius:999px; padding:3px 12px; font-size:12px; font-weight:600` | `Sources.svelte:492`, `.pill.on` `:668-673` | — (S2.8 FIXED confirmed) | no | **CONFIRMED** — unchanged, still conforms |
| Inactive pill | `color:#5c5c5c; background:#ffffff; border:1px solid #c8c8c8; border-radius:999px; padding:3px 12px` | `.pill` `:659-667` | — (S2.8 FIXED confirmed) | no | **CONFIRMED** — unchanged, still conforms |
| Selected row | `background:#f6f8f6; box-shadow: inset 2px 0 0 #3e9e4e; padding:15px 18px; margin:0 -18px` | `.row.sel` `:611-616` | — | no | **CONFIRMED** — unchanged, still conforms |
| Footer bar | `border-top:1px solid #d8d8d8; background:#ffffff; padding:0 40px; min-height:72px; margin-top:auto`, left `PC Engine` (the selected name, 13px/600 **`#1b1b1b`**) | `Sources.svelte:504-535`; `.bar` `:680-692`; `.barname` `:693-696` is `--fs-caption` (14px) `--ink-soft` | COSMETIC (bar name is soft grey 14px vs ink 13px/600) | no | **FIXED** (`88db01a`) — `Activate`/`Deactivate` is now the filled dark cap (`Button` variant `ink-solid`). See row 845: the fill won for BOTH states |
| Footer bar, nothing selected | Not drawn (every Repos state has a selection) | `Sources.svelte:508-510` shows `t.noSelection` = `"Select a source to configure it."` (`strings/sources.ts:55`) | EXTRA (no artboard behind it; a reasonable filler) | no | **CLOSED** — DECIDED: kept. The bar is always rendered, so the slot needs copy for the state the artboards never draw |
| Footer actions | `Configure` (grey outline `border:1px solid #d8d8d8; color:#5c5c5c`) then `Deactivate` (`border:1px solid #1b1b1b; color:#1b1b1b`) | `Sources.svelte:526` (`variant="default"`) and `:528-532` (`variant="ink"`); `Button.svelte:42-47,80-88` | — | no | **CONFIRMED** — unchanged, still conforms |

**Could not determine without a browser:** exact rendered heights of rows and the bar; whether
`.col h3`'s inherited `h3` weight lands on the artboard's 700; how the two columns behave when
one is much longer than the other (artboard has `align-items: start`, matched in CSS).

---

## ReposAdd

| Element | Artboard specifies (quoted) | Implementation (file:line) | Severity | Owner decision needed? | Status (2026-09-07) |
|---|---|---|---|---| --- |
| Page title | `"Add a repository"` | `Sources.svelte:422` `{t.addTitle}` = `"Add a source"` (`strings/sources.ts:19`) | WRONG (copy) | yes — "repository" vs the app's deliberate "source" vocabulary; one of the two has to give | **CLOSED** — DECIDED: "source" is the settled vocabulary; `ReposAdd`'s "repository" wording is stale. No code change |
| Back affordance | `<span style="font-size: 14px; font-weight: 500; color: #5c5c5c;">← Repositories</span>` | `Sources.svelte:424-431` renders `&#8592; {t.backToSources}` = `"← Back to sources"` (`strings/sources.ts:58`) | WRONG (copy) | yes — same vocabulary decision | **CLOSED** — DECIDED: same as above, "source" stands. No code change |
| Mode tabs | `URL` active with `box-shadow: inset 0 -2px 0 #3e9e4e; font-weight:600`, `Bundle zip` `font-weight:500; color:#5c5c5c`, `gap: 22px` | `ui/AddSource.svelte:135-148`, `.modes/.mode/.mode.on` `:246-265` | — (S2.5 FIXED confirmed) | no | **CONFIRMED** — unchanged, still conforms |
| URL field | `height: 44px; background:#ffffff; border:1px solid #dcdcdc; border-radius:2px; padding: 0 14px; flex:1`, mono 14px | `AddSource.svelte:152-162`; `input[type=text]` `:283-296` — 44px, mono, `--fs-btn`, `padding: 0 14px`, `--hairline` border, but `border-radius: var(--r-control)` | COSMETIC (radius token vs the artboard's flat 2px — same class of nit as the modal field) | no | **CONFIRMED (WRONG as recorded)** — `--r-control` **is** `2px` (`tokens.css:118`), so the URL field's radius already is the artboard's flat 2px; there is no delta here |
| Field placeholder | Artboard shows a typed value (runtime), not a placeholder | `AddSource.svelte:160` `t.urlPlaceholder` = `"owner/repo or https://github.com/owner/repo"` | — (no artboard claim) | no | — no artboard claim; unchanged |
| Look up button | `background:#c8372b; color:#ffffff; font-size:14px; font-weight:600; padding:9px 22px; border-radius:5px; box-shadow: inset 0 -2px 0 #9e2a20`, text `"Look up"`, right-aligned (`margin-left:auto`) | `AddSource.svelte:163-165` `<Button variant="action">` with `t.lookUp` (`strings/sources.ts:34`); `Button.svelte:55-65` | — | no | **CONFIRMED** — unchanged, still conforms |
| Hint under the field | Artboard has **no** hint line — the gap between field and `Found` is empty | `AddSource.svelte:209` `<p class="hint">{t.urlHint}</p>` = `"The project must publish a GitHub Pages mirror of its releases."` | EXTRA | yes — useful guidance with no artboard slot | **CLOSED** — DECIDED: kept, per "nothing is cut for absence from a mockup". It states a real requirement the artboard has no slot for |
| `Found` caption | `"Found"`, 11px/700/0.11em uppercase `#5c5c5c` | `AddSource.svelte:171` `t.found.caption`; `.cap` `:305-311` | — | no | **CONFIRMED** — unchanged, still conforms |
| Found panel | `background:#ffffff; border-radius:6px; padding:2px 18px`; rows `padding: 9px 0` split by `#ededed`; label `14px #5c5c5c`, value `14px/600` | `AddSource.svelte:172-206`; `.panel/.prow/.plabel/.pval` `:312-345` | — | no | **CONFIRMED** — unchanged, still conforms |
| Found rows | `Name`, `Type`, `Version` (`v0.1.0 · 4 Sep 2026`), `Firmware ABI` (`2 · supported`, green `#3e9e4e`), `Installs` (mono `minesweeper.bin · 34 KB`) | `AddSource.svelte:173-205`; labels from `t.found.name/type/installs` + reused `t.detail.version` / `t.detail.abiLabel`; `abiSupported` `strings/sources.ts:42`; green via `.pval.good` `:340-342` | — | no | **CONFIRMED** — unchanged, still conforms |
| ABI green when unknown | Artboard always green | `AddSource.svelte:114-119` is three-valued: unknown device ABI → no colour, no `· supported` | EXTRA-by-omission, deliberate and documented at `:109-113` | no | — deliberate and documented; unchanged |
| Bundle-zip tab body | Artboard does not draw the Bundle tab's body on this page | `AddSource.svelte:219-231`: stacked `Offline bundle` label + native `<input type="file">` | — | no — same shape question already OPEN as audit **3.12** (blocked on an owner decision) | **BLOCKED** — unchanged; same shape question as 3.12 **RE-STATUSED 2026-09-08** (`docs/BLOCKED-AUDIT.md`): Q15 — the Bundle-zip file-field shape. Row 548 is the same question. Note the sibling Write-pane row (survey A, W-3) is now FIXED: `FlashSection.svelte:190-201` shows the wrapper shape that works, so this is closer to a build than the row implies. |
| Footer bar | Single 72px bar, **empty on the left**, `Add` right-aligned as the red action button | `Sources.svelte:504-518`: left renders `{""}` when `addOpen`; `<Button variant="action" disabled={!addCanAdd}>` | — (S2.5 FIXED confirmed) | no | **CONFIRMED** — unchanged, still conforms |

**Could not determine without a browser:** whether the disabled `Add` reads as the artboard's
solid red (the artboard has no disabled state drawn); the real focus rings on the mode tabs
(`AddSource.svelte` sets none on `.mode`, unlike `AddSourcesModal.svelte:208-211`) — an
accessibility gap the artboards cannot arbitrate.

---

## ReposDetail

| Element | Artboard specifies (quoted) | Implementation (file:line) | Severity | Owner decision needed? | Status (2026-09-07) |
|---|---|---|---|---| --- |
| Body width | `padding: 36px 40px 40px; … gap: 30px; max-width: 900px` on the detail body only | `Sources.svelte:539-547` `.sources` has **no** `max-width`; the detail body inherits the global `--maxw` cap from `App.svelte`'s `.body`; `gap: 1rem` (16px) not 30px | WRONG (the 900px clause of audit **2.1** was never implemented, though 2.1 is marked FIXED) | yes — narrowing the detail must be scoped to this view, never to `--maxw` (CLAUDE.md) | **FIXED** (`cf14a7f` / `884ebdd`) — audit 2.1's unfinished clause landed: the detail body has its own `max-width: 900px; gap: 30px` wrapper, scoped to the view so `--maxw` is untouched (`Sources.svelte:555-562`) |
| Detail header | 24px title, mono slug `13px #5c5c5c`, kind chip, `← Back to sources` right-aligned on the same baseline | `Sources.svelte:258-271`; `.dhead/.dident/.dtitle/.dmeta` `:704-736` | — (S2.1 FIXED confirmed) | no | **CONFIRMED** — unchanged, still conforms |
| Kind chip | `font-size: 10px; … text-transform: uppercase; color:#5c5c5c; background:#f0f0f0; border-radius:2px; padding:3px 6px` | `Sources.svelte:263-265` (`t.colHomebrew`, uppercased by CSS); `.kind` `:726-736` — but `--fs-chip` is **12px** (`tokens.css:108`) vs the artboard's 10px | COSMETIC | no | **FIXED** (`884ebdd`) — the kind chip is now the artboard's 10px (`Sources.svelte:758`) |
| Version control | caption `Version`; `height: 40px; border:1px solid #dcdcdc; border-radius:2px; min-width:230px`, mono tag + grey date + custom chevron | `Sources.svelte:286-330`; `.vbox` `:791-804` (40px, 230px, `--hairline`, `--r-btn`) | — (S2.4 FIXED confirmed) | no | **CONFIRMED** — unchanged, still conforms |
| `Get older version` | `<span style="color:#3e9e4e; font-weight:600;">Get older version</span>`, 13px | `Sources.svelte:336-344` `t.detail.getOlderVersion`; `.older` `:833-845` is `--fs-btn` (14px), `font-weight: 500` | COSMETIC (13px/600 vs 14px/500) | no | **FIXED** (`884ebdd`) — `Get older version` is now 13px/600 (`Sources.svelte:869`) |
| Compatibility panel | caption `Compatibility`; rows `Firmware ABI` → green `2`, `Installs to` → mono `/roms/homebrew`, `Published` → `12 Aug 2026` | `Sources.svelte:355-373`; labels `strings/sources.ts:134-137`; `installsTo` derived `:188` | — (S2.3 FIXED confirmed) | no | **CONFIRMED** — unchanged, still conforms |
| Additional files caption | `"Additional files"` | `ui/AdditionalFiles.svelte:198` `t.additional.heading` (`strings/sources.ts:148`) | — | no | **CONFIRMED** — unchanged, still conforms |
| Row: name + need chip | `Base ROM` + `required`; `Additional Language` + `optional`; both chips identical grey | `AdditionalFiles.svelte:204-206`; chip copy `t.filePrompt.required/optional` (`strings/sources.ts:88-89`) | — (audit **2.9**'s "required should be red" clause is marked WRONG; my walk agrees — both chips are grey in the artboard) | no | **CONFIRMED** — unchanged; both chips are grey in the artboard, so 2.9's red clause stays WRONG |
| Row names / descriptions (`"Additional Language"`, `"Add languages from translated ROMs"`, `"US (NTSC) cartridge dump."`) | Present only as those rows' text | **Runtime data, not missing copy.** These are the converter input's `label`/`description` from the source manifest, resolved at `AdditionalFiles.svelte:100-111` (`pickText(input.label…)`, `pickText(input.description…)`), with `strings/sources.ts:87` as the fallback when a manifest omits a label. Correctly absent from the i18n tables. | — (not a finding) | no — **this corrects the survey's stated lead**: the strings are absent from the codebase because they are third-party manifest text, exactly like a repo slug | **CONFIRMED — not a finding.** Re-verified: these are converter-input `label`/`description` from the source manifest, resolved via `pickText` (`AdditionalFiles.svelte:100-111`). Runtime data, correctly absent from the i18n tables |
| Privacy note under the section | ~~`<div style="font-size: 13px; color: #5c5c5c; margin-top: -6px;">Runs in your browser. Your ROM never leaves your computer.</div>`~~ — **the board no longer draws this** (`cc09387` / `5992ad8`), on `ReposDetail` or `ReposDetailReady`; the column gap now separates *Additional files* from *What gets installed* directly | **Absent.** `grep -rn "never leaves your computer\|Runs in your browser" apps/web/src` → nothing. The nearest string is `strings/sources.ts:86` `subtitleConverted: "Files are converted in your browser. Nothing is uploaded."`, which is the **modal's** subtitle (`FilePromptModal`), not this line. `AdditionalFiles.svelte:195-233` renders caption → list → error and nothing else | **MISSING** | yes — either add the line (a 7-file i18n edit per CLAUDE.md) or accept the modal's subtitle as covering it | **CANCELLED** — owner ruling: the privacy note is dropped. Not to be built. **Now closed from the board side too** (`cc09387` / `5992ad8`). The direction was *board draws it, app does not*; both sides now agree, and the "add the line or accept the modal subtitle as coverage" decision in the previous column is moot. Note `ModalFilesConvert` still draws a **different** string (`Runs in your browser. Nothing is uploaded.`) which that ruling did not name — it is not this row. Verdict unchanged |
| Row state: hash OK | `<span style="color:#3e9e4e; font-weight:600;">Hash matches ✓</span>`, 13px | `AdditionalFiles.svelte:210` `{t.additional.hashMatches} &#10003;` (`strings/sources.ts:149`) | — | no | **CONFIRMED** — unchanged, still conforms |
| Row state: needs a file | `<span style="font-size:13px; font-weight:600; color:#5c5c5c;">Add a file</span>` | `AdditionalFiles.svelte:215-221` `t.additional.addAFile` (`strings/sources.ts:150`) | — | no | **CONFIRMED** — unchanged, still conforms |
| `What gets installed` | caption + rows: `binary` chip / `zelda3.bin` / `256 KB`; `data` / `zelda3.ro` / `1 MB`; `built` / `zelda3_assets.dat` / `not built yet` in `#9a9a9a`. Type chips are `font-size: 10px … width: 46px; text-align: center` | `Sources.svelte:378-406`; `strings/sources.ts:138-143`; `.itype` `:887-900` (`--fs-chip` 12px, `min-width: 46px`), `.isize.pending` `:923-925` `--ink-dim` | COSMETIC (chip 12px vs 10px) — otherwise S2.2 FIXED confirmed | no | **FIXED** (`884ebdd`) — the `what gets installed` type chips are now 10px (`Sources.svelte:923`) |
| Footer bar | `<span style="font-size:13px; color:#5c5c5c;">Not active. Activating adds it to the Library tab.</span>` + `Activate` as a **filled dark** button `background:#1b1b1b; color:#ffffff; padding:9px 26px; border-radius:5px; box-shadow: inset 0 -2px 0 #000000` | `Sources.svelte:506-511` (`t.notActiveHint`, `strings/sources.ts:59` — character-identical) and `:528-532` `<Button variant="ink">` = white surface with an ink border (`Button.svelte:80-88`) | WRONG (the primary action is an outline button where the artboard fills it black) | yes — `ink` is used app-wide; filling only this one needs a variant decision | **FIXED** (`88db01a`) — the footer primary is the artboard's filled dark cap |
| `Remove` button | Not in either detail artboard | `Sources.svelte:414-416` `<Button variant="destructive">{t.remove}</Button>` in `.dactions`, self-documented at `:941-943` | EXTRA (acknowledged in-code) | yes — keep the escape hatch or move it into the bar | **CLOSED** — DECIDED: kept. Same ruling; it is the only way to undo an add |

**Could not determine without a browser:** the real gap rhythm of the detail column (the CSS
`gap: 1rem` vs the artboard's 30px is measurable in source, but how it reads once the panels
have content is not); whether the `<select>` overlay lines up pixel-for-pixel with the drawn
`.vbox` across platforms; whether the section renders at all for a source whose manifest is not
in memory after a reload (`Sources.svelte:407-411` falls back to `t.loading`).

---

## ReposDetailReady

Identical to `ReposDetail` except for four deltas (verified by `diff`); everything above still
applies. Only the deltas are listed.

| Element | Artboard specifies (quoted) | Implementation (file:line) | Severity | Owner decision needed? | Status (2026-09-07) |
|---|---|---|---|---| --- |
| Optional-file row, satisfied | `<span style="font-size:13px; font-weight:600; color:#3e9e4e; white-space:nowrap;">German ✓</span>` — the **accepted variant's name** plus a check, in green | `AdditionalFiles.svelte:211-212` renders `t.filePrompt.found` = the literal word `"Found"` (`strings/sources.ts:91`), no check glyph, for the `"found"` state | WRONG | yes — showing the matched variant name needs the accepted variant plumbed to this row; "Found" is the fallback | **FIXED in part** (`88db01a`) — the satisfied row now carries the artboard's green check at 13px/600. The matched VARIANT NAME is not built: the row is never given it, and plumbing it is behaviour, not paint |
| `built` chip, once built | `color: #3e9e4e; background: #e9f4ec` | `Sources.svelte:384` `class:built`; `.itype.built` `:902-905` (`--zelda-green` on `--tint-success`) | — | no | **CONFIRMED** — unchanged, still conforms |
| Built file size | `<span style="font-size:12px; color:#1b1b1b; font-weight:600; …">12.4 MB</span>` — size replaces `not built yet` and goes bold ink | `Sources.svelte:395` `.isize.strong` `:919-922`; the switch is `row.bytes === undefined` at `:392` fed by `prepareState.get()` `:227` | — (S2.2 FIXED confirmed) | no | **CONFIRMED** — unchanged, still conforms |
| Total row | `border-top: 1px solid #d8d8d8`, `Total` 13px/600, `13.7 MB` 13px/700 mono | `Sources.svelte:399-404`; `.irow.total/.tlabel/.tval` `:926-939`; gated on every row having a size (`:240-248`) | — | no | **CONFIRMED** — unchanged, still conforms |
| Footer bar | `<span …>Active. Install it from the Library tab.</span>` + `Deactivate` as **plain red text** `font-size:14px; font-weight:600; color:#8a241b` with no box | `Sources.svelte:506-507` (`t.activeHint`, `strings/sources.ts:60` — character-identical) and `:528-532` `<Button variant="ink">` — an outline button, ink coloured | WRONG (text affordance vs boxed button; red vs ink) | yes — pairs with the `Activate` fill decision above; the artboard makes the two states visually asymmetric on purpose | **FIXED** (`88db01a`) — DECIDED: `ReposDetailReady`'s bare red text loses to `ReposDetail`'s filled dark cap. The owner's install-confirm ruling (the fill won) governs the same footer-primary slot, and one chrome across both states stops the bar reflowing on toggle |

**Could not determine without a browser:** whether `installTotal` ever becomes non-null in
practice for a source with a converter output (it requires `prepareState.get()` to hold every
built file); the artboard's `12.4 MB`/`13.7 MB` are runtime values and were not compared.

---

## ModalSources

The modal is reached from Guided Setup (`views/Wizard.svelte:1106`). Its surrounding wizard
spine is Part A / audit S3's subject and is not re-audited here.

| Element | Artboard specifies (quoted) | Implementation (file:line) | Severity | Owner decision needed? | Status (2026-09-07) |
|---|---|---|---|---| --- |
| Dialog shell | `width: 520px; background:#ffffff; border:1px solid #d8d8d8; border-radius:6px; box-shadow: 0 12px 40px rgba(0,0,0,0.32); overflow:hidden` | `AddSourcesModal.svelte:94` `<ModalShell maxWidth="32rem">` = **512px**; `ui/ModalShell.svelte:43,66` | COSMETIC (8px narrower) | no | **FIXED** (`87ae948`) — `maxWidth="32.5rem"` = 520px (`AddSourcesModal.svelte:94`) |
| Gold lip | `<div style="height: 3px; background: linear-gradient(180deg, #d9bc5e 0%, #c09a32 100%);">` as the dialog's first child | `ModalShell.svelte:44-46,71-74` `.gold-lip` with `--grad-gold` | — | no | **CONFIRMED** — unchanged, still conforms |
| Body padding | `padding: 22px 24px 20px; gap: 18px` | `ModalShell.svelte:75+` (padding on the inner body) + `.wrap` `AddSourcesModal.svelte:176-180` `gap: 1rem` (16px) | COSMETIC | no | **FIXED** (`e255bfa` + `87ae948`) — `ModalShell`'s body is now `1.375rem 1.5rem 1.25rem` = 22px 24px 20px (`ModalShell.svelte:78`) and `.wrap { gap: 18px }` (`AddSourcesModal.svelte:179`) |
| Title | `"Add Sources"`, `font-size: 18px; font-weight: 600; letter-spacing: -0.01em` | `AddSourcesModal.svelte:96` `locale.t.wizard.spine.sourcesButtonLabel` = `"Add Sources"` (`strings/wizard.ts:126`); `h3` `:181-184` is `--fs-lg` = **20px** (`tokens.css:63`) *(as audited; token since deleted)* | COSMETIC (20px vs 18px) | no | **FIXED** — `--fs-title` (18px) now, plus the artboard's 600/-0.01em. Was: `--fs-lg` 20px (`AddSourcesModal.svelte:183`). The 18px token this row called missing is `--fs-title`, minted and shared by every modal title; `--fs-lg` itself was retired and deleted in `51ac881` |
| Mode tabs | `URL` with `box-shadow: inset 0 -2px 0 #3e9e4e`, `Bundle zip` plain, `gap: 22px` | `AddSourcesModal.svelte:98-108`, `.mode.on` `:203-207` | — (audit **3.10** FIXED confirmed) | no | **CONFIRMED** — unchanged, still conforms |
| URL field | `height: 40px; border:1px solid #dcdcdc; border-radius:2px; padding: 0 12px; flex:1`, mono `13px`, placeholder `github.com/owner/repo` in `#9a9a9a` | `AddSourcesModal.svelte:112-118`; `input[type=text]` `:218-229` — `padding: 8px 10px` (no fixed 40px height), `--r-control` radius, `--fs-caption`; placeholder is `t.urlPlaceholder` = `"owner/repo or https://github.com/owner/repo"` | COSMETIC (height/radius) + WRONG (placeholder copy is a different, longer string than the artboard's) | yes — the artboard's short placeholder vs the implementation's explicit accepted-forms hint | **FIXED** (`a15a495`) height/radius — the field is now `height: 40px; padding: 0 12px`, mono 13px. **CLOSED** (placeholder) — DECIDED: keep the shipped one; the artboard's shorter version drops the only statement that a bare `owner/repo` is accepted. Original note: — the field is unchanged; the artboard's short placeholder vs the accepted-forms hint is still an owner call |
| Add button | `background:#c8372b; … padding: 9px 22px; border-radius: 5px; box-shadow: inset 0 -2px 0 #9e2a20`, text `"Add"` | `AddSourcesModal.svelte:119-121` `<Button variant="action">` with `t.add` (`strings/sources.ts:29`) | — | no | **CONFIRMED** — unchanged, still conforms |
| Bundle-zip tab body | Artboard keeps the same `[field][Add]` row on both tabs | `AddSourcesModal.svelte:123-134` stacked label + native file input | — | no — **already recorded**, audit **3.12** (OPEN, blocked on owner) | **BLOCKED** — unchanged; recorded as 3.12 **RE-STATUSED 2026-09-08** (`docs/BLOCKED-AUDIT.md`): duplicate of row 477 — Q15. |
| Group captions | `Emulators` / `Homebrew`, 11px/700/0.11em uppercase | `AddSourcesModal.svelte:149`; `.grouptitle` `:268-274` — `--fs-label`, uppercase, but **no `font-weight`**, so a `<div>` renders at 400 where the artboard is 700 | COSMETIC | no | **FIXED** (`87ae948`) — `.grouptitle` now sets `font-weight: 700` (`AddSourcesModal.svelte:269-270`) |
| Emulator rows | mono slug `font-size: 14px` left, systems `13px #5c5c5c` right, `padding: 9px 0`, `border-bottom: 1px solid #ededed`, `align-items: baseline` | `AddSourcesModal.svelte:151-156`; `.row` `:275-284`, `.repo` `:285-290` uses `--fs-caption`; `.systems` `:291-295` | COSMETIC (slug 14px matches `--fs-caption`; systems is 14px vs 13px) | no | **FIXED** (`87ae948`) — the systems column is now 13px (`AddSourcesModal.svelte:293`) |
| Homebrew rows | slug only, no right-hand text | `AddSourcesModal.svelte:154` guards on `group.key === "emulator"` | — | no | **CONFIRMED** — unchanged, still conforms |
| Group list max height | Artboard shows all five rows, no scroller | `.groups` `:261-267` `max-height: 40vh; overflow-y: auto` | EXTRA (defensive; no artboard claim) | no | **CLOSED** (`a15a495`) — DECIDED: kept, rationale recorded in the file. The list is unbounded at runtime and the modal has a fixed footer under it |
| Footer divider | `border-top: 1px solid #ededed; margin-top: 2px`, both halves `padding-top: 16px` | `.foot` `:297-304` `--rule`, `padding-top: 0.75rem` (12px) | — (audit **3.13** FIXED confirmed) | no | **FIXED** (`87ae948`) — the footer halves are now `padding-top: 16px` (`AddSourcesModal.svelte:303`) |
| `All sources` | `font-size: 13px; font-weight: 500; color: #5c5c5c`, **not** underlined | `AddSourcesModal.svelte:166` `t.allSources` (`strings/sources.ts:15`); `.wayout` `:305-317` — 13px/500/`--ink-soft`, no underline | — (audit **3.15**'s `.wayout` clause FIXED confirmed) | no | **CONFIRMED** — unchanged, still conforms |
| Footer primary button | Red action button reading `"Done"` | `AddSourcesModal.svelte:170` `<Button variant="action">{ts.close}</Button>` = `"Close"` (`strings/shared.ts:11`) | **WRONG (copy)** | yes — `Done` is the artboard word; `shared.common.close` is a shared key, so this needs its own key rather than an edit to `close` | **CLOSED** — DECIDED: `Close` is pinned project-wide over `Done`. The artboard word loses |

**Could not determine without a browser:** whether the modal actually fits its content without
the 40vh scroller at typical row counts; the real height of the URL field (padding-derived).

---

## ModalSourcesEmpty

Identical to `ModalSources` except for the list region (verified by `diff`); every row above
still applies.

| Element | Artboard specifies (quoted) | Implementation (file:line) | Severity | Owner decision needed? | Status (2026-09-07) |
|---|---|---|---|---| --- |
| Empty band | `<div style="display:flex; align-items:center; justify-content:center; padding:26px 0; border-top:1px solid #ededed;"><span style="font-size:13px; color:#9a9a9a;">No sources</span></div>` | `AddSourcesModal.svelte:140-141`; `.empty` `:241-250` — centred, `padding: 26px 0`, `border-top: 1px solid var(--rule)`, `--fs-btn-sm` (13px), `--ink-dim` | — (audit **3.11** FIXED confirmed, verbatim including the 26px) | no | **CONFIRMED** — unchanged, still conforms verbatim |
| Empty copy | `"No sources"` | `t.emptyColumn` = `"No sources"` (`strings/sources.ts:13`) | — character-identical | no | **CONFIRMED** — unchanged, still character-identical |
| Everything else (title, tabs, field, Add, footer, `All sources`, `Done`) | Same as `ModalSources` | Same code path | see ModalSources rows (incl. the `Done`/`Close` WRONG) | — | **FIXED** (2026-09-08 sweep) — the footer action is `{ts.close}` = `shared.common.close` = **`Close`** (`AddSourcesModal.svelte:170`, `shared.ts:19`), and `shared.ts:12-18` records `Close` as the one word for this slot project-wide. Applies the owner's `Close`-over-`Done` ruling. |

**Could not determine without a browser:** nothing specific to this state beyond the
ModalSources list.
# Part C — Modal artboards conformance survey

Worktree: `/home/doug/Nerd/git/gnw-web-builder/.worktrees/wt-re2`.
All line numbers are that worktree. Artboards read in full, DOM walked in order.
Page chrome behind each backdrop was read but is out of scope (identical across all five,
no modal-specific chrome delta found; backdrop itself is `rgba(0,0,0,0.5)` in all five and
in `ModalShell.svelte:57`).

Prior audit re-checked: **every S4 finding (4.1–4.7) is recorded FIXED and my walk agrees**,
with three exceptions noted inline below (4.4 badge size, 4.7 gate widths/tokens are fine;
4.7's "chips" fix landed). S7.3 ("does FilePromptModal scroll its actions away") is now
answerable from markup — see the ModalFilesConvert table.

---

## ModalConnect

Implementation: `apps/web/src/lib/ui/ConnectGateModal.svelte`, strings
`apps/web/src/lib/i18n/strings/shared.ts:50-57`, shell `apps/web/src/lib/ui/ModalShell.svelte`.

| Element | Artboard specifies | Implementation | Severity | Owner decision? | Status (2026-09-07) |
|---|---|---|---|---| --- |
| Backdrop | `background: rgba(0,0,0,0.5)` (`ModalConnect.dc.html:203`) | `ModalShell.svelte:57` | OK | — | **CONFIRMED** — unchanged |
| Frame | `width: 416px; border: 1px solid #d8d8d8; border-radius: 6px; box-shadow: 0 12px 40px rgba(0,0,0,0.32); overflow: hidden` (`:203`) | `ConnectGateModal.svelte:55` `maxWidth="26rem"` (416px); `ModalShell.svelte:63-70` | OK (confirms audit 4.1/4.7 FIXED) | — | **CONFIRMED** — unchanged |
| Gold lip | `height: 3px; background: linear-gradient(180deg,#d9bc5e,#c09a32)` as first child (`:203`) | `ModalShell.svelte:46,71-73` | OK | — | **CONFIRMED** — unchanged |
| Body padding | `padding: 22px 24px 20px` (`:203`) | `ModalShell.svelte:77` `1.25rem 1.5rem` (20px 24px), bottom comes from `.actions` `margin-top: 0.5rem` (`:192`) | COSMETIC | no | **FIXED** (`e255bfa`) — `ModalShell`'s body band is now `22px 24px 20px` (`ModalShell.svelte:78`) |
| Title | `font-size: 18px; font-weight: 600; letter-spacing: -0.01em` — "Device needed" (`:203`) | copy `shared.ts:51` ✓; style `ConnectGateModal.svelte:105` `font-size: var(--fs-lg)` = **1.25rem/20px** (`styles/tokens.css:63`) | COSMETIC (2px too large; affected all five artboards — as audited, no 18px token existed) | ~~yes — add an 18px token or accept~~ answered by `51ac881`: minted, and `--fs-lg` deleted | **FIXED** — `--fs-title` (18px) now, plus the artboard's 600/-0.01em. Was: `--fs-lg` 20px (`ConnectGateModal.svelte:105`) |
| Subtitle | "Connect your device’s adapter to continue." (`:203`, U+2019 apostrophe) | `shared.ts:52` `"Connect your device's adapter to continue."` (U+0027) | COSMETIC (typographic apostrophe) | no | **FIXED** (`ff33d9e`) — `shared.ts:52` now carries the typographic apostrophe: `"Connect your device’s adapter to continue."` |
| Subtitle style | `font-size: 14px; color: #5c5c5c` | `:109-113` `--fs-caption` (14px) / `--ink-soft` | OK | — | **CONFIRMED** — unchanged |
| Row list | `padding-top: 12px`, rows `padding: 14px 0; border-bottom: 1px solid #ededed; gap: 13px` (`:203`) | `:114-126` `padding-top: 0.25rem` (4px), row `0.875rem 0` / `1px solid var(--rule)` (#ededed) / `gap: 0.8rem` | COSMETIC (list padding-top 4px vs 12px) | no | **FIXED** — the row list now opens on `padding-top: 12px` with `gap: 13px` (`ConnectGateModal.svelte:117`, `:123`) |
| Unsatisfied mark | empty `18px × 18px` spacer (`:203`) | `:68` + `:127-134` | OK | — | **CONFIRMED** — unchanged |
| Satisfied mark | not shown in this artboard (shown in ModalFolder) | `:64-66` filled green disc + stroked SVG check | OK (audit 4.5 FIXED confirmed) | — | **CONFIRMED** — unchanged |
| Row title | "Device Connection", `14px/600` | `shared.ts:53`; `:146-150` `--fs-caption`/600 | OK | — | **CONFIRMED** — unchanged |
| Row sub | "An ST-Link v2 (or compatible) adapter", `13px #5c5c5c` | `shared.ts:55`; `:151-157` `--fs-btn-sm` (13px)/`--ink-soft` | OK | — | **CONFIRMED** — unchanged |
| Row action | "Choose Adapter" as **green text link**, `13px/600 #3e9e4e; white-space: nowrap` | `shared.ts:56`; `:78-80` + `:167-178` (`--zelda-green`, borderless) | OK | — | **CONFIRMED** — unchanged |
| Actions row | `justify-content: flex-end; gap: 20px; padding-top: 20px` | `:188-193` `gap: 0.6rem` (9.6px), `margin-top: 0.5rem` | COSMETIC (gap 20px → 9.6px) | no | **FIXED** — the action row is now `gap: 20px; margin-top: 20px` (`ConnectGateModal.svelte:190-192`) |
| Cancel | **plain text**: `font-size: 14px; font-weight: 500; color: #5c5c5c`, no border, no background | `:88` `<Button>` default variant → `Button.svelte:68-73` white cap with `1px solid var(--hairline)`, `--fs-btn-sm` (13px), `--pad-btn-sm` | **WRONG** — a bordered button where every one of the five artboards draws bare text | **yes** (design intent: is Cancel a `quiet` link app-wide?) | **FIXED** (`7fd667f`) — `Button` gained a `cancel` variant (bare 14px/500 `--ink-soft`, its own focus ring) and all six modal call sites use it, including `ConnectGateModal.svelte:88` |
| Connect | `#c8372b`, `#fff`, `14px/600`, `padding: 9px 22px`, `border-radius: 5px`, `box-shadow: inset 0 -2px 0 #9e2a20` | `:89-91` `variant="action"` → `Button.svelte:55-62` (`--action-red` #c8372b, `--fs-btn` 14px, `--pad-btn` 9px 22px, `--r-btn` 5px, inset shadow) | OK | — | **CONFIRMED** — unchanged |
| Error line | not in artboard | `:85` `<p class="err">` (only on failure) | EXTRA (justified: a real failure state) | no | **CONFIRMED — keep (2026-09-08 sweep).** A real failure state; not cut for absence from a mockup. |
| "Connecting…" label swap | not in artboard | `:79,90` `shared.ts:14` | EXTRA (justified state) | no | **CONFIRMED — keep (2026-09-08 sweep).** A real in-flight state; not cut for absence from a mockup. |

**Could not determine (needs a browser):** whether the 416px frame + 20px title wraps the
title onto two lines in any of the seven locales; focus ring / hover treatment of the green
text link.

---

## ModalFolder

Implementation: `apps/web/src/lib/ui/FolderGateModal.svelte`, strings `shared.ts:59-71`.

| Element | Artboard specifies | Implementation | Severity | Owner decision? | Status (2026-09-07) |
|---|---|---|---|---| --- |
| Frame / lip / backdrop | identical to ModalConnect, `width: 416px` (`ModalFolder.dc.html:202`) | `FolderGateModal.svelte:25` `maxWidth="26rem"`; `ModalShell.svelte:63-73` | OK | — | **CONFIRMED** — unchanged |
| Title | "Folders needed" (`:202`) | `shared.ts:60`; `:28`, `:100-104` (as audited, `--fs-lg` = 20px vs 18px; `--fs-lg` has since been deleted) | COSMETIC (same title-size delta) | see ModalConnect | **FIXED** — `--fs-title` (18px) + 600 / -0.01em applied (`FolderGateModal.svelte`) |
| Subtitle | "Select the folders below to continue." (`:202`) | `shared.ts:61` plural / `:62` singular, selected at `:30` | OK (singular variant is an EXTRA the artboard doesn't show, and is correct) | — | **CONFIRMED** — unchanged |
| ROM row mark (satisfied) | `18px` circle `background: #3e9e4e` with an 11px white stroked check, `stroke-width: 2.8`, `path d="M4.5 10.5l3.5 3.5 7.5-8"` (`:202`) | `:37-39` (identical SVG path/stroke) + `:131-134` | OK — confirms audit 4.5 FIXED, byte-for-byte on the path | — | **CONFIRMED** — unchanged |
| ROM row title / hint | "ROM Folder" / "Your local collection of ROM files" | `shared.ts:63,65`; `:44-45` | OK | — | **CONFIRMED** — unchanged |
| ROM row path line | third stacked line, `font-size: 12px; color: #5c5c5c; font-family: ui-monospace…; padding-top: 3px` | `:47` + `:154-162` (`--font-mono`, `--fs-micro` 12px, `padding-top: 3px`) | OK — confirms audit 4.6 FIXED | — | **CONFIRMED** — unchanged |
| ROM row action (satisfied) | **"Choose…"** — the artboard's *satisfied* row still reads "Choose…" (`:202`) | `:56` renders `changeEllipsis` = "Change…" (`shared.ts:18`) when `roms.selected` | **WRONG** (copy) | **yes** — artboard says the label does not change; impl deliberately swaps it | **BLOCKED** — re-verified 2026-09-08 sweep: unchanged, and the sweep declines to settle it. This is copy that *carries state* (a chosen folder vs none), not paint, so the artboard-wins-on-paint ruling does not reach it; reverting to a fixed `Choose…` would drop the only signal that the row is already satisfied. **RE-STATUSED 2026-09-08** (`docs/BLOCKED-AUDIT.md`): Q16 — `Choose…` versus `Change…` on a satisfied row. |
| SD row | "SD Card Folder" / "The root of your SD card volume", empty 18px mark, "Choose…" | `shared.ts:69-70`; `:72-73,78` | OK | — | **CONFIRMED** — unchanged |
| SD row rendering | artboard shows the SD row unconditionally | `:62` renders it only when `prompt.sd` | EXTRA/behavioural (correct: SD mode only) | no | **CONFIRMED — keep (2026-09-08 sweep).** Correct behaviour (SD mode only). No work implied. |
| "Reconnect last folder" + "or" | **not in the artboard** | `:52-53` (`shared.ts:66`, `shared.ts:19`), styled `:184-198` | EXTRA — an extra action pair in the row, no artboard behind it | **yes** | **CONFIRMED** — re-verified 2026-09-08 sweep: unchanged. The pair is a real, useful action, so it is not cut for absence; but it is an *action* with no artboard, which is where the owner drew the line on inventing UI. **RE-STATUSED 2026-09-08** (`docs/BLOCKED-AUDIT.md`): settled by *nothing is cut merely for not appearing in a mockup*. |
| Actions | `gap: 20px; padding-top: 20px`; Cancel bare text; "Continue" red cap | `:83-88`; `:199-204` `gap: 0.6rem` | COSMETIC (gap) + **WRONG** (Cancel, same as ModalConnect) | see ModalConnect | **FIXED** — the actions row is now `gap: 20px` (`FolderGateModal.svelte:201`) and Cancel is the bare-text `cancel` variant (`:84`, `7fd667f`) |
| Continue copy | "Continue" | `shared.ts:71`; `:86` | OK | — | **CONFIRMED** — unchanged |
| Continue disabled state | artboard shows it enabled (red) | `:85` `disabled={!ready}` → `Button.svelte:42-48` grey | EXTRA (justified gate state; but see the disabled-cap colour delta under ModalFilesBios) | no | **CONFIRMED — keep (2026-09-08 sweep).** A justified gate state. No work implied. |

**Could not determine:** whether the ROM row's three stacked lines + the `Reconnect last folder / or / Choose…`
action cluster fit on one 416px row without the `.item-sub` ellipsis truncating (`:150-152`).

---

## ModalFilesBios

Implementation: `apps/web/src/lib/ui/FilePromptModal.svelte`; strings
`apps/web/src/lib/i18n/strings/sources.ts:84-110`; call sites
`apps/web/src/lib/ui/AdditionalFiles.svelte:246-256` and
`apps/web/src/lib/views/RomManagementTab.svelte:2334-2342`.

| Element | Artboard specifies | Implementation | Severity | Owner decision? | Status (2026-09-07) |
|---|---|---|---|---| --- |
| Frame | `width: 620px` (`ModalFilesBios.dc.html:243`) | `FilePromptModal.svelte:309` `maxWidth="38.75rem"` = 620px | OK — confirms audit 4.7 FIXED | — | **CONFIRMED** — unchanged |
| Head band | `padding: 22px 26px 4px; gap: 4px` | `:320`, `:471-473` (`22px 26px 4px`), `h3` `margin-bottom: 0.25rem` | OK | — | **CONFIRMED** — unchanged |
| Title | "PC Engine CD needs additional files" (`:243`) | `sources.ts:85` `(name) => \`${name} needs additional files\`` | OK (subject is runtime) | — | **CONFIRMED** — unchanged |
| Title size | `18px/600/-0.01em` | `:478-480` `--fs-lg` = 20px *(as audited; token since deleted)* | COSMETIC | see ModalConnect | **FIXED** — `--fs-title` (18px) + 600 / -0.01em applied |
| Subtitle | `"PC Engine CD games will not start without it."`, `14px #5c5c5c` (`:243`) | `:322-326`: renders `note` (a prop **no call site ever passes** — `grep -rn "note={" apps/web/src/lib` returns only GeometryBar callers), else `subtitleConverted` when `showConverted`. `AdditionalFiles.svelte:247-253` passes neither `converts` nor `tool` → **the BIOS modal renders NO subtitle**. `RomManagementTab.svelte:2336` passes `tool` → `:129` makes `showConverted` true → the BIOS modal renders the **Convert artboard's** line, "Files are converted in your browser. Nothing is uploaded." | **MISSING** (one call site) / **WRONG** (the other) | **yes** — where does the BIOS subtitle come from (manifest field vs new i18n string)? | **FIXED** (`ceeddf4`) — new key `sources.filePrompt.subtitleBios` (`sources.ts:86`) in seven locales; both BIOS call sites pass it (`AdditionalFiles.svelte:252`, `RomManagementTab.svelte:2357`) and the RomManagementTab one passes `converts={false}` so the converter line no longer leaks in. One of the five real bugs |
| Row | `padding: 13px 0; border-bottom: 1px solid #ededed`, inner `gap: 16px` | `:490-500` | OK | — | **CONFIRMED** — unchanged |
| Row name | `14px/600` | `:516-519` `--fs-caption` | OK | — | **CONFIRMED** — unchanged |
| `required` badge | `font-size: 10px; letter-spacing: 0.06em; uppercase; color:#8a241b; background:#f6e9e7; border-radius:2px; padding:3px 6px` | `:522-536`: `--fs-label` = **11px** (`tokens.css:111`), `--danger` #8a241b ✓, `--tint-required` #f6e9e7 ✓, `--r-control` 2px ✓, `3px 6px` ✓, `0.06em` ✓ | COSMETIC — audit 4.4 is marked FIXED but the size is 11px, not the artboard's 10px | no | **FIXED** (`88db01a`) — `.tag` is now `--fs-badge` (10px); the 0.06em tracking was already right |
| `optional` badge | `color:#5c5c5c; background:#f0f0f0` | `:527-528` `--ink-soft` #5c5c5c ✓ / `--surface-sunk` = **#e8e8e8** (`tokens.css:9`), artboard `#f0f0f0` | COSMETIC | no | **FIXED** (tokens pass, 2026-09-08) — `--chip-fill: #f0f0f0` minted (dark `#2e2e2e`) and applied at `FilePromptModal.svelte:530`. Unlike `#e0e0e0`, this hex is one value in one role, 13 times across six boards, always a badge/chip `background` — a token, not a near-miss. |
| Filename line | `12px #5c5c5c ui-monospace` | `:379` `class:mono={monoDescriptions}`, `:537-546`. `AdditionalFiles.svelte:252` passes `monoDescriptions={true}`; **`RomManagementTab.svelte:2334-2342` does not** — the same BIOS modal renders its filenames in the body face there | **WRONG** (one of the two BIOS call sites) | no — clear bug | **FIXED** (`89c3e03`) — `RomManagementTab.svelte:2356` now passes `monoDescriptions={true}`, so both BIOS call sites render the filename mono. One of the five real bugs |
| `Choose` cap | `12px/600 #1b1b1b`, `background:#ffffff; border:1px solid #1b1b1b; border-radius:4px; padding:5px 14px` | `:404`, `:693-703` (identical incl. the non-token `border-radius: 4px`) | OK | — | **CONFIRMED** — unchanged |
| `Found` state | green stroked check + "Found", `13px/600 #3e9e4e; gap: 6px` | `sources.ts:91`; `:386-390` (same SVG path, `stroke-width: 2.4`); `:570-581` uses `--fs-caption` = **14px** vs 13px | COSMETIC | no | **FIXED** (`d3d7176` / `7fd667f`, mis-marked OPEN by the 2026-09-07 pass) — re-read: `.state` is `font-size: var(--fs-btn-sm)` = 13px / 600, `.state.ok` in `--zelda-green`, `gap: 6px` (`FilePromptModal.svelte:570-581`). It was already conformant when the pass recorded it OPEN |
| Cap hidden when satisfied | artboard's satisfied row shows only "✓ Found" | `:395` `{#if spec.repeatable || good.length === 0}` | OK — confirms audit 4.7 FIXED | — | **CONFIRMED** — unchanged |
| Optional disclosure | chevron + `"8 more optional files"`, `13px/500 #5c5c5c; gap: 8px; padding: 13px 0` (`:243`) | `sources.ts:98` `optionalTail` = `"8 optional files"` — the word **"more" is deliberately dropped** (rationale comment `sources.ts:96-97`); `:335-345`, `:549-562` `--fs-caption` 14px vs 13px | **WRONG** (copy) + COSMETIC (size) | **yes** — the deviation is argued in-code but contradicts the artboard | **CONFIRMED — decided (2026-09-08 sweep).** `"8 optional files"` stands. The word *more* is the padding the owner's *"I'd rather lose text than have too much of it."* rules out, and the count already carries the meaning. The in-code rationale at `sources.ts:96-97` is upheld, not overruled. |
| Footer band | `border-top: 1px solid #d8d8d8; padding: 16px 26px; gap: 16px; justify-content: flex-end` | `:356`, `:717-725` | OK — confirms audit 4.2 FIXED | — | **CONFIRMED** — unchanged |
| Cancel | bare text `14px/500 #5c5c5c` | `:357` default `<Button>` → bordered cap | **WRONG** (same as ModalConnect) | see ModalConnect | **FIXED** (`7fd667f`) — `FilePromptModal.svelte:357` now uses `variant="cancel"` |
| Submit, disabled | "Add to library"; `background:#e0e0e0; color:#9a9a9a`, **no** inset shadow, `9px 22px`, `radius 5px` | `sources.ts:109`; `:358` `disabled={!ready}` → `Button.svelte:42-48` `--surface-sunk` **#e8e8e8** / `--ink-soft` **#5c5c5c** + `border-color: var(--hairline)` | COSMETIC (disabled cap is darker-inked and bordered where the artboard is a flat light grey) | no | **FIXED in part** (`88db01a`) — `Button.svelte`'s shared `.btn:disabled` loses its border and drops the label to `--ink-dim` (#9a9a9a). The fill stays `--surface-sunk` #e8e8e8 rather than the drawn #e0e0e0, and that is now the **settled** call, not a deferral: `#e0e0e0` gets no token because it carries two different roles, and as a disabled fill `--surface-sunk` is the nearest (8/255). See the header-underline row for the full ruling |

**Could not determine:** whether `.body { overflow-y: auto }` (`:474-477`) plus
`.wrap { max-height: 74vh }` (`:465-470`) actually keeps the footer pinned — structurally it
now should (footer is a `flex-shrink: 0` sibling of the scroller), which **answers audit S7.3
in the affirmative**, but only a render proves it. Also: whether the disclosure chevron
rotation reads correctly at 13px.

---

## ModalFilesBiosError

Same component; only the refusal panel differs from ModalFilesBios. Rows above/below identical
— see that table; not repeated here.

| Element | Artboard specifies | Implementation | Severity | Owner decision? | Status (2026-09-07) |
|---|---|---|---|---| --- |
| Panel | `background:#fbf1ef; border-left: 2px solid #8a241b; border-radius: 0 3px 3px 0; padding: 9px 12px; margin-top: 9px; gap: 5px` (`ModalFilesBiosError.dc.html:243`) | `:601-610` `--tint-danger` #fbf1ef ✓, `2px solid var(--danger)` #8a241b ✓, `0 3px 3px 0` ✓, `0.55rem 0.75rem` (8.8/12px) ✓, `margin-top: 0.55rem` ✓, `gap: 0.3rem` (4.8px vs 5px) ✓ | OK — confirms audit 4.3 FIXED | — | **CONFIRMED** — unchanged |
| Panel headline | `"The provided System Card 3 file is invalid"`, `12px/600 #8a241b` | `sources.ts:99` `errInvalid: (name) => \`The provided ${name} file is invalid\`` ✓; `:419`, `:611-615` `--fs-micro` 12px ✓ | OK | — | **CONFIRMED** — unchanged |
| Placement | panel sits **inside** the offending row, above its `border-bottom` | `:417-433` inside `<section class="input">` | OK | — | **CONFIRMED** — unchanged |
| `Expected SHA-1` label | `11px #5c5c5c` | `sources.ts:94`; `:423`, `:620-623` `--fs-micro` = **12px** | COSMETIC (`--fs-label` is the 11px token) | no | **FIXED** (`d3d7176` / `7fd667f`, mis-marked OPEN by the 2026-09-07 pass) — `.hlabel { font-size: var(--fs-label) }` = 11px (`FilePromptModal.svelte:620-623`), the artboard value |
| Expected value | `11px #1b1b1b` mono, `word-break: break-all` | `:424`, `:627-632` — `--fs-micro` 12px, `--ink`, `--font-mono`, `break-all` ✓ | COSMETIC (size only) | no | **FIXED** (`d3d7176` / `7fd667f`, mis-marked OPEN by the 2026-09-07 pass) — `.hval { font-size: var(--fs-label) }` = 11px, mono, `word-break: break-all` (`FilePromptModal.svelte:627-632`) |
| `Current` label | `11px #5c5c5c; padding-top: 4px` | `sources.ts:95`; `:427`, `:624-626` `padding-top: 0.25rem` ✓ | COSMETIC (size only) | no | **FIXED** (`d3d7176` / `7fd667f`, mis-marked OPEN by the 2026-09-07 pass) — `.hlabel` is 11px and `.hlabel.gap { padding-top: 0.25rem }` (`FilePromptModal.svelte:620-626`) |
| Current value | `11px` mono **`#8a241b`** | `:428`, `:633-635` `.hval.bad { color: var(--danger) }` ✓ | OK — the "which hash is wrong" signal landed | — | **CONFIRMED** — unchanged |
| Hash stack | label-over-value, one per line | `:616-619` `flex-direction: column` | OK (the old side-by-side `.hash` row is gone) | — | **CONFIRMED** — unchanged |
| Row keeps its `Choose` cap while refused | artboard shows `Choose` still present on the failed row | `:395` — `bad` slots are excluded from `good`, so `good.length === 0` → cap renders | OK | — | **CONFIRMED** — unchanged |

**Could not determine:** whether a 40-hex-char SHA-1 at 12px inside a 620px modal wraps to two
lines where the artboard's 11px fits one — `word-break: break-all` makes this purely a render
question.

---

## ModalFilesConvert

Same component, converter call sites `AdditionalFiles.svelte:235-244` and
`RomManagementTab.svelte:2322-2332`.

| Element | Artboard specifies | Implementation | Severity | Owner decision? | Status (2026-09-07) |
|---|---|---|---|---| --- |
| Title | "Zelda 3 needs additional files" (`ModalFilesConvert.dc.html:243`) | `sources.ts:85` (subject runtime) | OK | — | **CONFIRMED** — unchanged |
| Subtitle | "Files are converted in your browser. Nothing is uploaded." | `sources.ts:86`; selected by `:129` `converts ?? tool !== undefined` — true for both converter call sites | OK | — | **CONFIRMED** — unchanged |
| Description face | `font-size: 12px; color:#5c5c5c` with **no** mono (`"US (NTSC) cartridge dump."`) | `:379` mono only when `monoDescriptions`; converter callers omit it | OK | — | **CONFIRMED** — unchanged |
| Row 1 satisfied | "✓ Found", cap dropped | `:385-391`, `:395` | OK | — | **CONFIRMED** — unchanged |
| Row 2 repeatable | `"2 added"` green `13px/600` + a `24px × 24px` outlined `+` square, `border:1px solid #1b1b1b; border-radius:4px`, 12px SVG `stroke-width: 2.2`, cluster `gap: 10px` | `sources.ts:93` `addedCount`; `:383-384`, `:397-402`, `:704-714` (24px, `1px solid var(--ink)`, radius 4px, 12px SVG) ; cluster `.act gap: 0.6rem` = 9.6px | OK — confirms audit 4.7 FIXED | — | **CONFIRMED** — unchanged |
| `Added` group label | `12px/600; letter-spacing: 0.06em; uppercase; color:#9a9a9a` | `sources.ts:92`; `:437`, `:639-645` `--fs-micro` 12px / `--ink-dim` #9a9a9a ✓ | OK | — | **CONFIRMED** — unchanged |
| `Added` group placement | a **separate block after** the last row's `border-bottom` (`:243` — the Translated ROM row closes with `border-bottom: 1px solid #ededed`, then the Added block starts), `padding: 12px 0 13px; gap: 7px` | `:435-457` `.addedbox` is **inside** `<section class="input">`, and `.input:not(:last-child)` (`:493-495`) means the last section draws **no** rule — so the rule the artboard puts between the row and its chips is absent | **WRONG** (structure: the chips sit inside the row, unruled, instead of below it) | **yes** — is the chip group part of the row or a peer block? | **FIXED** (2026-09-08 sweep) — `.addedbox` is now a sibling **after** `</section>` (`FilePromptModal.svelte:436-458`), not inside `section.input`, so the last input row keeps its `border-bottom` and the Added block sits below it with its own `padding: 12px 0 13px` (`:641-643`) — the artboard's structure exactly. |
| Chips | `background:#f0f0f0; border-radius: 3px; padding: 5px 9px; gap: 8px; align-items: baseline`, variant name `12px #1b1b1b` + filename `11px #9a9a9a` mono | `:439-454`, `:656-680`: `--surface-sunk` = **#e8e8e8** vs `#f0f0f0`, radius 3px ✓, `5px 9px` ✓, `gap: 8px` ✓, `--fs-micro` 12px / `--ink` ✓, `--fs-label` 11px / `--ink-dim` mono ✓ | COSMETIC (chip fill one step darker than the artboard) | no | **FIXED** (tokens pass, 2026-09-08) — `.chip` now takes the minted `--chip-fill` (#f0f0f0 / dark #2e2e2e) at `FilePromptModal.svelte:665`. |
| Chip is a remove button | artboard chip is static | `:441-452` the chip is a `<button>` that removes the file (`aria-label` from `sources.ts` `remove`), plus `max-width: 16rem` ellipsis on the filename (`:679`) | EXTRA (functionally needed — there is no other way to undo a pick; no artboard behind it) | **yes** (low stakes) | **CLOSED** — DECIDED: kept. There is no other way to undo a pick. The chip BLOCK now sits where the artboard draws it (`88db01a`); functionally needed |
| Chip wrap | `flex-wrap: wrap; gap: 7px` | `:646-653` | OK | — | **CONFIRMED** — unchanged |
| Footer submit | "Prepare", red `#c8372b` + `inset 0 -2px 0 #9e2a20`, `9px 22px`, radius 5px | `sources.ts:108`; `:358` `variant="action"` → `Button.svelte:55-62` | OK | — | **CONFIRMED** — unchanged |
| Cancel | bare text | bordered cap (`:357`) | **WRONG** (same as ModalConnect) | see ModalConnect | **FIXED** (`7fd667f`) — Cancel is the bare-text `cancel` variant |
| Footer band | `border-top: 1px solid #d8d8d8; padding: 16px 26px; gap: 16px` | `:717-725` | OK | — | **CONFIRMED** — unchanged |

**Could not determine:** whether a long variant name + filename chip pair exceeds the 620px
body and wraps as the artboard's two-up row does; whether `.fname { max-width: 16rem }` truncates
real filenames in practice.
# Part D — ModalInstallConfirm, ModalInstallConfirmSd, HeaderBusy

Worktree: `/home/doug/Nerd/git/gnw-web-builder/.worktrees/wt-re2`. No code changed.
All `apps/web/src/...` paths are relative to that worktree.

Scope note: both `ModalInstallConfirm*.dc.html` artboards draw the **whole Library screen**
behind the dialog. The dialog itself is walked exhaustively below. The page behind it is
`Roms.dc.html`'s subject and is owned by another section; the two rows that are *legible copy*
in my artboards (the dock caption line) are still reported here, marked `(overlaps Roms)`.

The two install-confirm artboards are byte-identical except one sentence
(`diff` of the two files yields exactly one hunk: `…to the device.` vs `…to the SD card.`),
so the dialog table is shared and the SD-only rows are called out.

---

## ModalInstallConfirm.dc.html

Dialog owner: `installProgress.run({...})`, not `ConfirmModal.svelte`. Invoked from
`RomManagementTab.svelte:721-740` (`openInstall()`), rendered by
`lib/ui/InstallProgressModal.svelte:69-101` inside `lib/ui/ModalShell.svelte`.
(Audit S6 item 3 already records that "`ModalInstallConfirm` is the `installProgress` path,
not this [ConfirmModal]" — `docs/audit-ui-conformance.md:1213`.)

| Element | Artboard specifies (quoted) | Implementation (file:line) | Severity | Owner decision needed? | Status (2026-09-07) |
|---|---|---|---|---| --- |
| Backdrop | `position: absolute; inset: 0; background: rgba(0,0,0,0.5); display: flex; align-items: center; justify-content: center` | `ModalShell.svelte:54-62` — `position: fixed; inset: 0; background: rgba(0,0,0,0.5); display:flex; align-items:center; justify-content:center` | OK | no | **CONFIRMED** — unchanged |
| Dialog width | `width: 416px` | `ModalShell.svelte:12` `maxWidth = "26rem"` (= 416px at 16px root); `InstallProgressModal.svelte:70` passes no override | OK | no | **CONFIRMED** — unchanged |
| Dialog frame | `border: 1px solid #d8d8d8; border-radius: 6px; box-shadow: 0 12px 40px rgba(0,0,0,0.32); overflow: hidden` | `ModalShell.svelte:63-70` (`--r-card: 6px`, `styles/tokens.css:119`); border colour `var(--hairline)` `:11` | OK (re-checks audit S4.1 **FIXED** — confirmed) | no | **CONFIRMED** — unchanged |
| Gold face-plate lip, first child | `<div style="height: 3px; background: linear-gradient(180deg, #d9bc5e 0%, #c09a32 100%);">` | `ModalShell.svelte:46,71-74` `.gold-lip { height: 3px; background: var(--grad-gold) }`; `--grad-gold` is the identical gradient at `styles/tokens.css:16` | OK (re-checks audit S4.1 **FIXED** — confirmed, exact) | no | **CONFIRMED** — unchanged |
| Body padding | `padding: 22px 24px 20px` | `ModalShell.svelte:76-78` `.modal-body.padded { padding: 1.25rem 1.5rem }` = `20px 24px 20px` | COSMETIC (top 20 vs 22) | no | **FIXED** (`e255bfa`) — the body band is now `1.375rem 1.5rem 1.25rem` = 22px 24px 20px (`ModalShell.svelte:78`) |
| Title text | `"Installation"` | `i18n/strings/roms.ts:59` `installTitle: "Installation"`, used `RomManagementTab.svelte:723`; rendered `InstallProgressModal.svelte:72` | OK — character-identical | no | **CONFIRMED** — unchanged |
| Title type | `font-size: 18px; font-weight: 600; letter-spacing: -0.01em` | `InstallProgressModal.svelte:170-173` `h3 { font-size: var(--fs-lg) }` = `1.25rem`/20px (`styles/tokens.css:63`) as audited — `--fs-lg` has since been deleted; no `letter-spacing` | COSMETIC (20px vs 18px; missing `-0.01em`) | no | **FIXED** (`f2c7c83`) — `--fs-title` 18px / 600 / `letter-spacing: -0.01em` (`InstallProgressModal.svelte:170-175`). The trailing "the `-0.01em` is also still absent" clause was a leftover from the pre-fix reading; it is present. |
| Title→body gap | outer flex `gap: 4px` | `InstallProgressModal.svelte:172` `h3 { margin-bottom: 0.5rem }` = 8px | COSMETIC | no | **FIXED** (`f2c7c83`) — `h3 { margin-bottom: 4px }` (`InstallProgressModal.svelte:174`), the artboard's outer `gap: 4px`. The row was stale: the change had already landed when the sweep re-read it. |
| Body sentence | `"Games, BIOS and languages will be installed to the device."` | `i18n/strings/roms.ts:60` `installBody`, selected at `RomManagementTab.svelte:1480`, rendered `InstallProgressModal.svelte:75` | OK — character-identical | no | **CONFIRMED** — unchanged |
| Body type | `font-size: 14px; color: #5c5c5c` | `InstallProgressModal.svelte:174-177` `.muted { color: var(--ink-soft); font-size: var(--fs-caption) }` = 14px (`styles/tokens.css:61`) | OK | no | **CONFIRMED** — unchanged |
| Checkbox row | *absent from the artboard* | `InstallProgressModal.svelte:76-89` renders one only when `prompt.checkboxes.length > 0`; `openInstall()`/`openSdSync()` pass none (`:721-758`) | OK — no EXTRA at runtime | no | **CONFIRMED** — unchanged |
| Phase checklist in confirm phase | *absent from the artboard* | `InstallProgressModal.svelte:74-101` — checklist is in the `{:else}` branch only | OK | no | **CONFIRMED** — unchanged |
| Action row | `display: flex; align-items: center; justify-content: flex-end; gap: 20px; padding-top: 22px` | `InstallProgressModal.svelte:191-196` `.actions { display:flex; gap: 0.6rem; justify-content: flex-end; margin-top: 1.25rem }` = gap 9.6px, top 20px | COSMETIC (gap 9.6 vs 20) | no | **FIXED** (`f2c7c83`) — `.actions { gap: 20px; margin-top: 22px }` (`InstallProgressModal.svelte:196-200`), matching `ModalInstallConfirm.dc.html:243` exactly. The row was stale. |
| **Cancel control** | plain text, no chrome: `font-size: 14px; font-weight: 500; color: #5c5c5c` | `InstallProgressModal.svelte:91` `<Button onclick=…>` → variant `default`, `Button.svelte:68-73` = white cap, `1px solid var(--hairline)`, 13px/600 (`:31-34`, `--fs-btn-sm: 13px` `tokens.css:110`), `--pad-btn-sm: 8px 18px` | **WRONG** (bordered button where the artboard has bare text; wrong size and weight). Note `Button.svelte:103-111` already has a `quiet` variant that is closer, though it underlines. | **yes** — bare-text vs neutral-cap Cancel is a system-wide button-language call, not a local nit | **FIXED** (`7fd667f`) — `InstallProgressModal.svelte:91` now uses `variant="cancel"`, the bare 14px/500 `--ink-soft` text the artboards draw |
| **Confirm button (Flash)** | `background: #c8372b; color: #ffffff; font-size: 14px; font-weight: 600; padding: 9px 22px; border-radius: 5px; box-shadow: inset 0 -2px 0 #9e2a20` | `RomManagementTab.svelte:725` passes `danger: true` → `InstallProgressModal.svelte:97` picks `variant="destructive"` → `Button.svelte:91-96` = **transparent background, `1px solid var(--danger)` (`#8a241b`), oxblood label**, filling only on hover | **WRONG** — the artboard's Confirm is a solid `--action-red` fill; the app draws an oxblood outline. The `action` variant (`Button.svelte:55-62`) is a token-exact match for the artboard (`--action-red #c8372b`, `--action-red-deep #9e2a20`, `--pad-btn 9px 22px` — `tokens.css:39-40,115`), so the delta is purely the `danger: true` flag | **yes** — outline-destructive may be a deliberate app-wide "irreversible write" rule (audit S5.1 notes Erase/BackupPatchCross legitimately use the outline). Owner must say whether the install confirm is in that family or should match its own artboard | **FIXED** (`6d803f2`) — `openInstall()` no longer passes `danger: true`, so `InstallProgressModal.svelte:97` selects `variant="action"` — the solid `--action-red` fill both artboards specify. Confirm-gate behaviour unchanged. One of the five real bugs |
| Confirm label | `"Confirm"` | `RomManagementTab.svelte:726` → `i18n/strings/shared.ts:23` `defaultConfirmText: "Confirm"` | OK — character-identical | no | **CONFIRMED** — unchanged |
| Confirm-gate variant | *no such control in the artboard* | `InstallProgressModal.svelte:92-95` can swap Confirm for a `confirmGate` button | OK — `openInstall()` passes no gate, so never shown on this screen | no | **CONFIRMED** — unchanged |
| Dismiss X / close affordance | *none* | `InstallProgressModal.svelte:70` — no X; dismiss is backdrop/Escape only, disabled once running | OK | no | **CONFIRMED** — unchanged |
| Footer rule under the actions | *none* (the actions sit inside the padded body) | no footer rule for this modal | OK — matches, and matches the audit's explicit scoping note (`docs/audit-ui-conformance.md:819`) | no | **CONFIRMED** — unchanged |
| Dock caption behind the dialog *(overlaps Roms)* | `"3.54 MB of 50 MB projected"` | `RomManagementTab.svelte:1454-1458` `budgetText` returns `` `${MiB(meterUsed)} MiB / ${MiB(gapBytes)} MiB` `` — a slash, no `of`, no `projected`, and `MiB` not `MB` | **MISSING** (the words "of" and "projected" exist in no string table) | no | **FIXED** (`bc71f68`) — `summary.projected` now supplies `… of … projected` (`roms.ts:154`, `RomManagementTab.svelte:1467`); the `MiB` unit is a separate open call |
| Net-change caption behind the dialog *(overlaps Roms)* | `"+0.12 MB net change"`, `color: #3e9e4e` | `RomManagementTab.svelte:1461-1467` renders `` `+0.12 MiB` `` only. The correct string `netChange: (sign, amountMiB) => \`${sign}${amountMiB} MiB net change\`` exists at `i18n/strings/roms.ts:152` but is used only by the StatPanel row at `:1348`, never by the dock | **WRONG** (i18n key exists and is simply not wired into the dock) | no | **FIXED** (`bc71f68`) — `summary.netChange` is now wired to the dock (`RomManagementTab.svelte:1477`) |
| Summary tab behind the dialog *(overlaps Roms)* | `"Summary"` | `i18n/strings/roms.ts:154` `summaryTab: "Summary"`, `RomManagementTab.svelte:2172` | OK | no | **CONFIRMED** — unchanged |
| "Additional options" behind the dialog *(overlaps Roms)* | `"Additional options"` | `i18n/strings/roms.ts:153`, `RomManagementTab.svelte:2279` | OK | no | **CONFIRMED** — unchanged |
| "Sync Library" behind the dialog *(overlaps Roms)* | `"Sync Library"` | `i18n/strings/roms.ts:58`, `RomManagementTab.svelte:2291,2309` | OK | no | **CONFIRMED** — unchanged |

### Could not determine — ModalInstallConfirm
- Whether the rendered dialog's total height matches; the artboard has no height constraint and the body is one line either way.
- The artboard's `align-items: center` on `.actions` is moot with two single-line children; not measurable statically.
- ~~Whether `--fs-lg` (20px) was widened deliberately for all modal `h3`s or is an unnoticed drift from 18px.~~ **Settled by `51ac881`**: it was drift. `--fs-title` (18px) was minted, every modal title moved onto it, and `--fs-lg` was retired and deleted.

---

## ModalInstallConfirmSd.dc.html

Identical DOM to the above apart from one sentence, so only the deltas are listed. Everything
unlisted carries the row above unchanged.

| Element | Artboard specifies (quoted) | Implementation (file:line) | Severity | Owner decision needed? | Status (2026-09-07) |
|---|---|---|---|---| --- |
| Title text | `"Installation"` (same word as the Flash artboard) | `i18n/strings/roms.ts:90` `syncTitle: "Installation"`, used `RomManagementTab.svelte:744` | OK — character-identical, and correctly the same word in both modes | no | **CONFIRMED** — unchanged |
| Body sentence | `"Games, BIOS and languages will be installed to the SD card."` | `i18n/strings/roms.ts:91` `syncBody`; branch at `RomManagementTab.svelte:1479-1481` (`device.targetMedia === "sd" ? syncBody : installBody`) | OK — character-identical, and the branch key is `targetMedia`, exactly the split the two artboards encode | no | **CONFIRMED** — unchanged |
| **Confirm button (SD)** | `background: #c8372b; … box-shadow: inset 0 -2px 0 #9e2a20` — *identical to the Flash artboard* | `openSdSync()` (`RomManagementTab.svelte:743-758`) passes **no** `danger` flag → `InstallProgressModal.svelte:97` picks `variant="action"` → `Button.svelte:55-62`, a token-exact match | OK | no | **CONFIRMED** — unchanged |
| Flash-vs-SD Confirm consistency | the two artboards give the button **the same fill** | Flash gets `destructive` (outline), SD gets `action` (filled) — `RomManagementTab.svelte:725` vs `:743-746` | **WRONG** — the app makes the two modes' primary button visually different where the artboards make them identical. This is the same root cause as the Flash Confirm row above | **yes** — same decision as above; resolving it one way makes both artboards conform | **FIXED** (`6d803f2`) — dropping `danger: true` makes Flash and SD render the same filled `action` button, as both artboards specify |
| Dock caption in SD mode *(overlaps Roms)* | `"3.54 MB of 50 MB projected"` | `RomManagementTab.svelte:1455` returns `` `${MiB(selectedTotalBytes)} MiB` `` in SD mode — a bare size, no total, no "projected" | MISSING (SD has no gap total by design — CLAUDE.md's SD-vs-Flash budget rule — so the artboard's "of 50 MB" arguably cannot apply in SD mode) | **yes** — is the SD dock supposed to show a total at all? | **CONFIRMED** — re-verified 2026-09-08 sweep: unchanged. SD has no gap total by design (CLAUDE.md's SD-vs-Flash budget rule), so the artboard's `of 50 MB` has nothing to resolve against. The unit itself is already MB (see row 234). **RE-STATUSED 2026-09-08** (`docs/BLOCKED-AUDIT.md`): settled by the SD-vs-Flash rule (rows 319/320). Separately: the `MiB` literal at `RomManagementTab.svelte:1455` is a real leftover against the MB ruling — recorded as a work item, not a decision. |
| Net-change caption in SD mode | `"+0.12 MB net change"` | `RomManagementTab.svelte:1462` returns `null` in SD mode (`"SD has no equivalent baseline"`) | WRONG vs the artboard, but justified in code | **yes** — the SD artboard shows a net-change figure the SD mode structurally cannot compute | **CONFIRMED** — re-verified 2026-09-08 sweep: unchanged and justified in code. **RE-STATUSED 2026-09-08** (`docs/BLOCKED-AUDIT.md`): settled by the SD-vs-Flash rule (rows 319/320). |

### Could not determine — ModalInstallConfirmSd
- Whether the artboard's page-behind is *meant* to be SD mode at all: its header still reads `Connected (Recovery Mode)` and the dock still shows a Flash-style `of 50 MB` budget, i.e. the background was not re-rendered for SD. If the background is just carry-over, the two SD dock rows above are artboard bugs, not app bugs.
- Whether the ZIP-fallback path (`RomManagementTab.svelte:2299-2308`, `downloadZipButton`) reaches this same confirm dialog — no artboard covers the non-`showDirectoryPicker` browser.

---

## HeaderBusy.dc.html

Three stacked artboards in one file: **Safe**, **Writing**, **Finishing**, each a full header
band + lip, each preceded by a caption block. The captions are annotation, not UI, and are not
audited as copy.

| Element | Artboard specifies (quoted) | Implementation (file:line) | Severity | Owner decision needed? | Status (2026-09-07) |
|---|---|---|---|---| --- |
| Header changes **in place** (no extra strip) | all three boards are one 56px band + one lip row; the busy boards recolour the band rather than adding anything | `DeviceHeader.svelte:105` `<header class="band" class:busy={deviceSafety.unsafe}>`; the single lip is `App.svelte:96-102` | OK — re-checks audit **5.7 FIXED**; my walk agrees, the separate `.unsafe-lip` is gone | no | **CONFIRMED** — unchanged |
| Safe band background | `background: #ffffff` | `DeviceHeader.svelte:192` `background: var(--surface)` | OK | no | **CONFIRMED** — unchanged |
| Busy band background (Writing + Finishing) | `background: #fdf8ec` | `DeviceHeader.svelte:197-199` `.band.busy { background: var(--band-busy) }`; `tokens.css:36` `--band-busy: #fdf8ec` | OK — exact | no | **CONFIRMED** — unchanged |
| Safe status text | `"Connected (Recovery Mode)"`, `font-size: 14px; font-weight: 600; color: #1b1b1b` | `i18n/strings/deviceHeader.ts:7` `connectedRecoveryMode`; `DeviceHeader.svelte:48-63,124`; type `:251-255` `.status { font-size: var(--fs-caption); font-weight: 600; color: var(--ink) }` (14px) | OK — character-identical, type-exact | no | **CONFIRMED** — unchanged |
| Writing status text | `"Writing flash. Do not disconnect"`, `font-weight: 700; color: #8a6508` | `i18n/strings/deviceHeader.ts:31` `unsafeWritingStatus`; selected `DeviceHeader.svelte:53-54`; type `:200-203` `.band.busy .status { color: var(--band-busy-ink); font-weight: 700 }`, `tokens.css:37` `--band-busy-ink: #8a6508` | OK — character-identical, colour and weight exact | no | **CONFIRMED** — unchanged |
| Finishing status text | `"Finishing up. Do not disconnect"` | `i18n/strings/deviceHeader.ts:32` `unsafeSettlingStatus`; `DeviceHeader.svelte:55-56` keyed on `deviceSafety.state === "settling"` | OK — character-identical | no | **CONFIRMED** — unchanged |
| Precedence of a lost link over "do not disconnect" | *not covered by any of the three boards* | `DeviceHeader.svelte:48-52` puts `connectionLost` / `noConnection` ahead of the busy strings, with the rationale in the comment `:44-47` | EXTRA (states the artboard does not draw) — defensible, recorded not flagged | no | **CONFIRMED as intentional** — the owner's ruling is that *nothing gets cut for not appearing in a mockup*. This is app behaviour no board covers, not a delta: once the link is gone, `Do not disconnect` is advice about a device that is no longer there, and `connectionLost`/`noConnection` are the true statement. The precedence stays, and the rationale at `DeviceHeader.svelte:44-47` is the record of it |
| Three *connected* wordings no board draws | every board that draws a connected header draws one string, `Connected (Recovery Mode)` — 51 occurrences across the canvas, and no other connected wording appears on any board | `DeviceHeader.svelte:49-63` reaches three further wordings on the pre-stub path: `connectedRetroGo` `"Connected (Retro-Go)"` when the scan classifies the device as Retro-Go, `connectedAs(label)` `` `Connected (${label})` `` for any other classified device, and a bare `connected` `"Connected"` when nothing classified (`deviceHeader.ts:8-10`). All three ship in seven locales | EXTRA (three states, no artboard) | **yes** — three wordings the owner has never seen; `docs/DECISIONS.md` #66 asserts the status line carries only five values, and it carries eight | **BLOCKED** — recorded 2026-09-08. Q24 in `docs/BLOCKED-AUDIT.md`. Not settled by *nothing is cut merely for not appearing in a mockup*: the states are legitimate and stay, but the words are copy nobody has approved, and the derivation that picks between them is behaviour, so the artboard-wins-on-paint ruling does not reach it either |
| Header before a scan, and after a disconnect | *no board draws either state* — every board draws a scanned device, and the two Landing boards draw an empty header-left | Both slots read `Scanning…` while `device.scanning`, and `—` before any scan lands (`deviceHeader.ts:11-12`, `DeviceHeader.svelte:74-96`), neither dimmed, since `.dim` requires `scanned`. After a disconnect `{#if device.isConnected \|\| device.everConnected}` (`:128`) keeps both slots on screen carrying the previous scan's values, under a status line reading `No connection` | EXTRA (states, no artboard) | no | **CONFIRMED** — recorded 2026-09-08 while walking the status line. Settled by the standing ruling *nothing is cut merely for not appearing in a mockup*: these are real states with plain placeholder values, not a gap. Distinct from A47, which is the `patchMissing` value on a *scanned* device and is Q3 |
| Console chip, Safe | `background: #2e9e44` (green), no animation | `DeviceHeader.svelte:35-43` `statusColor` → `green` when `utilLoaded`; `DeviceControls.svelte:127` `.status-green { background: var(--status-green) }`, `tokens.css:55` `#2e9e44` | OK — exact | no | **CONFIRMED** — unchanged |
| Console chip, Writing/Finishing | `background: #b8860b; animation: throb 1.1s ease-in-out infinite` | `DeviceHeader.svelte:38-39` `deviceSafety.unsafe → "amber"`; `DeviceControls.svelte:130` `.status-amber { background: var(--caution) }`, `tokens.css:42` `--caution: #b8860b`; `:144-151` `animation: gw-icon-pulse-bg 1.1s ease-in-out infinite` | OK — colour and duration exact | no | **CONFIRMED** — unchanged |
| Throb keyframe depth | `@keyframes throb { 0%,100% { filter: brightness(1); } 50% { filter: brightness(0.62); } }` | `DeviceControls.svelte:148-151` `50% { filter: brightness(0.6) }` | COSMETIC (0.6 vs 0.62) | no | **FIXED** (`8492751`) — the throb keyframe is now `brightness(0.62)` |
| **Caution ring on the chip while busy** | busy chip keeps `border: 1px solid rgba(0,0,0,0.35)` and the same two-part `box-shadow` as Safe — **no ring** | `DeviceControls.svelte:140-143` `.gw-icon-btn.unsafe { border-color: var(--caution); box-shadow: 0 0 0 2px var(--caution), … }` | **EXTRA** — a 2px amber halo the artboard does not draw (comment at `:138-139` states it is a deliberate addition) | **yes** — deliberate but unbacked; owner should accept it or drop it | **FIXED** (`352e8af`) — the EXTRA is gone rather than accepted. `DeviceControls.svelte:167-169` `.gw-icon-btn.unsafe` now drives only the throb; the 2px `--caution` halo and the caution border colour were removed, so the busy chip keeps the idle chip's `1px solid rgba(0,0,0,0.35)` border and the same two-part inset shadow (`:125-140`), which is exactly what HeaderBusy / GuidedFlashing / FlashingCancel / FlashingCancelConfirm draw. Only the fill and the throb change between idle and writing. Note that survey B's `Busy state disables destructive controls` row still cites the amber ring as the app's substitute signal; that clause is now stale, but its status (BLOCKED, Q18) does not move. |
| Chip pulses while *scanning* too | *no scanning board in this file* | `DeviceControls.svelte:60,144-147` `.syncing` shares the busy animation | EXTRA (out of artboard scope) | no | **CONFIRMED as intentional** — same ruling. `HeaderBusy` has no scanning board, so there is nothing to conform to; the scan is a genuine "the app is talking to the device, do not yank it" period and shares the busy animation deliberately. Kept, recorded, not flagged |
| Caret chip on the console button | `background: #c9c9cd; border: 1px solid rgba(0,0,0,0.35); border-radius: 999px; padding: 2px; box-shadow: 0 1px 2px rgba(0,0,0,0.2)`, arrow `fill="#161616"` — **unchanged in all three states** | `DeviceControls.svelte:164-174` (`--silver #c9c9cd` `tokens.css:23`, `--ink-on-face #161616` `tokens.css:29`); no busy variant | OK — exact, including staying unchanged when busy | no | **CONFIRMED** — unchanged |
| Safe lip | `height: 3px; background: linear-gradient(180deg, #d9bc5e 0%, #c09a32 100%)` | `App.svelte:136-139` `.lip { height: 3px; background: var(--grad-gold) }`, `tokens.css:16` | OK — exact | no | **CONFIRMED** — unchanged |
| Busy lip fill + crawl | `background-image: repeating-linear-gradient(115deg, #b8860b 0 14px, #e8c25a 14px 28px); background-size: 62px 100%; animation: crawl 1.1s linear infinite` (`@keyframes crawl { 0 0 → 62px 0 }`) | `App.svelte:141-148` `.lip.hazard { background: var(--grad-hazard); background-size: 62px 100%; animation: lip-crawl 1.1s linear infinite }`, keyframes `:146-149` `0 0 → 62px 0`; `tokens.css:21` `--grad-hazard: repeating-linear-gradient(115deg, #b8860b 0 14px, #e8c25a 14px 28px)` | OK — gradient, size, duration and keyframes all exact | no | **CONFIRMED** — unchanged |
| Busy lip **height** | `height: 5px` in both busy boards (3px when Safe) | `App.svelte:136-139` — constant 3px, comment `:134-135` *"Exactly one lip, always 3px … no layout shift"* | already recorded — **audit 8.9** (`docs/audit-ui-conformance.md:1448-1454`), position "the artboard is what should change" | already tracked | **BLOCKED** (re-sorted 2026-09-07, was OPEN) — the app keeps a constant 3px on purpose: 3px->5px on the *first* frame of a write nudges the whole page down 2px, and the lip already changes fill **and** starts crawling at that instant, so the extra height adds no signal the eye has not already been given. Trading a layout shift for a redundant 2px is the wrong side of the deal, and this band is on screen during every device write. The artboard is judged the defect; that is 8.9's standing position and this walk agrees. Left BLOCKED rather than closed only because overruling an approved board is the owner's call, not an agent's **RE-STATUSED 2026-09-08** (`docs/BLOCKED-AUDIT.md`): Q2 — the busy lip. Merged with survey A GF5. |
| Install slots dim while busy | caption says *"the install slots go stale and dim"*; the boards' own markup renders both slots identically in all three states | `DeviceHeader.svelte:132,139` dim on `scanned && !ofw` / `scanned && !isRetroGo` only | already recorded — **audit 8.10** (`:1456-1463`), blocked on the artboard contradiction | already tracked | **BLOCKED** (re-sorted 2026-09-07, was OPEN) — **the board contradicts itself**: its caption says the slots "go stale and dim", its own markup renders them identical to idle in all three states. There is therefore no dim value to read off, and inventing one would be inventing UI. Only the owner can settle it, by redrawing the busy boards with dimmed slots or striking the caption. The row is not unfixed - it is unspecified **RE-STATUSED 2026-09-08** (`docs/BLOCKED-AUDIT.md`): Q17 — the busy artboards contradict their own caption. |
| Dark-theme busy tokens | every board is light-only | `tokens.css:181-182,219-220` derived dark values | already recorded — **audit 8.11** (`:1465-1471`) | already tracked | **COULD NOT DETERMINE** (re-sorted 2026-09-07, was OPEN) — every board in the set is light-only, so there is no drawn dark value to compare against; the shipped `tokens.css` dark pair was *derived*, not drawn. Nothing here can be settled by reading code - it needs the toggle flipped and the band looked at. Carrying it as OPEN implied an agent could act on it; none can |
| Slot order | Safe/Writing/Finishing all show `logo-gnw-badge.svg` "Zelda (Patched)" **then** `logo-rgo.png` version | `DeviceHeader.svelte:132-142` — OFW slot first, Retro-Go second, comment `:129-131` cites bank order | OK — re-checks audit 5.x note at `:1048`; my walk agrees the order is now correct | no | **CONFIRMED** — unchanged |
| Divider between slots | `width: 1px; height: 18px; background: #d8d8d8; margin: 0 3px` | `DeviceHeader.svelte:232-237` `.divider { width: 1px; height: 14px; background: var(--hairline); margin: 0 0.2rem }` | COSMETIC (14px vs 18px) | no | **FIXED** (`8492751`) — `.divider { height: 18px; margin: 0 3px }` (`DeviceHeader.svelte:246-251`) |
| G&W badge height | `height: 27px` | `DeviceHeader.svelte:248-250` `.logo-key-gnw { height: var(--header-control-h) }` = `1.7rem` = 27.2px (`:184`) | OK | no | **CONFIRMED** — unchanged |
| Retro-Go logo height | `height: 14px` | `DeviceHeader.svelte:242-247` `.logo-key { height: 14px }` | OK — exact | no | **CONFIRMED** — unchanged |
| Retro-Go version type | `font-size: 13px; font-weight: 600; font-family: ui-monospace, Menlo, monospace` | `DeviceHeader.svelte:251-255` `.val { font-size: var(--fs-caption) (14px); font-weight: 600 }` — **`.mono` is defined at `:265-267` but applied to no element** | COSMETIC/WRONG (version string renders in the sans face; 14px not 13px). The value itself is runtime data and is not the finding — the face is | no | **FIXED** (`8492751`) — `.mono` is now applied to the Retro-Go value when it holds a version, giving the artboard's 13px mono (`DeviceHeader.svelte:141`, `:282-285`); placeholder states stay sans by design |
| Band padding | `padding: 0 40px`, band `height: 56px` | `DeviceHeader.svelte:190` `padding: 0.45rem 1.25rem` = `7.2px 20px`; height is content-driven | COSMETIC (20px vs 40px side padding) | no | **FIXED in part** (`8492751`) — side padding is now 40px (`DeviceHeader.svelte:201`); the band height is still content-driven, not the artboard's 56px |
| Grid/device icon at the far left | 19px stroked square-with-pins SVG, present in **all three** boards | `DeviceHeader.svelte:114-120` renders `FlashChipIcon`/`SdCardIcon` at `size={18}` inside `.home-btn`, i.e. a *media-type* icon, not the artboard's fixed glyph; comment `:272-275` says this is deliberate | WRONG (different glyph, and it varies with `targetMedia` where the artboard is constant) | **yes** — the app icon carries information the artboard's does not; owner picks which | **FIXED (glyph) / CONFIRMED (the swap)** (`7c1897a`, icons pass 2026-09-08) — the premise was wrong. The header glyph in `Main`, `RomsNewSystem`, `RomsSdNoCard` and `HeaderBusy` is **not** a separate device-grid icon: it is byte-for-byte the flash-chip path Landing1/Landing2 draw on the media card, at 19px/1.3 instead of 26px/1.2. It is constant across the boards only because every board is drawn in flash mode, so there is no artboard that contradicts the `targetMedia` swap — the app is a superset. The glyph itself now matches (`DeviceHeader.svelte:113-118`); the swap is kept. |
| Busy state disables destructive controls | *the boards show no disabled state* — the console button, the language control and the theme toggle look identical in all three | `DeviceControls.svelte:57-71` the trigger stays enabled while busy; its menu (`:73-89`) still offers `restartRecoveryMode` / `disconnectDevice` / `changeAdapter` mid-write | EXTRA/observation — no artboard requires disabling, and the amber ring at `:140-143` is the app's substitute signal | **yes** — "Disconnect device" being clickable during `Writing flash. Do not disconnect` is the one behavioural gap the busy artboards imply but do not draw | **BLOCKED** — unchanged; `disconnectDevice` is still clickable under `Writing flash. Do not disconnect` **RE-STATUSED 2026-09-08** (`docs/BLOCKED-AUDIT.md`): Q18 — disabling destructive controls during a write. |
| Language control | plain text `"EN"`, `font-size: 12px; font-weight: 500; color: #5c5c5c` | `DeviceHeader.svelte:148-158` a `<select class="icon lang-select">` listing full locale names (`i18n/locale.svelte.ts:34-46`), styled as a silver cap (`:295-317`) | WRONG (a styled select where the artboard has a bare 2-letter label) — but the app supports 7+ locales, which a static `EN` label cannot express | **yes** — same class of call as the Cancel button: artboard predates the multi-locale switcher | **FIXED** (`9e0f750`) — re-verified against the code and the same finding as survey A's A2, with which `docs/BLOCKED-AUDIT.md` Q1 merged it. `DeviceHeader.svelte:148-160` is still a `<select>`, but it is drawn as the boards draw it: `.icon` (`:316-325`) carries no background, border, shadow or radius, `.lang-select` (`:326-335`) sets `appearance: none`, `--fs-micro` (12px), `font-weight: 500`, `--ink-soft` (`#5c5c5c`) and centres the text. The options list the uppercase locale CODE, not the language name, so the closed state is the artboard's `EN` and seven locales are still reachable — the capability the row said a static label could not express is intact. `docs/BLOCKED-AUDIT.md`'s Q1 is closed by code; that file is outside this pass. **2026-09-08:** the closed indicator this row measures is unchanged, but the `<select>` behind it has been replaced by a custom menu (`92bb436`) — the *open* list is drawn by no board and is recorded as **G2** in survey A's *Fixes with no artboard home*. |
| Theme toggle | 16px stroked crescent-moon SVG, `stroke: #5c5c5c`, no button chrome | `DeviceHeader.svelte:159-161` a `<button class="icon">` rendering the text glyph `☾`/`☀` on a silver cap with `1.5px solid var(--model-accent)` (`:295-307`) | WRONG (text glyph on a bordered cap vs a bare stroked SVG) | no | **FIXED** (`8492751`) — the theme toggle is now the artboard's bare stroked crescent with no silver cap (`DeviceHeader.svelte:159-161`, `.theme-btn` `:342-353`) |
| Right-group gap | `gap: 18px` | `DeviceHeader.svelte:204-209` `gap: 0.7rem` = 11.2px | COSMETIC | no | **FIXED** (`8492751`) — the right group is now `gap: 18px` (`DeviceHeader.svelte:221-224`) |
| `role="alert"` / aria on the busy lip | *not expressible in an artboard* | `App.svelte:97-101` sets `role="alert"` + `aria-label={locale.t.deviceHeader.unsafeAria}` (`i18n/strings/deviceHeader.ts:34` `"Do not disconnect the device"`) | EXTRA, positive | no | **CONFIRMED** — unchanged, positive extra |
| Reduced-motion handling | *not expressible in an artboard* | `App.svelte:150-154` and `DeviceControls.svelte:152-159` both keep the colour and stop the motion | EXTRA, positive | no | **CONFIRMED** — unchanged, positive extra |

### Could not determine — HeaderBusy
- Whether `deviceSafety.state` ever actually lands on `"settling"` long enough for the "Finishing up" board to be seen — the transition out is driven by `markQuiet()` from the liveness poll (`installProgress.svelte.ts:299-315`), which needs the device to answer; static reading cannot time it.
- Whether the busy band's 56px height is preserved in the app (`.band` height is content-driven from `--header-control-h` + padding, not set).
- Whether the dark-theme busy band actually reads as "hazard" — needs the toggle flipped (audit item 7.16 / 8.11).
- Whether the artboard's fixed left grid-glyph was intended to be replaced by the media-type icon or was simply never redrawn.

---

# Deltas needing an owner decision

Gathered from every section above. Each is a delta that cannot be fixed by an agent because it
needs new copy with no artboard source, a behaviour that does not exist, or a conflict between
artboards.

## Cross-cutting (one decision settles many artboards)

1. **`Cancel` as bare text vs a bordered neutral cap.** Every modal artboard in this set draws
   `font-size: 14px; font-weight: 500; color: #5c5c5c` with no border; `Button.svelte:68-73`
   gives it a border at all five call sites (`ConnectGateModal.svelte:88`,
   `FolderGateModal.svelte:84`, `FilePromptModal.svelte:357`, `InstallProgressModal.svelte:91`).
   App-wide button-language call.
2. **The install-confirm's Confirm button: solid red fill or oxblood outline.** Both artboards
   specify `background: #c8372b; box-shadow: inset 0 -2px 0 #9e2a20`. Flash passes `danger: true`
   (`RomManagementTab.svelte:725`) and renders the outline; SD (`:743-746`) renders the fill. The
   artboards make the two identical. Audit S5.1 notes Erase legitimately uses the outline, so
   this may be a deliberate "irreversible write" family — someone has to say which.
3. **`MB` vs `MiB`, product-wide.** Every artboard measure line is `MB`; the app emits `MiB`.
4. **"repository" vs "source" vocabulary.** `ReposAdd` says `Add a repository` / `← Repositories`;
   the app deliberately says `Add a source` / `Back to sources`. One of the two has to give.
5. ~~**Modal title size.**~~ **CLOSED (`51ac881`).** Asked as: *every modal artboard title is
   18px; `--fs-lg` is 20px and no 18px token exists — add one, or accept the 2px everywhere.*
   `--fs-title` (18px) was minted, every modal title moved onto it, and `--fs-lg` was retired and
   deleted. Nothing to answer.
6. **Any new copy is a seven-file i18n edit** (`en` + six translations, per CLAUDE.md). This
   applies to items 7, 8, 12, 13, 16 below and is the main reason they are decisions and not
   chores.

## Library

7. **The footer dock's caption lost its copy** — artboard `3.54 MB of 50 MB projected` /
   `+0.12 MB net change`; `RomManagementTab.svelte:1454-1467` emits the figures bare. No
   `projected` string exists in `i18n/strings/roms.ts`; `summary.netChange` (`roms.ts:152`)
   already carries the right sentence and is simply not wired to the dock.
8. **`Choose an SD card to install`** (`RomsSdNoCard`) exists nowhere, and `flashGateNote`
   returns `null` unconditionally in SD mode (`:1408-1409`) — the gate-note branch is
   unreachable. Needs a key *and* a decision on whether SD gets a gate note at all.
9. **`RomsSdNoCard` may itself be the defect**: it still draws the meter and the Summary notch on
   a no-card SD screen, which CLAUDE.md's SD-vs-Flash budget rule says the app must not compute.
   Confirm the artboard is stale before anyone implements it. Same for its undisabled
   `Sync Library`.
10. **`Games` vs `ROMs`** (`roms.ts:135`) and **`Total` vs `Total projected size`**
    (`roms.ts:140`) in the summary table — naming, and the first also touches the tab name.
11. **Row classes with no artboard**: BIOS/emulator rows (`:2047-2055`), unknown-homebrew rows
    with a `remove` chip (`:2085-2094`), the now-playing status chip (`:2129`), the system tag's
    All-filter-only rule (`:2065`). None are in S6's unbacked list.
12. **`RomsOptions`**: the options panel's position (older artboard = page-flow card, code =
    bottom dock, no newer artboard exists); `ScreenScraper` as a `Source` value; the artboard
    fusing Preview + `Apply` + drop-hint into one column where the code makes them exclusive
    branches (`GameDetailsPanel.svelte:937-975`); the missing `Written <timestamp>` row; the
    cheats column's closing summary row vs the code's editable list. All inherit S6.1.

## Sources

13. ~~**The privacy note**~~ **Closed, no decision needed.** The owner dropped the line, and
    `cc09387` / `5992ad8` removed it from `ReposDetail` and `ReposDetailReady`. Nothing to add.
14. **`Activate` / `Deactivate` button shapes** — SETTLED (`88db01a`). Both states take the
    filled dark cap (`Button` variant `ink-solid`), following the owner's install-confirm ruling
    on the same footer-primary slot. `ReposDetailReady`'s bare red text loses.
15. **`Repos` header** — SETTLED (`88db01a`). Both: the subheading is dropped (removed from all
    seven locales) and the `Add source` button is now the artboard's green plus + `Add` text
    affordance, with `addSource` kept as its accessible name.
16. **Modal footer `Done` vs `Close`** — SETTLED: `Close` is pinned project-wide; the
    artboard's `Done` loses. Original note: (`AddSourcesModal.svelte:170` uses the shared
    `shared.common.close`) — needs its own key, never an edit to the shared one.
17. **Unbacked but useful**: `AddSource`'s `urlHint` line; `Remove` in the detail view; the
    modal's accepted-forms placeholder vs the artboard's short `github.com/owner/repo`.
18. **`ReposDetailReady`'s satisfied optional row** shows the accepted variant name plus a green
    check; `AdditionalFiles.svelte:211-212` shows the literal word `Found`. Needs the accepted
    variant plumbed to the row.

## Modals and header

19. **The BIOS modal's subtitle**: the `note` prop is dead repo-wide, so `AdditionalFiles.svelte:246-256`
    renders no subtitle and `RomManagementTab.svelte:2334-2342` prints the *Convert* artboard's
    line on a BIOS prompt. New key, or a manifest field the callers pass?
20. **`optionalTail` drops "more"** — `8 optional files` vs the artboard's `8 more optional
    files` (`sources.ts:96-98`). The in-code rationale is sound and contradicts the design.
21. **FolderGate's satisfied row says `Change…`** where `ModalFolder.dc.html:202` keeps
    `Choose…` (`FolderGateModal.svelte:56`); plus its unbacked
    `Reconnect last folder` / `or` pair (`:52-53`).
22. **The Added-chips block**: part of the input row or a peer block below the rule?
    (`FilePromptModal.svelte:435-457`, and the removable-chip behaviour at `:441-452`.)
23. **Should device actions be disabled mid-write?** `DeviceControls.svelte:73-89` leaves
    `disconnectDevice` clickable under `Writing flash. Do not disconnect`. No artboard draws a
    disabled state — implied, undrawn.
24. **The amber caution ring on the console chip while busy** (`DeviceControls.svelte:140-143`)
    is deliberate per its own comment and drawn in no artboard.
25. **The header's language control**: the artboard has a static `EN` label where the app renders
    a 7-locale `<select>` (`DeviceHeader.svelte:148-158`). The app carries information the artboard
    predates. *(The glyph half of this item is closed — see row 822. The artboard's "fixed
    device-grid icon" is the flash-chip glyph, now shared verbatim, and the `targetMedia` swap
    contradicts nothing the boards draw.)*

## Re-sorted here on 2026-09-07 — carried OPEN by the first marking pass

Each of these was marked OPEN in the first status pass, but none is actionable: every one waits on
a decision.

26. **`RomsOptions`' three conditional presences** — the import glyph gated on `ssUsername`, the
    Variant row and the preview box gated on `coverSource === 'scraper'`. The artboard draws all
    three unconditionally, but un-gating them is behaviour, not paint: the import glyph would offer
    a ScreenScraper fetch with no credentials behind it, an always-on Variant row would control
    nothing in file mode, and an always-on preview box would have no source there. Conforming means
    designing a file-mode state the artboard does not draw.
27. **`RomsOptions`' neutral `Save preview` caption.** The three shipped captions are `Loading...` /
    `Failed to render` / `No preview`. Which becomes the artboard's neutral `Save preview`, or
    whether a fourth state is added, is undrawn.
28. **`LibrarySummary`'s BIOS aside filename in mono.** Mono-setting only the filename means
    splitting `missingDetail` (`sources.ts:123`) into fragments the template interleaves around a
    `<code>` — the Pre/Mid/Post fragment-composition class, authored per language across seven
    locales, not applied mechanically.
29. **`ModalFilesBios`' disabled submit cap.** The paint comes from `Button.svelte`'s shared
    `.btn:disabled` (`:41-48`); changing it repaints every disabled button in the app, in both
    themes. App-wide, like item 1.
30. ~~**Three fills with no token: `#e0e0e0` and `#f0f0f0`.**~~ **CLOSED (`852df8d`).** Answered
    together, as the item asked. `#f0f0f0` earned a token — `--chip-fill: #f0f0f0` / dark `#2e2e2e`
    — because it is one value in one role (a badge/chip `background`) 13 times across six boards,
    and `--surface-sunk` is the sunken-track grey, wrong in kind for a raised chip. `#e0e0e0`
    earned none: it is a divider in one place (`--rule`, 13/255) and a disabled fill in another
    (`--surface-sunk`, 8/255), so it snaps by role rather than minting a third grey for two
    roles that already have homes.

## Not findings — recorded so they are not re-raised

- **`Add languages from translated ROMs` / `Additional Language`** (the lead this task was
  briefed on) are **not missing copy.** They are converter-input `label`/`description` from the
  source manifest, resolved at `AdditionalFiles.svelte:100-111` via `pickText(...)` with
  `strings/sources.ts:87` as the fallback — runtime data, correctly absent from the i18n tables.
  The real defect on that row is item 18 above.
- **`3.54 MB of 50 MB projected`** *is* a real finding, but only the words `of … projected`
  (item 7); the figures are runtime.
