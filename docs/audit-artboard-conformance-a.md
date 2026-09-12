# Artboard conformance survey (A): Landing, Guided, Overview, Firmware, Flash management, Backup & patch

**What this is.** `docs/audit-ui-conformance.md` measured the implementation against a *findings
list* — 46 findings, 38 closed. This document measures it against the *design*: 26 artboards in
`docs/design/mockups/`, walked element by element, in DOM order, against the components that
implement them. A two-minute spot check before this survey found copy that exists in an artboard
and nowhere in the codebase on a screen the earlier audit marks closed; that is the class of gap
this exists to find.

**This is a survey. No application code was changed by it.** Every row below is a finding to be
triaged, not a patch to be applied. Several rows are deliberate reversals of the artboard that
someone argued for in a code comment — those are marked as owner decisions rather than defects.

**Method and its limit.** Read entirely from markup, CSS and the i18n string tables. **Nothing was
rendered in a browser.** Anything that needs a render is called out as undetermined where it
arises. Every code claim cites `file:line`; every design claim quotes the artboard.

**Severity.** **MISSING** — the artboard shows it, the app does not implement it at all.
**WRONG** — implemented, but differently. **EXTRA** — in the app, in no artboard. **COSMETIC** —
a token or spacing nit.

**False positives excluded by construction.** Byte counts, game names, version strings, filenames,
addresses and any other device-derived value are runtime data, not copy, and are never reported as
missing copy. Copy means the literal surrounding text.

**There is no longer a second artboard generation — withdrawn 2026-09-08.** This document used to
carry a "two generations" caveat: that `RomsNewSystem` / `RomsSdNoCard` were the only boards drawing
the app's real four tabs, while `Main`, `Guided`, `Firmware` and the `BackupPatch*` family were older
three-tab drawings whose nav chrome was retired and therefore exempt from measurement. **That premise
is dead.** After `31cc2f7` re-synced the boards, **all 44 boards in `docs/design/mockups/` that draw
the nav band draw the same four tabs** — `Overview / Firmware / Sources / Library` — and the exact
line numbers this document cited as three-tab evidence now hold four-tab content: `Guided.dc.html:67-70`
and `Firmware.dc.html:65-68`. Every board is a valid reference for the nav band, nothing is exempt as
retired chrome, and the individual generation notes below have been rewritten in place.

**Relationship to `docs/audit-ui-conformance.md`.** Anything that audit already records as OPEN is
referenced by finding number, not re-reported. Where this walk disagrees with something it marks
FIXED, that disagreement is stated explicitly.

The other 19 artboards (Roms / Repos / Modals / HeaderBusy) are surveyed in a companion document.

---

## Status of this survey — 2026-09-08 (re-status against the merges since `8ed21e6`)

**Counted mechanically, every status cell:** FIXED 102, OPEN 8, BLOCKED 10, CONFIRMED 88,
COULD NOT DETERMINE 1, no status of its own 2 — **211**. **Plus 30 rows added 2026-09-08** for the
three flash boards neither survey had ever walked — recounted 2026-09-08 after `5e6f658` was
applied: FIXED 7, FIXED in part 1, OPEN 2, BLOCKED 14, CONFIRMED 6 (was FIXED 3 / OPEN 2 /
BLOCKED 19 / CONFIRMED 6; six FlashFailure rows moved BLOCKED → FIXED) —
counted in their own table below rather than folded into a 2026-09-07 column. **Plus 26 rows added
2026-09-08 (missing-states pass)**: `FileBrowserFrogfs`, which no survey had ever walked, and the
two boards that pass drew from the shipping components — `FirmwareLayout` and `EraseCustomRange` —
OPEN 2, CONFIRMED 24, again in their own table: **267 in all**, across 29 artboards. The header table below read FIXED 102 /
OPEN 5 / cross-reference 2; the cells read 105 / 3 / 1, because A54, A57 and A63 were re-statused
to FIXED in the blocked audit and the summary list still called them open pointers. Both splits
total 109, which is how the error survived a pass that checked the total.

**`31cc2f7` synced 19 artboards that were a generation stale, and 17 of them are this survey's.**
Every row on those boards was verdicted before the sync. Diffing all 17 against `31cc2f7^`, the
substantive (non-tab-bar) changes are exactly: whole-MB figures losing `.00` (9 boards); the
footer primary action gaining `margin-left: auto` (9 boards — already equivalent in code,
`FirmwareRail.svelte:230-232`); five prose strings retiring their em-dashes; the FileBrowser
partition caption dropping its address; the FileBrowser read status dropping "over SWD"; and the
BackupPatchBoth collision aside dropping the FrogFS wording. Landing1/Landing2 (13 rows) and
Guided (8 rows) have since been rebuilt against the corrected boards (`1e67d11`, `7d561e9`,
`fb77abb`, `7ee5e06`).

**Five rows are directly contradicted and reopen: FB-4, FB-6, E-7, #10 and #18.** Two of them —
**FB-4 and FB-6 — were built (`0b19acd`) to match board text the sync has since deleted.**
**A33's** Artboard column quoted `free of 50.00 MB`; the board now says `50 MB`, `formatSize`
already trims, and its FIXED verdict survives the re-check.

**169 rows in this survey sit on a board that moved**: Landing1 8, Landing2 5, Guided 8 (all 21
re-walked and rebuilt), plus Main 32, BothEmpty 6, NoStockBank1 3, NoStockBank2 3,
StockUnpatched 6, GuidedFlashing 9, Firmware 18, FileBrowser 12, Write 16, Dump 11, Erase 13,
BackupPatch 6, BackupPatchBoth 4, BackupPatchCross 6, BackupPatchAllowed 3 — **148 rows across
15 boards not re-walked** when this paragraph was written, of which 6 were re-read here, leaving
**142 outstanding at that moment**.

**That 142 is now zero. See the section below.**

**Two "Generation note" paragraphs are now stale** (the Main note and the Firmware note): both
say the artboard draws a three-tab nav. Since `31cc2f7` both draw the app's four tabs. Their
conclusion — that the app's four tabs are correct — is unchanged and now trivially so.

**Three artboards drawn since this survey had no rows here at all** — `FlashingCancel`,
`FlashingCancelConfirm` and `FlashFailure`. **Walked 2026-09-08 and added below (30 rows).** They
were the largest remaining measurement gap in either survey; there is now no approved artboard
that has never been surveyed. Most of what they draw is behaviour, not paint: 19 of the 30 rows
were BLOCKED, 16 of those behind one open question — whether a running flash gets a user-facing
Cancel — and the rest behind the `BAD_HASH_FLASH` work in the engine. Three rows were built
(`ee63de2`), all of them paint that decides nothing. **Since then `5e6f658` built the
FlashFailure dialog** — the danger lip, the head-band failure sentence, the failed-block table
and the advice aside (FF3/FF5/FF6/FF7/FF8/FF9) — taking BLOCKED from 19 to 14 and FIXED from 3
to 7 (plus 1 in part). The 16 behind the Cancel question are untouched.

## Status of this survey — 2026-09-08 (stale-board re-walk: the 142 closed)

The 142 outstanding rows above are closed, in two pieces.

**89 by `5442258`.** It re-derived every non-tab-bar line the sync changed in the nine Advanced
boards and built them: `margin-left: auto` on the footer action cluster (`FirmwareRail`), the
whole-MB row sizes through the shared `formatSize`, the four retired em-dashes, the FileBrowser
partition caption (`Emulators, saves (LittleFS)`, address dropped) and its read status
(`reading · 62%`). That covers Firmware 18, FileBrowser 12, Write 16, Dump 11, Erase 13,
BackupPatch 6, BackupPatchBoth 4, BackupPatchCross 6, BackupPatchAllowed 3 — 89 rows, less the 5
already re-read here (FB-4, FB-6, E-7, #10, #18) = the 84 that were outstanding.

**58 by this pass.** Diffing each remaining board against `31cc2f7^` in full:

- **Main, BothEmpty, NoStockBank1, NoStockBank2, StockUnpatched** changed in exactly two ways
  and no others: the tab bar (three tabs → four, `gap: 30px` → `34px`), and `free of 50.00 MB` →
  `free of 50 MB`. The tab bar is verified conformant (`4630392`, `Advanced.svelte:388` is
  `gap: 34px`). The MB figure is A33, re-read above; `OverviewTab.svelte:550` composes it from
  `formatSize`, which trims. Nothing else on those five boards moved, so **all 49 remaining rows
  keep their verdicts** — Main 31, BothEmpty 6, NoStockBank1 3, NoStockBank2 3, StockUnpatched 6.
- **GuidedFlashing** was not in `31cc2f7` at all. Its only change since it was surveyed is
  `e68d6f1`, which replaced the *backdrop* — the Guided step rail behind the modal — with the
  corrected Guided pane. That pane is now byte-identical to `Guided.dc.html`'s, which
  `fb77abb` / `7ee5e06` already rebuilt against, so the section's own note ("spine rows G1–G7
  apply verbatim") is true again. **GF1–GF9 measure the busy header and the progress modal, and
  `e68d6f1` touched neither** — all 9 rows keep their verdicts.

**No status cell moves and no new delta was found.** That is the honest result of the walk, not
a decision to leave it alone: the corrected boards for these six screens carry two changes
between them, and both were already built.

## Status of this survey — 2026-09-08 (blocked audit)

**Every BLOCKED row in this survey was re-walked against current code and its artboard.** Of the
47, **19 were stale — already built** and never re-marked (F1/F5/F7/F9/F10 under `30bb7d6`,
W-3/W-11 under `0bfd2db`, D-4/D-5 under `84cb50e`, BackupPatch #18 under `fa6ffed`, A50 under
`c6a52b9`, plus A15, A21, A24, A33, A35, A37, A38, X-1 and X-5). **17 more were never blocked at
all** — a standing owner ruling already covered them, twelve of those under *nothing is cut
merely for not appearing in a mockup*. Three rows the previous pass left OPEN (A54, A57, A63)
close with A50.

**Ten rows remain genuinely blocked: A2, A47, GF5, GF6, GR9, F12, W-8, W-13, X-3 and
BackupPatch #19.** Every row carries a dated `RE-STATUSED 2026-09-08` clause in its status cell
naming its verdict and, where still blocked, its question number in
[`docs/BLOCKED-AUDIT.md`](./BLOCKED-AUDIT.md).

Two rows had to be corrected against the verification pass itself: **D-4** claimed a bare native
`<select>` and "not settleable without a render" — `RangeField.svelte:133-148` sets
`appearance: none` and bakes the artboard's own chevron in as a data URI. **X-1**'s
artboard-versus-artboard bar conflict no longer exists: `GeometryBar` has `default`/`tall`/`slim`
variants and all thirteen call sites pass an explicit size, including the two the row calls
unbacked.

## Status of this survey — 2026-09-08 (sweep, outside the Firmware/Advanced tab)

A third pass re-verified every **OPEN** and **BLOCKED** row whose implementation lives outside
`lib/advanced/**` / `views/OverviewTab.svelte` / `ui/InstallProgressModal.svelte` (those were
owned by a concurrent pass). **Fifteen rows moved in this survey.**

Most of the movement is rows that were *already done* and had not been re-marked: the whole
Landing block (**A6**, **A7**, **A9**) and four Guided rows (**GL1**, **GR6**, **GS2**, **GSO2**)
were closed by branches that landed on 2026-09-07 without the survey being updated. **Seven rows
were closed in code by someone else; one — the `destructive` 1.5px rule, audit #15 — was built by
this sweep.**

The other movement is rows that were never work. Five OPEN/BLOCKED rows were re-read against the
owner's standing rulings and are now **CONFIRMED as decisions**, not defects:

- **G3** (per-step description lines) — three subtitles under three titles that already say the
  same thing is the filler the owner ruled out; `wizard.ts:93-94` now records the reversal.
- **GL3** (card label alignment) — an artboard-versus-artboard cosmetic; `GuidedLayoutStock`
  wins, which is what the code already does.
- **GL9** (hardware-floor note) and **GR8** (the `Back` control) and **A13** (the
  unsupported-browser line) — real information with no artboard behind it, and *nothing is cut
  merely for being absent from a mockup*.

**Three rows stayed BLOCKED; A5 has since been withdrawn as stale.** **A5** (34px title) was
recorded as waiting on a 34px token — but `--fs-display-lg` already **is** 34px and
`Landing.svelte:160` already reads it, so there was never anything to mint. **A2** does not wait on
`styles/tokens.css` either: it is the bare-`EN`-label-vs-seven-locale-switcher capability question
(survey B row 820), not a paint value. **A4/A43** is *not* settled by
"artboard wins on pure paint": the artboard draws a **different glyph** (a 12-lead package where
the components draw a real SOIC-8), and both components are shared with `DeviceHeader.svelte`,
where the same glyph is an open behaviour question (row 773 of survey B). It has to be decided
once, for all three call sites.

## Status of this survey — 2026-09-07

**Every row in every table below now carries a `Status (2026-09-07)` column, re-verified on
2026-09-07** after the branches that closed most of the first pass's OPEN rows landed. The survey
text itself is unchanged: rows were marked, never rewritten or deleted, so the original claim and
its `file:line` citation stay readable next to what became of it. Statuses are **FIXED** (closed,
with the commit that did it), **OPEN** (still true as written), **BLOCKED** (needs an owner
decision — the cell says which), **CONFIRMED** (walked again, still conforms) and **COULD NOT
DETERMINE** (needs a browser).

**The re-verification moved rows in both directions.** Seventeen rows the first marking pass left
OPEN are closed (`79cbd66`, `02d83be`, `f7f71d9`, `ad92c77`, and one — BackupPatch #4 — that
`81ad3aa` had already fixed months before the marking pass recorded it as OPEN). Six more were
mis-sorted the other way: they were never actionable, because each waits on a decision only the
owner can make. They are now BLOCKED, with the decision named on the row: **A35** (the ext-flash
legend, behind X-5's `#c0392b` and A36's label), **A37**'s shape half (behind A33), **X-1 / A34**
(an artboard-versus-artboard bar-geometry conflict plus two call sites with no artboard at all),
**X-7** (removing the hover strip removes click-to-pin detail from eight call sites — behaviour,
not conformance) and **D-4** (not settleable without a render). **A8** is marked CONFIRMED — not a
defect: the row itself always said the missing artboard spacer was harmless.

| Status | rows (2026-09-07) | rows (2026-09-08 sweep) | rows (2026-09-08 icons pass) | rows (2026-09-08 blocked audit, as stated) | rows (2026-09-08 re-status, counted) |
|---|---:|---:|---:|---:|---:|
| FIXED | 68 | 75 | 80 | 102 | **102** |
| OPEN | 18 | 12 | 8 | 5 | **8** |
| BLOCKED | 54 | 48 | 47 | 10 | **10** |
| CONFIRMED (walked again, still conforms) | 69 | 74 | 74 | 91 | **88** |
| COULD NOT DETERMINE | 1 | 1 | 1 | 1 | **1** |
| row with no status of its own | 1 | 1 | 1 | 2 | **2** |
| **total rows walked** | 211 | 211 | 211 | 211 | **211** |

**Sixth reading — 2026-09-08 (missing-states pass), the whole file.** The five columns above are
all readings of the 211-row core; every one of them predates the 30 flash-board rows and the 26
missing-states rows, which are counted in their own tables below. Counting **every** cell in the
file by the same rule gave **267 rows**: FIXED **110**, OPEN **10**, BLOCKED **24**,
CONFIRMED **120**, COULD NOT DETERMINE **1**, no status of its own **2**. That is the fifth column
plus the flash boards' 30 (8 / 2 / 14 / 6) plus this pass's 26 (0 / 2 / 0 / 24), with F18 and E-9
moved OPEN → CONFIRMED inside the 211. `SETTLED — CONFIRMED` on GR9 resolves to CONFIRMED, per the
leading-family rule below.

**Eighth reading — 2026-09-08 (nav-band pass), the whole file.** Re-counted by the same rule after
that pass's edits: **271 rows** — FIXED **117**, OPEN **7**, BLOCKED **23**, CONFIRMED **121**,
COULD NOT DETERMINE **1**, no status of its own **2**. The only movement is the two rows **F0** and
**F1a** described above; no existing cell changed and no code was written. The parser was
re-implemented from `docs/CONFORMANCE.md`'s derivation rule and reproduced the seventh reading
exactly before any edit, and the `Guided` (8 rows) and `Firmware` (18 rows) tables were hand-counted
against it.

**Seventh reading — 2026-09-08 (merge sweep), the whole file.** Re-counted by the same rule after
that pass's edits: **269 rows** — FIXED **117**, OPEN **6**, BLOCKED **23**, CONFIRMED **120**,
COULD NOT DETERMINE **1**, no status of its own **2**. Nothing regressed and no code was written
by that pass; seven rows were closed **by merges that had already landed** and two new rows were
added.

Seven rows moved, each re-read against the code rather than against a commit message:

- **FBF-7** (footer summary per selection) — closed by `347ef5b`.
- **FB-4**, **FB-6**, **E-7**, **row 10**, **row 18** — the five rows `cadf918` reopened against
  the resynced artboards. `5442258` had already re-conformed every one of them; the survey was
  never updated behind it, so all five sat OPEN against code that matched the board.
- **A2** (header right controls) — closed by `9e0f750` + `8492751`, which also closes
  `docs/BLOCKED-AUDIT.md`'s Q1 (that file is outside this pass and still carries the question).

Two rows were added, both OPEN, both undrawn states of the File-browser footer found while closing
FBF-7: **FB-13** (LittleFS with Recovery Mode off — the rows are not clickable and the footer still
says to click one) and **FB-14** (no partition selected — no summary at all). Neither is written:
both need the owner's wording or a ruling, and no board supplies copy for either.

The fourth column was the blocked audit's header, not a count of cells. The fifth is a count of
cells. It differs by the three pointer rows (A54/A57/A63, FIXED not OPEN) and by the five rows
`31cc2f7` reopened.

**How the fifth column is derived, so it can be re-checked without re-litigating it
(2026-09-08, counts pass).** Every line beginning `|` in this file is parsed; a table is a *row*
table only if it has a `Status …` column that is not column 0 (that excludes the four summary
tables above, whose first column is `Status` or `Artboard`). Cells are split on `|` **outside**
backtick spans, so inline code containing a pipe does not shift the columns, and a row's status
is the **leading** token of its status cell only — a `**BLOCKED**` appearing inside a FIXED cell's
prose is not counted. Validation: the parse reproduces the per-artboard `rows` column of both
summary tables below, board for board, and two tables (`Main`, 32 rows, and survey B's
`HeaderBusy`, 31 rows) were also counted by hand and matched exactly.

Two rows carry no status value of their own and are counted as such rather than as a verdict:
**GS6** (`Steps 2-4 identical to GuidedRetroGoOnly` — a pointer to GR3/GR9) and **row 16**
(`Destructive hover` — *"out of artboard scope, noted only"*). The fifth column previously read
CONFIRMED 89 / no-status 1; row 16 had been folded into CONFIRMED. Corrected here to 88 / 2. The
total, 211, does not move.

**Icons pass (2026-09-08), fourth column.** Five rows moved. **A4** and **A43** left BLOCKED for
FIXED — the block was never real: all five artboards that draw the flash chip draw the same path,
so there was one glyph to apply, not a conflict to arbitrate, and applying it at every call site
at once is what the previous pass correctly said was required. **GF4** and **GF7** were built.
**GF6** loses its colour half to FIXED and stays BLOCKED on copy alone. **Row 15**
(BackupPatchCross, `destructive`'s border) was **stale** — the variant has been 1.5px for some
time; the 1px the row quotes is the `:disabled` reset a few lines above it.

Read that as (2026-09-08): of the ~142 delta rows, **75 are closed and 60 remain** — **48 of the
60 behind an owner decision**, leaving **12** anyone could pick up today, and every one of them is
small. The 2026-09-07 reading below is kept for comparison: *of the ~142 delta rows, 68 are closed
and 73 remain, 54 of the 73 behind an owner decision, 18 actionable.*

| Artboard | FIXED | OPEN | BLOCKED | CONFIRMED | undetermined | rows |
|---|---:|---:|---:|---:|---:|---:|
| Landing1 | 0 | 3 | 4 | 1 | 0 | **8** |
| Landing2 | 1 | 1 | 1 | 2 | 0 | **5** |
| Main | 17 | 0 | 12 | 3 | 0 | **32** |
| BothEmpty | 2 | 0 | 2 | 2 | 0 | **6** |
| NoStockBank1 | 0 | 1 | 1 | 1 | 0 | **3** |
| NoStockBank2 | 0 | 1 | 0 | 2 | 0 | **3** |
| StockUnpatched | 0 | 1 | 0 | 4 | 1 | **6** |
| Guided | 0 | 1 | 0 | 7 | 0 | **8** |
| GuidedFlashing | 1 | 3 | 2 | 3 | 0 | **9** |
| GuidedLayout | 2 | 1 | 2 | 4 | 0 | **9** |
| GuidedLayoutStock | 1 | 0 | 0 | 3 | 0 | **4** |
| GuidedRetroGoOnly | 0 | 2 | 1 | 6 | 0 | **9** |
| GuidedSkipBackup | 2 | 1 | 0 | 3 | 0 | **6** |
| GuidedStockOnly | 1 | 0 | 1 | 3 | 0 | **5** |
| Firmware | 3 | 1 | 7 | 7 | 0 | **18** |
| FileBrowser | 9 | 0 | 2 | 1 | 0 | **12** |
| Write | 8 | 0 | 5 | 3 | 0 | **16** |
| Dump | 5 | 0 | 3 | 3 | 0 | **11** |
| Erase | 6 | 1 | 1 | 5 | 0 | **13** |
| *(Flash management, cross-cutting)* | 2 | 0 | 5 | 2 | 0 | **9** |
| BackupPatch | 3 | 0 | 2 | 1 | 0 | **6** |
| BackupPatchBoth | 1 | 0 | 1 | 2 | 0 | **4** |
| BackupPatchCross | 3 | 1 | 0 | 1 | 0 | **6** |
| BackupPatchAllowed | 1 | 0 | 2 | 0 | 0 | **3** |
| **Total** | **68** | **18** | **54** | **69** | **1** | **211** |

**The three flash boards are counted separately, on purpose.** Every column in the table above is
a 2026-09-07 reading; `FlashingCancel`, `FlashingCancelConfirm` and `FlashFailure` were walked on
2026-09-08 and folding 2026-09-08 statuses into a 2026-09-07 column would produce a total that
means nothing — the exact class of error `docs/CONFORMANCE.md` records twice.

| Artboard (walked 2026-09-08) | FIXED | OPEN | BLOCKED | CONFIRMED | undetermined | rows |
|---|---:|---:|---:|---:|---:|---:|
| FlashingCancel | 1 | 0 | 5 | 4 | 0 | **10** |
| FlashingCancelConfirm | 0 | 0 | 7 | 1 | 0 | **8** |
| FlashFailure | 7 | 2 | 2 | 1 | 0 | **12** |
| **Total** | **8** | **2** | **14** | **6** | **0** | **30** |

**A third group is counted separately for the same reason: the missing-states pass, 2026-09-08.**
`FileBrowserFrogfs` was in the mockups README index but had rows in neither survey and was not in
`docs/CONFORMANCE.md`'s inventory count; `FirmwareLayout` and `EraseCustomRange` were **drawn** by
that pass, from the shipping components, to close F18 and E-9 — both of which were OPEN only
because no board depicted a state the app renders. Those two boards conform by construction, which
is why their rows are all CONFIRMED and why they are not folded into a column that would read as
progress.

| Artboard (walked 2026-09-08, missing-states pass) | FIXED | OPEN | BLOCKED | CONFIRMED | undetermined | rows |
|---|---:|---:|---:|---:|---:|---:|
| FileBrowserFrogfs | 1 | 1 | 0 | 8 | 0 | **10** |
| FirmwareLayout *(board drawn by this pass)* | 0 | 0 | 0 | 9 | 0 | **9** |
| EraseCustomRange *(board drawn by this pass)* | 0 | 0 | 0 | 7 | 0 | **7** |
| **Total** | **1** | **1** | **0** | **24** | **0** | **26** |

**FBF-7 has since closed** (`347ef5b`), which is the one cell that has moved in the table above
since it was written; `FileBrowserFrogfs` reads 1 / 1 / 0 / 8.

**Two rows were added to the `Firmware` table by the 2026-09-08 nav-band pass** — **F0** (tab bar,
CONFIRMED) and **F1a** (mode-switch type, OPEN). They exist because the "older three-tab generation,
retired chrome, not measured" exemption was withdrawn that day (see the preamble): the nav band had
never been walked on this board, and once it was, it produced one conformant element and one
one-token delta. That is what **S8.5** reduces to. Like FB-13/FB-14 below, they are **not** folded
into the frozen 2026-09-07 reading; the whole-file mechanical count in the header includes them, and
the survey moves **269 → 271 rows, CONFIRMED 120 → 121, OPEN 6 → 7**. Nothing else moved, and no row
moved because code was written.

**Two rows were added to the `FileBrowser` table by the 2026-09-08 merge sweep** — **FB-13** and
**FB-14**, both OPEN — so that board now carries 14 rows. They are deliberately **not** folded
into the 2026-09-07 reading below, which is frozen: adding 2026-09-08 rows to a 2026-09-07 column
is the error this file records twice. The whole-file count that includes them is the seventh
reading in the header.

The same pass moved **F18** and **E-9** from OPEN to CONFIRMED — closed by producing the drawing,
not by changing code. Both are counted in the 211 table above, whose columns are a 2026-09-07
reading and are not restated here; the mechanical count of every current cell is in the header
table, and it moves by exactly those two rows plus these 26.

Survey A therefore walks **267 rows across 29 artboards** (211 + 30 + 26). Three of the eight FIXED
cells were closed by `ee63de2` — the whole of that pass's code change, two of them part-fixes
that say in the row itself what is still outstanding; the other five are the FlashFailure rows
`5e6f658` closed, which is why this table's FlashFailure row now reads FIXED 7 / BLOCKED 2 rather
than the 2 / 7 it carried when the board was first walked. Every other new row records something that cannot be built
without a decision.

### OPEN, in priority order

Only rows marked **OPEN** — actionable today, no owner decision needed. BLOCKED rows are listed
separately under *Everything needing an owner decision* at the foot of this document. Fifteen
rows, re-derived 2026-09-07 and trimmed again the same day when the header rows closed; the
structural items that used to head this list (`Controls`, the empty bank card, the geometry-bar paint, the Erase selection) are now closed, and the ext-flash
legend and footer row set moved to BLOCKED.

**2026-09-08:** of the fifteen rows below, six have left OPEN — **A9** (8.6, now FIXED), **GR6**
(FIXED), **GS2** (FIXED), and **G3**, **GL9**, **GR8** (all CONFIRMED as decisions, above).
**#15** was built. What is left in this list is items 1, 2 and 5–8, of which items 2 and 5–8 are
outside this sweep's scope or are missing-artboard reports rather than defects.

1. **A54 / A57 / A63 — the empty-bank cross-references.** A48/A49 are closed (`79cbd66`), so what
   is left under 8.3 is A50's copy half alone, which is BLOCKED. These three rows stay OPEN only as
   pointers; nothing in them is separately actionable.
2. **GF4 / GF5 / GF7 — the progress modal.** The 480px width override
   (`InstallProgressModal.svelte:70` passes no `maxWidth`, so `ModalShell`'s 416px default applies),
   the working-note ink, and the SVG chevron on the log toggle.
3. **GR6 / GR8 — the Guided Retro-Go pane.** `Button.svelte`'s `quiet` variant still underlines and
   `skipEllipsis` is still `"Skip…"`; the `back` button is still rendered (tracked as S6.12).
4. **A9 — Landing2's `Modded with / Flash memory / Change` row**, tracked as 8.6.
5. **GL9 — the hardware-floor note** on the chooser, drawn on no chooser artboard (S6.12 / 7.19),
   and **GS2** — GuidedSkipBackup's caution ink, deliberately kept so it flips in dark theme.
6. **G3 — Guided's per-step description lines**, tracked as 3.9.
7. **E-9 — the Erase pane's custom-range open state**, a reasonable extension with no artboard.
8. **F18 — the Firmware layout-override drawer**, a missing artboard rather than a defect.
9. **#15 — `destructive`'s 1px border** against the artboards' 1.5px, in `Button.svelte`.

**2026-09-08 (icons pass).** Four more rows leave this list. **GF4** and **GF7** (item 2) were
built, and **GF6**'s colour half with them — item 2 now reduces to GF6's copy, which is BLOCKED.
**#15** (item 9) was never a defect: `Button.svelte`'s `destructive` already carries the
artboard's 1.5px border, so the row was stale. What remains actionable in this survey is
**nothing**: items 1 and 3–6 are pointers or confirmed decisions, and items 7 (**E-9**) and 8
(**F18**) are missing-artboard reports whose implementations live in `lib/advanced/**`.

**2026-09-08 (missing-states pass).** Items 7 and 8 leave this list for good: the missing artboards
were drawn (`EraseCustomRange.dc.html`, `FirmwareLayout.dc.html`) and both rows are now CONFIRMED.
**Two new OPEN rows arrive**, both from `FileBrowserFrogfs`, a board nobody had surveyed:
**FBF-1** (the selected-segment ring, which also disproves the premise of the nineteenth question
in `docs/BLOCKED-AUDIT.md`) and **FBF-7** (the File-browser footer summary, which the pair of
boards specifies per selection while the app ships one string for both). The OPEN count is
unchanged at 10 either way.

**2026-09-08 (merge sweep).** **FBF-7 is closed** (`347ef5b`): the summary now follows
`selectedFs`, with `footerSummaryFrogfs` in all seven locales. **FBF-1 stayed OPEN through this sweep** — the ring was
still `--zelda-green` over a `--seg-games` fill and the two boards still specify two ring
colours. (It is **FIXED** as of the later green-fill-scoped pass recorded in its own row; the
two-ring-colour question itself still stands with the owner.) **A2 leaves this survey's blocked
set** (`9e0f750`): the header's language and theme controls are now the artboards' chrome-less
text and crescent. **Two new OPEN rows arrive**, **FB-13** and **FB-14** — the same false-
instruction shape as FBF-7 in two states no board draws (LittleFS with Recovery Mode off; no
partition selected). Both need the owner's wording, so neither was written. The OPEN count falls
from 10 to 6.

---

## Summary (as first written — superseded by the status table above)

**160 deltas across 26 artboards.** 33 MISSING, 64 WRONG, 28 EXTRA, 35 COSMETIC.
(The 2026-09-08 flash-boards pass added 21 of those deltas across the three boards neither survey
had ever walked: `FlashingCancel` 4, `FlashingCancelConfirm` 7, `FlashFailure` 10. The other
nine of its 30 rows record conformance or duplicate an existing row and are not counted here.)

Rows already recorded as OPEN in `docs/audit-ui-conformance.md` (3.9, 8.3, 8.6, S6.12, 5.1's
`Re-read partition` clause) are referenced by finding number and **excluded from these counts**.
Rows that record a *conformance* — an element walked and found correct — are listed in the
per-artboard tables with a `—` severity and are likewise not counted.

| Artboard | MISSING | WRONG | EXTRA | COSMETIC | Total |
|---|---:|---:|---:|---:|---:|
| Landing1 | 0 | 3 | 1 | 4 | **8** |
| Landing2 | 2 | 0 | 1 | 0 | **3** |
| Main | 3 | 18 | 5 | 6 | **32** |
| BothEmpty | 3 | 0 | 1 | 0 | **4** |
| NoStockBank1 | 0 | 1 | 1 | 0 | **2** |
| NoStockBank2 | 0 | 0 | 0 | 0 | **0** |
| StockUnpatched | 0 | 0 | 0 | 0 | **0** |
| Guided | 1 | 0 | 0 | 0 | **1** |
| GuidedFlashing | 0 | 3 | 0 | 2 | **5** |
| FlashingCancel | 2 | 1 | 0 | 1 | **4** |
| FlashingCancelConfirm | 6 | 0 | 0 | 1 | **7** |
| FlashFailure | 6 | 1 | 1 | 2 | **10** |
| GuidedLayout | 0 | 2 | 1 | 2 | **5** |
| GuidedLayoutStock | 0 | 0 | 0 | 0 | **0** |
| GuidedRetroGoOnly | 0 | 2 | 1 | 0 | **3** |
| GuidedSkipBackup | 0 | 0 | 0 | 3 | **3** |
| GuidedStockOnly | 0 | 1 | 0 | 1 | **2** |
| Firmware | 1 | 5 | 2 | 2 | **10** |
| FileBrowser | 5 | 2 | 2 | 2 | **11** |
| Write | 2 | 10 | 2 | 0 | **14** |
| Dump | 1 | 1 | 4 | 2 | **8** |
| Erase | 0 | 5 | 2 | 1 | **8** |
| *(Flash management, cross-cutting)* | 0 | 3 | 1 | 3 | **7** |
| BackupPatch | 0 | 1 | 2 | 1 | **4** |
| BackupPatchBoth | 0 | 1 | 0 | 1 | **2** |
| BackupPatchCross | 0 | 3 | 0 | 1 | **4** |
| BackupPatchAllowed | 1 | 1 | 1 | 0 | **3** |
| **Total** | **33** | **64** | **28** | **35** | **160** |

### What the shape of this table says

Four artboards come out clean — `NoStockBank2`, `StockUnpatched`, `GuidedLayoutStock` and
`Guided` (the "bar the retired chrome" qualifier this line used to carry was withdrawn
2026-09-08: `Guided.dc.html:67-70` draws the app's real four tabs, so there is no retired chrome
left to excuse). That is real: the bank-prompt state machine, the stock-path
spine and the chooser's two-card variant were all built against their artboards and hold up
element by element.

The concentration is elsewhere. **`Main` alone carries 32 deltas — 23% of the survey.** The
earlier audit cited Overview twice (5.4, 5.5) and closed one of them; walking it turns up a
different section label, a different row set, a section that does not exist in any artboard, a
relocated screenshot action, a bank card whose head row, bar geometry and occupant block are all
laid out differently, and an external-flash panel that is a different object from the one drawn.
Overview was never de-boxed or re-copied; it was re-*plumbed*.

**The three Flash-management panes plus their shared chrome carry 40.** `Write` is the worst
single pane (14): its plan block, its option checkboxes and its acknowledgement gate all diverge,
and the artboard's `Overwrites` row — the README's "warnings say what you are about to lose" rule
made concrete — has no counterpart in the code at all. `FileBrowser` (11) includes a genuine
functional bug: its 72px footer never renders.

**19 of the 62 WRONG rows are copy**, and every one of those is a seven-file i18n edit.

---
## Landing1

Implemented by `apps/web/src/lib/views/Landing.svelte` (step `'media'`), with the header from
`lib/ui/DeviceHeader.svelte` + `App.svelte`'s lip.

Conforming and worth recording: the pips (`Landing.svelte:32-35`, `110-124`) are the artboard's
`22px × 6px` green + `6px × 6px` `#d8d8d8` pair exactly; all six card strings match the artboard
character for character (`lib/i18n/strings/landing.ts:8-13`); the card box model (`min-height: 168px`,
`padding: 30px 28px`, `gap: 16px`, `border: 1px solid #d8d8d8`, `radius 6px`, `.text { margin-top: auto }`)
matches line for line (`Landing.svelte:144-169`).

| # | Element | Artboard specifies | Implementation | Severity | Owner decision? | Status (2026-09-07) |
|---|---|---|---|---|---| --- |
| A1 | Header bar height/padding | `height: 56px; … padding: 0 40px` on the white band | `.band` has no height and `padding: 0.45rem 1.25rem` (7.2px / 20px) — `DeviceHeader.svelte:190` | WRONG | no | **FIXED** — the band now carries the artboard's 56px as `min-height` alongside the 40px side padding (`DeviceHeader.svelte`, `.band`). `min-height` rather than `height` so a longer status line in another locale grows the band instead of overflowing it; at every shipped string length it resolves to exactly 56px |
| A2 | Header right controls | Plain text `<span style="font-size: 12px; font-weight: 500; color: #5c5c5c;">EN</span>` and a bare 16px stroked moon `<svg>`, no chrome | Both are chromed controls: `.icon` = `background: var(--silver); border: 1.5px solid var(--model-accent); box-shadow: inset 0 -2px 0 …; border-radius: 5px; width/height: 1.9rem` (`DeviceHeader.svelte:295-307`); the language control is a `<select>` (`:148-158`) and the theme control is a text glyph `☾`/`☀`, not an SVG (`:159-161`) | WRONG | no | **FIXED** (`9e0f750` language control, `8492751` theme control) — re-verified against the code. `.icon` no longer draws the silver cap: `background: none; border: none; box-shadow: none; border-radius: 0; color: var(--ink-soft)` (`DeviceHeader.svelte:316-325`), and `.lang-select` (`:326-335`) adds `appearance: none`, `--fs-micro` (12px, `tokens.css:90`), `font-weight: 500` — the artboard's bare `12px/500 #5c5c5c`. The capability objection is answered rather than traded away: the control is still a real `<select>`, its closed state and its options now read the uppercase locale CODE, which is what every board draws. The theme control is the bare 16px stroked crescent SVG (`:170`, `.theme-btn` `:346-357`). This closes Q1 in `docs/BLOCKED-AUDIT.md`, which merged this row with survey B's `Language control`; that file is not this pass's to edit and still carries the question. |
| A3 | Connection dot on the landing header | Header-left is empty on both Landing artboards | A `.dot` is rendered whenever `!device.isConnected && !device.everConnected`, which is exactly the landing case — `DeviceHeader.svelte:107-109` | EXTRA | no | **FIXED** — the `.dot` span is gone; `.header-left` is empty on the landing case exactly as Landing1/Landing2 draw it, and the div is kept as the flex spacer. Note the span carried **no CSS anywhere in the app** (`grep -rn '\.dot' apps/web/src` matched only a tokens.css comment), so it was already invisible dead markup — removing it is zero visual risk. Its removal also un-masked two genuinely dead selectors in the same file (`.brand`, `.key`): Svelte could not prune them while an element carried an unresolvable `class="dot {device.connection}"` expression. Both deleted; svelte-check is back to 0/0 |
| A4 | Card icon style | Both cards use **stroked outline** glyphs, `stroke="#1b1b1b" stroke-width="1.2"`, e.g. the flash chip is `<rect x="5" y="5" width="10" height="10" rx="1.2">` plus 12 lead strokes | `FlashChipIcon` / `SdCardIcon` are **filled** silhouettes (`fill="currentColor"`, `FlashChipIcon.svelte:11-27`, `SdCardIcon.svelte:36-38`), used at `Landing.svelte:43,51` | WRONG | yes — the filled glyphs are deliberate shared assets (`FlashChipIcon.svelte:1-7` says they exist so Landing and DeviceHeader stay pixel-identical). Restyling them to the artboard outline changes the header too. Owner picks: restyle both, or update the artboard. | **FIXED** (`7c1897a`, icons pass 2026-09-08) — settled once for every call site, which is what unblocked it. All five artboards that draw the chip (Landing1, Landing2, Main, RomsNewSystem/RomsSdNoCard, HeaderBusy) draw the **identical** path, so there was no artboard-versus-artboard conflict to resolve — only one glyph applied at two sizes. Both components are now stroked outlines with a `strokeWidth` prop; Landing keeps 26px/1.2, `DeviceHeader` takes 19px/1.3. The 12-lead body is not the real SOIC-8; taken verbatim under *artboard wins on pure paint*, and reversible as a two-file revert. |
| A5 | Title size | `font-size: 34px` | `var(--fs-display-lg)` = `2rem` = 32px — `Landing.svelte:127`, `styles/tokens.css:65`. The code comments the gap at `:126` | COSMETIC | no | **FIXED / row was stale** — no 34px token was ever missing: `--fs-display-lg` **is** 34px (`tokens.css:82`, the artboard value, with its own comment) and `Landing.svelte:160` already reads it. The row recorded the token's old 2rem value. Nothing minted; nothing to change. |
| A6 | Card title size | `font-size: 18px` | `var(--fs-lg)` = `1.25rem` = 20px — `Landing.svelte:184`, `styles/tokens.css:63` *(as surveyed; `--fs-lg` was retired outright in `51ac881` and no longer exists)* | COSMETIC | no | **FIXED** (2026-09-08 sweep) — `.choice .label` is now `font-size: var(--fs-title)` = **18px** (`Landing.svelte:253`), the artboard value, using the newly minted token. |
| A7 | Card description size | `font-size: 14px` | `var(--fs-caption)` = `0.875rem` = 14px — matches. The rubric under the title is artboard 15px vs `--fs-caption` 14px (`Landing.svelte:136`) | COSMETIC | no | **FIXED** (2026-09-08 sweep) — `.rubric` is now `font-size: var(--fs-lede)` = **15px** (`Landing.svelte:167`), the artboard value, using the newly minted token. |
| A8 | Trailing spacer row | Landing1 ends with an empty `<div … padding-top: 4px;"><span></span></div>` | No equivalent; `.landing` has `gap: 28px` only (`Landing.svelte:103`). Harmless — recorded so the walk is complete, not as a defect | COSMETIC | no | **CONFIRMED — not a defect.** Re-read 2026-09-07: the row itself records the artboard spacer as harmless, so its absence is not a delta. Marked so it stops appearing in the OPEN backlog |

## Landing2

Implemented by `apps/web/src/lib/views/Landing.svelte` (step `'action'`).

| # | Element | Artboard specifies | Implementation | Severity | Owner decision? | Status (2026-09-07) |
|---|---|---|---|---|---| --- |
| A9 | "Modded with / Flash memory / Change" row | A row between the rubric and the cards: `Modded with` (13px `#5c5c5c`), the chosen media in 13px/600, and `Change` in 13px/500 `#3e9e4e` | Not implemented — `Landing.svelte:58-93` goes straight from `.head` to `.choices` | MISSING | already recorded as **8.6 OPEN** in `docs/audit-ui-conformance.md:1428`; not re-counted below | **FIXED** (2026-09-08 sweep) — the row is implemented: `.modded` / `.modded-label` / `.modded-value` / `.modded-change` at `Landing.svelte:61-69`, styled `:172-197`, with `Change` in `--zelda-green` returning to `step = 'media'`. Closes 8.6. |
| A10 | Card icons on step 2 | Both cards carry icons: Manage device a **green** (`stroke="#3e9e4e"`) flash-chip glyph — i.e. the icon echoes the media chosen in step 1 and is tinted to say it is the active context — and Manage games a gamepad glyph (`<rect x="2.5" y="4.5" width="15" height="11" rx="1.6">` + d-pad + two buttons) | Neither action card renders any icon at all — `Landing.svelte:60-79` has only `<span class="text">` | MISSING | yes — the gamepad glyph does not exist as an asset in `apps/web/src/assets/` or `lib/ui/`; someone must approve creating it (and confirm the green tint is meant to track `device.targetMedia`) | **FIXED** (`eebdc02`) — both step-2 cards now draw a 26px glyph: the media icon tinted green (`Landing.svelte:63-73`, `.icon-green` `:205-208`) and the artboard's inline gamepad SVG (`:85-97`) |
| A11 | Advanced link | `<span style="font-size: 13px; font-weight: 500; color: #5c5c5c;">Manage device (advanced) →</span>` | Matches: `landing.ts:19` is character-identical, rendered at `Landing.svelte:87` with `--fs-btn-sm` (13px, `tokens.css:110`), weight 500, `--ink-soft` (`:194-204`). **Conforms.** | — | no | **CONFIRMED** — still conforms (`landing.ts:19`, `Landing.svelte:222-227`) |
| A12 | Back control | `← Back` at `font-size: 14px; font-weight: 500; color: #5c5c5c` | Matches (`landing.ts:22`, `Landing.svelte:211-220`, `--fs-btn` = 14px at `tokens.css:109`). **Conforms.** | — | no | **CONFIRMED** — still conforms (`Landing.svelte:112-113`) |
| A13 | Unsupported-browser line | No artboard shows it | `(Unsupported Browser)` is appended as a third `.sub` line inside the Manage device card and the card dims to `opacity: 0.5` — `Landing.svelte:68-70`, `178-181`, `landing.ts:18` | EXTRA | yes — a real state with no artboard; needs one, or acceptance as-is | **CONFIRMED — keep.** Re-walked 2026-09-08 sweep. An unbacked EXTRA, but a real state (no WebUSB) carrying real information, and the owner's standing rule is that nothing is cut merely for being absent from a mockup. Not filler: no other element on the screen says the browser cannot do this. |

## Main

Implemented by `apps/web/src/lib/views/OverviewTab.svelte`, `lib/ui/BankCard.svelte`,
`lib/ui/GeometryBar.svelte`, `lib/ui/StatPanel.svelte`, with the header from `lib/ui/DeviceHeader.svelte`
and the nav band from `lib/views/Advanced.svelte`.

**Generation note.** Main draws a three-tab nav (`Overview / Firmware Setup / ROMs`). The app
ships four tabs — `Overview / Firmware / Sources / Library` (`Advanced.svelte:199-234`,
`lib/i18n/strings/firmwareSetup.ts:15-17`) — taken from the newer `RomsNewSystem` /
`RomsSdNoCard` generation. The band's own geometry does conform (`height: 46px`, full-bleed
white, `padding: 0 40px`, `border-bottom: 1px solid #d8d8d8`, 3px inset active rule —
`Advanced.svelte:385-414`). **Corrected 2026-09-08: `Main.dc.html:66-69` draws `Overview` /
`Firmware` / `Sources` / `Library`** — the app's real four, at the app's real values — so the
"three tabs, `Firmware Setup` / `ROMs`, retired chrome, not reported" note that stood here
described a board that no longer exists. Main's nav band conforms; it is measured once, on
`Firmware.dc.html`, as row **F0**.

**Layout.** Main's body is `grid-template-columns: repeat(12, …)` with Device + Internal flash on
`span 7` and Screen + External flash on `span 5`. The app has the grid and the `span 7`/`span 5`
dashboard row (`OverviewTab.svelte:745-757`) but puts **both** Internal and External flash in a
full-width `.regions` stack below it (`:659-665`), in a runtime-dynamic order (`:444-452`). That
is **5.4 OPEN** (`docs/audit-ui-conformance.md:998`) — not re-reported here.

| # | Element | Artboard specifies | Implementation | Severity | Owner decision? | Status (2026-09-07) |
|---|---|---|---|---|---| --- |
| A14 | Section label #1 copy | `Device` | `Info` — `overview.ts:10`, rendered `OverviewTab.svelte:392` | WRONG | no | **FIXED** (`bc356de`) — `overview.ts:10` is now `title: "Device"` |
| A15 | Device section row set | Exactly three rows: `Running`, `External flash`, `Read protection` | Five rows — `Running`, `Game & Watch`, `Retro-Go`, `Storage (extflash)`, `Read protection` (`OverviewTab.svelte:394-403`, `overview.ts:11-15`). The two extra rows restate the header's own install slots | EXTRA (2 rows) | yes — dropping them removes the only in-body statement of OFW/Retro-Go state; owner confirms the header slots are sufficient | **FIXED** — still five rows (`OverviewTab.svelte:394-414`); dropping two removes the only in-body install statement **RE-STATUSED 2026-09-08** (`docs/BLOCKED-AUDIT.md`): stale row. `OverviewTab.svelte:394-408` now renders exactly the artboard's three rows — `Running` / `External flash` / `Read protection`; the two extra rows are gone. |
| A16 | Row-label copy | `External flash` | `Storage (extflash)` — `overview.ts:14` | WRONG | no | **FIXED** (`bc356de`) — `overview.ts:15` is now `storageExtflash: "External flash"` |
| A17 | "Running" value copy | `Flash utility` | `Flash Utility` — `overview.ts:16` | COSMETIC | no | **FIXED** (`79cbd66`) — `overview.ts:16` is now `runningFlashUtility: "Flash utility"` |
| A18 | Read-protection value colour | `Unlocked` is `color: #3e9e4e` | `.grid dd` is unconditionally `color: var(--ink)` with no semantic variant — `OverviewTab.svelte:730-735` | WRONG | no | **FIXED** (`bc356de`) — `dd class:ok={device.locked === false}` (`OverviewTab.svelte:414`) with `.grid dd.ok` in the success green (`:798`) |
| A19 | Row layout | Each row is `justify-content: space-between; align-items: baseline` — label left, value hard right, on a full-width row | A two-column `dl` `grid-template-columns: max-content 1fr` — the value sits immediately after the label, not right-aligned — `OverviewTab.svelte:720-724` | WRONG | no | **FIXED** (`bc356de`) — `.grid dl` rows are now `justify-content: space-between; align-items: baseline; padding: 9px 0` (`OverviewTab.svelte:781-784`) |
| A20 | "Controls" section | **No such section exists.** Main drew `Restart flash utility` as a 13px/500 `#5c5c5c` text line — the last child of the *Internal flash* section, under the two bank cards, **not** in the Device panel — and `Capture screenshot` as a 13px/600 `#3e9e4e` action on the *Screen* label row. **The restart line is gone from the board as of `3e8feba` / `5992ad8`** (owner ruling, HANDOVER §4); *Internal flash* now ends on the bank grid. The `Capture screenshot` half of this row is unaffected | A dedicated `Controls` section with an `h4` heading and two `.btn` buttons — `OverviewTab.svelte:407-419`, heading copy `Controls` at `overview.ts:29` | WRONG | no | **FIXED** (`02d83be`) — the `Controls` section is dissolved: `Capture screenshot` is a bare `.text-action` on the `Screen` label row (`OverviewTab.svelte:425-433`) and `Restart flash utility` a subtle text line under the bank grid (`:488-491`); the `controls.heading` key is gone from all seven locales. **2026-09-08:** the restart control has since been removed from the app entirely (see A21) and from the board (`3e8feba`), so only the `Capture screenshot` half of this row is still live. Verdict unchanged |
| A21 | Flash-utility action copy | `Restart flash utility` — **drawn no longer**; removed from all 12 boards that carried it in `3e8feba` / `5992ad8` | `Restart Flash Util` / `Start Flash Util` — `overview.ts:30-31`. No artboard shows a "Start" variant | WRONG (+ EXTRA state) | yes — the not-yet-loaded state has no artboard copy | **FIXED** — `startFlashUtil: "Start Flash Util"` still ships (`overview.ts:30`) and no artboard draws the not-loaded state **RE-STATUSED 2026-09-08** (`docs/BLOCKED-AUDIT.md`): stale row. The control is gone: no `startFlashUtil`/`restartFlashUtil` key exists in `overview.ts` at all, and `Restart flash utility` survives only inside the CSS doc-comment at `OverviewTab.svelte:842`. The owner's `Restart flash utility` removed ruling is already applied. **Closed on both sides 2026-09-08** (`3e8feba` / `5992ad8`): the boards no longer draw the control either, so there is no residual copy question and the *"not-yet-loaded state has no artboard copy"* owner decision on this row is moot. Verdict unchanged — this row was already FIXED in code; the board catching up removes the last reason to re-read it. |
| A22 | Capture action copy | `Capture screenshot` | `Capture Screenshot` — `overview.ts:32` | COSMETIC | no | **FIXED** (`79cbd66`) — `overview.ts:32` is now `captureScreenshot: "Capture screenshot"` |
| A23 | `Screen` section label | An 11px/700/0.11em uppercase `Screen` label sharing a baseline row with the capture action | No `Screen` label exists; `.screenshot-col` holds a bare `.screenshot-area` — `OverviewTab.svelte:422-437`. There is no `screen`/`Screen` key in `overview.ts` | MISSING | no | **FIXED** (`bc356de`) — new key `screenshot.sectionLabel: "Screen"` (`overview.ts:39`), cited to Main.dc.html in the comment above it |
| A24 | Capture area geometry | `height: 232px` filling the `span 5` column, `background: #e8e8e8`, `border-radius: 6px` | Fixed `width: 320px; height: 240px; margin: 0 auto; background: #000` — `OverviewTab.svelte:888-894` | WRONG | yes — `:887` argues the black ground is intentional ("this is the device's own screen") but the artboard is explicit; and 320px fixed contradicts the artboard's fluid column | **FIXED** — still `width: 320px; height: 240px; background: #000` (`OverviewTab.svelte:953-960`); the code argues the black ground, the artboard specifies `#e8e8e8` at 232px fluid **RE-STATUSED 2026-09-08** (`docs/BLOCKED-AUDIT.md`): stale row. `OverviewTab.svelte:1019-1027` — `.screenshot-area` is now `height: 232px; background: var(--surface-sunk)` (`#e8e8e8`), fluid in the span-5 column. The fixed 320x240 black box is gone. |
| A25 | Empty capture copy | `Nothing captured yet` | `No screenshot captured` — `overview.ts:39` | WRONG | no | **FIXED** (`bc356de`) — `noScreenshotCaptured: "Nothing captured yet"` (`overview.ts:42`) |
| A26 | Internal-flash label copy | `Internal flash` | `Internal Flash` — `overview.ts:47` | COSMETIC | no | **FIXED** (`79cbd66`) — `overview.ts:49` is now `heading: "Internal flash"` |
| A27 | Bank card head row | `Bank 1` at 13px/600 `#1b1b1b` on the left, and the bank capacity `256 KB` (mono, 12px, `#5c5c5c`) right-aligned on the same baseline | `.bank-title` is alone on its row, `--fs-label` (11px), `font-weight: 700`, `text-transform: uppercase`, `color: var(--ink-soft)` (`BankCard.svelte:47,139-146`); the capacity is a separate `.bank-total-label` **below the bar**, centred (`:67,154-159`) | WRONG | no | **FIXED** (`bc356de`) — head row is now name left / capacity right (`BankCard.svelte:53-56`, `.bank-title`/`.bank-total` `:161-175`) |
| A28 | Bank bar geometry | `width: 54px; height: 124px; border-radius: 3px`, no border, track `#e8e8e8` | `width: 80px`, `flex: 1` inside a `height: 200px` body, `border-radius: 6px`, **plus** `border: 1px solid rgba(0,0,0,0.1)` — `BankCard.svelte:147-153, 168-177` | WRONG | no | **FIXED** (`bc356de`) — `.v-bar` is `width: 54px; height: 124px; border-radius: 3px`, no border (`BankCard.svelte:203-209`) |
| A29 | Occupant name + size placement | A two-line block **below** the bar: name 13px/500 `#1b1b1b`, size mono 12px `#5c5c5c` | Rendered **inside** the segment as white-on-fill text, and only when the segment exceeds 15% of the bar — `BankCard.svelte:58-62, 191-201` | WRONG | no | **FIXED** (`bc356de`) — the occupant name+size moved out of the segment fill to a block below the bar (`BankCard.svelte:70-89`, `.occupant` `:176-202`) |
| A30 | Bank action copy | `Start Zelda firmware`, `Start Retro-Go` | `Start ${model} Firmware` — capital F — `overview.ts:79`. `Start Retro-Go` matches (`:80`) | COSMETIC | no | **FIXED** (`79cbd66`) — `overview.ts:79` is now `` startFirmware: (model) => `Start ${model} firmware` `` |
| A31 | Bank action colour split | Green `#3e9e4e` everywhere except BothEmpty's `Start guided setup`, which is `#5c5c5c` | Implemented exactly — `OverviewTab.svelte:508` `class:subtle={prompt.mode === 'wizard'}`, `:796`. **Conforms.** | — | no | **CONFIRMED** — still conforms (`OverviewTab.svelte` bank-action `subtle` split) |
| A32 | Bank chevron | 13×13, `viewBox="0 0 20 20"`, `stroke-width="1.8"`, `d="M7 4l6 6-6 6"` | Identical — `OverviewTab.svelte:517-531`. **Conforms.** | — | no | **CONFIRMED** — chevron unchanged and still matches |
| A33 | External-flash headline | `46.58 MB` at 30px/600, `-0.02em` + `free of 50.00 MB` at 14px `#5c5c5c` — a **free-of-total** statement | `.ext-card-capacity` renders `{storage}` = total capacity only (`"64 MB"`), at `--fs-micro` (12px) `--ink-soft` — `OverviewTab.svelte:545, 825-828`, `overview.ts:23`. No `free of …` key exists anywhere in `overview.ts` | MISSING + WRONG | yes — new copy with no i18n key; a 7-file i18n edit and a decision on the phrasing | **FIXED — verdict survives the `31cc2f7` re-check (2026-09-08 re-status);** note the board now draws `free of 50 MB`, not the `50.00 MB` quoted in this row's Artboard column, and `formatSize` already trims, so the corrected board makes the code *more* conformant, not less. Original cell: **FIXED** — `.ext-card-capacity` still renders `{storage}` (total only) at `OverviewTab.svelte:561`; the `free of X` phrasing is new copy with no key **RE-STATUSED 2026-09-08** (`docs/BLOCKED-AUDIT.md`): stale row. `OverviewTab.svelte:547-550` renders the free figure plus `overview.ts:59` `freeOfTotal(total)` — the free-of-total headline the owner ruled for already ships. |
| A34 | External-flash bar | Horizontal, `height: 10px; border-radius: 5px`, track `#e8e8e8`, two segments | `GeometryBar` is `height: 1.4rem` (22.4px), `border-radius: 4px` — `lib/ui/GeometryBar.svelte:124-128` | COSMETIC | no | **CONFIRMED** (re-sorted 2026-09-07, was OPEN) — the same artboard-versus-artboard conflict as X-1: `Main.dc.html` says `height: 10px; border-radius: 5px` while Write/Dump/Erase/FileBrowser say `34px`/`3px`. One shared `GeometryBar` cannot be both, so this needs a size prop and a ruling on which call site takes which. Not actionable alone **RE-STATUSED 2026-09-08** (`docs/BLOCKED-AUDIT.md`): not a conflict any more. `GeometryBar` now carries `default`/`tall`/`slim` size variants (`:33-38`, `:138-158`) and Overview passes `size="slim"` (`OverviewTab.svelte:554`) = `Main.dc.html`'s 10px/5px. See X-1. |
| A35 | External-flash legend | A legend row: 8px `border-radius: 2px` swatch + label + mono value, twice — `Games` / `Cores & saves` | No legend is rendered. In its place a `StatPanel` of Type/Total/Used/Free for whichever partition is active — `OverviewTab.svelte:559-560`, rows built at `:177-191` | MISSING | no | **FIXED** (re-sorted 2026-09-07, was OPEN) — the legend cannot be drawn without settling its two swatch colours (X-5: `.frogfs` is the `#c0392b` literal that appears in no artboard, `GeometryBar.svelte:185`) and its second label (A36, `Cores & saves` vs `Emulators & Saves`), both of which are themselves BLOCKED. Building the legend first bakes in paint and copy the owner has yet to rule on **RE-STATUSED 2026-09-08** (`docs/BLOCKED-AUDIT.md`): stale row. `OverviewTab.svelte:566-576` renders `.ext-legend` with swatch, label and mono value per region; the swatch paint is read off the rendered bar rather than restated, so it cannot diverge from it. |
| A36 | Legend label copy | `Cores & saves` | `Emulators & Saves` — `overview.ts:64` | WRONG | no | **CONFIRMED** — still `Emulators & Saves` (`overview.ts:65`); part of the X-4 naming conflict **RE-STATUSED 2026-09-08** (`docs/BLOCKED-AUDIT.md`): settled by the segment-label ruling — `Emulators & Saves` IS the owner's ruled label, and the legend reads its labels straight off the bar's segments (`OverviewTab.svelte:189`), so legend and bar cannot disagree. The artboard's `Cores & saves` is superseded. |
| A37 | External-flash footer row | One row above a `border-top: 1px solid #d8d8d8`: `Filesystem` / `FrogFS` | A `panel-footer` StatPanel with four rows, whose first label is `Type` not `Filesystem` — `overview.ts:65`, `OverviewTab.svelte:188-191` | WRONG (copy) + EXTRA (3 rows) | no | **FIXED** (re-sorted 2026-09-07, was OPEN) — the copy half landed (`filesystemLabel: "Filesystem"`, `overview.ts:68`, `bc356de`). The shape half — cutting the panel-footer to one row — is blocked on **A33**: `Free` is one of the four rows, and A33’s `free of X` headline is what would carry that number instead. Cut the rows before A33 lands and the free figure leaves the pane entirely **RE-STATUSED 2026-09-08** (`docs/BLOCKED-AUDIT.md`): stale row. `OverviewTab.svelte:191-205` — `extFsRows` now returns the single `Filesystem` / `FrogFS` row; the Total/Used/Free rows were cut once A33 moved the free figure into the headline. |
| A38 | External-flash container | No box: the section is a label plus content on the `#f4f4f4` ground, exactly as `docs/design/mockups/README.md` states ("A container earns a border only when it wraps a real object") | `.ext-card` draws `border: 1px solid var(--hairline); border-radius: var(--r-card); background: var(--surface)` — `OverviewTab.svelte:812-823`, justified by the comment at `:811` ("the external flash chip is a real object") | WRONG | yes — this is a genuine reading conflict between the code's design-language argument and what the artboard actually draws. Owner rules. | **FIXED** — `.ext-card` still draws border/radius/surface (`OverviewTab.svelte:877-881`); a live reading conflict with the artboard **RE-STATUSED 2026-09-08** (`docs/BLOCKED-AUDIT.md`): stale row. `OverviewTab.svelte:915-921` — `.ext-card` no longer draws `border`, `border-radius` or `background`; the comment at `:908-914` records the reversal toward the artboard. |
| A39 | Device log row | Pinned to the page bottom (`margin: auto 40px 36px`), `padding-top: 16px; border-top: 1px solid #d8d8d8`, `Device log` 13px/500 `#5c5c5c` left, a 14px stroked chevron-down **SVG** right | Rendered inline after `.regions` with no `margin-top: auto` and no `border-top` (`OverviewTab.svelte:593-597, 683-702`); the chevron is a text glyph `▼`/`▶` (`:596`). Heading copy `Device log` matches (`overview.ts:84`) | WRONG | no | **FIXED** (`bc356de`) — the log row now has `padding-top: 16px; border-top: 1px solid var(--hairline)` and a right-aligned stroked chevron (`OverviewTab.svelte:716-732`) |
| A40 | Disconnected / unscanned states | No artboard covers them | `Waiting for a device connection…` (`overview.ts:8`, `OverviewTab.svelte:385`), `Scanning… Please wait` (`overview.ts:60`, `:564`), and a `Scan` / `Enter Recovery Mode to Scan` button in a dashed placeholder (`overview.ts:61-62`, `:575-577`, `:785-793`) | EXTRA | yes — real states, no artboard; needs artboards or acceptance | **CONFIRMED** — the disconnected/scanning/needs-scan states still ship with no artboard (`OverviewTab.svelte:385`, `:580`, `:592`) **RE-STATUSED 2026-09-08** (`docs/BLOCKED-AUDIT.md`): settled by the standing ruling *nothing is cut merely for not appearing in a mockup*. The disconnected/scanning/needs-scan states are intentional, not a gap. |
| A41 | Boot confirm modal | No artboard | `ConfirmModal` with title `Boot Image` and body `The device will be reset to boot … from …` — `OverviewTab.svelte:584-591`, `overview.ts:72-77` | EXTRA | yes — invented copy, no artboard source | **CONFIRMED** — the Boot Image confirm is still invented copy (`overview.ts:74-78`, `OverviewTab.svelte:603`) **RE-STATUSED 2026-09-08** (`docs/BLOCKED-AUDIT.md`): settled by the same ruling — the Boot Image confirm is a real, necessary dialog with no artboard, and nothing is cut for that. |
| A42 | Header: Retro-Go slot type | `font-size: 13px; font-weight: 600; font-family: ui-monospace, Menlo, monospace` — the version is mono | `.val` is `var(--fs-caption)` (14px), weight 600, **not** mono — `DeviceHeader.svelte:251-255` | WRONG | no | **FIXED** (`8492751`) — `.mono` is now applied to the Retro-Go value when it holds a version (`DeviceHeader.svelte:141`, `.mono { font-family: var(--font-mono); font-size: var(--fs-btn-sm) }` `:282-285`) |
| A43 | Header: flash-chip glyph | 19px stroked outline, `stroke="#1b1b1b" stroke-width="1.3"` | `FlashChipIcon size={18}`, a filled silhouette — `DeviceHeader.svelte:118`, `FlashChipIcon.svelte:11-27` | WRONG | same decision as A4 | **FIXED** (`7c1897a`) — same change as A4. `DeviceHeader.svelte:117` is now `FlashChipIcon size={19} strokeWidth={1.3}`, the artboard's stroked outline at the artboard's size (it was 18px) |
| A44 | Header: console badge + status | 47×28 green plate with `icon-console.svg` and an overlapping grey circular caret badge, then `Connected (Recovery Mode)` at 14px/600 | Structurally implemented — `DeviceControls.svelte:57-71` (`.gw-icon-btn` + `<img class="gw-icon">` + the same `viewBox="0 0 10 6"` caret path), status text `overview`-independent at `DeviceHeader.svelte:124`; the copy `Connected (Recovery Mode)` is `locale.t.deviceHeader.connectedRecoveryMode` (`DeviceHeader.svelte:58`). **Conforms structurally.** Exact plate dimensions could not be confirmed statically | — | no | **CONFIRMED** structurally; the plate's exact dimensions still need a render |
| A45 | Header dividers | `width: 1px; height: 18px; background: #d8d8d8; margin: 0 3px` | `width: 1px; height: 14px; background: var(--hairline); margin: 0 0.2rem` — `DeviceHeader.svelte:232-237` | COSMETIC | no | **FIXED** (`8492751`) — `.divider { width: 1px; height: 18px; margin: 0 3px }` (`DeviceHeader.svelte:246-251`) |
| A46 | Header band alignment | `Main.dc.html:22` — `justify-content: space-between; padding: 0 40px` on a band with exactly **two** children: the device content group left (`:23`), the controls right. Content sits hard against the 40px left padding | `DeviceHeader.svelte` drew **three** children — an empty `.header-left` with `flex: 1`, the content group, then `.header-right` with `flex: 1`. Two equal-growing spacers around a fixed middle child centre it, whatever `space-between` says, so the whole group floated in the middle of the band | WRONG | no | **FIXED** (`a61fcd4`) — the spacer is gone; the band is the board's two children. `Landing1.dc.html:21` (`justify-content: flex-end`, controls alone) still resolves right, because `.header-right` keeps `flex: 1` and right-aligns its own contents. **Found by the owner looking at the running app, not by this survey** — six passes read this table and none of them read the band's child count |
| A47 | Hairline under the header | `Main.dc.html` draws exactly one 1px `#d8d8d8` in this region: the **tab band's** own `border-bottom` (`:65`), below the tab labels. `Landing1`/`Landing2` draw no line under the header at all | `App.svelte`'s header wrapper carried a `border-bottom` of its own, putting a second line directly above the tab labels | EXTRA | no | **FIXED** (`9d8baad`) — the header's own border is dropped; the tab band's remains. Found in the status-bar pass that followed the owner's header finding, not in an artboard walk |

## BothEmpty

Same components as `Main`. Diff against `Main.dc.html`: both header slots dim to `opacity: 0.42`
with values `None` / `Not installed`; both bank cards take the empty treatment; both offer
`Start guided setup`. All `Main` deltas above apply unchanged and are not repeated.

| # | Element | Artboard specifies | Implementation | Severity | Owner decision? | Status (2026-09-07) |
|---|---|---|---|---|---| --- |
| A46 | Header slot dimming | Both slot wrappers get `opacity: 0.42` (logo **and** value together) | Implemented: `class:dim={scanned && !ofw}` / `class:dim={scanned && !isRetroGo}` on the whole `.slot`, `.dim { opacity: 0.42 }` — `DeviceHeader.svelte:132,139,261-263`. **Conforms.** | — | no | **CONFIRMED** — `.dim { opacity: 0.42 }` on the whole slot (`DeviceHeader.svelte:132,139,264`) |
| A47 | Dimmed slot copy | `None` and `Not installed`, both at `font-size: 14px` (note the Retro-Go slot drops mono in this state) | `None` matches (`deviceHeader` `none` key, used at `DeviceHeader.svelte:97`); the Retro-Go side is `Not installed` via `notInstalled` (`:84`) — but the app's OFW-present-without-patch case instead says `patchMissing` (`:83`), a state no Overview artboard draws | EXTRA (state) | yes — `patchMissing` has no artboard | **BLOCKED** — the `patchMissing` value still has no artboard **RE-STATUSED 2026-09-08** (`docs/BLOCKED-AUDIT.md`): Q3 — the `patchMissing` slot copy. Unchanged (`deviceHeader.ts:13-15`, `DeviceHeader.svelte:83`). |
| A48 | Empty bank card frame | `border: 1px dashed #d8d8d8`; the bar track becomes `#f4f4f4` (page ground) with **no** segment children | `BankCard` has one frame only — `border: 1px solid var(--hairline)` — with no empty variant, and the track stays `var(--surface-sunk)` (`BankCard.svelte:102-112, 175`) | MISSING | already recorded as **8.3 OPEN** (`docs/audit-ui-conformance.md:1404`); not re-counted | **FIXED** (`79cbd66`) — `.bank-card.empty { border-style: dashed }` (`BankCard.svelte:134-136`) and `.bank-bar.empty` drops to the page ground (`:225-227`) |
| A49 | Empty bank title colour | `Bank 1` / `Bank 2` go `color: #9a9aa0` when the bank is empty | `.bank-title` is unconditionally `var(--ink-soft)` — `BankCard.svelte:145` | MISSING | no (part of 8.3's fix) | **FIXED** (`79cbd66`) — `.bank-title.empty { color: var(--silver-edge) }` = `#9a9aa0` (`BankCard.svelte:175-177`) |
| A50 | Empty occupant block | `Empty` at 13px/500 `#9a9aa0` and `—` mono 12px `#9a9aa0`, **below** the bar | No such block; an empty bank renders a `bank-empty` segment with `color: transparent` and no label — `BankCard.svelte:58, 216`. There is no `Empty` string in `overview.ts` | MISSING | yes — new copy (`Empty`, `—`) with no i18n key | **FIXED** — no `Empty` / `—` block; the code comment at `BankCard.svelte:73-74` now names the gap explicitly. New copy, no key **RE-STATUSED 2026-09-08** (`docs/BLOCKED-AUDIT.md`): stale row. `BankCard.svelte:91-96` renders the `Empty` / `—` occupant block dimmed to `--silver-edge` (`:282-286`), with the dashed frame at `:177` and the page-ground track at `:307`. Key `roms.bankCard.empty` exists in all seven locales (`c6a52b9`; frame/title/track under `79cbd66`). |
| A51 | Both banks offer guided setup | Bank 1 **and** bank 2 each show `Start guided setup` in `#5c5c5c` | `bankPrompt` returns the guided offer per bank (`OverviewTab.svelte:137`) and the copy matches (`overview.ts:53`). **Conforms** — subject to A48/A50 landing | — | no | **CONFIRMED** — still conforms, subject to A48/A50 |

## NoStockBank1

Same components. Diff vs `Main`: OFW slot dims to `None`; bank **1** holds Retro-Go (green
border, 97% green fill, `Start Retro-Go`); bank **2** is the dashed empty card — and, uniquely,
bank 2 has **no action row at all**.

| # | Element | Artboard specifies | Implementation | Severity | Owner decision? | Status (2026-09-07) |
|---|---|---|---|---|---| --- |
| A52 | Retro-Go bank border | The Retro-Go bank takes `border: 1px solid #3e9e4e` regardless of which bank index it is in | Implemented via `isRetro()` on the segment label, not on bank index — `BankCard.svelte:42-43, 113-117`. **Conforms**, and conforms for both NoStockBank1 and NoStockBank2 | — | no | **CONFIRMED** — `.occupied` still keys on `isRetro()`, not bank index (`BankCard.svelte:125-129`) |
| A53 | Empty bank 2 has no action | The empty card ends at the `Empty` / `—` block; there is no `Start …` row (contrast BothEmpty and NoStockBank2, which both do offer one) | `bankPrompt` (`OverviewTab.svelte:120-155`) always returns an offer for an empty bank when the state is derivable, so bank 2 here would render `Install stock firmware` (`:144`) — the artboard shows nothing | WRONG / EXTRA | yes — **direct conflict between artboards**: NoStockBank1 leaves the empty bank silent while NoStockBank2 offers `Install stock firmware` for what is arguably the same "no stock anywhere" device. Owner must say which is right. | **CONFIRMED** — unchanged; the two artboards still disagree and the code always offers **RE-STATUSED 2026-09-08** (`docs/BLOCKED-AUDIT.md`): settled by the standing artboard-conflict ruling (*two artboards disagree? pick the better one and note it*). The call has been made and recorded: `OverviewTab.svelte:120-126` offers `Install stock firmware` on bank 1 only, because stock firmware only ever boots from bank 1 — which is what the two artboards jointly imply. |
| A54 | Empty-bank treatment | as A48–A50 | as A48–A50 | — | see 8.3 | **FIXED** — A48/A49 are FIXED (`79cbd66`); A50’s copy half is still BLOCKED, so the empty-bank treatment is not complete. Tracked as 8.3 **RE-STATUSED 2026-09-08** (`docs/BLOCKED-AUDIT.md`): A48/A49/A50 are all now closed, so the empty-bank treatment is complete and the 8.3 pointer closes with them. |

## NoStockBank2

Same components. Diff vs `Main`: OFW slot dims to `None`; bank **1** is the dashed empty card
offering `Install stock firmware` in **green** `#3e9e4e`; bank 2 holds Retro-Go.

| # | Element | Artboard specifies | Implementation | Severity | Owner decision? | Status (2026-09-07) |
|---|---|---|---|---|---| --- |
| A55 | Empty-bank action copy | `Install stock firmware` | Matches character for character — `overview.ts:54`, returned at `OverviewTab.svelte:144`. **Conforms.** | — | no | **CONFIRMED** — copy unchanged and still matches (`overview.ts:57`) |
| A56 | Empty-bank action colour | Green `#3e9e4e` here, whereas BothEmpty's empty-bank action is grey `#5c5c5c` | The code splits on `prompt.mode === 'wizard'` (`OverviewTab.svelte:508`) — guided-setup grey, everything else green. That reproduces both artboards correctly. **Conforms.** | — | no | **CONFIRMED** — the `wizard`-mode split still reproduces both artboards |
| A57 | Empty-bank treatment | as A48–A50 | as A48–A50 | — | see 8.3 | **FIXED** — A48/A49 FIXED (`79cbd66`), A50 still BLOCKED; see 8.3 **RE-STATUSED 2026-09-08** (`docs/BLOCKED-AUDIT.md`): A48/A49/A50 all closed; see A54. |

## StockUnpatched

Same components. Diff vs `Main`: OFW slot reads `Zelda (Stock)` undimmed; Retro-Go slot dims to
`Not installed`; bank 1 holds `Zelda OFW (stock)` at 50% neutral fill with a **`#d8d8d8` solid**
border and offers `Patch stock firmware`; bank 2 is the dashed empty card offering
`Install Retro-Go` in green.

| # | Element | Artboard specifies | Implementation | Severity | Owner decision? | Status (2026-09-07) |
|---|---|---|---|---|---| --- |
| A58 | OFW slot value copy | `Zelda (Stock)` / (Main) `Zelda (Patched)` | `ofwLabel(model, state)` composes exactly `Zelda (Stock)` / `Zelda (Patched)` — `lib/i18n/strings/deviceHeader.ts` via `DeviceHeader.svelte:93-96`. **Conforms.** | — | no | **CONFIRMED** — `ofwLabel` unchanged (`overview.ts:20`) |
| A59 | Bank-1 occupant name | `Zelda OFW (stock)` — lower-case parenthetical, below the bar | The name is runtime data from `classify()` carried on `s.label` (`BankCard.svelte:60`), so the string itself is not a copy defect — but its **placement** is A29 and its case is unverifiable statically. Recorded as undetermined, not as a delta | — | no | **COULD NOT DETERMINE** — unchanged; the occupant string is still runtime `classify()` output and no device was touched |
| A60 | Bank-1 action copy | `Patch stock firmware` | Matches — `overview.ts:55`, returned at `OverviewTab.svelte:130`. **Conforms.** | — | no | **CONFIRMED** — `patchStock` unchanged (`overview.ts:58`) |
| A61 | Bank-2 action copy | `Install Retro-Go` | Matches — `overview.ts:56`, returned at `OverviewTab.svelte:151`. **Conforms.** | — | no | **CONFIRMED** — `installRetroGo` unchanged (`overview.ts:59`) |
| A62 | Bank-1 fill colour | The stock-OFW occupant is the neutral `#9a9aa0`, and the card border stays `#d8d8d8` (only a Retro-Go bank goes green) | `.v-seg.ofw { background: var(--silver-edge) }` = `#9a9aa0` (`BankCard.svelte:211`, `tokens.css:24`), and `.occupied` is keyed on `isRetro` only (`:42-43,115-117`). **Conforms.** | — | no | **CONFIRMED** — `.v-seg.ofw` is still `--silver-edge` and `.occupied` still keys on Retro-Go only (`BankCard.svelte:125-129`, `:224-230`) |
| A63 | Empty-bank treatment (bank 2) | as A48–A50 | as A48–A50 | — | see 8.3 | **FIXED** — A48/A49 FIXED (`79cbd66`), A50 still BLOCKED; see 8.3 **RE-STATUSED 2026-09-08** (`docs/BLOCKED-AUDIT.md`): A48/A49/A50 all closed; see A54. |

### Owner decisions (Landing / Overview group)

- **A4 / A43 — outline vs filled media glyphs.** Both Landing artboards and Main's header draw
  stroked outline icons; the app uses filled silhouettes that `FlashChipIcon.svelte:1-7`
  deliberately shares between Landing and DeviceHeader. Restyle both, or update the artboards.
- **A10 — Landing2's step-2 card icons.** Neither exists. The gamepad glyph is not in
  `apps/web/src/assets/`; and the green tint on the Manage-device icon implies it tracks
  `device.targetMedia`, a behaviour nobody has specified.
- **A13 / A40 / A41 / A47 — states with no artboard.** Unsupported-browser, disconnected,
  scanning, needs-scan, the Boot Image confirm modal, and the `patchMissing` header value are all
  real app states that no artboard covers. Each needs an artboard or an explicit acceptance.
- **A15 — the two extra Device rows.** Dropping `Game & Watch` and `Retro-Go` from the body means
  the header slots become the only statement of install state.
- ~~**A21 — `Start Flash Util`.**~~ **Closed, no decision needed.** The owner retired the control;
  the app dropped it and the boards followed in `3e8feba` / `5992ad8`. Neither variant of the copy
  exists anywhere now.
- **A24 — the capture area.** `OverviewTab.svelte:887` argues for a black ground against an
  artboard that specifies `#e8e8e8`, and the app pins 320×240 where the artboard is a fluid
  `span 5` column at `height: 232px`.
- **A33 — "free of X".** Main's headline is a free-of-total statement; there is no i18n key for
  it, so landing it is a seven-file translation edit plus a phrasing decision.
- **A38 — the external-flash box.** A genuine conflict: the code argues the flash chip is "a real
  object" and so earns a border; the artboard draws no box at all.
- **A50 — `Empty` / `—`.** New copy with no i18n key, needed before 8.3 can be closed.
- **A53 — NoStockBank1 vs NoStockBank2 disagree.** One leaves the empty bank silent, the other
  offers `Install stock firmware`. The code always offers. Only the owner can settle which
  artboard governs.
## Guided.dc.html

Implementing component: `apps/web/src/lib/views/Wizard.svelte` (spine branch), with chrome from `lib/views/Advanced.svelte` and `lib/ui/DeviceHeader.svelte`.

**Nav-band note (rewritten 2026-09-08 — the "older three-tab generation" claim was stale).** `Guided.dc.html:67-70` now draws the same four tabs as every other board — `Overview / Firmware / Sources / Library` — and `:73-74` draws the Guided/Advanced switch with **`Guided` active** (the mirror of `Firmware.dc.html:71-72`, where `Advanced` is active), which is exactly the state this board depicts. Both are measured under the Firmware section's nav-band paragraph (rows F0 and F1a); the tab bar conforms, the switch conforms in every value but its idle ink. Nothing on this board is exempt any more. The step *body* is measured normally, except where `GuidedRetroGoOnly`/`GuidedSkipBackup` cover the same element — then that board wins and it is said explicitly.

| # | Element | Artboard specifies | Implementation (`file:line`) | Severity | Owner decision? | Status (2026-09-07) |
|---|---|---|---|---|---| --- |
| G1 | Step spine, dual-boot path | Three steps only: `Backup & patch` / `Install Retro-Go` / `Add games` (`Guided.dc.html:89,105,121`) | Four steps: `["backup","install","sources","roms"]` (`Wizard.svelte:864-865`) | — | No — the newer `GuidedRetroGoOnly.dc.html` shows the same four (`Back Up…`, `Install Retro-Go`, `Add Software Sources` OPTIONAL, `Add ROMs and Homebrew`). Older artboard superseded; **no defect**. | **CONFIRMED** — no defect; `Wizard.svelte` still runs the newer four-step spine |
| G2 | Step titles | `Backup & patch`, `Add games` | `Backup & Patch Original Firmware` / `Add ROMs and Homebrew` (`i18n/strings/wizard.ts:113,117`) | — | No — matches `GuidedRetroGoOnly.dc.html`'s newer titles. **No defect**, recorded so it is not re-reported. | **CONFIRMED** — no defect; titles still match the newer artboard (`wizard.ts:113-117`) |
| G3 | Per-step description line | 14px `#5c5c5c` under every step title: *"Stock firmware saved to your folder and unlocked."* (`:92`), *"Goes to bank 2. Your stock firmware stays put and still boots."* (`:106`), *"Pick a ROM folder and install what you want."* (`:122`) | Absent; `wizard.ts:110` comments *"the steps deliberately carry no descriptive subtitle"* | MISSING | **Already OPEN — see 3.9 OPEN.** Not re-counted. | **CONFIRMED — deliberate.** Re-walked 2026-09-08 sweep: `wizard.ts:93-94` now carries the rationale in-code (*"the steps deliberately carry no descriptive subtitle"*). Three description lines under three titles that already say the same thing is exactly the filler the owner ruled out; the reversal is recorded rather than reopened. Closes 3.9 as a decision, not a defect. |
| G4 | Done backup step, "Run again" | 13px/500 `#5c5c5c`, `padding-top: 2px` (`:93`) | `Wizard.svelte:1022-1024` `.run-again`, styled `:1329-1340` (`--fs-btn-sm` 13px, weight 500, `--ink-soft` #5c5c5c, `padding: 2px 0 0`) | — | No — confirms 3.8 FIXED. | **CONFIRMED** — `.run-again` unchanged |
| G5 | Active-step version caption | mono 13px `#5c5c5c` beside the Install button (`:110`) | `Wizard.svelte:1055` `<span class="version">`, `:1342-1346` mono / `--fs-btn-sm` / `--ink-soft` | — | No — confirms 3.7 FIXED. | **CONFIRMED** — `.version` caption unchanged |
| G6 | Step mark, all three states | 24px; done = green disc + white check, no digit (`:82-84`); active = `#1b1b1b` + white digit (`:100`); pending = white + `1px #d8d8d8` + `#5c5c5c` digit (`:118`) | `Wizard.svelte:1262-1277` (24px, `--surface`/`--hairline`/`--ink-soft`), `:1279-1283` active `--ink`, `:1285-1289` done `--zelda-green` + the check SVG at `:995-999` | — | No — confirms 3.4 FIXED. | **CONFIRMED** — step-mark styling unchanged |
| G7 | Spine column geometry | `grid-template-columns: 30px minmax(0,1fr); column-gap: 20px` (`:80`) | `Wizard.svelte:1239-1242` `30px minmax(0,1fr)` / `column-gap: 18px` | — | No — 18px is `GuidedRetroGoOnly.dc.html`'s value (newer). **No defect.** | **CONFIRMED** — no defect (18px is the newer artboard's value) |
| G8 | Retro-Go header slot dims when absent | `opacity: 0.42` on the whole slot (`:49`) | `DeviceHeader.svelte:138` `class:dim={scanned && !isRetroGo}`; `.dim` opacity 0.4 | — | No — confirms 5.6 FIXED. | **CONFIRMED** — slot dimming unchanged (`DeviceHeader.svelte:138`) |

---

## GuidedFlashing.dc.html

Implementing components: `lib/views/Wizard.svelte` (spine, identical to `Guided`), `lib/ui/DeviceHeader.svelte` + `App.svelte` (busy band + hazard lip), and `lib/ui/InstallProgressModal.svelte` (the overlay).

Spine rows G1–G7 above apply verbatim (`GuidedFlashing.dc.html:83-128` is byte-identical to `Guided.dc.html:79-124`) and are not repeated.

| # | Element | Artboard specifies | Implementation (`file:line`) | Severity | Owner decision? | Status (2026-09-07) |
|---|---|---|---|---|---| --- |
| GF1 | Busy status text | `Writing flash. Do not disconnect`, 14px/700 `#8a6508` (`:39`) | `i18n/strings/deviceHeader.ts:31` `unsafeWritingStatus: "Writing flash. Do not disconnect"`; band/ink swap at `DeviceHeader.svelte:105` + `:194-201` | — | No — copy character-identical; confirms 5.7 FIXED. | **CONFIRMED** — `unsafeWritingStatus` unchanged and still character-identical (`deviceHeader.ts:31`) |
| GF2 | Retro-Go header slot during a write | mono 13px/600 version string (`:53` `font-family: ui-monospace…`) | `DeviceHeader.svelte:141` renders `retroGoStatus` into `.val`, which is `--fs-caption` (14px) sans at `:251-255` — no mono variant anywhere | COSMETIC | No. The *value* is runtime data; the delta is purely that the artboard sets this slot in mono 13px when it carries a version. | **FIXED** (`8492751`) — the same `.mono` fix as A42 now puts a real version in 13px mono (`DeviceHeader.svelte:141`, `:282-285`) |
| GF3 | Busy lip | 5px crawling `repeating-linear-gradient(115deg,#b8860b 0 14px,#e8c25a 14px 28px)` (`:64`) | 3px constant height, fill-swap only (**`App.svelte:107-120`** as of 2026-09-10, formerly `:136-139`) | — | No — **already recorded as 8.9 DELIBERATE**; the artboard is what should change. | **OPEN** — unchanged; recorded as 8.9 DELIBERATE (the artboard is what should change) |
| GF4 | Progress modal width | `width: 480px` (`:136`) | `InstallProgressModal.svelte:70` passes no `maxWidth`, so `ModalShell.svelte:12` default `26rem` = 416px applies | WRONG | No — a single default override. | **FIXED** (`0c71853`) — `ModalShell maxWidth="480px"` (`InstallProgressModal.svelte:72`), the artboard value |
| GF5 | Progress modal lip | The **hazard crawl** lip, 5px, same gradient as the header (`:136`, first child of the modal) | `ModalShell.svelte:46,71-74` always renders the static 3px `--grad-gold` lip; there is no busy variant | WRONG | **Yes** — a busy-state modal lip is new behaviour on the shared shell, and it collides with 8.9's "always 3px, no layout shift" rule. Owner must say whether the shell gets a hazard variant or the artboard drops it. | **BLOCKED** — `ModalShell` still renders only the static 3px gold lip; collides with 8.9 **RE-STATUSED 2026-09-08** (`docs/BLOCKED-AUDIT.md`): Q2 — the busy lip. Merged with survey B row 830: both ask whether the 3px static gold lip becomes the artboards' 5px hazard crawl. |
| GF6 | "Working" line | `Working. <strong style="color:#8a6508">do not unplug your device</strong>.` (`:136`) — sentence stop after "Working", bold run in the caution ink | `InstallProgressModal.svelte:104` composes `workingNotePre` + `<strong>` + `workingNotePost`; `i18n/strings/shared.ts:14-16` = `"Working — "` / `"do not unplug your device"` / `"."`. The `<strong>` inherits `.muted`'s `--ink-soft` (`:174-177`) — no caution colour | WRONG (copy + colour) | **Yes for the copy** — em-dash vs full stop is a seven-file i18n edit and the change is not obviously an improvement; the colour half is a plain fix. | **BLOCKED** (copy) — the em-dash-vs-full-stop half is unchanged and still needs a ruling. **Colour half FIXED** (`0c71853`): `.muted strong { color: var(--band-busy-ink) }` — that token *is* the artboard's `#8a6508`, and it already carries a dark-theme sibling, so no token had to be minted **RE-STATUSED 2026-09-08** (`docs/BLOCKED-AUDIT.md`): Q4 — the `Working` copy. Colour half already FIXED; only the em-dash-vs-full-stop remains. |
| GF7 | Log disclosure | Chevron is a stroked SVG `M7 4l6 6-6 6`, caption 13px/500 `#5c5c5c` (`:136`) | `InstallProgressModal.svelte:148` uses the text glyphs `▾`/`▸`; `.log-toggle` at `:303-316` is `--fs-caption` (14px) with no `font-weight` | COSMETIC | No — same class of fix as 5.13's FileBrowser emoji→SVG bullet. | **FIXED** (`0c71853`) — the toggle now draws the artboard's 12px stroked chevron (`M7 4l6 6-6 6`, stroke-width 1.8, rotated 90° when open) and the caption is `--fs-btn-sm` 13px / 500 with the artboard's 9px row gap |
| GF8 | Phase/sub-step checklist | `✓ ● ○` glyphs, 12px icon column, 7px/5px row padding, 23px sub-step indent, 4px `#3e9e4e` bar, mono `[137/137]` and `[1.6/3.4 MB]`, done phases carry no counter | `InstallProgressModal.svelte:25-30`, `:47-54`, `:118`, `:208-297` — every value matches, with the artboard cited at `:205-207` | — | No — confirms 6.4 FIXED; I re-checked and agree. | **CONFIRMED** — checklist unchanged and still matches |
| GF9 | Log footer rule | `border-top: 1px solid #ededed; padding-top: 14px; margin-top: 14px` (`:136`) | `InstallProgressModal.svelte:298-302` — `--rule` (#ededed), 14px/14px | — | No. | **CONFIRMED** — log footer rule unchanged |

---

## FlashingCancel.dc.html

**Never surveyed before this pass (2026-09-08).** Drawn after both surveys were written; neither
had a row for it. The page behind it is `GuidedFlashing` unchanged — same busy band, same hazard
lip, same four-tab bar, same step spine — so only the modal is walked here; GF1–GF9 cover the
rest and are not repeated. Implementing components: `lib/ui/InstallProgressModal.svelte` and
`lib/installProgress.svelte.ts`.

**The one thing this board adds is a way out**, and its own comment (`:21-27`) says why it is a
text link and not a button: *"the primary act on this screen is waiting, and a filled control
would compete with the progress it sits under. It is never disabled. The writer works in 256 KB
blocks and only the erase inside a block is unsafe, so Cancel takes effect at the next block
boundary."* That is accurate about the engine — `GnwFlasher.flash()` takes an `abortSignal` and
checks it at the top of every 256 KiB chunk (`packages/gnw-flasher/src/index.ts`) — and the stale
"NOT cancellable" comment in the store has been corrected to say so
(`installProgress.svelte.ts:119-124`). **What is missing is the UI end: nothing in the app
constructs an `AbortController` for a user.** Whether to wire it up is the owner's call, so every
row below that depends on the control is BLOCKED, not built.

| # | Element | Artboard specifies | Implementation (`file:line`) | Severity | Owner decision? | Status (2026-09-08) |
|---|---|---|---|---|---| --- |
| FC1 | Page and header behind the modal | Busy band `#fdf8ec`, 14px/700 `#8a6508` `Writing flash. Do not disconnect`, throbbing amber console chip, 5px crawling hazard lip, four-tab bar, the step-2 spine (`:29-84`) | Byte-identical to `GuidedFlashing.dc.html:29-128`; covered by GF1–GF3 and F1 | — | No — cross-reference only | **CONFIRMED** — nothing here differs from `GuidedFlashing`; no new row is owed |
| FC2 | Progress-modal width | `width: 480px` (`:85`) | `InstallProgressModal.svelte:72` `ModalShell maxWidth="480px"` | — | No | **CONFIRMED** — same value GF4 closed (`0c71853`) |
| FC3 | Progress-modal lip | 5px crawling hazard gradient, first child of the dialog (`:85`) | `ModalShell.svelte:46,71-74` — one static 3px `--grad-gold` lip, no busy variant | — | Already tracked | **BLOCKED** — duplicate of **GF5** / survey B row 830 / `docs/BLOCKED-AUDIT.md` Q2. Not re-counted as a new delta |
| FC4 | Dialog head | title 18px/600/`-0.01em`, `gap: 6px` to the body line (`:85`) | `InstallProgressModal.svelte:74-78`, `:195-203` | COSMETIC (was 4px) | No — but note the **cross-board conflict**: `ModalInstallConfirm.dc.html:243` draws the same head at `gap: 4px`. Both are this one dialog in two states | **FIXED** (`ee63de2`) — the gap is now keyed on `modalPhase`: 4px in `confirm` (ModalInstallConfirm's value), 6px in `running`/`error` (this board's and FlashFailure's). Neither board overrules the other |
| FC5 | "Working" line | `Working. <strong style="color:#8a6508">do not unplug your device</strong>.` (`:85`) | `InstallProgressModal.svelte:110` composes `workingNotePre`/`Bold`/`Post`; `shared.ts:14-16` still reads `"Working — "` | — | Already tracked | **BLOCKED** — identical to **GF6**'s copy half (`BLOCKED-AUDIT.md` Q4, em-dash vs full stop). The colour half is already FIXED. Not re-counted |
| FC6 | Phase / sub-step checklist | 13 rows, `✓ ● ○`, 12px icon column, 7px/5px padding, 23px indent, 4px `#3e9e4e` bar at 46%, mono `[137/137]` / `46%` / `[1.6/3.4 MB]` (`:85`) | `InstallProgressModal.svelte:117-144`, `:265-357` — walked row by row against this board, every value matches | — | No | **CONFIRMED** — GF8 re-checked against a second board drawing the same list; no new delta |
| FC7 | Log disclosure and its rule | 12px stroked chevron `M7 4l6 6-6 6`, `Log (23)` 13px/500 `#5c5c5c`, above a `border-top: 1px solid #ededed` with 14px/14px (`:85`) | `InstallProgressModal.svelte:146-172`, `:363-392` | — | No | **CONFIRMED** — GF7 + GF9, unchanged |
| FC8 | Footer row layout | The rule is one row, `justify-content: space-between`: the log disclosure hard left, and a right group of `Stops after the current block` + `Cancel` at `gap: 12px`, baseline-aligned (`:85`) | `InstallProgressModal.svelte`'s `.foot-row` is that row: `space-between`, the log toggle left, `.cancel-group` right at `gap: 12px`, `align-items: baseline` | WRONG (layout) | **Yes** — it cannot be settled before FC9: with no control on the right, `space-between` on a one-child row is a no-op | **FIXED** (2026-09-11) — built with FC9. The row also renders with an empty log, since gating it on log lines took the way out with it |
| FC9 | **Cancel control** | Bare text, `font-size: 14px; font-weight: 500; color: #5c5c5c` — no chrome, and per the board comment never disabled (`:85`, `:21-27`) | `InstallProgressModal.svelte`'s `.cancel-link` — bare text, `--fs-btn-sm`/500/`--ink-soft`, calling `installProgress.requestCancel()`. `confirmCancel()` aborts a per-run `AbortController` handed to `exec` as `reporter.signal` | **MISSING** | **Yes** — the owner's open question. The engine already supports it; wiring it means an `AbortController` per run, a store field, and a decision about what a half-written bank leaves behind | **FIXED** (2026-09-11) — the owner asked for it. `apps/web/test/flashcancel.mjs` asserts the abort at the WRITER (a stubbed `flashImage` records its opts), not at the flag |
| FC10 | Cancel caption | `Stops after the current block`, `font-size: 12px; color: #9a9aa0` (`:85`) | `shared.installProgressModal.cancelCaption`, all seven locales; `--fs-micro`/`--ink-dim` (`#9a9a9a`, the token nearest the board's `#9a9aa0`; `--ink-faint` is documented as not for readable text) | **MISSING** | **Yes** — same gate as FC9; a seven-file i18n edit that would describe a control that does not exist | **FIXED** (2026-09-11) — the board's six words, unchanged, as it recommended |

### Could not determine — FlashingCancel
- Whether the board intends Cancel to remain visible during the *non-flashing* phases the same modal drives (the read/build phases before the first write, and SD sync). The board draws only the flashing phase.
- Whether the right group's `align-items: baseline` matters once the caption and Cancel sit at 12px and 14px — not measurable statically.

---

## FlashingCancelConfirm.dc.html

**Never surveyed before this pass (2026-09-08).** Byte-identical to `FlashingCancel` apart from
two things: the running modal's `Cancel` darkens from `#5c5c5c` to `#1b1b1b`, and a second dialog
opens over it. FC1–FC8 therefore apply verbatim and are not repeated; only the deltas are listed.

**Nothing on this board is buildable today.** It is the confirmation step of the control FC9
records as the owner's open question, and it also names a consequence — *"leaves it unbootable
until you install again"* — that is a behaviour claim, not paint.

| # | Element | Artboard specifies | Implementation (`file:line`) | Severity | Owner decision? | Status (2026-09-08) |
|---|---|---|---|---|---| --- |
| FCC1 | Cancel ink while its confirm is up | `color: #1b1b1b` (`:85`), against `#5c5c5c` on `FlashingCancel` — the trigger stays lit while its dialog is open | Nothing. The link keeps `--ink-soft` while its dialog is open | **MISSING** | **Yes** — same gate as FC9 | **OPEN** (2026-09-11) — no longer blocked, FC9 exists. One rule, never built: a lit state for the trigger while its own dialog is up |
| FCC2 | Second backdrop | `rgba(0,0,0,0.32)` at `z-index: 9`, stacked *over* the running modal's `rgba(0,0,0,0.5)` (`:86`) | `ModalShell` takes `zIndex`; the confirm passes `--z-modal-prompt`. The scrim is still `rgba(0,0,0,0.5)` on both shells | **MISSING** | **Yes** — same gate | **OPEN** (2026-09-11) — stacking built, the LIGHTER second scrim not. Two 0.5 scrims darken more than the board draws; it needs a scrim prop on `ModalShell` |
| FCC3 | Confirm dialog frame | `width: 416px`, `border: 1px solid #d8d8d8`, `border-radius: 6px`, `box-shadow: 0 12px 40px rgba(0,0,0,0.32)`, and a **`height: 3px; background: #8a241b`** lip in place of the gold one (`:86`) | `ModalShell maxWidth="416px" lip="danger"` — the lip prop landed in `ee63de2` and `--danger` IS `#8a241b` | **MISSING** (the danger lip only) | **Yes** — same gate | **FIXED** (2026-09-11) |
| FCC4 | Confirm title | `Stop writing Retro-Go?`, 18px/600/`-0.01em` (`:86`) | `shared.installProgressModal.cancelTitle`, all seven locales — `Stop writing?`, without the firmware name | **MISSING** (copy) | **Yes** — same gate | **FIXED** (2026-09-11), with one deviation: the board names Retro-Go, but this dialog also covers the OFW flash and SD sync, and the store has no per-run name to interpolate. Recorded rather than invented |
| FCC5 | Confirm body | `Bank 2 is 46% written. Stopping leaves it unbootable until you install again. Your stock firmware in bank 1 is not touched.`, 14px `#5c5c5c` (`:86`) | `shared.installProgressModal.cancelBody`, all seven locales — `What is already written stays written. The install is incomplete until you run it again.` | **MISSING** (copy) | **Yes** — and more than FC9: the sentence names the bank, the percentage, and asserts what survives. The first two are runtime; the third is a claim about `GnwFlasher.flash()`'s block-boundary abort that the owner should confirm against hardware | **BLOCKED** (2026-09-11) — the board's sentence is still not built and the hardware statement is still missing. What shipped is deliberately GENERIC: the board's `bank 1 is not touched` is true of a Retro-Go install into bank 2 and FALSE of an OFW patch flash, which writes bank 1. `flashcancel.mjs` fails if a bank claim reappears here |
| FCC6 | Confirm actions | `Keep writing` bare text 14px/500 `#5c5c5c`, then `Stop` as a `1.5px solid #8a241b` outline, `#8a241b` label, 14px/600, `padding: 8px 20px`, `border-radius: 5px`; row `justify-content: flex-end; gap: 20px; padding-top: 22px` (`:86`) | Built from the pre-existing variants exactly as this row predicted: `Button variant="cancel"` then `variant="destructive"`, inside `.actions` | **MISSING** | **Yes** — same gate | **FIXED** (2026-09-11) |
| FCC7 | Confirm head gap | `gap: 8px` (`:86`) | `h3.head-6` — 6px, the `FlashingCancel`/`FlashFailure` value, not the board's 8px | COSMETIC | No | **OPEN** (2026-09-11) — no longer blocked. Still a third value for the same head; 6px was reused rather than adding a fourth keyed case for 2px |
| FCC8 | Running modal behind | Keeps its crawling lip and its 46% bar — the write does not pause while the question is asked (`:85`) | Consistent with the engine: the abort is checked at the next chunk boundary, so a write genuinely does continue while the dialog is up | — | No | **CONFIRMED as the correct model** — the board and the engine agree; recorded so a future implementation does not freeze the progress modal when the confirm opens |

### Could not determine — FlashingCancelConfirm
- What the app does after `Stop` is taken: the board draws no post-cancel screen, and `FlashFailure` is explicitly the *failure* end state, not the cancelled one. There is no artboard for "you stopped it".
- Whether Escape / backdrop-click on the confirm means "Keep writing" — not expressible in an artboard.

---

## FlashFailure.dc.html

**Never surveyed before this pass (2026-09-08).** Implementing components:
`lib/ui/InstallProgressModal.svelte` (`modalPhase === "error"`) and `lib/installProgress.svelte.ts`.

Its own comment (`:19-25`) states the design intent: *"The end state of the BAD_HASH_FLASH rule:
sanity check, retry twice, then stop. The write has stopped, so the chrome drops out of its busy
state in the same moment the error appears… 'The affected blocks' are named as three rows, not a
hex dump: what the block carried first, its address second and in mono. Retry is the primary;
Close is an escape, not the recommendation."*

**Updated 2026-09-08 (statuses applied, verified against the code).** The per-block failure
detail the board's table needs now exists on this branch (`installProgress.errorBlocks`), so the
block table (FF7/FF8), the advice aside (FF9), the head-band failure sentence (FF5) and the danger
lip (FF3) are all **built** — `5e6f658`. What remains unbuilt is the `Retry install` action
(FF11), which is a behaviour decision, not paint; the aside's trailing *"then retry"* therefore
still names an action that does not exist.

| # | Element | Artboard specifies | Implementation (`file:line`) | Severity | Owner decision? | Status (2026-09-08) |
|---|---|---|---|---|---| --- |
| FF1 | Chrome leaves the busy state | White `#ffffff` band, **green** `#2e9e44` console chip with no throb, `Connected (Recovery Mode)` 14px/600, and a **static 3px gold** lip — the busy treatment is gone entirely (`:27-79`) | The app renders exactly that when `deviceSafety` is idle (`DeviceHeader.svelte:132-160`; **`App.svelte:107-120`** as of 2026-09-10, formerly `:136-148`). But the error path releases into **`settling`, not idle** — `installProgress.svelte.ts:301` (formerly `:274-279`) calls `deviceSafety.release()` in `finally` with the comment *"the error path releases exactly like the success path"* — and `settling` is still `unsafe`, so the band stays amber and the lip keeps crawling behind the failure dialog until `markQuiet()` fires | — | **Yes — behaviour** | **OPEN (behaviour)** — the board asserts the chrome drops out of busy *in the same moment the error appears*, and the app holds it for the settling window. The board's reasoning is stated and is sound (*"A page still shouting 'do not disconnect' behind a dead flash would be a lie"*), but a failed write is exactly when the device is most likely to still be mid-erase, which is what `settling` exists for. Not a paint gap; an owner call on which risk wins |
| FF2 | Dialog width and frame | `width: 480px`, `1px solid #d8d8d8`, `radius 6px`, `0 12px 40px rgba(0,0,0,0.32)` (`:85`) | `InstallProgressModal.svelte:72` + `ModalShell.svelte:63-70` | — | No | **CONFIRMED** — the failure dialog is the same 480px shell as the running one, which is what the board draws |
| FF3 | Dialog lip | `height: 3px; background: #8a241b` — solid danger, replacing the gold (`:85`) | `ModalShell.svelte:15,33,52,77-84` — a `lip?: "gold" \| "danger"` prop, flat `--danger` on `.lip.danger`, driven by `modalPhase === "error"` at `InstallProgressModal.svelte:102` | — | No | **FIXED** (`5e6f658`) — verified 2026-09-08: same 3px height, no crawl, no layout shift; `--danger` is `#8a241b` already |
| FF4 | Dialog title | `Install failed` (`:85`) | `InstallProgressModal.svelte:74` renders `prompt.title` in every phase, so the failure dialog is still headed `Install Retro-Go` (`roms.ts` / `wizard.ts` install titles) | **MISSING** (copy) | **Yes** — a per-phase title is a new store concept, and the word choice is the owner's | **BLOCKED** — a seven-file i18n edit plus a `PhaseTitle`-style store field. Not paint |
| FF5 | Failure sentence | `Three blocks did not match after two retries. Bank 2 is partly written and will not boot.` — 14px, `#5c5c5c`, regular weight, sitting in the head band directly under the title (`:85`) | `InstallProgressModal.svelte:112` `<p class="muted">{headline}</p>`, inside the head band under the title — `--fs-caption` (14px), regular weight, `--ink-soft` (`:260-263`). `headline` (`:42-53`) is composed from the real error's `errorBlocks` (block count + retry count + affected bank), falling back to the raw message when no blocks are carried | — | No | **FIXED** (`5e6f658`) — verified 2026-09-08. Landed with FF3, so the state keeps its red cue in the lip |
| FF6 | Head band | `padding: 22px 24px 0`, `gap: 6px` between title and sentence (`:85`) | `InstallProgressModal.svelte:108` (`h3.head-6`, `margin-bottom: 6px` at `:257-259`) with the FF5 sentence at `:112` | — | No | **FIXED** (`5e6f658`) — verified 2026-09-08: the 6px gap now has the sentence it was drawn for, and FF7/FF8's sections give the head's `0` bottom padding something to butt against |
| FF7 | `Blocks that failed` caption | 11px/700/`0.11em`/uppercase `#5c5c5c`, `padding-bottom: 8px`, `border-bottom: 1px solid #e0e0e0` (`:85`) — the app's standard section caption | `InstallProgressModal.svelte:218` (`.blocks-cap`, `:332`) — the house 11px/700/`0.11em` uppercase caption over the header rule | — | No | **FIXED** (`5e6f658`) — verified 2026-09-08 |
| FF8 | Block rows | Three rows, `gap: 14px`, `padding: 9px 0`, `border-bottom: 1px solid #ededed` (last row none): a 62px mono 12px/600 `#8a241b` `Block 14` column, then the payload name 13px `#1b1b1b` (`Games, BIOS, languages` / `Emulators, saves` — the settled segment labels), then a mono 12px `#5c5c5c` address `0x9038_0000` | `InstallProgressModal.svelte:217-226` — one `.block-row` per entry of `installProgress.errorBlocks`, mono danger `Block n`, the region label resolved against the same `GeoSegment[]` the geometry bars draw, then the mono address | — | No | **FIXED** (`5e6f658`) — verified 2026-09-08. Row count follows the real error; the board's three rows were a drawing, not a count |
| FF9 | Advice aside | `background: #fbf1ef; border-left: 2px solid #8a241b; border-radius: 0 3px 3px 0; padding: 10px 12px`, text 13px `#1b1b1b`: `Repeated block failures are almost always the programmer wiring. Reseat it, then retry.` (`:85`) | `InstallProgressModal.svelte:229` (`.advice`, `:373`) — the danger-tinted wash with the 2px `--danger` left rule | — | No | **FIXED** (`5e6f658`) — verified 2026-09-08. Its trailing *"then retry"* still names FF11, which is blocked; revisit the sentence if FF11 is answered as "no retry" |
| FF10 | Checklist and log in the failure state | **Absent.** The board's failure dialog is title, sentence, block table, aside, footer — the phase checklist and the `Log (n)` disclosure are both gone; `Save log` replaces the disclosure | `InstallProgressModal.svelte:108-172` keeps both in the `error` branch, with the failed phase marked `✗` | **EXTRA** | **Yes** | **OPEN** — the app's version is arguably better (the `✗` marks *which* phase died, which the board can only express through the block table it has instead), but it is a real structural divergence and the owner should pick. Nothing is cut for absence from a mockup, so the default is to keep both |
| FF11 | `Retry install` | The primary: `#c8372b` fill, white, 14px/600, `padding: 9px 22px`, `radius 5px`, `inset 0 -2px 0 #9e2a20` — `Button`'s `action` variant token for token | No retry affordance; the failure footer offers `Save log` and `Close` only | **MISSING** | **Yes — behaviour** | **BLOCKED** — retrying after a partial write is a device operation, not paint. The paint itself is the existing `action` variant |
| FF12 | Failure footer | A full-bleed band ruled off from the body: `border-top: 1px solid #d8d8d8; margin-top: 20px; padding: 16px 24px`, `space-between`, `Save log` 13px/500 `#5c5c5c` hard left, then a right group of `Close` (bare 14px/500 `#5c5c5c`) and `Retry install` at `gap: 20px` (`:85`) | `InstallProgressModal.svelte:181-190`, `:236-247` | COSMETIC | No, for the band. **Yes** for `Close`'s treatment | **FIXED in part** (`ee63de2`) — the band, its rule, its 20px/16px/24px geometry and the left-aligned `Save log` (already 13px/500 `--ink-soft`) all match now. **`Close` is deliberately left as the neutral cap**: the board makes it bare text precisely because `Retry install` is the primary beside it, and with FF11 absent that would leave the failure dialog with no visible action at all. It becomes a one-word change the moment FF11 lands |

### Could not determine — FlashFailure
- Whether `deviceSafety` actually reaches idle within a user-visible time after a failed write, or whether the header stays amber until the next device round-trip — `markQuiet()` needs the device to answer, and this pass touches no hardware. FF1 records the design question; this records that the timing itself was not measured.
- Whether the board's `Bank 2` phrasing survives the SD-mode path, which shares this modal and has no banks.
- Whether the aside's `#fbf1ef` should become a token: one use, one board, so it snaps to nothing today.

---

## GuidedLayout.dc.html

Implementing component: `lib/views/Wizard.svelte` (chooser branch, `:920-974`).

| # | Element | Artboard specifies | Implementation (`file:line`) | Severity | Owner decision? | Status (2026-09-07) |
|---|---|---|---|---|---| --- |
| GL1 | Chooser heading | `How Do You Want the Device Set Up?` (28px/600/-0.02em) | `i18n/strings/wizard.ts:98` `title: "What Do You Want on the Device?"`; rendered `Wizard.svelte:924` | WRONG | **Yes — artboard conflict.** `GuidedLayoutStock.dc.html` gives the *other* wording, `What Do You Want on the Device?`, which is what shipped. Two artboards, two headings, one control. Owner picks. | **FIXED (decision taken, 2026-09-08 sweep)** — the heading is now `What should this device run?` (`wizard.ts:98`), a third wording that resolves the `GuidedLayout` / `GuidedLayoutStock` conflict rather than picking a side: it is the shorter of the two artboard readings and asks about the device, not the user. Noted here so it can be changed later if the owner prefers either original. |
| GL2 | Column placement | The whole 470px column is vertically centred: outer `flex: 1; display:flex; align-items:center; justify-content:center; padding: 0 40px` | `Wizard.svelte:1121` `.wizard-container { margin: 4rem auto }`, inside `Advanced.svelte:323-326` `.tabpane.guided { padding-top: var(--page-pad-top-guided) }` = 64px (`styles/tokens.css:147`) *(as surveyed; the `--page-pad-*-guided` pair was retired in `f6e1fd5` — see `Advanced.svelte:348-350`)* — so 64 + 64 = **128px of top space**, top-anchored, never centred | WRONG | **Yes** — the older `Guided.dc.html:75` says `padding: 64px 40px 40px` (top-anchored), the newer four-tab layouts say vertically centred. Conflicting generations; also the 128px doubling is a bug under either reading. | **FIXED** (`79cbd66`) — `.wizard-container { margin: 0 auto }`, with the reasoning in the comment above it (`Wizard.svelte:1126-1132`); the column now takes only `.tabpane.guided`’s 64px, which is Guided.dc.html’s own `padding: 64px 40px 40px`. (The *centring* half of the GL1/GL3 artboard conflict is untouched and stays with those rows.) |
| GL3 | Card label alignment | `width: 100%; text-align: center` on the label span | `Wizard.svelte:1203-1207` `.choice-label` has neither; `.choice` sets `text-align: left` (`:1161-1176`) | COSMETIC | **Yes — artboard conflict**: `GuidedLayoutStock.dc.html`'s identical card omits `width/text-align`, and the shipped code follows that one. | **CONFIRMED — `GuidedLayoutStock` wins.** Re-walked 2026-09-08 sweep. A two-artboard conflict on a cosmetic; the sweep takes the card that omits `width/text-align` (the same call the code already makes), so no change. Recorded, not reopened. |
| GL4 | Card geometry | `width: 304px; padding: 15px 20px; gap: 18px; border: 1px solid #d8d8d8; border-radius: 6px`; marks well `width: 120px`, gnw 24px, rgo 11px, plus-glyph 11px `#c0c0c0` | `Wizard.svelte:1161-1201`: 304px, 15px/20px, gap 18px, `--hairline`, 6px; `.marks` 120px, `.mark-gnw` 24px, `.mark-rgo` 11px (`:1188-1201`), plus at `:929-931` `stroke="var(--ink-faint)"` (#c8c8c8) | — | No — `--ink-faint` #c8c8c8 vs `#c0c0c0` is inside token tolerance and was the S3.15 fix. | **CONFIRMED** — card geometry unchanged and still matches |
| GL5 | Card stack spacing | `gap: 10px`; 12px pips→title; 24px title→cards; 20px cards→escape | `Wizard.svelte:1158` `gap: 0.75rem` (12px); container gap `2rem` with `-6px` pip offset (`:1118`, `:1131`) → **26px** pips→title, **32px** title→cards, and `.chooser { margin-bottom: -1.25rem }` (`:1159`) → **12px** cards→escape | COSMETIC | No — one spacing-table pass. | **FIXED** (`0b9219a`) — `.pips.chooser-pips { margin-bottom: -20px }`, `.chooser-title { margin: 0 0 -8px }`, `.chooser { margin-bottom: -12px }` give the artboards' 12 / 24 / 20px (`Wizard.svelte:1136-1138`, `:1149`, `:1166-1167`) |
| GL6 | Escape line | `Something else?` `#9a9a9a` + `Use the Advanced tab` 600 `#6e6e6e`, 13px | `wizard.ts:102-103` (copy identical); `.escape` `--ink-dim` #9a9a9a / `--fs-btn-sm` 13px (`:1208-1213`), `.escape-strong` `--ink-mute` #6e6e6e/600 (`:1222-1225`) | — | No. | **CONFIRMED** — escape line unchanged (`Wizard.svelte:1216-1233`) |
| GL7 | Pips | first pip `22×6 #3e9e4e`, second `6×6 #d8d8d8` | `Wizard.svelte:922-925`, `:1125-1140` | — | No — confirms 3.5 FIXED. | **CONFIRMED** — pips unchanged |
| GL8 | Third card, "Return to Stock" | Present as the third choice | `Wizard.svelte:952-959`, gated `{#if !isStock}` | — | No — the gate is reasoned in the comment at `:950-951`; `GuidedLayoutStock` draws the two-card variant, so both states are backed. | **CONFIRMED** — the `{#if !isStock}` gate is unchanged |
| GL9 | Hardware-floor note | Not drawn on any chooser artboard | `Wizard.svelte:967,971` `.floor-note`, styled `:1215-1221` | EXTRA | **Already OPEN — see S6.12 (Wizard floor gating) / 7.19.** Not re-counted. | **CONFIRMED — keep.** Re-walked 2026-09-08 sweep: `.floor-note` still renders (`Wizard.svelte:967-971`). It states a hard hardware floor (8 MB / 16 MB) that nothing else on the chooser says — information, not filler — and nothing is cut for absence from a mockup. Tracked as S6.12 for the gating behaviour only. |

---

## GuidedLayoutStock.dc.html

Implementing component: `lib/views/Wizard.svelte` (chooser branch), same as `GuidedLayout`.

| # | Element | Artboard specifies | Implementation (`file:line`) | Severity | Owner decision? | Status (2026-09-07) |
|---|---|---|---|---|---| --- |
| GLS1 | Chooser heading | `What Do You Want on the Device?` | `i18n/strings/wizard.ts:98` — character-identical | — | No. See GL1 for the conflict with `GuidedLayout`. | **CONFIRMED** — unchanged (`wizard.ts:98`) |
| GLS2 | Two cards only (`Dual Boot`, `Only Retro-Go`) — no `Return to Stock` | The variant shown when the device still has unpatched stock | `Wizard.svelte:952` `{#if !isStock}` suppresses the third card exactly then | — | No — state implemented correctly. | **CONFIRMED** — unchanged (`Wizard.svelte:952`) |
| GLS3 | Card labels | `Dual Boot` / `Only Retro-Go` | `wizard.ts:99-100` — character-identical | — | No. | **CONFIRMED** — unchanged (`wizard.ts:99-100`) |
| GLS4 | Column placement / spacing / escape line | identical to `GuidedLayout` | — | — | See GL2, GL5. | **FIXED** — both rows it defers to are closed: GL2 by `79cbd66` (the doubled top space) and GL5 by its own commit. Nothing is left under GLS4 |

---

## GuidedRetroGoOnly.dc.html

Implementing component: `lib/views/Wizard.svelte` (spine branch, `rgo` path).

| # | Element | Artboard specifies | Implementation (`file:line`) | Severity | Owner decision? | Status (2026-09-07) |
|---|---|---|---|---|---| --- |
| GR1 | Pips | second pip on: `6×6 #d8d8d8` then `22×6 #3e9e4e` | `Wizard.svelte:922-925` with `stepIndex === 1` | — | No. | **CONFIRMED** — unchanged |
| GR2 | Pips→spine spacer | `<div style="height: 26px">` | `Wizard.svelte:1136` comment states exactly this; 2rem gap − 6px = 26px | — | No. | **CONFIRMED** — the 26px spine spacer is unchanged and now explicitly scoped away from the chooser (`Wizard.svelte:1131-1138`) |
| GR3 | Four steps: `Back Up the Original Firmware` / `Install Retro-Go` / `Add Software Sources` OPTIONAL / `Add ROMs and Homebrew` | — | `Wizard.svelte:864-865` (`rgo` → backup+install+sources+roms), titles at `wizard.ts:114-117` — all four character-identical | — | No. | **CONFIRMED** — unchanged (`wizard.ts:114-117`) |
| GR4 | Active title 21px/600/-0.015em; inactive 16px/600 | — | `Wizard.svelte:1306-1312` (16px base) and `:1313-1315` (`.active` → 21px) | — | No — confirms 3.6 FIXED. | **CONFIRMED** — unchanged |
| GR5 | `OPTIONAL` chip | 12px/600/`0.05em`/uppercase `#9a9a9a`, on the title baseline | `Wizard.svelte:1010` `chip-optional`; `:1316-1328` `--fs-chip` 12px/600/0.05em/uppercase, `--ink-dim` = #9a9a9a (`tokens.css:84`) | — | No — confirms 3.3 FIXED. | **CONFIRMED** — unchanged |
| GR6 | `Skip` control beside `Back Up` | Bare text: 13px/500 `#5c5c5c`, **no underline**, label is `Skip` (no ellipsis) | `Wizard.svelte:1026` `<Button variant="quiet">{w.step1.skipEllipsis}</Button>`; `wizard.ts:31` `skipEllipsis: "Skip…"`; `Button.svelte:103-111` `.quiet` is `text-decoration: underline` + `padding: 0.5rem 0.25rem` and inherits the button font size, not 13px | WRONG | **Partly** — the ellipsis half is already S6.12 OPEN, so cite that; the **underline is a new finding**. S3.15 removed underlines from `.skip-anyway`/`.wayout` but `Button variant="quiet"` still underlines, and it is used for `Skip…` (`:1026`) and for `Reinstall` (`:1052`), neither of which any artboard underlines. | **FIXED** (2026-09-08 sweep) — both halves. The control is a bare `<button class="skip">` (`Wizard.svelte:1028-1030`), styled `:1399-1408` as `--fs-btn-sm` / 500 / `--ink-soft` with **no** `text-decoration` and a real `:focus-visible` ring; and the string is `step1.skip: "Skip"` (`wizard.ts:31`) — the ellipsis is gone. It no longer routes through `Button`'s `quiet` variant at all. |
| GR7 | Primary button | `#c8372b` fill, white, 14px/600, `padding: 9px 22px`, `border-radius: 5px`, `inset 0 -2px 0 #9e2a20` | `Button.svelte` `action` variant (used at `Wizard.svelte:1023,1052`) | — | Not fully determinable statically — I did not measure the `action` variant's padding against `9px 22px`. Flagged, not claimed. | **SETTLED — CONFIRMED** (was undetermined): `Button.svelte`'s `.action` uses `--pad-btn: 9px 22px`, `--r-btn: 5px`, `--fs-btn: 14px` and `inset 0 -2px 0 var(--action-red-deep)` (`Button.svelte:55-62`, `tokens.css:114-115`) — token-exact to the artboard |
| GR8 | No back control anywhere on the spine | — | `Wizard.svelte:976` renders `<button class="back">← Back</button>` | EXTRA | **Already OPEN — see S6.12 (the `Back` link).** Not re-counted. | **CONFIRMED — keep.** Re-walked 2026-09-08 sweep: `<button class="back">` still renders (`Wizard.svelte:976`). It is the only way back out of a chosen path; removing it is navigation, not conformance. Tracked as S6.12. |
| GR9 | Step 2/3/4 render **no control at all** while pending (opacity 0.5, title only) | — | `Wizard.svelte:1071` renders an always-present `Add Sources` Button on the `sources` step, and `:1074` a disabled `Continue to Manage ROMs →` on `roms` | WRONG | **Yes** — the artboard's pending steps are inert titles; removing the controls changes what a pending step affords. Needs a call on whether pending steps stay clickable. | **BLOCKED** — unchanged; pending steps still carry live controls (`Wizard.svelte:1071`, `:1074`) **RE-STATUSED 2026-09-08** (`docs/BLOCKED-AUDIT.md`): Q5 — do pending Guided steps render controls. |

---

## GuidedSkipBackup.dc.html

Implementing component: `lib/views/Wizard.svelte` (spine branch, `skipExpanded` state).

| # | Element | Artboard specifies | Implementation (`file:line`) | Severity | Owner decision? | Status (2026-09-07) |
|---|---|---|---|---|---| --- |
| GS1 | Caution panel | `background:#fbf3e2; border-left: 2px solid #b8860b; border-radius: 0 3px 3px 0; padding: 10px 13px; gap: 6px` | `Wizard.svelte:1357-1366` `.caution`: `--tint-caution` #fbf3e2 (`tokens.css:101`), `--caution` #b8860b, `0 3px 3px 0`, `padding: 0.75rem 0.9rem` (12/14.4px), `gap: 0.5rem` | COSMETIC | No — confirms 3.15 FIXED for the radius; the padding/gap are ~2px off. | **FIXED** (`0b9219a`) — `.caution { padding: 10px 13px; gap: 6px }` (`Wizard.svelte:1365-1373`) |
| GS2 | Caution body text | 13px, `#1b1b1b` (plain ink) | `Wizard.svelte:1367-1372` `.caution p`: `font-size: 0.85rem` (13.6px, off-scale — `--fs-btn-sm` is 13px) and `color: var(--tint-caution-ink)` = **#4a3a12**, a brown, not the artboard's ink | COSMETIC | No. | **FIXED** (2026-09-08 sweep) — `.caution p` is `font-size: var(--fs-btn-sm)` (13px, on-scale) and `color: var(--ink)` (`Wizard.svelte:1391-1396`), the artboard's plain ink. The in-code comment records that `--ink` flips in dark theme exactly as the brown did, so the dark-theme reason for keeping the brown is met without keeping it. |
| GS3 | Caution copy | *"This cannot be undone, and downloading the original firmware is probably illegal in your jurisdiction."* | `wizard.ts:121` — character-identical | — | No. | **CONFIRMED** — copy unchanged (`wizard.ts:121`) |
| GS4 | `Skip anyway` | 13px/600 `#8a241b`, no underline | `Wizard.svelte:1373-1383`: `--fs-btn-sm` 13px, 600, `--danger` = #8a241b (`tokens.css:41`), no underline | — | No — confirms 3.15 FIXED. | **CONFIRMED** — unchanged (`Wizard.svelte:1381-1391`) |
| GS5 | The `Skip` affordance is gone once the caution is open (only `Skip anyway` remains) | — | `Wizard.svelte:1025-1027` keeps the `Skip…` button rendered alongside the expanded panel | COSMETIC | No. | **FIXED** (`0b9219a`) — the `Skip…` button is now suppressed once the caution panel is open (`Wizard.svelte:1025-1027`) |
| GS6 | Steps 2-4 identical to `GuidedRetroGoOnly` | — | — | — | See GR3, GR9. | see GR3 / GR9 — GR3 **CONFIRMED**, GR9 **BLOCKED** **RE-STATUSED 2026-09-08** (`docs/BLOCKED-AUDIT.md`): pointer only — see GR9, now Q5. |

---

## GuidedStockOnly.dc.html

Implementing component: `lib/views/Wizard.svelte` (spine branch, `stock` path, `:864`).

| # | Element | Artboard specifies | Implementation (`file:line`) | Severity | Owner decision? | Status (2026-09-07) |
|---|---|---|---|---|---| --- |
| GSO1 | Three steps: `Select Backup of Original Firmware` DONE / `Restore Original Firmware` active / `Remove Retro-Go` OPTIONAL | — | `Wizard.svelte:864` `["select-backup","restore","remove-rgo"]`; titles `wizard.ts:118-120` — all three character-identical; `stepOptional` covers `remove-rgo` at `Wizard.svelte:1002` | — | No — confirms 3.2 FIXED. | **CONFIRMED** — unchanged (`wizard.ts:118-120`) |
| GSO2 | Step 2's button label is `Restore` | — | `Wizard.svelte:1092` uses `{w.spine.restoreOriginal}`, i.e. the button repeats the whole step title *"Restore Original Firmware"* (`wizard.ts:119`) | WRONG | **Yes** — the fix needs a new `Restore` key (a seven-file i18n edit); there is no existing key with that text. | **FIXED** (2026-09-08 sweep) — `spine.restoreButtonLabel: "Restore"` exists (`wizard.ts:120`) alongside the step title, so the button no longer repeats the whole heading. |
| GSO3 | `Remove Retro-Go` step renders no control | — | `Wizard.svelte:1043-1097` has no `remove-rgo` branch, so nothing renders | — | No — matches. But note the step is therefore purely decorative: there is no way to actually remove Retro-Go from Guided. That is what the artboard draws, so not a defect here. | **CONFIRMED** — unchanged |
| GSO4 | Step 1 done mark is the green check disc, and step 1's title is *not* promoted (16px) even though it is `done` | — | `Wizard.svelte:1277-1281` done styling; `:1301` promotes only `.active`, and `stepActive` excludes `stepDone` (`Wizard.svelte:993`) | — | No. | **CONFIRMED** — unchanged |
| GSO5 | `Select Backup` step has **no** control in its done state | — | `Wizard.svelte:1080-1082` renders a `Select Folder` Button, `disabled={restoreDone}`, still visible when done | COSMETIC | No — a disabled leftover where the artboard shows a bare title. Same shape as the 3.8 fix on the backup step. | **FIXED** (`02d83be`) — the done state renders no control at all: the picker row now sits inside `{#if !restoreDone}` (`Wizard.svelte:1071-1078`) |

---

## Firmware.dc.html

Implementing components: `lib/views/Advanced.svelte` (nav band), `lib/advanced/FirmwareRail.svelte` (rail + pane head + footer bar), `lib/advanced/RetroGoTab.svelte` → `lib/advanced/RomSection.svelte` (the Install pane body).

**Nav band — measured 2026-09-08, and it settles S8.5.** The "older three-tab set at `:65-67`" this
paragraph used to describe no longer exists: `Firmware.dc.html:65-68` draws `Overview / Firmware /
Sources / Library`, and `:71-72` draws the Guided/Advanced switch beneath the same band. Both halves
were measured against the app; the tab bar conforms outright, the switch conforms in every value but
one. **New rows F0 and F1a below carry them.**

- **Tab bar — conformant.** Board: four tabs, `height: 46px`, `padding: 0 2px`, `gap: 34px`,
  `letter-spacing: 0.02em`; idle 14px/600 `#6e6e6e` on `inset 0 -3px 0 transparent`, active
  14px/700 `#1b1b1b` on `inset 0 -3px 0 #3e9e4e`. App: `Advanced.svelte:385-414` (`.tabbar` /
  `.tab` / `.tab.active`), value for value, with `--ink-mute: #6e6e6e`, `--ink: #1b1b1b`,
  `--zelda-green: #3e9e4e` (`styles/tokens.css:140,10,55`). Labels `Overview` / `Firmware` /
  `Sources` / `Library` (`firmwareSetup.ts:15-17`, `sources.ts:7`) are the board's verbatim.
- **Mode switch (the S8.5 subject) — one delta, everything else conformant.** Board: `gap: 18px`,
  idle `13px/500 #5c5c5c`, active `13px/600 #1b1b1b` on `inset 0 -2px 0 #3e9e4e` with
  `padding: 4px 0`. App `Advanced.svelte:416-437` matches the gap, both sizes, both weights, the
  padding and the underline (`--fs-btn-sm: 13px`, `tokens.css:187`; `--zelda-green`; `--ink` on the
  active word). **The idle ink does not match**: `.modeswitch button` (`:425`) takes
  `var(--ink-mute)` = `#6e6e6e`, where the board draws `#5c5c5c` = `--ink-soft`
  (`tokens.css:11`). The tab bar's idle ink *is* `#6e6e6e`, so this reads as the tab's token
  reused one rule too far. One-token fix, no decision needed — **F1a, OPEN**. Labels `Guided` /
  `Advanced` (`firmwareSetup.ts:19-20`) are the board's verbatim.

**Unanimity, so no board has to be chosen over another.** The switch markup is byte-identical in all
**24** boards that draw it, in both states (`grep`ed across `docs/design/mockups/*.dc.html`: 24 idle
spans, 24 active spans, one style string each). Its visibility rule is unanimous too — those 24 are
**exactly** the boards whose active tab is `Firmware`, and no `Firmware`-active board omits it, which
is what `Advanced.svelte:235` gates on (`tab === "device"`). The one app behaviour no board covers is
the additional `&& device.isConnected`; no board draws a disconnected Firmware tab, so it is unbacked
rather than contradicted, and it is not a delta.

The **rail, pane head and footer bar** on this artboard are not contradicted by any other board, so
they govern.

| # | Element | Artboard specifies | Implementation (`file:line`) | Severity | Owner decision? | Status (2026-09-07) |
|---|---|---|---|---|---| --- |
| F0 | Nav-band tab bar | Four tabs `Overview / Firmware / Sources / Library` (`:65-68`), `height: 46px`, `padding: 0 2px`, `gap: 34px`, `0.02em`; idle 14px/600 `#6e6e6e` on `inset 0 -3px 0 transparent`, active 14px/700 `#1b1b1b` on `inset 0 -3px 0 #3e9e4e` | `Advanced.svelte:385-414`; labels `firmwareSetup.ts:15-17` + `sources.ts:7`. Every value matches | — | No | **CONFIRMED** (row added 2026-09-08) — measurable for the first time now the "retired three-tab chrome" exemption is withdrawn; unanimous across all 44 boards that draw the band |
| F1a | Mode-switch type — **the S8.5 subject** | `gap: 18px`; idle `13px/500 #5c5c5c`, active `13px/600 #1b1b1b` on `inset 0 -2px 0 #3e9e4e`, `padding: 4px 0` (`:71-72`); byte-identical in all 24 boards that draw the switch, and drawn only where `Firmware` is the active tab | `Advanced.svelte:416-437`. Gap, both sizes, both weights, padding, underline and active ink all match. **Idle ink does not**: `.modeswitch button:425` is `var(--ink-mute)` `#6e6e6e`, board is `#5c5c5c` = `--ink-soft` (`tokens.css:11`) | COSMETIC (one token) | No | **FIXED** (`c7e1577`) — `.modeswitch button` now takes `--ink-soft`; the `.tab` rule above it keeps `--ink-mute`, which is correct there. Original cell: **OPEN** (row added 2026-09-08) — S8.5 was BLOCKED on "the switch's type has no current artboard"; 24 boards draw it, so the block is withdrawn and what remains is this single token. Swap `--ink-mute` → `--ink-soft` on `.modeswitch button`; the `.tab` rule above it keeps `--ink-mute`, which is correct there |
| F1 | Mode-switch labels | `Guided` / `Advanced`, 13px, active `inset 0 -2px 0 #3e9e4e`, `padding: 4px 0` (`:70-71`; and identically in all five newer four-tab Guided artboards, e.g. `GuidedFlashing.dc.html:76-77`) | `i18n/strings/firmwareSetup.ts:19` `modeGuidedSetup: "Guided Setup"`; rendered `Advanced.svelte:236-241`. Type/underline at `:378-400` are correct | WRONG (copy) | **Yes** — a seven-file i18n edit. (It used to be recorded as interacting with **8.5 BLOCKED**, on the premise that the switch's *type* had no current artboard. That premise is dead — see the nav-band paragraph above.) | **FIXED** — unchanged (`firmwareSetup.ts:19` `"Guided Setup"`); interacts with 8.5 **RE-STATUSED 2026-09-08** (`docs/BLOCKED-AUDIT.md`): stale row. `firmwareSetup.ts:19-20` already reads `modeGuidedSetup: "Guided"` / `modeAdvanced: "Advanced"` — the artboard's labels (`30bb7d6`). |
| F2 | Rail | Two groups, `Firmware management` / `Flash management`, six items, 11px/700/`0.11em` uppercase `#5c5c5c` headings, 14px items, selected `inset 2px 0 0 #3e9e4e` with `padding-left:14px; margin-left:-14px`, rail `border-right`, `padding: 32px 20px 40px 40px` (`:75-76`) | `FirmwareRail.svelte:69-88` (groups/labels), `:158-179` (rail + railhead), `:180-197` (item/selected) — every value matches, with the artboard cited at `:145-149` | — | No — confirms 5.12 FIXED. | **CONFIRMED** — rail unchanged and still matches |
| F3 | Pane head | 24px/600/-0.015em title + 14px `#5c5c5c` subtitle `Currently on bank 2, v1.4.1-44.` (`:82-83`) | `FirmwareRail.svelte:111-114`; `.pagetitle` `:252-257`, `.pagesub` `:258-262`; copy at `i18n/strings/firmwareSetup.ts:351` `Currently on bank ${bank}, ${version}.` — character-identical | — | No — confirms 5.8 FIXED. | **CONFIRMED** — pane head unchanged |
| F4 | Pane body box | `padding: 32px 40px 40px; gap: 32px; max-width: 720px` (`:79`) | `FirmwareRail.svelte:217-220` `.pane.narrow .panebody` gap 32 / max-width 720, applied via `class:narrow={selected === "install"}` (`:109`) | — | No. | **CONFIRMED** — pane body box unchanged |
| F5 | `Version` field label | `Version` (`:87`), 13px/500 `#5c5c5c` | `i18n/strings/firmwareSetup.ts:171` `installVersionLabel: "Install version"`, rendered `RomSection.svelte:821` | WRONG (copy) | **Yes** — seven-file i18n edit. | **FIXED** — still `installVersionLabel: "Install version"` (`firmwareSetup.ts:171`); seven-file copy decision **RE-STATUSED 2026-09-08** (`docs/BLOCKED-AUDIT.md`): stale row. `firmwareSetup.ts:172` already reads `installVersionLabel: "Version"`, not `Install version`. |
| F6 | Version control | 40px box, `border-radius: 2px`, mono value, chevron at the right, `1px #d8d8d8` | `RomSection.svelte:822-831` native `<select class="mono">` | COSMETIC | No — a native select is the platform-honest form of this control; only the 40px/2px paint is at issue. | **FIXED** (`81ad3aa`) — the version control now carries the artboard's 40px height / 2px radius and its 13px/500 label (`RomSection.svelte`, `Firmware.dc.html:87-88` cited in the commit) |
| F7 | Two option checkboxes | `Keep installed games` / `Keep saves and settings` (`:106`, `:114`), drawn as 17px `#3e9e4e` rounded-2px squares with a white check | `RomSection.svelte:834-846`; copy `firmwareSetup.ts:172-173` `Migrate games` / `Migrate saves and settings`; native `<input type="checkbox">` | WRONG (copy + paint) | **Yes for the copy** — "Keep" vs "Migrate" is a meaning change, not a wording nit, and it is a seven-file i18n edit. | **FIXED** (copy) — the paint landed (`81ad3aa`: 17px green mark, 2px radius, white check); `Migrate games` / `Migrate saves and settings` still ship (`firmwareSetup.ts:172-173`) and the change of meaning needs an owner **RE-STATUSED 2026-09-08** (`docs/BLOCKED-AUDIT.md`): stale row. `firmwareSetup.ts:173-174` already read `Keep installed games` / `Keep saves and settings` — the artboard's copy verbatim; the paint landed earlier under `81ad3aa`. |
| F8 | Checkbox visibility | Both drawn unconditionally in the pane | `RomSection.svelte:834` gates them on `installMode === "flash" && deviceHasRetroGoInstalled` | — | No — the artboard's device has Retro-Go installed, so it is consistent; recorded so it is not mistaken for a gap. | **CONFIRMED** — the gate is unchanged and consistent with the artboard's device state |
| F9 | `Target` field label above the bank cards | `<label>Target</label>`, 13px/500 `#5c5c5c` (`:119`) | No label anywhere — `RomSection.svelte:851` jumps straight to `<div class="bank-picker">` | MISSING | **Yes** — needs a new `Target` i18n key across seven files. | **FIXED** — no `Target` label; `RomSection.svelte:851` still jumps to `.bank-picker`. New seven-locale key **RE-STATUSED 2026-09-08** (`docs/BLOCKED-AUDIT.md`): stale row. `RomSection.svelte:855` renders `bankTargetLabel` and `firmwareSetup.ts:175` defines it as `Target`. The label the row calls missing exists. |
| F10 | Bank card sub-captions | Per card: `Bank 1` / `Replaces stock` and `Bank 2` / `Dual boot` (`:127-128`, `:137-138`), 13px/600 + 12px `#5c5c5c` | One shared caption *below* both cards instead: `RomSection.svelte:855-857` → `firmwareSetup.ts:174-175` `bankTargetCaption` = `Install target: bank N (dual-boot, stock kept)` | WRONG | **Yes** — moving the text into the cards means two new short keys and retiring one long one; a copy decision, not a patch. | **FIXED** — still one composed caption below both cards (`RomSection.svelte:856`, `firmwareSetup.ts:174`) **RE-STATUSED 2026-09-08** (`docs/BLOCKED-AUDIT.md`): stale row. `RomSection.svelte:856-861` now renders per-card footer captions `Replaces stock` / `Dual boot` (`firmwareSetup.ts:176-177`) instead of one composed caption below both cards. |
| F11 | Selected target card border | `border: 1px solid #3e9e4e` — plain green, no ring (`:132`) | `BankCard.svelte:126-129` `.bank-card.selected { border-color: var(--model-accent); box-shadow: 0 0 0 2px var(--model-accent) }` | WRONG | No — `--model-accent` is a neutral grey when the model is unknown; this is the same class of error 5.13 fixed for `.bank-action` and `.occupied`, missed on the *selectable* branch. | **FIXED** (`bc356de`) — `.bank-card.selected` now uses `--zelda-green`, not `--model-accent`, with the reasoning in the comment (`BankCard.svelte:134-145`); closes 5.13's missed branch |
| F12 | Target card bar | 34×84 vertical track `#e8e8e8` with a single fill (50% grey for stock, 97% `#3e9e4e` for Retro-Go), 2-up grid `max-width: 460px`, `gap: 14px` | `RomSection.svelte:851-854` renders full `BankCard`s (title + segmented bar with in-segment labels/sizes + `bank-total-label`, `BankCard.svelte:46-70`) | COSMETIC | **Yes** — `BankCard` is the sanctioned shared primitive (CLAUDE.md), so making it match this artboard's stripped-down target card means either a new variant or amending the artboard. | **BLOCKED** — `RomSection.svelte:851-854` still renders full `BankCard`s; needs a stripped variant or an artboard amendment **RE-STATUSED 2026-09-08** (`docs/BLOCKED-AUDIT.md`): Q6 — the stripped target-card bar. |
| F13 | Footer bar | `border-top: 1px solid #d8d8d8; background:#ffffff; padding: 0 40px; min-height: 72px; space-between` (`:148`) | `FirmwareRail.svelte:224-236` `.panefoot` — every value matches, artboard cited at `:221-223` | — | No — confirms 5.1 FIXED. | **CONFIRMED** — footer bar unchanged and still matches |
| F14 | Footer summary | `Writes 248 KB to bank 2 · stock firmware kept` (`:149`), 13px `#5c5c5c` | `firmwareSetup.ts:185-186` `Writes ${size} to bank ${bank}${dualBoot ? " · stock firmware kept" : ""}` (with `:183-184` citing `Firmware.dc.html:149`); `.sum` 13px `--ink-soft` at `FirmwareRail.svelte:237-240` | — | No — copy character-identical, size runtime. | **CONFIRMED** — footer summary unchanged |
| F15 | `Advanced layout` affordance | 14px/500 `#5c5c5c` plain text left of the button (`:151`) | `firmwareSetup.ts:182` `layoutAdvancedToggle: "Advanced layout"`; `RomSection.svelte:947-949` `<button class="footlink">` | — | No — copy identical. (Note 5.1's status block lists this Install-pane bar as one of the two parts *not* adopted; it has since been adopted — I disagree with that line and record it here.) | **CONFIRMED** — `Advanced layout` unchanged (`firmwareSetup.ts:182`, `RomSection.svelte:947`) |
| F16 | Split primary button | `Flash Retro-Go` + a caret cell divided by `1px rgba(255,255,255,0.28)`, one shared `inset 0 -2px 0 #9e2a20` (`:152-159`) | `RomSection.svelte:951-963` `<SplitButton label={flashButtonLabel} …>`; `firmwareSetup.ts:128` `flashRetroGo: "Flash Retro-Go"` | — | No — copy identical; the caret's divider paint not verified line-by-line inside `SplitButton.svelte`. | **FIXED** (`ad92c77`) — `.action .caret { border-left: 1px solid rgba(255, 255, 255, 0.28) }` (`SplitButton.svelte:96-99`), the artboard’s light rule |
| F17 | Nothing else in the pane body | The artboard's Install pane is exactly: head, Version, two checkboxes, Target, footer | `RomSection.svelte:858-872` (three `.notice` paragraphs), `:966-974` (the `.well` mono geometry dump), `:978-988` (`Start bank N` SplitButton), `:990-992` (`Read back superblock (debug)`) | EXTRA | **Yes** — the mono `.well`, `Start bank N` and the superblock-debug link are developer surfaces with no artboard; the owner has to say whether they ship, hide behind a dev flag, or get drawn. | **CONFIRMED** — the `.well` dump, `Start bank N` and the superblock-debug link all still ship (`RomSection.svelte:967`, `:982`, `:991`) **RE-STATUSED 2026-09-08** (`docs/BLOCKED-AUDIT.md`): settled by *nothing is cut merely for not appearing in a mockup*. Moving the superblock-debug link behind Advanced remains a sensible follow-up, but it is work, not a decision. |
| F18 | Layout-override drawer | Not drawn | `RomSection.svelte:876-931` (`FrogFS offset`, `LittleFS size`, geometry bar) — reached only via F15's toggle | EXTRA | No — the artboard names the `Advanced layout` affordance but does not draw its opened state; this is a missing artboard, not a defect. | **CONFIRMED** (2026-09-08, missing-states pass) — no longer a missing artboard. `FirmwareLayout.dc.html` draws the opened drawer, from this component; walked in the `FirmwareLayout` section below. The row is closed by producing the drawing, not by changing code. |

---

### Owner decisions (Guided/Firmware group)

- **GL1 — chooser heading conflict.** `GuidedLayout.dc.html` says `How Do You Want the Device Set Up?`; `GuidedLayoutStock.dc.html` says `What Do You Want on the Device?` (shipped). One control, two artboards.
- **GL2 — Guided column placement.** Older `Guided.dc.html:75` is top-anchored 64px; the newer four-tab Guided artboards vertically centre the 470px column. Separately, the app currently applies *both* 64px paddings (128px total), which is wrong under either reading.
- **GL3 — chooser card label alignment.** `GuidedLayout` centres the label across the card; `GuidedLayoutStock` does not. Shipped code follows the latter.
- **GF5 — hazard lip on the progress modal.** `GuidedFlashing.dc.html:136` gives the modal a 5px crawling hazard lip; `ModalShell` has one static 3px gold lip and **8.9** explicitly forbids growing it to avoid layout shift. Shell variant, or amend the artboard?
- **GF6 — "Working" copy.** Artboard `Working. do not unplug your device.` vs shipped `Working — do not unplug your device.` A seven-file i18n edit for a punctuation change; confirm it is wanted. (The missing `#8a6508` on the bold run is a plain fix, no decision needed.)
- **GR9 — pending steps carrying live controls.** `GuidedRetroGoOnly`/`GuidedSkipBackup` draw pending steps as inert dimmed titles; the app renders an always-enabled `Add Sources` button and a disabled `Continue to Manage ROMs →` on them.
- **GSO2 — Restore button label.** Artboard `Restore`; the app reuses the step title `Restore Original Firmware`. Needs a new i18n key across seven files.
- ~~**F1 — mode-switch label.**~~ **Withdrawn 2026-09-08 — no owner decision here any more.** The boards say `Guided`; `firmwareSetup.ts:19-20` already says `Guided` / `Advanced` (`30bb7d6`). The switch's *type* — the half this bullet deferred to 8.5 — is now measured as **F1a**: **8.5's block is withdrawn** (24 boards draw the switch), and what is left is one token, `--ink-mute` where the board draws `--ink-soft`. That is a fix, not a question.
- **F5 / F7 — Install-pane copy.** `Version` vs shipped `Install version`; `Keep installed games` / `Keep saves and settings` vs shipped `Migrate games` / `Migrate saves and settings`. The second pair is a meaning change, not a wording nit.
- **F9 — missing `Target` label.** New i18n key needed; no existing string covers it.
- **F10 — bank target captions.** Artboard puts `Replaces stock` / `Dual boot` inside each card; the app has one composed sentence below both. Retiring `bankTargetCaption` for two new keys is a copy decision.
- **F12 — `BankCard` vs the artboard's target card.** `BankCard` is the sanctioned shared primitive; matching `Firmware.dc.html:122-141` needs a stripped variant or an artboard amendment.
- **F17 — unbacked developer surfaces in the Install pane** (`.well` geometry dump, `Start bank N`, `Read back superblock (debug)`). Ship, gate, or draw?

Also carried, not re-counted: **3.9 OPEN** (per-step descriptions), **S6.12 OPEN** (the `Back` link, the ellipsis `Skip…`, the floor-note), **8.9 DELIBERATE** (3px lip). **8.5** (mode-switch type) is **no longer BLOCKED as of 2026-09-08** and is no longer carried as a decision: 24 boards draw the switch, so it is measurable, and it is now row **F1a — OPEN** on one token. It needs a fix, not a ruling.

**Could not be determined statically:** GR7 (the `action` button variant's exact padding/radius vs `9px 22px` / `5px`), F16's split-button divider paint inside `SplitButton.svelte`, and every question of whether the 470px Guided column and the 720px Install pane actually land where the artboards put them once rendered — nothing here was opened in a browser.
## FileBrowser

Implemented by `apps/web/src/lib/advanced/FileBrowserSection.svelte`, with the rail, page title/subtitle and footer bar supplied by `apps/web/src/lib/advanced/FirmwareRail.svelte` (title/subtitle at `FirmwareRail.svelte:60-61`, footer at `:135-140`). Copy lives in `apps/web/src/lib/i18n/strings/firmwareSetup.ts:321-334`.

| # | Element | Artboard specifies | Implementation (`file:line`) | Severity | Owner decision? | Status (2026-09-07) |
|---|---|---|---|---|---| --- |
| FB-1 | Internal-flash bar | `FileBrowser.dc.html:64` renders TWO bars; the first is `Internal flash` + `bank 1 · bank 2` / `2 × 256 KB` with segments `Bank 1 · stock` and `Bank 2 · Retro-Go` | Only one `<GeometryBar>` is rendered, and it is the extflash one — `FileBrowserSection.svelte:124` `<GeometryBar segments={segments} onClick={handleFsClick} />`, `segments` = `extflashSegments(...)` at `:15`. No `intflashSegments` import exists in the file. | MISSING | no | **FIXED** (`0b19acd`) — the internal-flash bar is drawn (`FileBrowserSection.svelte:150-158`) |
| FB-2 | Bar head row | `FileBrowser.dc.html:64`: each bar carries `External flash` + mono `bank 0` left and mono `64 MB` right | The single bar is passed no `title`, `note` or `sizeLabel` (`FileBrowserSection.svelte:124`), so `GeometryBar.svelte:34` `headed` is false and the whole head row is skipped. Dump/Write/Erase all pass `INT_BAR_NOTE`/`EXT_BAR_NOTE`/`extBarSize`; File browser alone does not. | MISSING | no | **FIXED** (`0b19acd`) — both bars now pass `title`/`note`/`sizeLabel` (`FileBrowserSection.svelte:151-163`) |
| FB-3 | "Click a partition" hint | The pane subtitle is `Pick a partition above to read its contents.` (`FileBrowser.dc.html:63`) | Present and character-identical: `firmwareSetup.ts:322` `intro: "Pick a partition above to read its contents."`, rendered via `FirmwareRail.svelte:61`. | — (no delta) | no | **CONFIRMED** — unchanged (`firmwareSetup.ts:322`) |
| FB-4 | Partition caption above the list | `FileBrowser.dc.html:66`: an 11px/700/`0.11em` uppercase label `LittleFS · 0x90370000` on the page ground, with `reading over SWD · 62%` right-aligned opposite it | `FileBrowserSection.svelte:190,201` render `<h3>{locale.t.fileBrowserSection.frogfsTitle}</h3>` / `littlefsTitle` — 1.1rem, non-uppercase (`:236-240`), inside the white surface, with no address suffix and no right-hand status. | WRONG | no | **FIXED** (`5442258`; the stale board citation at `FileBrowserSection.svelte:16` re-pointed in `0763892`) — re-verified against the code. `captionTitle` (`:31-37`) is the partition's human name with its filesystem in parentheses — `Emulators, saves (LittleFS)` (`firmwareSetup.ts:330`) — and `captionAddr` with its `hex8`/`BANK_BASE` imports is gone, so the address the corrected board deleted is gone from the code too. It renders as `.cap` (`:316-322`), 11px/700/`0.11em` uppercase on the page ground, inside `.caprow` (`:309-315`) with the read status right-aligned opposite it (`:243-250`). Reopened by `cadf918`; closed by `5442258` without the survey being updated behind it. |
| FB-5 | Read-progress bar | `FileBrowser.dc.html:68` a `height: 4px; border-radius: 2px` track on `#e8e8e8` with a `#3e9e4e` fill at the read percentage | No progress element. The read state is a paragraph: `FileBrowserSection.svelte:203` `{locale.t.fileBrowserSection.readingLittlefs(...)}` = `"Reading LittleFS partition over SWD (${pct}%)..."` (`firmwareSetup.ts:327`). | MISSING | no | **FIXED** (`0b19acd`) — the 4px read-progress track was added |
| FB-6 | Read-status copy | `FileBrowser.dc.html:67` `reading over SWD · 62%` | `firmwareSetup.ts:327` `Reading LittleFS partition over SWD (62%)...` — different wording, and it replaces the tree rather than sitting beside the caption. | WRONG | no | **FIXED** (`5442258`) — both halves. `firmwareSetup.ts:334` is now ``readingLittlefs: (pct) => `reading · ${pct}%` `` — the corrected board's wording, edited in all seven locales — and the status renders as `.capstat` (`FileBrowserSection.svelte:248`) inside `.caprow`, beside the caption, rather than in place of the tree. Reopened by `cadf918`; closed by `5442258` without the survey being updated behind it. |
| FB-7 | White list surface | `FileBrowser.dc.html:69` `background: #ffffff; border-radius: 6px; padding: 2px 16px` | `FileBrowserSection.svelte:231-235` `.fs-view { background: var(--surface); border-radius: var(--r-card); padding: 1.5rem }` — surface and radius match; padding is `24px` on all sides vs the artboard's `2px 16px`. | COSMETIC | no | **FIXED** (`0b19acd`) — list-surface padding corrected to the artboard's `2px 16px` |
| FB-8 | Row indent ladder | `FileBrowser.dc.html:69` rows are `padding: 8px 0 8px 12px` (depth 1), `…32px` (depth 2), `…52px` (depth 3) — a 12px base plus 20px per level | `FileBrowserSection.svelte:241-248`: nested `ul` is `padding-left: 1.25rem` (20px/level, correct) but `.tree > ul { padding-left: 0 }` drops the artboard's 12px base indent. | COSMETIC | no | **FIXED** (`0b19acd`) — the 12px base indent was restored on the row ladder |
| FB-9 | Footer bar | `FileBrowser.dc.html:72`: 72px bar, `Click a file to download it from the device.` left, `Re-read partition` right | The bar **never renders**. `PaneFooter` is used with a `summary` and no children (`FileBrowserSection.svelte:220`), so `paneFooter.svelte.ts:22` `content` stays `null` and `FirmwareRail.svelte:135` `{#if footer.content}` is false. The footer copy exists (`firmwareSetup.ts:333`) but is unreachable on this pane. | MISSING | no | **FIXED** (`af22d7d`) — `FirmwareRail`'s guard now renders the bar when a section declares only a summary; the actions div alone stays child-gated. This was one of the five real bugs |
| FB-10 | Footer action `Re-read partition` | `FileBrowser.dc.html:72` right-hand action `Re-read partition` | Not implemented; already recorded in `docs/audit-ui-conformance.md:937` (5.1's status block) as deliberately not adopted because "no such handler exists — wiring one is new device-touching behaviour". | MISSING | **yes** — needs an owner decision on adding a re-read handler (already flagged in 5.1) | **CONFIRMED** — still not implemented; needs a new device-touching re-read handler (also 5.1) **RE-STATUSED 2026-09-08** (`docs/BLOCKED-AUDIT.md`): not a decision. `Re-read partition` is unbuilt work needing a device-touching re-read handler, and hardware-dependent work is the owner's own track — it must not be raised as a question. |
| FB-11 | Duplicate footer declaration | one bar per screen (README: "One footer bar on every screen") | `FileBrowserSection.svelte:217` declares a second `<PaneFooter summary=…>` inside the `{:else if selectedFs}` branch, in addition to `:220`. Both write the same shared slot; the inner one is redundant (and `:218`'s `</div>` is mis-indented). | EXTRA | no | **FIXED** (`af22d7d`) — the duplicate `PaneFooter` and its stray `</div>` were dropped |
| FB-12 | Recovery-mode gate | No artboard shows a gate on this pane | `FirmwareRail.svelte:120-126` renders a bare `Enter Recovery Mode` button in place of the whole pane when `!device.utilLoaded`, plus an `aria-disabled` dimming wrapper for non-Retro-Go devices (`:36`, `:120`). | EXTRA | **yes** — no artboard exists for the un-booted/gated state | **CONFIRMED** — the recovery gate still replaces the pane (`FirmwareRail.svelte:120-126`); no artboard **RE-STATUSED 2026-09-08** (`docs/BLOCKED-AUDIT.md`): settled by *nothing is cut merely for not appearing in a mockup*. |
| FB-13 | Footer summary with LittleFS selected and Recovery Mode off | No artboard draws this state: `FileBrowser.dc.html:87` draws the LittleFS footer only for the case where the rows are downloadable | `FileBrowserSection.svelte:123-129` shows `footerSummary` (`Click a file to download it from the device.`, `firmwareSetup.ts:340`) for the whole LittleFS selection, but `canDownload` also requires `device.utilLoaded` (`:116`). With Recovery Mode off every file renders as the inert `.row file` div (`:224-233`) and the footer instructs the user to click something that is not clickable. The rows carry a `downloadNeedsRecovery` tooltip (`:228`); the footer never says it. | WRONG (copy) | **yes** — the owner's wording, or a ruling that the row tooltip is enough | **OPEN** — recorded 2026-09-08 while closing FBF-7, which is the same false instruction on the other selection. Reported, not written: a third summary string is new copy in seven locales and no board supplies it. |
| FB-14 | Footer summary with no partition selected | Not drawn — `FileBrowser.dc.html` and `FileBrowserFrogfs.dc.html` both draw the pane with a selection made | `FileBrowserSection.svelte:123-129` returns `undefined` when `selectedFs` is `null`, so the 72px bar renders with an empty summary slot. The bar itself still renders (FB-9), and the pane head's subtitle carries `intro` (`Pick a partition above to read its contents.`, `firmwareSetup.ts:327`, via `FirmwareRail.svelte:61`), so the instruction is on screen — just not in the footer. | — (no artboard claim) | **yes** — a fourth string, or a ruling that an empty slot is right | **OPEN** — recorded 2026-09-08 while closing FBF-7. The empty slot is deliberate and the code says so (`:118-122`: with no selection neither board draws a footer line, so none is invented), but it is an undrawn state that no row covered. |

## FileBrowserFrogfs

**Walked 2026-09-08 (missing-states pass).** The board was in the README index from the day it landed but had no rows in either survey, and `docs/CONFORMANCE.md`'s inventory sentence did not count it. Implemented by the same file as `FileBrowser` — `apps/web/src/lib/advanced/FileBrowserSection.svelte` — which renders either the FrogFS or the LittleFS state from one `selectedFs`; the rail, pane head and footer bar come from `FirmwareRail.svelte`. Copy: `firmwareSetup.ts:326-341`.

Rows that are the same on both boards (rail, pane head, bar chrome, segment names and colours) are governed by the FB and X rows and are not re-walked here; only what this board draws *differently* from `FileBrowser.dc.html`, plus what only appears when FrogFS is the selection.

| # | Element | Artboard specifies | Implementation (`file:line`) | Severity | Owner decision? | Status (2026-09-08) |
|---|---|---|---|---|---| --- |
| FBF-1 | Selected-segment ring | `FileBrowserFrogfs.dc.html:81` rings the selected FrogFS segment in `#1b1b1b` — `background: #3e9e4e; box-shadow: inset 0 0 0 2px #1b1b1b` | `GeometryBar.svelte:199-201` `.gseg.sel { box-shadow: inset 0 0 0 2px var(--zelda-green) }`, drawn over `.frogfs`'s own `--seg-games` green (`:220`) — a green ring on a green fill, invisible. | WRONG | no | **FIXED** — and it bears directly on the nineteenth question in `docs/BLOCKED-AUDIT.md`, whose premise is quoted in the code at `GeometryBar.svelte:194-196`: *"every board that draws this ring draws it over a NEUTRAL fill and none over the green"*. **That premise is wrong.** This board draws exactly that case, and answers it with `#1b1b1b`. Reported, not applied — the same board's sibling `FileBrowser.dc.html:81` rings its selection `#3e9e4e`, so the pair specifies two ring colours and someone has to say whether the ring follows the fill or is one colour. **Narrowly fixed 2026-09-08:** `.gseg.sel.frogfs`/`.frogfs-changed` now ring in `--ink` (`tokens.css:10` = the board's `#1b1b1b`, with a dark-theme flip to `#ececec` at `:256`/`:295`, so it is not the hard-`#1b1b1b`-invisible-in-dark defect class). Scoped to the green-fill case ONLY — the one thing both boards agree on, since `FileBrowser.dc.html:81` keeps its green ring over a GREY fill; every other segment's ring is byte-identical. The global "ring follows the fill or is one colour" question, and the same collision on `.bank` under `[data-model="zelda"]`, both remain with the owner as BLOCKED-AUDIT #19. |
| FBF-2 | Partition caption | `Games, homebrew (FrogFS)`, 11px/700/`0.11em` uppercase on the page ground (`:83`) | Character-identical: `firmwareSetup.ts:328` via `captionTitle` (`FileBrowserSection.svelte:31-37`), `.cap` at `:303-308`. | — (no delta) | no | **CONFIRMED** |
| FBF-3 | No read status, no progress track | The board draws neither, unlike `FileBrowser.dc.html:83-84` | Both are gated on `selectedFs === "littlefs" && lfsLoading` (`FileBrowserSection.svelte:235`, `:240`), so the FrogFS state renders neither. The FrogFS tree is already in `device.installedFrogfs` from the scan; nothing is read here. | — (no delta) | no | **CONFIRMED** |
| FBF-4 | No download affordance on FrogFS rows | No row carries the green download arrow the LittleFS board puts after every file size (`:84` vs `FileBrowser.dc.html:85`) | `canDownload` is `selectedFs === "littlefs" && device.utilLoaded` (`FileBrowserSection.svelte:116`), so FrogFS files take the inert `.row file` branch (`:213-220`) — no button, no arrow. | — (no delta) | no | **CONFIRMED** |
| FBF-5 | Row ladder | folders at `padding: 8px 0 8px 12px`, their files at `…32px` (`:84`) — the same 12px base plus 20px per level as FB-8 | `.tree > ul { padding-left: 12px }` (`FileBrowserSection.svelte:338-340`) plus `1.25rem` per nested level (`:332-337`). | — (no delta) | no | **CONFIRMED** |
| FBF-6 | File sizes | mono 12px `#5c5c5c`, right of the name (`:84`) | `{kb(node.size ?? 0)} KB` (`FileBrowserSection.svelte:219`), `.size` mono `--fs-micro` `--ink-soft` (`:392-396`). | — (no delta) | no | **CONFIRMED** |
| FBF-7 | Footer summary | `Read from the device. Download is available on LittleFS only.` (`:87`) — this board and `FileBrowser.dc.html:72` give the pane **two different summaries**, one per selection | One static string for both: `firmwareSetup.ts:340` `footerSummary: "Click a file to download it from the device."`, passed unconditionally at `FileBrowserSection.svelte:273`. On the FrogFS selection the app tells the user to click a file that is not clickable. | WRONG | no | **FIXED** (`347ef5b`) — verified against the code, not the commit message: `FileBrowserSection.svelte:123-129` derives the summary from `selectedFs` — `footerSummary` on LittleFS, the new `footerSummaryFrogfs` on FrogFS (`firmwareSetup.ts:341`), which carries a real translation in all seven locale files. The board's sentence is character-identical. The same false instruction survives in a case no board draws — LittleFS with Recovery Mode off — and is recorded as its own row, **FB-13**. |
| FBF-8 | Footer action `Re-read partition` | `:87`, same as `FileBrowser.dc.html:88` | Not implemented — see FB-10. Re-reading FrogFS is a device-touching handler that does not exist. | MISSING | no | **CONFIRMED** — the FB-10 row governs; hardware-dependent work is the owner's own track and must not be raised as a question. |
| FBF-9 | Empty-tree fallback | The board draws a populated tree only | `FileBrowserSection.svelte:251` falls back to `noFrogfsFiles` (`firmwareSetup.ts:332`) when the scan found no FrogFS files. | EXTRA | no | **CONFIRMED** — settled by *nothing is cut merely for not appearing in a mockup*. |
| FBF-10 | Segment names and colours | `FrogFS` / `LittleFS` / `Free`, green and grey (`:81`) | Same conflict this board shares with every other Flash-management board: names at X-4 (`Games` / `Emulators & Saves` / `Free Space`), colours at X-5 (now `--seg-games` / `--seg-saves`, the artboard's green and grey). | — (no new delta) | no | **CONFIRMED** — governed by X-4 and X-5; recorded so this board is not re-walked for them. |

## FirmwareLayout

**Drawn and walked 2026-09-08 (missing-states pass).** This board did not exist when F18 was written; F18's whole finding was *"the artboard names the `Advanced layout` affordance but does not draw its opened state"*. The board now draws it, from the shipping component — `apps/web/src/lib/advanced/RomSection.svelte:876-931`, inside the `Firmware.dc.html` pane, everything else on the frame unchanged from that board.

Every row below therefore conforms by construction; they are recorded so the state is measurable next time rather than to claim progress. Two measurements had to be taken from the component because no board carries them, and are called out as such.

| # | Element | Artboard specifies | Implementation (`file:line`) | Severity | Owner decision? | Status (2026-09-08) |
|---|---|---|---|---|---| --- |
| FL-1 | Drawer container | `1px solid #d8d8d8`, `border-radius: 2px`, body `padding: 10px; gap: 10px` (`FirmwareLayout.dc.html:149-150`) | `.sub` / `.sub-body` (`RomSection.svelte`) — `1px solid var(--hairline)`, `var(--r-control)`, `padding: 0.6rem`, `gap: 0.6rem`. Taken **from the component**; no prior board draws this container. | — (no delta) | no | **CONFIRMED** |
| FL-2 | `FrogFS offset` field | label `FrogFS offset` 14px with a 12px `#5c5c5c` hint `(bytes from 0x90000000; reserves the bottom)`, mono input showing the placeholder `auto (0x90370000)` (`:152-155`) | `firmwareSetup.ts:190-192` (`frogfsOffsetLabel`, `offsetHint`, `autoPlaceholder`), `RomSection.svelte:889-896`. In SD mode the same slot takes `sdCacheOffsetLabel`; the board draws the flash case, which is the pane `Firmware.dc.html` draws. | — (no delta) | no | **CONFIRMED** |
| FL-3 | `LittleFS size` field | label + 12px hint `(≥8 MB)`, a narrow right-aligned mono input on `8` with a `MB` suffix outside the box (`:157-162`) | `firmwareSetup.ts:193-196`, `RomSection.svelte:898-909`; `.unit-input input { width: 4.5ch; text-align: right }` and a separate `.unit` span — the suffix is text beside the control, **not** `RangeField`'s bordered unit picker. Field width taken from the component. | — (no delta) | no | **CONFIRMED** |
| FL-4 | Field visibility | Both fields drawn | `RomSection.svelte:897` hides `LittleFS size` and the defaults note on an SD install; only the offset field is common. Consistent with the board's flash-install device. | — | no | **CONFIRMED** |
| FL-5 | Defaults note | 14px `#5c5c5c`: `Default: FrogFS offset automatically reserves the bottom based on device layout. Both round up to the 4096 B erase block.` (`:165`) | `firmwareSetup.ts:197-198` `layoutDefaultsNote(blockSize)`; the `4096` is the device's real erase block at runtime, drawn here as the usual value. | — (no delta) | no | **CONFIRMED** — flagged as copy: *"Default: FrogFS offset automatically reserves the bottom"* names the field twice and reads awkwardly; `Both` then refers to two fields, one of which is hidden in SD mode. |
| FL-6 | Device geometry bar | 12px mono caption `external flash`, a 34px/3px bar, `0x90000000` / `0x94000000` mono legend under it (`:168-177`) | `RomSection.svelte:928-936` — `GeometryBar size="tall"`, `title={locale.t.shared.geometry.externalFlash}` with no `note`/`sizeLabel`, so `GeometryBar.svelte:63` renders the `.gtitle` mono caption rather than the headed row the Flash-management boards use, plus the `leftLabel`/`rightLabel` legend. Taken from the component. | — (no delta) | no | **CONFIRMED** — the bar is headed differently here than on Write/Dump/Erase/FileBrowser, deliberately: this one has no capacity to state, only a span. |
| FL-7 | Reserved detail strip | 18px of empty space below the legend (`:177`) | `GeometryBar.svelte:297-306` `.gdetail { min-height: 1.1rem; opacity: 0 }` — reserved so hovering a segment does not shift the drawer. Recorded by X-7, which keeps the strip. | — (no delta) | no | **CONFIRMED** — governed by X-7. |
| FL-8 | Not drawn: the scanning and scan-failed states | The board draws the scanned case only | `RomSection.svelte:919-926` also renders a scan progress track, a `scan failed:` line and a dimmed `Scan the device to see its current flash layout.` placeholder. | EXTRA | no | **CONFIRMED** — settled by *nothing is cut merely for not appearing in a mockup*; a third and fourth board for two transient strings would not earn their place. |
| FL-9 | Footer while the drawer is open | The footer is unchanged from `Firmware.dc.html:148-159` (drawn at `FirmwareLayout.dc.html:186-199`) — same summary, same `Advanced layout` text, same split button | `RomSection.svelte:946-949` gives the toggle `aria-expanded` but no open-state paint, so the two states are visually identical in the footer. | — (no delta) | no | **CONFIRMED** — recorded, not proposed: a disclosure with no visible open marker is worth a look, but changing it is design, not documentation. |
## Write

Implemented by `apps/web/src/lib/advanced/FlashSection.svelte` (+ `RangeField.svelte`, `PaneFooter.svelte`, `FirmwareRail.svelte`). Copy: `firmwareSetup.ts:248-284`.

| # | Element | Artboard specifies | Implementation (`file:line`) | Severity | Owner decision? | Status (2026-09-07) |
|---|---|---|---|---|---| --- |
| W-1 | Title / subtitle | `Write image` / `Write a raw .bin to a bank at an offset.` (`Write.dc.html:79`) | Character-identical: `firmwareSetup.ts:342` `railWriteImage: "Write image"`, `:251` `intro`, rendered at `FirmwareRail.svelte:63`. | — (no delta) | no | **CONFIRMED** — unchanged |
| W-2 | Field row position/shape | `Write.dc.html:82-85`: `Image file` (flex 1.6) and `Start` (flex 1.4) sit side by side in one `align-items: flex-end` row, **below** the bars and the hint | The image field is rendered **above** the bars (`FlashSection.svelte:129-132`) and `Start` is alone in a `.grid` with `max-width: 16rem` (`:159-161`, `:227-232`). The two never share a row. | WRONG | no | **FIXED** (`94df21a`) — `Image file` and `Start` now share one bottom-aligned row below the bars |
| W-3 | Image-file control | `Write.dc.html:82` a 40px bordered field (`#ffffff`, `1px solid #d8d8d8`, `border-radius: 2px`) showing the filename in mono | `FlashSection.svelte:130` uses `FilePick`, a silver-capped button + grey caption (`FilePick.svelte:40-56`), with the chosen name repeated on a separate `.meta mono` line at `:131`. *(As surveyed; `ui/FilePick.svelte` was deleted unreferenced in `863290c` and no longer exists.)* | WRONG | **yes** — a native `<input type="file">` cannot be styled into the artboard's field without a wrapper; same class of decision as audit 3.12 | **FIXED** — unchanged; a native file input cannot become the artboard's field without a wrapper (same call as 3.12) **RE-STATUSED 2026-09-08** (`docs/BLOCKED-AUDIT.md`): stale row. `FlashSection.svelte:190-201` and `:413-424` now render the artboard's 40px `.filefield` (white, `1px solid var(--hairline)`, `--r-control`) with the native input visually hidden inside it (`0bfd2db`). |
| W-4 | Bar hint | `Click a partition to fill the destination, or type one in.` (`Write.dc.html:81`) | Character-identical, `firmwareSetup.ts:256`, rendered `FlashSection.svelte:157`. | — (no delta) | no | **CONFIRMED** — unchanged |
| W-5 | Size caption under the fields | `Write.dc.html:86-87`: a mono `12px #5c5c5c` line `248 KB → pads to 0x40000 · 256 KB erase-aligned` sitting directly under the field row | No such standalone caption. The nearest text is inside the sunken well: `FlashSection.svelte:191` → `firmwareSetup.ts:269` `${size} B → padded ${padded} B (${paddedHex})`. The artboard's `erase-aligned` clause has no counterpart anywhere in `flashSectionEn`. | WRONG | no | **FIXED** (`94df21a`) — the pad readout is now the artboard's standalone mono caption |
| W-6 | Option checkboxes are visible | `Write.dc.html:88-91` shows both checkboxes inline on the page, no disclosure | `FlashSection.svelte:163-180` hides them behind a `Transfer options` disclosure toggle (`:165-167`, copy at `firmwareSetup.ts:259`), on a `--surface-sunk` bar (`:266-277`). The toggle itself appears in no artboard. | WRONG / EXTRA | no | **FIXED** (`94df21a`) — both options are out of the disclosure and on the page ground |
| W-7 | Checkbox copy | `Compress transfer` and `Verify after write` (`Write.dc.html:89-90`) | `firmwareSetup.ts:260` `LZMA compress`, `:262` `Verify writes`, each with an extra parenthetical hint (`:261`, `:263`) the artboard does not show. | WRONG | no | **FIXED** (`94df21a`) — the artboard's `Compress transfer` / `Verify after write` copy landed in all seven locales |
| W-8 | Checkbox default states | `Write.dc.html:89` Compress is checked (green tick); `:90` Verify is **unchecked** and its label is `#5c5c5c` | `FlashSection.svelte:25-26` `compress = true` (matches) but `verify = true` (artboard: off). Note CLAUDE.md's flash-verify-overhead entry argues against per-chunk read-back verify by default. | WRONG | **yes** — flipping a write-path default is a behaviour change, not a paint change | **BLOCKED** — deliberately untouched by `94df21a`; flipping the `verify` default is a write-path behaviour change **RE-STATUSED 2026-09-08** (`docs/BLOCKED-AUDIT.md`): Q7(a) — the `Verify after write` default. |
| W-9 | Plan block surface | `Write.dc.html:92-93`: white surface (`#ffffff`, `border-radius: 6px`, `padding: 18px 20px`) with an uppercase 11px/700 `Plan` caption | `FlashSection.svelte:188-195` is `<div class="well mono">`, `background: var(--surface-sunk)`, `border-radius: 0`, `--fs-micro` (`:299-306`). No `Plan` caption element. | WRONG | no | **FIXED** (`94df21a`) — the sunken well is now the white `PLAN` block with its uppercase caption (`FlashSection.svelte:190-196`) |
| W-10 | Plan rows | `Write.dc.html:93` three label/value rows: `Writes`, `Destination`, `Overwrites` — labels `14px #5c5c5c` left, mono 600 values right | The well holds two prose sentences instead (`FlashSection.svelte:190-191` → `firmwareSetup.ts:267-269`, `Plan: bank2 (0x…) + 0x… ← file.bin`). None of the three row labels exists in `flashSectionEn`. | MISSING | no | **FIXED in part** (`94df21a`) — `Writes` and `Destination` rows landed; the third row is W-11, still **BLOCKED** |
| W-11 | `Overwrites` row | `Write.dc.html:93` names what is lost, in caution gold: `Overwrites` / `Retro-Go v1.4.1-44` in `#b8860b` — the README's "warnings say what you are about to lose" | Nothing in `FlashSection.svelte` derives or shows what currently occupies the destination. `grep -n 'Overwrites' apps/web/src/lib` → no hits. The only warnings are address-shaped: alignment (`:192`) and overrun (`:193`). | MISSING | **yes** — needs new copy and a new derivation (what occupies the target range) | **FIXED** — still nothing derives what occupies the destination; needs new copy plus a new derivation **RE-STATUSED 2026-09-08** (`docs/BLOCKED-AUDIT.md`): stale row. `FlashSection.svelte:77-110` derives what occupies the destination and `:252-253` renders the `Overwrites` row, gold on loss; `firmwareSetup.ts:274` `overwritesRow: "Overwrites"` (`0bfd2db`). |
| W-12 | Acknowledgement copy | `Write.dc.html:96` `I understand this overwrites whatever is there now.` | `firmwareSetup.ts:272` `I understand this overwrites the firmware bank; I have a backup.` | WRONG | no | **FIXED** (`94df21a`) — the acknowledgement copy now matches the artboard |
| W-13 | Acknowledgement visibility | `Write.dc.html:95-96` shows the ack for a **bank 2 / Retro-Go** destination, i.e. unconditionally | `FlashSection.svelte:197` renders it only when `needsAck && file && !lockedGuard`, and `:49` `needsAck = bank === 1` — a bank-2 write shows no ack at all, which is exactly the case the artboard draws. | WRONG | **yes** — widening the ack gate changes when a write is blocked | **BLOCKED** — deliberately untouched; widening the ack gate changes when a write is blocked **RE-STATUSED 2026-09-08** (`docs/BLOCKED-AUDIT.md`): Q7(b) — the bank-2 acknowledgement gate. |
| W-14 | Footer summary | `Writes a raw image. No patching, no layout changes.` (`Write.dc.html:98`) | Character-identical, `firmwareSetup.ts:275`, `FlashSection.svelte:204`. | — (no delta) | no | **CONFIRMED** — unchanged |
| W-15 | Footer button label | `Write image` (`Write.dc.html:98`) | `firmwareSetup.ts:273` `flashImageButton: "Flash image…"`, `FlashSection.svelte:205`. | WRONG | no | **FIXED** (`94df21a`) — the footer button now reads `Write image` |
| W-16 | Recovery-mode gate | No artboard | `FlashSection.svelte:125-126` replaces the entire pane with a bare `Enter Recovery Mode` button when the stub is not loaded. | EXTRA | **yes** — no artboard for this state | **CONFIRMED** — the recovery gate still replaces the pane (`FlashSection.svelte:125-126`); no artboard **RE-STATUSED 2026-09-08** (`docs/BLOCKED-AUDIT.md`): settled by *nothing is cut merely for not appearing in a mockup* — one of five identical recovery-gate rows (W-16, D-10, D-11, E-13, BackupPatch #6), all closed by the same ruling. |

## Dump

Implemented by `apps/web/src/lib/advanced/DumpSection.svelte` (+ `RangeField.svelte`, `PaneFooter.svelte`). Copy: `firmwareSetup.ts:217-243`.

| # | Element | Artboard specifies | Implementation (`file:line`) | Severity | Owner decision? | Status (2026-09-07) |
|---|---|---|---|---|---| --- |
| D-1 | Title / subtitle | `Dump` / `Read a region of flash to a file on your computer.` (`Dump.dc.html:79`) | Character-identical (`firmwareSetup.ts:343`, `:219`; `FirmwareRail.svelte:65`). | — (no delta) | no | **CONFIRMED** — unchanged |
| D-2 | Bar hint | `Click a partition to fill the range, or type one in.` (`Dump.dc.html:81`) | Character-identical, `firmwareSetup.ts:222`, `DumpSection.svelte:150`. | — (no delta) | no | **CONFIRMED** — unchanged |
| D-3 | Start / Size fields | `Dump.dc.html:83-84`: `Start` (flex 1.4) + `Size` (flex 1), 40px tall, each with the attached unit segment | Present and correctly proportioned: `DumpSection.svelte:152-155` in a `grid-template-columns: 1.4fr 1fr` (`:211-215`), fields from `RangeField.svelte:110-120` with the `hex`/`KB`/`MB` `<select>` (`:114-118`). Field height is content-derived (`:149` `padding: 0.35rem 0.5rem` ≈ 32px) vs the artboard's 40px. | COSMETIC | no | **FIXED** (`94df21a`) — `RangeField` gained the artboard's 40px control height |
| D-4 | Unit-picker chevron | `Dump.dc.html:83-84` draws an explicit chevron `<path d="M5 8l5 5 5-5">` in the unit segment | `RangeField.svelte:114-118` is a native `<select>`; the arrow is the UA's. Visually close but not the artboard glyph, and not verifiable without a render. | COSMETIC | no | **FIXED** (re-sorted 2026-09-07, was OPEN) — still a native `<select>` with no `appearance: none` (`advanced/RangeField.svelte:80-84`, `:123-137`). Drawing the artboard’s chevron means suppressing the native control and hand-drawing an arrow, and whether the result matches cannot be judged without a render. Needs a look at the app, not a code edit **RE-STATUSED 2026-09-08** (`docs/BLOCKED-AUDIT.md`): stale row, and the row's premise was wrong. `RangeField.svelte:133-148` sets `appearance: none` / `-webkit-appearance: none` and bakes the artboard's exact `M5 8l5 5 5-5` chevron in as a data URI, with a dark-theme sibling at `:154-160` (`84cb50e`). No render is needed to settle it. |
| D-5 | Range caption | `Dump.dc.html:86-87`: one mono `12px` line — `0x90370000 → 0x905F6000 · 2,631,680 bytes · matches LittleFS` — under the fields | Split across two lines inside a sunken well (`DumpSection.svelte:166-167` → `firmwareSetup.ts:231-232`), with a `Plan:` prefix the artboard does not have, and the `matches <partition>` annotation absent entirely (`grep -n 'matches' firmwareSetup.ts` → no hit). | WRONG | **yes** — "matches LittleFS" is new copy plus a new derivation (does the typed range equal a scanned partition?) | **FIXED** (`7965384`) — the two-line well collapsed into the artboard's single mono range caption; the `matches LittleFS` clause is deliberately left out **RE-STATUSED 2026-09-08** (`docs/BLOCKED-AUDIT.md`): stale clause. `DumpSection.svelte:185` renders `· matches <name>` via `firmwareSetup.ts:235` `matchesPartition` (`84cb50e`) — the clause is built, so this row is now FIXED in full. |
| D-6 | Plan block | `Dump.dc.html:88-89`: white surface, uppercase `Plan` caption, rows `Reads` (`2,631,680 bytes`) and `To file` (`littlefs-0x90370000.bin`) | `DumpSection.svelte:165-168` `.well` on `--surface-sunk`, `border-radius: 0` (`:239-247`), two prose sentences, no `Plan` caption, no `Reads` / `To file` labels — none of those three strings exist in `dumpSectionEn`. | MISSING | no | **FIXED** (`7965384`) — the white `PLAN` block with `Reads` / `To file` rows landed (`DumpSection.svelte:171-181`) |
| D-7 | Blank-length hint | Not in the artboard | `DumpSection.svelte:162` renders `Length blank = whole region from offset.` (`firmwareSetup.ts:230`). | EXTRA | no | **FIXED** (`7965384`) — the blank-length hint the artboard does not draw was dropped |
| D-8 | Invalid-range hint in the footer | `Dump.dc.html:90` footer holds only the summary sentence and the primary button | `DumpSection.svelte:176` puts `Enter a valid offset and length.` (`firmwareSetup.ts:238`) inside the footer bar, left of the button. | EXTRA | no | **FIXED** (`02d83be`) — the invalid-range hint left the footer: it states itself in the body beside the overrun warning (`DumpSection.svelte:187-191`), and `PaneFooter` now carries only the summary and the primary button |
| D-9 | Footer summary + button | `Reads over SWD. The device stays untouched.` / `Dump to file` (`Dump.dc.html:90`) | Both character-identical (`firmwareSetup.ts:237`, `:235`; `DumpSection.svelte:172`, `:178`). | — (no delta) | no | **CONFIRMED** — unchanged |
| D-10 | Progress / Cancel state | No artboard exists for it | `DumpSection.svelte:181-184` swaps the footer for an inline `Progress` + `Cancel` + hint. Flagged only as unbacked; audit S8.13 records that the flash-cancel design is queued and no mockup exists. | EXTRA | **yes** — blocked on the mockup S8.13 already asks for | **CONFIRMED** — unchanged; queued behind the same missing mockup as S8.13 **RE-STATUSED 2026-09-08** (`docs/BLOCKED-AUDIT.md`): settled by *nothing is cut merely for not appearing in a mockup* — same ruling as W-16/D-11/E-13/BackupPatch #6. |
| D-11 | `Enter Recovery Mode` swap | Not in the artboard | `DumpSection.svelte:174-175` replaces the primary button when dumping bank 0 without the stub (`:169` `needsRecovery`). | EXTRA | **yes** — no artboard for this state | **CONFIRMED** — unchanged; no artboard for the un-booted state **RE-STATUSED 2026-09-08** (`docs/BLOCKED-AUDIT.md`): settled by *nothing is cut merely for not appearing in a mockup*. |

## Erase

Implemented by `apps/web/src/lib/advanced/EraseSection.svelte` (+ `RangeField.svelte`, `PaneFooter.svelte`). Copy: `firmwareSetup.ts:289-315`.

| # | Element | Artboard specifies | Implementation (`file:line`) | Severity | Owner decision? | Status (2026-09-07) |
|---|---|---|---|---|---| --- |
| E-1 | Title / subtitle | `Erase` / `Select partitions to wipe. This cannot be undone.` (`Erase.dc.html:79`) | Character-identical (`firmwareSetup.ts:344`, `:292`). | — (no delta) | no | **CONFIRMED** — unchanged |
| E-2 | Bar hint | `Click partitions to select. Ctrl / Cmd for more than one.` (`Erase.dc.html:81`) | Character-identical, `firmwareSetup.ts:295`, `EraseSection.svelte:219`. | — (no delta) | no | **CONFIRMED** — unchanged |
| E-3 | Selected-segment paint | `Erase.dc.html:80`: a selected segment is **filled** destructive red — `background: #8a241b; box-shadow: inset 0 0 0 2px #8a241b` | Selection paints the generic green ring instead: `EraseSection.svelte:199,213` pass `isSelected`, and `GeometryBar.svelte:149-151` `.gseg.sel { box-shadow: inset 0 0 0 2px var(--zelda-green) }` — one shared rule for Write/Dump/Erase, with no destructive variant. | WRONG | no | **FIXED** (`02d83be`) — `GeometryBar` gained a destructive tone the Erase pane opts into: `.gbar.destructive .gseg.sel { background: var(--danger); box-shadow: inset 0 0 0 2px var(--danger) }` with white ink (`GeometryBar.svelte:163-170`), `--danger` being the artboard’s `#8a241b` (`tokens.css:41`) |
| E-4 | `Selected` caption | `Erase.dc.html:82` an 11px/700/`0.11em` uppercase label reading `Selected` (no colon) on the page ground | `EraseSection.svelte:229` renders `firmwareSetup.ts:300` `selectedTitle: "Selected:"` styled `font-weight: 600` at `--fs-body` (`:330-333`) — body-size, not uppercase, and it carries a colon. | WRONG | no | **FIXED** (`1897c22`) — `Selected` is now the artboard's uppercase caption without its colon |
| E-5 | Selected list surface | `Erase.dc.html:82` the rows sit on a white surface — `background: #ffffff; border-radius: 6px; padding: 2px 16px` — with `1px solid #ededed` row rules | `EraseSection.svelte:230-237` is a bulleted `<ul>` on the page ground with no surface and no rules (`:334-340`). The CSS comment at `:324-325` asserts the artboard shows it "bare on the page ground; no fill, no border" — that is contradicted by `Erase.dc.html:82`, so the comment is wrong as well as the paint. | WRONG | no | **FIXED** (`1897c22`) — the rows sit on the white ruled surface instead of a bullet list; the CSS comment that mis-cited the artboard went with it |
| E-6 | Selected row shape | `Erase.dc.html:82`: name 14px/600 left, mono `3,586,048 bytes at 0x90000000` right-aligned, `justify-content: space-between`, `padding: 10px 0` | `EraseSection.svelte:233-235` is `<strong>` + `<span class="muted">` inline in a list item, not a justified two-column row, and the value is parenthesised: `firmwareSetup.ts:315` `(${size} bytes at ${addr})`. | WRONG | no | **FIXED** (`1897c22`) — each row is now the drawn name / mono-value justified pair, parentheses dropped |
| E-7 | Caution line | `Erasing an internal bank wipes the OS on it — stock firmware or Retro-Go.` with `border-left: 2px solid #b8860b; padding-left: 12px` (`Erase.dc.html:83`) | Character-identical and correctly ruled: `firmwareSetup.ts:301`, `EraseSection.svelte:243`, `:341-347`. Confirms audit 5.9 FIXED. | — (no delta) | no | **FIXED** (`5442258`) — `firmwareSetup.ts:306` now reads `Erasing an internal bank wipes the OS on it, stock firmware or Retro-Go.`, the comma the corrected board draws, in all seven locales. Reopened by `cadf918`; closed by `5442258` without the survey being updated behind it. |
| E-8 | `Custom range…` affordance | `Erase.dc.html:84` right-aligned `13px`, `font-weight: 600`, `color: #5c5c5c` | Present (audit 5.9 FIXED) but painted green: `EraseSection.svelte:247-249`, `:300-309` `.linkish { color: var(--zelda-green) }` at `--fs-caption` (14px). | COSMETIC | no | **FIXED** (`1897c22`) — `Custom range…` is back to 13px/600 quiet grey |
| E-9 | Custom-range fields | Artboard shows the affordance only; no open state is drawn | `EraseSection.svelte:252-257` opens two `RangeField`s and reuses `dumpSection.offsetLabel`/`lengthLabel` for their captions. Unbacked but a reasonable extension of D-3. | EXTRA | no | **CONFIRMED** (2026-09-08, missing-states pass) — the open state now has an artboard: `EraseCustomRange.dc.html`, drawn from this component and walked in the `EraseCustomRange` section below. Closed by producing the drawing, not by changing code. |
| E-10 | Footer summary | `6.22 MB will be erased. This cannot be undone.` (`Erase.dc.html:85`) | Same shape with the size interpolated: `firmwareSetup.ts:304` `(size) => \`${size} will be erased. This cannot be undone.\``, `EraseSection.svelte:259`. | — (no delta) | no | **CONFIRMED** — unchanged |
| E-11 | Footer button label | `Erase 2 partitions…` — the count is in the label (`Erase.dc.html:85`) | `firmwareSetup.ts:302` `eraseButton: (plural) => \`Erase partition${plural ? "s" : ""}…\`` — no count. (The confirm-modal title at `:305` does carry the count.) | WRONG | no | **FIXED** (`1897c22`) — the partition count is now in the footer button label |
| E-12 | Footer button style | `border: 1.5px solid #8a241b; color: #8a241b`, no fill (`Erase.dc.html:85`) | `EraseSection.svelte:260` uses `variant="destructive"`, `Button.svelte:91-95` transparent + `--danger` border/ink. Matches. | — (no delta) | no | **CONFIRMED** — unchanged |
| E-13 | Recovery-mode gate | No artboard | `EraseSection.svelte:187-188` replaces the whole pane with a bare `Enter Recovery Mode` button. | EXTRA | **yes** — no artboard for this state | **CONFIRMED** — unchanged; no artboard for the gate **RE-STATUSED 2026-09-08** (`docs/BLOCKED-AUDIT.md`): settled by *nothing is cut merely for not appearing in a mockup*. |

## EraseCustomRange

**Drawn and walked 2026-09-08 (missing-states pass).** E-9's finding was that `Erase.dc.html` draws the `Custom range…` affordance and never its open state. The board now draws it, from `apps/web/src/lib/advanced/EraseSection.svelte:252-257` and `RangeField.svelte`, inside the `Erase.dc.html` pane with nothing else on the frame changed.

Conforms by construction; recorded so the state is measurable. Two measurements come from the component, not from a board, and say so.

| # | Element | Artboard specifies | Implementation (`file:line`) | Severity | Owner decision? | Status (2026-09-08) |
|---|---|---|---|---|---| --- |
| ECR-1 | Placement | Directly under the caution / `Custom range…` row, in the pane body's own 28px column (`EraseCustomRange.dc.html:88-93`) | `EraseSection.svelte:251-257` — the `{#if customOpen}` block is the next child of `.stack` (`gap: 28px`), after `.caution-row`. | — (no delta) | no | **CONFIRMED** |
| ECR-2 | Row shape | The two fields sit on one row, `align-items: flex-end; gap: 16px`, wrapping (`:92`) | `.custom { display: flex; align-items: flex-end; gap: 1rem; flex-wrap: wrap }` (`EraseSection.svelte`, `.custom`). Taken **from the component**; no prior board draws this row. | — (no delta) | no | **CONFIRMED** |
| ECR-3 | Field captions | `Start` and `Size` (`:92-93`) | `EraseSection.svelte:253-254` passes `locale.t.dumpSection.offsetLabel` / `lengthLabel` — `firmwareSetup.ts:225`, `:227`, both literally `Start` / `Size`. | — (no delta) | no | **CONFIRMED** — but recorded: Erase borrows Dump's keys rather than owning its own. Harmless while both read `Start` / `Size`; it means a future edit to Dump's captions silently moves Erase's too. |
| ECR-4 | Field paint | 13px/500 `#5c5c5c` caption 8px above a 40px `1px #d8d8d8` / 2px-radius control, mono value area, a `1px #d8d8d8` divider then the unit word 13px/600 with an 11px chevron — the same control `Dump.dc.html:84-85` draws | `RangeField.svelte` `.field` / `.control` / `select`, each citing `Write.dc.html:85` / `Dump.dc.html:84-85` in its own comment. | — (no delta) | no | **CONFIRMED** — governed by D-3 / W-3; the board reuses that vocabulary rather than inventing one. |
| ECR-5 | Field width | 260px each, not stretched (`:92-93`) | `RangeField` sets `min-width: 0` and no flex-grow, and `.custom` does not grow its children, so each field is its input's intrinsic width. **The 260px is an approximation of that intrinsic width, taken from the component, not a value any board or stylesheet states.** | — | no | **CONFIRMED** — the one number on this board that is drawn rather than measured; noted so it is not later quoted as a spec. |
| ECR-6 | Initial values | Both fields empty, unit `hex` (`:92-93`) | `customStart` / `customSize` start `""` and `RangeField`'s `unit` starts `"hex"`. Clicking a partition bar writes into these fields (README: *"the flash bars are a shortcut that writes into the range fields"*), which is why the board draws the just-opened state rather than a filled one. | — (no delta) | no | **CONFIRMED** |
| ECR-7 | Footer while open | Unchanged from `Erase.dc.html:85` — same summary, same destructive button | `EraseSection.svelte:259-261`; the footer reads `selection`, which a custom range does not populate, so opening the drawer changes neither the summary nor the button state. | — (no delta) | no | **CONFIRMED** — recorded, not proposed: with only a custom range typed in, the footer still says `Erase partitions…` and stays disabled, which is worth a look but is behaviour, not paint. |

## Cross-cutting (all four Flash-management artboards)

Same markup in `FileBrowser.dc.html:64`, `Write.dc.html:80`, `Dump.dc.html:80`, `Erase.dc.html:80`.

| # | Element | Artboard specifies | Implementation (`file:line`) | Severity | Owner decision? | Status (2026-09-07) |
|---|---|---|---|---|---| --- |
| X-1 | Bar height / radius / track | `height: 34px; border-radius: 3px; background: #e8e8e8`, no border | `GeometryBar.svelte:121-129` `.gbar { height: 1.4rem` (22.4px) `; border-radius: 4px; border: 1px solid var(--surface-sunk) }`. Quoted as "34px bars" in audit 5.3, which was closed on the `<select>`/click-to-fill grounds only — the geometry was never addressed. | COSMETIC | no | **FIXED** (re-sorted 2026-09-07, was OPEN) — an artboard-versus-artboard conflict, not a defect: Write/Dump/Erase/FileBrowser say `34px`/`3px`, `Main.dc.html` (A34) says `10px`/`5px`, and two further call sites — `InstallGeometry` and `RomSection` — have no artboard at all. Closing it needs a size prop **and** a ruling for the unbacked call sites **RE-STATUSED 2026-09-08** (`docs/BLOCKED-AUDIT.md`): stale row. `GeometryBar` gained `default`/`tall`/`slim` variants (`:33-38`, `:138-158`), and ALL thirteen call sites now pass an explicit size — including the two the row calls unbacked: `InstallGeometry.svelte:158` and `RomSection.svelte:928-932` both take `tall`, with the reasoning recorded in the prop's own doc comment. Nothing is left to arbitrate. |
| X-2 | Segment divider | `border-left: 2px solid #f4f4f4` — the page ground cutting through the bar, and only between segments | `GeometryBar.svelte:137` `border-right: 1px solid rgba(0, 0, 0, 0.18)` on every segment including the last. | COSMETIC | no | **FIXED** (`02d83be`) — `.gseg:not(:last-child) { border-right: 2px solid var(--bg) }` (`GeometryBar.svelte:143-148`): the page ground, 2px, and only between segments |
| X-3 | Internal-bar segmentation | Two segments only, one per bank, each 50%, labelled `Bank 1 · stock` / `Bank 2 · Retro-Go` | `classify.ts:210-212` emits up to FOUR segments (a used slice + a free slice per bank), and the used slice's label is the raw `b.type` string with no `Bank N · ` prefix. The README's "Bank 1 and bank 2 are divided" is satisfied structurally, but the artboard's labels are not produced. | WRONG | **yes** — restoring the artboard labels means dropping the used/free split inside a bank, which is real information the artboard omits | **BLOCKED** — unchanged; adopting the artboard's two segments drops the used/free split **RE-STATUSED 2026-09-08** (`docs/BLOCKED-AUDIT.md`): Q8 — two segments or four on the internal-flash bar. |
| X-4 | Extflash segment labels | `FrogFS`, `LittleFS`, `Free` (`Write.dc.html:80`; `Erase.dc.html:82` repeats `FrogFS`/`LittleFS` in the Selected rows) | `classify.ts:178-179` and `:172` label them `Games`, `Emulators & Saves`, `Free Space` (`shared.ts:80-82`). | WRONG | **yes** — a deliberate product choice (friendlier names) versus the artboards' filesystem names; conflict, not a bug | **CONFIRMED** — unchanged (`shared.ts:80-82` still `Free Space` / `Games` / `Emulators & Saves`) **RE-STATUSED 2026-09-08** (`docs/BLOCKED-AUDIT.md`): settled by the segment-label ruling; `shared.ts:88-90` already reads `Free Space` / `Games & Homebrew` / `Emulators & Saves` — the ruled names verbatim. The artboards' `FrogFS`/`LittleFS` naming is superseded. |
| X-5 | Extflash segment colours | `FrogFS` = `#3e9e4e` green with white ink; `LittleFS` = `#9a9aa0` grey with white ink (`Write.dc.html:80`) | Inverted and off-palette: `GeometryBar.svelte:164-166` `.frogfs { background: #c0392b }` (red, in no artboard), `:181-183` `.littlefs { background: var(--zelda-green) }`. `Erase.dc.html:80` further recolours both to `#8a241b` when selected (see E-3). | WRONG | **yes** — `#c0392b` is not a token and matches no artboard; picking the replacement needs the owner | **FIXED** — unchanged: `.frogfs` is still `#c0392b` and `.littlefs` still takes the green (`GeometryBar.svelte:164-183`) **RE-STATUSED 2026-09-08** (`docs/BLOCKED-AUDIT.md`): stale row. `GeometryBar.svelte:220` and `:237` now read `var(--seg-games)` / `var(--seg-saves)`, defined at `tokens.css:61-62` as `--zelda-green` (`#3e9e4e`) and `--silver-edge` (`#9a9aa0`) — exactly the artboard's green-and-grey. The `#c0392b` literal is gone, which also unblocks A35. |
| X-6 | Segment ink | `color: #ffffff` (or `#5c5c5c` on the `Free` segment), 11px/600, no shadow | `GeometryBar.svelte:156-162` adds `text-shadow: 0 1px 1px rgba(0,0,0,0.5)`; the `#ffffff` is a bare literal — the on-fill ink gap recorded as audit 8.1. | COSMETIC | no | **FIXED** (`02d83be`) — the text shadow is gone; `.gseg span` is flat `#fff` (`GeometryBar.svelte:175-181`), with the missing on-fill ink token noted in the comment as audit 8.1’s still-open gap |
| X-7 | Hover-detail strip | No artboard shows a detail line under the bar | `GeometryBar.svelte:85-87` renders a `.gdetail` strip (with a `min-height: 1.1rem` reserved even when empty, `:231`) plus a click-pin outline (`:143-147`). | EXTRA | no | **CONFIRMED** (re-sorted 2026-09-07, was OPEN) — removing the strip removes click-to-pin selectable-address detail from all eight `GeometryBar` call sites (`.gseg.pinned`, `GeometryBar.svelte:152-155`). That is a functionality decision, not a conformance one: the owner must say whether the detail moves somewhere else or goes **RE-STATUSED 2026-09-08** (`docs/BLOCKED-AUDIT.md`): settled by *nothing is cut merely for not appearing in a mockup*. |
| X-8 | Rail | `Firmware management` (`Backup & patch`, `Install Retro-Go`) then `Flash management` (`File browser`, `Write image`, `Dump`, `Erase`); active item `font-weight: 600` + `inset 2px 0 0 #3e9e4e`, `padding: 7px 0 7px 14px; margin-left: -14px` | Character-identical copy (`firmwareSetup.ts:340-348`) and identical geometry (`FirmwareRail.svelte:71-88`, `:180-197`, rail `:158-165`). Confirms audit 5.12 FIXED. | — (no delta) | no | **CONFIRMED** — rail unchanged and still matches |
| X-9 | Footer bar chrome | `border-top: 1px solid #d8d8d8; background: #ffffff; padding: 0 40px; min-height: 72px`, summary `13px #5c5c5c` | Matches: `FirmwareRail.svelte:224-240`. Confirms audit 5.1 FIXED — except on File browser, where it never renders (FB-9). | — (no delta) | no | **CONFIRMED** — and the File-browser exception is now closed too (FB-9 fixed in `af22d7d`) |

### Owner decisions (Flash management group)

- **FB-10** — `Re-read partition` in the File browser footer: implementing it means wiring a new device-touching handler. Already recorded in `docs/audit-ui-conformance.md:937`.
- **FB-12 / W-16 / D-11 / E-13** — the "Enter Recovery Mode" gate that replaces each pane (and the Dump footer's button swap). No artboard covers the un-booted state; someone must say whether it gets one or stays as-is.
- **W-3** — the `Image file` control: a native file input cannot be made into the artboard's 40px mono field without a wrapper. Same choice as audit 3.12 (accept the native control and update the artboard, or commission a wrapper).
- **W-8** — `Verify after write` default. The artboard draws it unchecked; the code defaults it on (`FlashSection.svelte:26`). Flipping it is a write-path behaviour change (and CLAUDE.md's flash-verify-overhead note argues for off).
- **W-11** — the `Overwrites` plan row. Needs new copy in all seven locales *and* a new derivation of what currently occupies the destination range. This is the README's "warnings say what you are about to lose" rule, and nothing in the app implements it for Write.
- **W-13** — whether the acknowledgement checkbox appears for every destination (as `Write.dc.html` draws it for a bank-2 write) or stays gated to bank 1.
- **D-5** — the `matches LittleFS` annotation: new copy plus a new "typed range equals a scanned partition" derivation.
- **D-10** — the Dump progress/cancel state has no artboard; blocked on the same mockup audit S8.13 already queues.
- **X-3** — internal-bar segmentation: the artboard's two `Bank N · <os>` segments versus the implementation's per-bank used/free split. Adopting the artboard drops real information.
- **X-4** — `FrogFS` / `LittleFS` / `Free` (artboards) versus `Games` / `Emulators & Saves` / `Free Space` (`shared.ts:80-82`). A naming conflict, not a defect; whichever wins should win everywhere, including the Erase Selected rows.
- **X-5** — the extflash segment palette. `.frogfs` is `#c0392b`, a literal in no artboard and no token, and green/grey are swapped relative to every Flash-management artboard.

### Not determinable without a browser render

- Whether `RangeField`'s content-height control (`RangeField.svelte:149`) actually lands near the artboards' 40px, and how the native `<select>` chevron reads beside the artboard's drawn one (D-3, D-4).
- Any of the dark-theme derivations of these surfaces — every artboard here is light-only (audit S7.16, S8.11).
- Whether the `GeometryBar` labels are legible at the real segment widths: `GeometryBar.svelte:78` suppresses a label below `pct > 7`, and the artboard's `LittleFS` segment is exactly 5%.
## BackupPatch

Implemented by `apps/web/src/lib/advanced/OfficialFirmwareSection.svelte` (body), with the page title/subtitle and the footer bar drawn by `apps/web/src/lib/advanced/FirmwareRail.svelte` (declared via `advanced/PaneFooter.svelte`); copy in `apps/web/src/lib/i18n/strings/firmwareSetup.ts` (`officialFirmwareEn`, `:26-103`).

**Shared skeleton, surveyed once here** (all four artboards are byte-identical outside the deltas listed under the other three sections): 56px header band + 3px gold lip, the nav strip with `Overview / Firmware / Sources / Library` + the Guided/Advanced switch, the `244px minmax(0,1fr)` rail grid, the `Backup & patch` page title + subtitle, the two-step spine, and the 72px footer bar. The header, nav strip and rail are outside this section's ownership and are already recorded elsewhere: the nav strip draws the app's real four tabs on these boards as on every other (the "three tabs, retired chrome" exemption was withdrawn 2026-09-08 — see the preamble), and both it and the Guided/Advanced switch are now **measured** under the Firmware section's nav-band paragraph as rows F0 (CONFIRMED) and F1a (OPEN, one token), which **withdraws S8.5's block**; the rail itself is S5.12 (FIXED) and the footer bar is S5.1 (FIXED). Verified conformant and NOT reported as deltas: the `244px minmax(0,1fr); gap: 0` split with `padding: 32px 20px 40px 40px` on the rail (`FirmwareRail.svelte:154-165`); the pane body `padding: 32px 40px 40px; gap: 28px; max-width: 880px` (`:210-217`); the footer `border-top: 1px solid var(--hairline); background: var(--surface); padding: 0 var(--page-pad-x); min-height: 72px; justify-content: space-between` (`:225-236`) with a 13px `--ink-soft` summary (`:240-243`); the 24px/600/-0.015em title + 14px `--ink-soft` subtitle (`:248-260`) carrying artboard-verbatim copy (`firmwareSetup.ts:345` `"Backup & patch"`, `:28` `"Save your stock firmware, then patch it so custom firmware can boot."`); the `30px minmax(0,1fr)` / `column-gap: 18px` spine with the 22px disc, green-check done state and 1px `--hairline` connector (`OfficialFirmwareSection.svelte:611-645`); the 18px step-1 / 22px step-2 headings (`:684-693`); the row surface `background: var(--surface); border-radius: 6px; padding: 2px 16px` with `10px 0` rows ruled by `--rule` (`#ededed`) (`:737-761`); the uppercase 11px green `Valid` chip (`:791-797`, string `:49`); the `Found` chip (`:668-674`, string `:46`); the folder line with stroked glyph + mono path + green `Change folder` link (`:391-402`, `:818-843`); `Back up this device again` (`:475-479`, `:848-856`); and the footer's red-fill `Patch firmware` (`--action-red: #c8372b` / `--action-red-deep: #9e2a20`, `styles/tokens.css:39-40`, `ui/Button.svelte:55-62`) beside `"Your stock backup stays on disk — this only rewrites the device."` (`firmwareSetup.ts:84`).

| # | Element | Artboard specifies | Implementation (`file:line`) | Severity | Owner decision? | Status (2026-09-07) |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | Step 1 body, above the folder line | Nothing between the `Firmware backup` / `Found` title row and the folder line — the artboard goes straight from the heading to the folder row | `OfficialFirmwareSection.svelte:382` renders `pickFolderIntro` ("Pick a folder holding your stock backups, or an empty folder to save a backup.") and `:383-387` a second paragraph `pickFolderLookForPre` + two mono filename globs + `pickFolderBodyPost`, unconditionally, in every state | EXTRA | yes — the copy is useful for the no-folder-chosen state (which no artboard draws); deleting it in the found state needs an owner call on whether it should be conditional or gone | **CONFIRMED** — both intro paragraphs still render unconditionally (`OfficialFirmwareSection.svelte:382-387`) **RE-STATUSED 2026-09-08** (`docs/BLOCKED-AUDIT.md`): settled by the no-filler ruling read together with artboard-wins: the paragraphs go conditional — kept in the no-folder state (which no artboard draws, so nothing is cut) and dropped in the found state the artboard does draw. That is a build item, not a decision. |
| 2 | Step-1 connector | The 1px `#d8d8d8` connector is always drawn under step 1's disc (`<span style="width: 1px; flex-grow: 1; background: #d8d8d8; margin: 8px 0;">`) — the artboard never shows step 1 without step 2 below it | `:372` `{#if selected}<span class="connector"></span>{/if}` — no connector until a valid backup is selected | WRONG | no — but note the app has a state (no valid backup) the artboards do not draw, so a missing connector there is arguably correct | **FIXED** (`f7f71d9`) — the connector is drawn unconditionally, with the artboard cited above it (`OfficialFirmwareSection.svelte:369-375`) |
| 3 | `Install bootloader` checkbox | A custom 16px mark: `width: 16px; height: 16px; border-radius: 2px; background: #3e9e4e` with a white 10px stroked check inside | `:543` is a bare native `<input type="checkbox">`; `.check` (`:723-733`) styles only the label, and `grep accent-color\|input[type="checkbox"]` over `styles/*.css` returns nothing — the browser default control is used | WRONG | no | **FIXED** (`81ad3aa`) — the 16px mark is painted: 2px radius, green fill, white check, real `<input type="checkbox">` kept (`OfficialFirmwareSection.svelte:747-770`) |
| 4 | `Install bootloader` / `(recommended)` type sizes | Label 14px, `(recommended)` 13px `#5c5c5c`, row `gap: 10px`, `align-items: center` | `:723-733`: label `--fs-caption` (14px ✓), but `.check em` is `--fs-micro` (0.75rem = 12px, vs 13px), `gap: 0.45rem` (7.2px vs 10px) and `align-items: baseline` | COSMETIC | no | **FIXED** (`81ad3aa`; mis-marked OPEN by the 2026-09-07 pass) — re-read: `.check` is `align-items: center; gap: 10px` and `.check em` is `--fs-btn-sm` = 13px (`OfficialFirmwareSection.svelte:735-746`). The same commit that painted the mark (#3) also fixed the row metrics; only the marking missed it |
| 5 | Footer `Patch firmware` button geometry | `padding: 9px 22px; border-radius: 5px` | `styles/tokens.css:115` `--pad-btn: 9px 22px` ✓ and `ui/Button.svelte:33` `border-radius: var(--r-btn)` = `styles/tokens.css:117` `5px` ✓ — conformant | — (no delta) | no | **CONFIRMED** — unchanged and conformant |
| 6 | Recovery-mode affordance | No artboard shows an `Enter Recovery Mode` button in this footer — the footer holds exactly one action | `:582-586` renders `Enter Recovery Mode` / `Entering Recovery Mode…` in the footer whenever `!device.utilLoaded`, plus a `connectToPatchAndFlash` hint at `:581` | EXTRA | yes — the two-click recovery affordance is real, necessary behaviour with no artboard; the artboard cannot be conformed to without dropping it | **CONFIRMED** — the footer's recovery affordance still ships with no artboard **RE-STATUSED 2026-09-08** (`docs/BLOCKED-AUDIT.md`): settled by *nothing is cut merely for not appearing in a mockup*. |

Not statically determinable: whether the disc/connector column visually aligns with the artboard's 30px track at real render width, and whether the 880px body cap plus the row surface reproduce the artboard's row measure. Both need a browser.

Already recorded, not re-reported: S5.10 (spine, per-file rows, collision warning) is FIXED and my walk agrees — the spine (`:356-372`), the file rows (`:417-437`) and the collision aside (`:563-568`) are all present.

## BackupPatchBoth

Same components. Unique to this state (vs `BackupPatch`): the row list becomes a two-entry single-selection list keyed by model name rather than filename, step 2's subtitle becomes `"Patches the selected backup and writes it back to the device."`, and the gold extflash-collision aside appears.

| # | Element | Artboard specifies | Implementation (`file:line`) | Severity | Owner decision? | Status (2026-09-07) |
| --- | --- | --- | --- | --- | --- | --- |
| 7 | Collision aside copy | *"**Overlaps installed data:** patching writes 4.00 MB at the start of external flash, **over part of your FrogFS games partition. Those games will need reinstalling.**"* | `firmwareSetup.ts:75-78`: bold matches, but the body reads `"…over some of your installed games. Those will need reinstalling."` — the artboard names the FrogFS games partition and says "Those games", the implementation says "some of your installed games" / "Those" | WRONG | yes — the implementation's wording is deliberately broader (`:123-129` comment: the warning also covers LittleFS and FAT partitions, so naming FrogFS alone would be wrong); conforming to the artboard would make the sentence lie in the LittleFS/FAT case. Needs an owner call on which is correct, or new copy that covers both. | **CONFIRMED** — copy unchanged; conforming would make the sentence false for LittleFS/FAT **RE-STATUSED 2026-09-08** (`docs/BLOCKED-AUDIT.md`): settled by the segment-label ruling. `firmwareSetup.ts:77-78` already reads `Anything installed there — Games & Homebrew, Emulators & Saves — will need reinstalling`: the ruled names, generalised so the sentence stays true for LittleFS and FAT. Both halves of the old conflict now point the same way. |
| 8 | Collision aside rule/padding | `border-left: 2px solid #b8860b; padding: 2px 0 2px 14px` | `:701-707` `border-left: 2px solid var(--caution)` (`--caution: #b8860b`, `tokens.css:42`) ✓, `padding: 0.15rem 0 0.15rem 0.75rem` = 2.4px / 12px vs 2px / 14px | COSMETIC | no | **FIXED** (`81ad3aa`) — the gold aside's padding was aligned with the danger one at `2px 0 2px 14px` (`OfficialFirmwareSection.svelte:707-708`) |
| 9 | Selection radio ring | 15px disc, unselected `border: 1px solid #9a9aa0`, selected `border: 4px solid #3e9e4e`, both on `#ffffff` | `:765-777` — 15px, `border: 1px solid var(--silver-edge)` (`#9a9aa0`) / `:checked { border: 4px solid var(--zelda-green) }` on `var(--surface)`. Conformant, listed only because S5.10 flagged it | — (no delta) | no | **CONFIRMED** — unchanged and conformant |
| 10 | Selected row weight and size column | Selected row name at `font-weight: 600`; size column reads `int 128 KB · ext 4.00 MB` | `:783-786` `.row.sel .rname { font-weight: 600 }`; `:449` renders `int {rowSize(...)} · ext {rowSize(...)}` with `rowSize` at `:166-167` producing `128 KB` / `4.00 MB` | — (no delta) | no | **FIXED** (`5442258`) — the size half is closed: `OfficialFirmwareSection.svelte:463` renders `int {formatSize(fb.internal.length)} · ext {formatSize(fb.external.length)}`, the local `rowSize`/`toFixed(2)` is gone, and `formatSize` trims the whole-MB `.00`, so the row prints `ext 4 MB` as the corrected board does. The weight half was already conformant. Reopened by `cadf918`; closed by `5442258` without the survey being updated behind it. |

## BackupPatchCross

Same components. Unique to this state: the danger aside replaces the gold one, an acknowledgement checkbox appears inside it, the footer summary swaps, and the footer action becomes a destructive outline reading `Patch anyway`.

| # | Element | Artboard specifies | Implementation (`file:line`) | Severity | Owner decision? | Status (2026-09-07) |
| --- | --- | --- | --- | --- | --- | --- |
| 11 | Cross-model danger aside container | A **left-rule aside, no box**: `border-left: 2px solid #8a241b; padding: 2px 0 2px 14px`, on the page ground, exactly mirroring the gold aside in `BackupPatchBoth` | `:548-557` `<div class="danger">`, styled `:860-868` as a **bordered box**: `border: 1px solid var(--caution); border-radius: var(--r-control); padding: 0.6rem 0.7rem; background: var(--surface-sunk)` | WRONG | no — this is the de-boxing pass simply not reaching this element | **FIXED** (`81ad3aa`) — the aside is de-boxed: `border-left: 2px solid var(--danger)` on the page ground, no fill, no radius (`OfficialFirmwareSection.svelte:906-913`) |
| 12 | Cross-model aside colour | `#8a241b` (the danger red) on both the rule and the bold lead-in | `:860` uses `var(--caution)` (`#b8860b`, gold) for the border; the artboard's `strong` colour has no rule at all in the implementation (`.danger p` at `:865-869` sets no colour on `strong`), so the bold lead-in renders as plain ink, not `--danger` | WRONG | no | **FIXED** (`81ad3aa`) — the rule is now `--danger` and `.danger p strong` takes `--danger` (`OfficialFirmwareSection.svelte:908`, `:919-921`) |
| 13 | Cross-model bold + body copy | `"⚠ Cross-model:"` + *"this is Zelda firmware, but the connected hardware scanned as Mario. Mario hardware lacks two of the buttons Zelda needs — the result may be partly unusable."* | `firmwareSetup.ts:67-69` — character-identical | — (no delta) | no | **CONFIRMED** — copy unchanged and still character-identical |
| 14 | Acknowledgement checkbox | 16px square, `border-radius: 2px`, `border: 1px solid #8a241b` on white (unchecked), label *"I understand and want to flash Zelda firmware onto Mario hardware anyway"*, `gap: 10px`, `padding-top: 10px` above it | Label copy is character-identical (`firmwareSetup.ts:70`); the control at `:553` is a bare native checkbox with no `--danger` outline (same root cause as #3), and the 10px offset is the `.danger` box's own `gap: 0.5rem` (`:867`) | WRONG | no | **FIXED** (`81ad3aa`) — the acknowledgement mark is outlined in `--danger` while unset (`OfficialFirmwareSection.svelte:924-926`) |
| 15 | Footer, cross-model | Summary *"Read the warning above before continuing."*; action `border: 1.5px solid #8a241b; color: #8a241b; padding: 8px 20px; border-radius: 5px` labelled `Patch anyway`, no fill | `:576-589`: summary `footerSummaryCross` (`firmwareSetup.ts:85`, identical) and `<Button variant="destructive">{patchAnywayButton}</Button>` (`firmwareSetup.ts:83`, identical). `ui/Button.svelte:91-96` is `border: 1px solid var(--danger)` — **1px, not 1.5px** | COSMETIC | no | **FIXED / row was stale** (re-read by the icons pass, 2026-09-08) — `.destructive` is `border: 1.5px solid var(--danger)` (`Button.svelte:121-126`), the artboard value. The `1px` the row quotes was the `.btn.destructive:disabled` reset, not the variant |
| 16 | Destructive hover | The artboard is a static frame; it specifies no hover | `ui/Button.svelte:97-100` inverts to a `--danger` fill with white ink | — (out of artboard scope, noted only) | no | — out of artboard scope, unchanged |

## BackupPatchAllowed

Same components. Unique to this state: the same two-row selection list as `BackupPatchBoth` (with Mario selected), and a **gold** cross-model note in place of the collision aside.

| # | Element | Artboard specifies | Implementation (`file:line`) | Severity | Owner decision? | Status (2026-09-07) |
| --- | --- | --- | --- | --- | --- | --- |
| 17 | Allowed cross-model note — treatment | A gold left-rule aside identical in shape to the collision aside: `border-left: 2px solid #b8860b; padding: 2px 0 2px 14px`, with a bold `#b8860b` `Cross-model:` lead-in at 14px ink | `:558-561` is a plain `<p class="muted">` — `--fs-caption` grey body text (`:686-690`), no rule, no bold lead-in, no gold | WRONG | no | **FIXED** (`81ad3aa`) — the allowed note is now the gold left-rule `caution-aside`, not grey body copy (`OfficialFirmwareSection.svelte:557-562`) |
| 18 | Allowed cross-model note — copy | `"Cross-model:"` (bold) + *"this is Mario firmware on Zelda hardware. That works — Zelda has every button Mario uses — but the device will behave as a Mario unit."* | `firmwareSetup.ts:71-72` `crossModelAllowedNote` is a single interpolated sentence: `` `Note: backup is ${backupModel} firmware on ${deviceModel} hardware — allowed.` `` — no bold lead-in key, and none of the artboard's explanation (why it works, and the consequence) | MISSING | yes — conforming needs two new keys (a `crossModelAllowedBold` and a body), landed across all seven locales, and the artboard's sentence is Mario→Zelda-specific while the implementation's is model-agnostic, so the generalised phrasing has to be authored, not copied | **FIXED** (`fa6ffed` structure, `5442258` copy) — `firmwareSetup.ts:71-73` carries `crossModelAllowedBold: "Cross-model:"` plus a model-generalised body with both em-dashes gone: `this is ${backupModel} firmware on ${deviceModel} hardware. That works, because ${deviceModel} has every button ${backupModel} uses, but the device will behave as a ${backupModel} unit.` — the corrected board's sentence, in all seven locales, rendered at `OfficialFirmwareSection.svelte:568-571`. Reopened by `cadf918`; closed by `5442258` without the survey being updated behind it. |
| 19 | Collision aside in this state | `BackupPatchAllowed` shows the cross-model note and **no** collision aside; `BackupPatchBoth` shows the collision aside and **no** cross-model note — yet both are the same two-backup folder | `:558-568` renders the cross-model note and the collision aside as independent conditions (`crossModel` and `overlapsInstalled`), so both can appear together | EXTRA | yes — a genuine artboard conflict: no artboard draws the both-at-once state, so the stacking order and whether they should merge is undrawn | **BLOCKED** — unchanged: the cross-model note and the collision aside are still independent conditions and can co-occur (`OfficialFirmwareSection.svelte:557-570`) **RE-STATUSED 2026-09-08** (`docs/BLOCKED-AUDIT.md`): Q9 — can the cross-model note and the collision aside appear together. |

### Owner decisions (Backup & patch group)

- **#1** — Step 1's two intro paragraphs (`pickFolderIntro`, `pickFolderLookForPre`/`pickFolderBodyPost`) exist in no artboard. They serve the no-folder-chosen state, which no artboard draws. Decide: make them conditional on `!dir`, or delete them.
- **#6** — The footer's `Enter Recovery Mode` two-click affordance is real behaviour with no artboard. Decide whether to commission an artboard for it or accept the divergence.
- **#7** — Collision-aside copy conflict: the artboard names *"part of your FrogFS games partition"*, but the implementation's condition also fires for LittleFS and FAT partitions (`:123-129`), so the artboard's wording would be false in those cases. Needs either a ruling that the artboard wins, or new copy covering all three filesystems.
- **#18** — The allowed cross-model note needs new copy (a bold lead-in plus a body explaining *why* it is allowed and what the consequence is), model-generalised rather than the artboard's Mario→Zelda-specific sentence, and landed in all seven locales.
- **#19** — Artboard conflict: the collision aside and the cross-model note are drawn as mutually exclusive across `BackupPatchBoth` / `BackupPatchAllowed`, but the implementation can show both. No artboard covers the combined state.

---

## Four boards drawn 2026-09-08, surveyed here for the first time

`ModalRecoveryMode`, `ModalConfirm`, `RomsNoFolder` and `ModalSpaceAlert` were drawn for
surfaces that ship but had no artboard. Before this pass neither survey carried a single row for
any of them.

**Read the CONFIRMED cells here with that in mind.** These four boards were drawn *from* the
components, so a CONFIRMED row means "the board records what the code does", not "the owner
approved this and the code matches it". That is weaker evidence than every other CONFIRMED in
this survey and the two must not be totalled as if they were equal. The rows worth reading are
the ones that are **not** CONFIRMED: the drawing pass made calls, and three real defects fell out
of walking the boards back against the code.

They are modal-family boards and would sit more naturally in survey B, which owns the Modals
group. They are here because this pass owned this file.

### ModalRecoveryMode.dc.html

Implementing component: `apps/web/src/lib/ui/StubLoadModal.svelte`, on `lib/ui/ModalShell.svelte`
and `lib/ui/Button.svelte`. Copy from `i18n/strings/shared.ts:44-53`.

| # | Element | Artboard specifies | Implementation (`file:line`) | Severity | Owner decision? | Status (2026-09-08) |
|---|---|---|---|---|---| --- |
| RM1 | Page behind the modal | The Erase pane with the header reading `Connected (Recovery Mode)` (`:17-92`) | Byte-identical to `Erase.dc.html`; covered by the Erase table and F0 | — | No — cross-reference only | **CONFIRMED** — nothing here differs from `Erase`; no new row is owed |
| RM2 | Dialog frame | `width: 416px; background:#ffffff; border:1px solid #d8d8d8; border-radius:6px; box-shadow: 0 12px 40px rgba(0,0,0,0.32); overflow:hidden` (`:94`) | `ModalShell.svelte:49,69-76` — `maxWidth` default `26rem` = 416px, `--surface`, `--hairline`, `--r-card` 6px, the same shadow | — | No | **CONFIRMED** — value for value |
| RM3 | Face-plate lip | 3px `linear-gradient(180deg,#d9bc5e,#c09a32)`, first child (`:94`) | `ModalShell.svelte:52,77-80` `--grad-gold` (`tokens.css:16`, the identical stops) | — | No | **CONFIRMED** |
| RM4 | Body band and stack | `padding: 22px 24px 20px`, children at `gap: 8px` (`:94`) | `ModalShell.svelte:86-89` `1.375rem 1.5rem 1.25rem`; the 8px comes from `h3`/`.muted` `margin-bottom: 0.5rem` (`StubLoadModal.svelte:36,41`) | — | No | **CONFIRMED** — expressed as margins rather than a flex gap, same result |
| RM5 | Title | `Enter Recovery Mode?`, `18px/600/-0.01em` (`:94`) | `shared.ts:45`; `StubLoadModal.svelte:32-37` `--fs-title` 18px / 600 / `-0.01em` | — | No | **CONFIRMED** — copy character-identical |
| RM6 | Body apostrophes | The board sets both as typographic: `device’s` and `don’t` (`:94`) | `shared.ts:49,51` use straight `'` in `body2Pre` and `body2Post`. Every other string in the same object (`connectGateModal.subtitle`, `:56`) uses `’` | COSMETIC | No — but it is punctuation, so `i18n-locale-drift.mjs` does not exempt it: a two-character fix is a seven-file edit | **FIXED** — both apostrophes now typographic in the English source and in every sibling locale whose own typography wants one |
| RM7 | Emphasised runs in the body | `<strong style="font-weight: 700; color: #1b1b1b">` on `Recovery Mode` and `power button` (`:94`) — the bold run steps **up** to full ink | `StubLoadModal.svelte:18,21` render bare `<strong>`s inside `<p class="muted">`; `.muted` sets `color: var(--ink-soft)` (`:38-42`) and the `<strong>` inherits it. The bold run is the same `#5c5c5c` as the prose around it | WRONG (colour) | No — a one-line scoped rule, and it is the same fix `0c71853` already applied to `InstallProgressModal`'s `.muted strong` under GF6 | **FIXED** |
| RM8 | Actions row | `justify-content: flex-end; gap: 20px; padding-top: 12px` (`:94`) | `StubLoadModal.svelte:43-48` — `gap: 0.6rem` (9.6px), `margin-top: 1.25rem` (20px) | COSMETIC | No — `ConnectGateModal` and `FolderGateModal` already took the artboard's 20px (survey B rows *Actions row* / *Actions*); this modal and `ConfirmModal` are the two that did not | **FIXED** |
| RM9 | Cancel | Bare text, `14px/500 #5c5c5c`, no border, no underline (`:94`) | `StubLoadModal.svelte:24` `<Button variant="cancel">`; `Button.svelte:136-144` — `background: transparent; border: none; box-shadow: none; color: var(--ink-soft); font-size: var(--fs-caption)` (14px) `font-weight: 500` | — | No | **CONFIRMED** — see the note below this table; the reported "bordered pill" delta does not exist |
| RM10 | Continue | `background:#c8372b; color:#fff; 14px/600; padding: 9px 22px; border-radius: 5px; box-shadow: inset 0 -2px 0 #9e2a20` (`:94`) | `StubLoadModal.svelte:25` `variant="action"`; `Button.svelte:68-75` — `--action-red` `#c8372b`, `--fs-btn` 14px, 600, `--pad-btn` `9px 22px`, `--r-btn` 5px, `inset 0 -2px 0 var(--action-red-deep)` `#9e2a20` | — | No | **CONFIRMED** — value for value |
| RM11 | Backdrop | `rgba(0,0,0,0.5)`, centred (`:94`) | `ModalShell.svelte:60-68` | — | No | **CONFIRMED** |

**The reported "Cancel is drawn bare but renders as a bordered pill" delta was checked and is
not real** — recorded once here for all six modals rather than per board. `Button`'s `cancel`
variant (`Button.svelte:132-156`) is already the boards' bare 14px/500 `--ink-soft` text: it
clears the `.btn` base's `border`, `box-shadow` and `--pad-btn-sm` padding, and carries its own
focus ring because it has no border to show one. Every modal that draws a bare Cancel uses it —
`StubLoadModal:24`, `ConfirmModal:81`, `ConnectGateModal:88`, `FolderGateModal:84`,
`FilePromptModal:357`, `InstallProgressModal:131`. `ModalConnect` and `ModalFolder` did have this
defect and survey B closed it (`7fd667f`); the report appears to predate that fix. **Nothing to
do on any board.**

### ModalConfirm.dc.html + ModalConfirmRunning / Progress / Done / Error

Implementing component: `apps/web/src/lib/ui/ConfirmModal.svelte`. Five boards now draw this one
dialog — `ModalConfirm` the confirm phase, and the four drawn later the same day covering
`running` (indeterminate), `running` (determinate), `done` and `error`. All five draw the Overview
tab's boot-image instance, titled `Boot Image`. Its two call sites are `OverviewTab.svelte:603`
and `DeviceHeader.svelte:179`.

**The four phase boards are more trustworthy than `ModalConfirm` itself**, and rows MK4/MK5
below were re-statused once they landed. The later four were drawn against the component's real
box model — `<p>` elements carrying the UA's `1em` margin, because `styles/global.css` resets
`h1,h2,h3` (`:36-40`) and never `<p>` — while `ModalConfirm` draws the body as a `display: flex;
gap: 8px` stack of `<span>`s, a model this component does not use anywhere. Where the two
disagree about body spacing or size, **the earlier board is the defect**.

| # | Element | Artboard specifies | Implementation (`file:line`) | Severity | Owner decision? | Status (2026-09-08) |
|---|---|---|---|---|---| --- |
| MK1 | Page behind the modal | The Overview tab, Device panel / bank cards / External flash / device log (`:17-200`) | Byte-identical to `Main.dc.html`; covered by the `Main` table | — | No — cross-reference only | **CONFIRMED** |
| MK2 | Dialog frame, lip, backdrop | Same `416px` / hairline / 6px / gold-lip shell as RM2–RM3 (`:206`) | `ConfirmModal.svelte:73` `<ModalShell>` with every default | — | No | **CONFIRMED** — the two boards draw one shell |
| MK3 | Title | `Boot Image`, `18px/600/-0.01em` (`:206`) | `ConfirmModal.svelte:75` renders the `title` **prop** — the string is the caller's, and the board's instance is Overview's. Type at `:109-114` = `--fs-title` / 600 / `-0.01em` | — | No | **CONFIRMED** — the type conforms; the copy is runtime data, not a survey value |
| MK4 | Body line size | `font-size: 14px; color: #5c5c5c` (`:206`) | `ConfirmModal.svelte:79` `<p class="muted">`. The component's own `<style>` defines **no `.muted` rule** — it resolves to `styles/global.css:53-55`, which sets `color` and nothing else, so the paragraph inherits `body`'s `--fs-body` = **16px** (`tokens.css:92`) | COSMETIC | **Yes — but about the board.** `ModalConfirmRunning`/`Progress`/`Done` all draw this dialog's body paragraph at `font-size: 16px`, which is what the component renders. Only `ModalConfirm` says 14px, and it is the board whose box model is wrong (see MK5) | **OPEN — against the board, not the code.** Re-statused when the four phase boards landed. Recorded as OPEN rather than closed because *some* board has to be corrected and only the owner should say which |
| MK5 | Title→body spacing | `display: flex; gap: 8px` between title and body (`:206`) | Not a flex stack. `h3 { margin-bottom: 0.5rem }` (`:113`) sits against a `<p>` carrying the UA's `margin: 1em 0`, which `global.css` never resets — the two collapse to **16px**, not 8px | COSMETIC | **Yes — about the board.** The four phase boards draw exactly this: `<p style="margin: 16px 0">` under a bare title div, no flex, no gap. `ModalConfirm` is the outlier | **OPEN — a defect in our own board.** Was CONFIRMED in this survey's first draft, which read the `h3` margin and stopped before the `<p>`'s. Corrected here |
| MK6 | Actions row | `justify-content: flex-end; gap: 20px; padding-top: 12px` (`:206`) | `ConfirmModal.svelte:115-120` — `gap: 0.6rem`, `margin-top: 1.25rem` | COSMETIC | No — identical to RM8; the two should move together | **FIXED** |
| MK7 | Cancel | Bare text `14px/500 #5c5c5c` (`:206`) | `ConfirmModal.svelte:81` `variant="cancel"` | — | No | **CONFIRMED** — see the RM9 note |
| MK8 | Confirm cap | `Boot` — `#c8372b`, `14px/600`, `9px 22px`, radius 5, `inset 0 -2px 0 #9e2a20` (`:206`) | `ConfirmModal.svelte:82` `variant={danger ? "destructive" : "action"}`; `Button.svelte:68-75` for the drawn `action` case | — | No | **CONFIRMED** — the drawn state matches. The `danger` prop swaps in the oxblood **outline** (`Button.svelte:121-126`); no board draws this dialog in that state, and nothing is cut for absence from a mockup |
| MK9 | Running phase, indeterminate bar (`ModalConfirmRunning`) | `Working — <strong>do not unplug your device</strong>.` at 16px `#5c5c5c` with the `<strong>` at **600**, over an 8px `border-radius: 2px` shuttle: `linear-gradient(90deg,#e8e8e8 30%,#3e9e4e 50%,#e8e8e8 70%)` at `background-size: 200% 100%` | `ConfirmModal.svelte:85` composes `shared.ts:22-24`; `.indet` `:128-143` — 8px, radius 2px, `--surface-sunk` `#e8e8e8` at both ends, `200% 100%`, the `slide` keyframes | COSMETIC ×2 | No | **BLOCKED** (2026-09-10) — the weight half is **FIXED** (`c046d5f`): `.muted strong` now takes 600, scoped to this component because `InstallProgressModal` composes the identical fragment and ITS boards (`GuidedFlashing`, `FlashingCancel`, `FlashingCancelConfirm`) draw a bare `<strong>`, so the UA's 700 is correct there. Both halves of that split are pinned by `test/checklist-board-copy.mjs`. What remains needs a ruling, so the row is no longer OPEN: the gradient's mid-stop is **`--model-accent`**, not `--zelda-green`. The board's `#3e9e4e` is what a Zelda device shows — a Mario device runs the same shuttle in `--mario-red`. **This is SA7's defect a second time**, in a second dialog, and the two should be ruled on together. **Also note the artboard, not the code, is now the stale half of the copy claim**: the original cell called the composition character-identical, and it no longer is — the em-dash rewrite made `shared.ts` read `Working. `+`Do not unplug your device`+`.` where the board still draws `Working — do not unplug your device.` The code is right by the copy rules and the board is what should change. Original cell: **OPEN** — two values, both small. The `<strong>` is bare, so it renders at the UA's **700** against the board's 600 |
| MK10 | Determinate progress (`ModalConfirmProgress`) | Two stacked bar rows: `flex: 1` track `height: 10px; background:#e8e8e8; border:1px solid #9a9aa0; border-radius: 2px`, `#c8372b` fill, and a 12px mono `#5c5c5c` caption at `gap: 10px` | `ConfirmModal.svelte:87,92` render `Progress.svelte`; `:19-36` — `0.6rem` track, `--surface-sunk`, `--silver-edge` `#9a9aa0`, radius 2px, `--action-red` `#c8372b` fill, `--fs-micro` 12px mono `--ink-soft`, `gap: 0.6rem` | — | **Yes** | **OPEN — the board draws a state the app cannot reach.** Every value conforms, but the branch is dead: `{#if total > 0}` (`:86`) needs `report()` to have been called, and **neither call site ever calls it** — `runBoot` (**`DetailsPane.svelte:278-282`** as of 2026-09-10, formerly `OverviewTab.svelte:286-291`) takes no `report` argument at all, and `DeviceHeader.svelte`'s inline `run` (**`:347`**, formerly `:183`) takes none either. `sub` is likewise never set, so the second bar has no producer either. The board exists because `report` is part of `run`'s published signature (`:29-31`), not because anything drives it. **Read it as an API contract, not a shipping screen**; the live path is always MK9's indeterminate shuttle |
| MK11 | Spacing between the two bars | Nothing — the board draws the two rows as bare siblings, flush | `Progress.svelte`'s `.wrap` (`:14-18`) sets no margin and `ConfirmModal` adds none between `:87` and `:92`, so the bars touch | — | **Yes** | **OPEN — a defect with no artboard authority either way.** Not an artboard-vs-code delta: `ModalConfirmProgress` draws them flush too, because it was drawn from this code. Two stacked meters with zero separation read as one control; the right gap is a design call, and there is no drawing to take it from. Unreachable today (MK10), so it costs nothing until `report` gets a caller |
| MK12 | Done phase (`ModalConfirmDone`) | `✓ Done.` at `16px/600 #3e9e4e`, then a right-aligned red `Close` cap (`9px 22px`, radius 5, `inset 0 -2px 0 #9e2a20`) at `margin-top: 20px` | `ConfirmModal.svelte:96` renders `shared.ts:25` `"✓ Done."` into `.ok` (`:124-127`, `--zelda-green` / 600, 16px inherited); `:98` is `variant="action"`; `.actions` `:115-120` `margin-top: 1.25rem` = 20px | — | No | **CONFIRMED** — value for value, including the glyph in the string |
| MK13 | Error phase lip | **Gold** — `ModalConfirmError` keeps the default `linear-gradient(180deg,#d9bc5e,#c09a32)` over a failed operation | `ConfirmModal.svelte:73` passes no `lip`, so `ModalShell.svelte:52` defaults to `"gold"` | — | **Yes** | **OPEN — two error surfaces disagree, and both are drawn.** `FlashFailure.dc.html:84` swaps its dialog to a solid `--danger` lip and `InstallProgressModal.svelte:105` (formerly `:102`) implements exactly that, keyed on `modalPhase === "error"`. So `lip="danger"` is **not** an uncalled prop — it has a live caller — and the open question is the narrower one: whether a failure in *this* dialog earns the same chrome as a failure in that one. Recorded because the app currently answers "no" by omission rather than by decision |
| MK14 | Error phase body and actions | `Not connected.` at `14px #8a241b`, then a neutral `Close` — `#ffffff`, `1px solid #d8d8d8`, `#5c5c5c`, `13px/600`, `8px 18px`, radius 5 | `ConfirmModal.svelte:100` `<p class="err">{error}</p>` — `global.css:56-59` gives `--danger` `#8a241b` at `--fs-caption` 14px; `:102` is `<Button>` with no variant = `default` (`Button.svelte:81-86`), which is that neutral cap value for value | — | **Yes** | **OPEN — the paint conforms; what it says does not.** The dialog renders a bare `Error.message` (`:62`) with an unchanged title and a single `Close`: no retry, and no route to the device log, which every other failure surface in the app offers. The board draws `Not connected.` because that is genuinely what `runBoot` throws (**`DetailsPane.svelte:279`** as of 2026-09-10, formerly `OverviewTab.svelte:287`) — a raw developer string standing in for user-facing copy. **The board is faithful; the surface is the thinnest failure state in the app** |

### RomsNoFolder.dc.html

Implementing component: `apps/web/src/lib/views/RomManagementTab.svelte`, the `{#if !roms.selected}`
branch — `.gate-empty` at `:2007-2013`, styled `:2456-2464`.

| # | Element | Artboard specifies | Implementation (`file:line`) | Severity | Owner decision? | Status (2026-09-08) |
|---|---|---|---|---|---| --- |
| RN1 | Nav band | Four tabs, `Library` active with the green 3px underline (`:63-69`) | Covered by F0 | — | No — cross-reference only | **CONFIRMED** |
| RN2 | `Change folder` in the nav band | A 16px stroked folder glyph + `Change folder` `13px/500 #5c5c5c`, right-aligned **on the nav line** (`:70-76`) | Nothing. The app's only change-folder affordance is the `.folder-btn` glyph in the games-pane header (`:2064`), which lives in the `{:else}` branch — so in **this** state there is no way to change folders except the gate button itself | **MISSING** | **Yes** — the same question `:2036-2039`'s comment already records: the board puts this control in a tab strip `RomManagementTab` does not own. Placing it needs a ruling on which component owns the nav-band right slot | **BLOCKED** |
| RN3 | Gate copy | `Set up your ROM folder to manage games.` (`:83`) | `roms.ts:18` `gateBody` — character-identical | — | No | **CONFIRMED** |
| RN4 | Gate button | `Set up folders…` — `14px/600 #1b1b1b`, `background:#c9c9cd`, `1px solid rgba(0,0,0,0.3)`, `border-radius: 2px`, `padding: 5px 13px` (`:84`) | `:2008-2010` `<button class="action">`; `:2591-2606` — `--fs-caption` 14px / 600 / `--ink`, `--silver` `#c9c9cd`, the same `rgba(0,0,0,0.3)` edge, `--r-control` 2px, `padding: 0.3rem 0.8rem` (4.8 / 12.8px). Copy `roms.ts:19` | — | No — the sub-pixel padding rounds to the drawn value | **CONFIRMED**. Note it is the plain `.action`, **not** `.action.primary` — the board draws the silver cap, which is what SA7 below makes worth saying |
| RN5 | Gate container | `align-items: center; gap: 12px; padding: 32px 16px; color:#5c5c5c; font-size: 14px` (`:82`) | `.gate-empty` `:2456-2464` — `gap: 0.75rem`, `padding: 2rem 1rem`, `--ink-soft`, `--fs-caption` | — | No | **CONFIRMED** — value for value |
| RN6 | No footer bar | The board draws none, and says why in its own comment (`:78-80`): the 72px `.bar` is inside the same `{:else}` as the table (`:2285`), so the gate state has no footer | `RomManagementTab.svelte:2285` — `.bar` opens inside the `{:else}`, one branch below `.gate-empty` (`:2007`); nothing renders a footer in the gate state | — | **Yes** — not against the code, which matches the board, but against the design rule. `docs/design/mockups/README.md:70` states **"One footer bar on every screen"**; the same file's board index at `:47` describes this board as *"the panel's gate, and no footer bar"*. **The README contradicts itself**, and this is the screen where it shows | **CONFIRMED** (code ↔ board) — the rule needs amending or this screen needs a bar; that is the owner's call, not an agent's |

### ModalSpaceAlert.dc.html

Implementing component: `apps/web/src/lib/views/RomManagementTab.svelte`'s inline `spaceAlert`
dialog (`:2378-2389`). Copy from `i18n/strings/roms.ts:44-49`.

| # | Element | Artboard specifies | Implementation (`file:line`) | Severity | Owner decision? | Status (2026-09-08) |
|---|---|---|---|---|---| --- |
| SA1 | Page behind the modal | The Library tab with the summary notch and the 72px footer bar (`:2001`) | Byte-identical to `Roms.dc.html`; covered by survey B's `Roms` table | — | No — cross-reference only | **CONFIRMED** |
| SA2 | Dialog frame | The 416px shell, but `border: 1px solid #8a241b` (`:2003`) | `:2379` `<ModalShell borderColor="var(--danger)" zIndex={200}>`; `--danger` is `#8a241b` (`tokens.css:51`) | — | No | **CONFIRMED** |
| SA3 | Lip | **Gold**, `linear-gradient(180deg,#d9bc5e,#c09a32)` — the board keeps the default lip on a danger-bordered dialog (`:2003`) | `ModalShell.svelte:52` default `lip="gold"` | — | No | **CONFIRMED** — worth recording that this is the app's *other* danger dialog and it differs from `FlashFailure.dc.html:84`, which swaps the lip to solid `--danger`. Two boards, two treatments; both are drawn, so neither is a defect |
| SA4 | Body line size | `font-size: 14px; color: #5c5c5c` (`:2003`) | `:2382` `<p style="color: var(--ink-soft)">` — colour only, so the paragraph inherits `--fs-body` **16px** | WRONG (16px against 14px) | No — **the same defect as MK4**, in a second dialog. Both are one declaration | **FIXED** |
| SA5 | Title | `Space Limit Reached`, `18px/600/-0.01em`, `color: #8a241b` (`:2003`) | `:2381` inline `font-size: var(--fs-title)` + `color: var(--danger)`; weight 600 comes from `global.css:36-40`. **No `letter-spacing`**, and no bottom margin, so the 8px title→body gap the board draws is absent (`global.css:39` zeroes `h3` margins and nothing restores it here) | COSMETIC | No | **FIXED** — the two other modals get both from their own scoped `h3` rule; this one is inline-styled and got neither |
| SA6 | Body copy | `Not enough space on device! Required: 26.42 MB, Available: 24.06 MB` (`:2003`) | `roms.ts:47-48` `notEnoughSpace(required, available)` — character-identical | — | **Yes** — flagged as copy, not conformance. An exclamation mark and a colon-delimited `Label: value, Label: value` machine register, under a title (`Space Limit Reached`) already written as a calm sentence-case phrase. Two registers in one dialog. It is also redundant with its own title | **OPEN (copy)** — raised under the standing instruction to bring up clumsy copy rather than ship it. A shorter line stating the shortfall once would replace both halves; no wording is proposed here because it is a seven-file i18n edit and the owner should pick it |
| SA7 | Confirm button | `OK` — `background:#3e9e4e; border:1px solid #3e9e4e; color:#fff; 14px/600; border-radius: 2px; padding: 5px 13px` (`:2003`) | `:2383` `<button class="action primary">`; `.action.primary` `:2611-2615` sets `background`/`border-color` to **`var(--model-accent)`** | — | **Yes** | **CONFIRMED against the board / OPEN as a question.** The board's `#3e9e4e` is `--zelda-green`, so the drawing matches a Zelda device — but `--model-accent` is `var(--zelda-green)` on `.model-zelda` and `var(--mario-red)` on `.model-mario` (`tokens.css:330,333`). **The same OK button is green on one device and red on another, on a dialog whose border and title are `--danger`.** Verified in the token file, not inferred. It reads as unintended: `--model-accent` is a device-identity accent, and this is an error acknowledgement, where a model-shifting colour says nothing and the red case collides with the danger frame. Not fixed here — a fix means either a fixed colour or the neutral `.action`, and that is a paint decision the owner makes |
| SA8 | Actions row | `justify-content: flex-end; padding-top: 16px` (`:2003`) | `:2383` inline `margin-top: 1.5rem` (24px) | COSMETIC | No | **FIXED** |


---

## Fixes with no artboard home — 2026-09-08

Seven fixes landed on 2026-09-08 that **no artboard can adjudicate**, so none of them belongs
under a board. Two classes: a viewport-level declaration every full-bleed band on every board
sits inside, and five surfaces the boards do not draw at all — two native `<select>` popups, a
dropdown menu, and paint that only fails in the dark theme, which the boards are light-only
throughout. They are rows because they are real closes; they are here because forcing them under
a board would misstate where the evidence came from.

**How they were found matters more than that they closed.** G1 came from the owner opening the
app, exactly as A46 did. The other six came from two sweeps his finding prompted — one over every
UA-painted control, one over all 118 hardcoded hex values in `lib/**/*.svelte`. **Not one came
from an artboard walk**, and six survey passes had read the surrounding tables without seeing
any of them.

| # | Element | Artboard specifies | Implementation | Severity | Owner decision? | Status (2026-09-08) |
|---|---|---|---|---|---| --- |
| G1 | Dead scrollbar gutter | Nothing — no board can draw this. Every board's header band, nav band and footer bar runs the full artboard width | `global.css` had `scrollbar-gutter: stable` on `html` while `.app` is `height: 100vh; overflow: hidden`, so the document can never scroll. ~15px was reserved on the right for a scrollbar that cannot exist, and **nothing full-bleed reached the right edge** | WRONG | no | **FIXED** (`a61fcd4`) — replaced with `html, body { height: 100%; overflow: hidden }`, which states the fixed-viewport fact directly. `.tabpane`'s own scrollbar is taken from inside the pane, below the chrome, so nothing shifts when it toggles. **Found by the owner on the running app** |
| G2 | Language menu, open state | No board draws it. The boards draw only the **closed** indicator — `Landing1.dc.html:22`, bare `12px/500 #5c5c5c` — which `9e0f750` already matched | The control was a native `<select>`: its popup is UA-painted, so in dark theme Chromium composited author `--ink-soft` `#9b9b9b` options on its own light popup ground, ~2.5:1. A native select also cannot show a code closed and a language name open | WRONG (dark only) | no | **FIXED** (`92bb436`) — a hand-rolled trigger + menu on `DeviceControls`' pattern. Both menu surfaces are app tokens, so the list follows the live theme; the list shows endonyms (`Deutsch`, `日本語`) and the indicator keeps the short code, which is the boards' `EN`. Keyboard and ARIA parity with the select it replaced. **Found by the owner on the running app.** Survey B's `Language control` row covers the closed indicator and is unaffected |
| G3 | `DeviceControls` dropdown chrome | No board draws this menu. The nearest authority is the floating-panel convention `ModalConnect.dc.html` / `ModalFolder.dc.html` set: outer edge `#d8d8d8`, an inner divider `#ededed` | Both declarations read `var(--border)`, **defined nowhere** in `apps/web/src/styles`. An undefined custom property is the guaranteed-invalid value, so the menu border fell back to `currentColor` (near-black in light, near-white in dark) and the divider **never painted at all** — in either theme | WRONG | no | **FIXED** (`43a1dfd`) — `--hairline` for the outer edge, `--rule` for the divider, matching the language menu. No gate can see an undefined custom property; found by the sweep over the header's own chrome |
| G4 | `RangeField` unit `<select>` popup | No board draws the open popup. `Dump.dc.html:84-85` / `Write.dc.html:85` draw the closed unit segment, which already conformed | `color: var(--ink-soft); background: transparent`. The UA paints the popup from the select's own computed background, so dark theme drew `#9b9b9b` options on Chromium's light ground, ~2.6:1 — the same failure as G2 | WRONG (dark only) | no | **FIXED** (`74dd42f`) — background is now `--surface`, which the `.control` around it already paints, so the closed control is unchanged in both themes |
| G5 | Sources version picker popup | No board draws it | `.vpick` is an `opacity: 0` select over a hand-drawn box. Hiding the control does not hide its popup, which inherited `color: var(--ink)` (`#ececec` in dark) onto the light UA ground — ~1.1:1 | WRONG (dark only) | no | **FIXED** (`74dd42f`) — both colours stated explicitly on the select and its options; the closed control stays fully transparent |
| G6 | Library silver button cap ink | No board draws the dark theme | `RomManagementTab`'s `.action` was `color: var(--ink)` on `background: var(--silver)`. `--silver` is a device-face fill that stays light across themes (`#c9c9cd` → `#9a9aa0`) while `--ink` inverts, collapsing the pair to 2.40:1 in dark | WRONG (dark only) | no | **FIXED** (`74dd42f`) — `--ink-on-face`, the token `tokens.css` defines for exactly this pairing and which `SplitButton` and `DeviceControls` already used |
| G7 | Cheat-row remove hover | No board draws the dark theme | `GameDetailsPanel`'s `.cc-remove:hover` was `rgba(0,0,0,.05)` — a black wash darkens in **both** themes, so on the dark `--surface` it was a ~1% shift, effectively no hover state at all | COSMETIC (dark only) | no | **FIXED** (`74dd42f`) — `--surface-sunk`, the app's hover fill, which flips with the theme |

### Reported by the dark sweep and deliberately not fixed

Recorded here so they are findable; **no rows**, because each needs a token minted or an
already-open gap closed first, and inventing rows for them would put paint the owner has not
ruled on onto the scoreboard.

- **On-fill ink.** Twelve `#ffffff` declarations sit over themed accent fills. `StatusChip`'s
  white-on-green is **3.39:1 in light and 2.69:1 in dark**; white-on-blue **4.02:1 → 3.06:1**.
  Neither passes AA in *either* theme — a pre-existing light-theme shortfall that dark makes
  worse, not a dark-theme defect. The remedy is an on-fill-ink token, which is audit **8.1**'s
  already-open gap; it is not a one-line swap and is not attempted here.
- **`GeometryBar`'s four Material partition fills** — `#1565c0`, `#8d6e63`, `#6a4ca5`, `#546e7a`
  (`:278-287`) — do not flip with the theme. On the dark track the segment **edges** lose
  definition; the labels over them stay readable. A fix mints four tokens.
- **`GeometryBar`'s `.bank-empty` rule** (`:293`) would draw white on `--surface-sunk` — 1.2:1 in
  light. It is dead: the `bank-empty` kind is produced by `classify.ts:214` for the **bank**
  segment set, which `BankCard` renders (and paints correctly at `:327`), not `GeometryBar`.
  Deleting a dead rule is a code change, not a conformance one.

## The ten most significant deltas, in priority order

1. **`FileBrowserSection`'s 72px footer never renders (FB-9).** `PaneFooter` is given a `summary`
   and no children, so `paneFooter.svelte.ts`'s `content` stays null and `FirmwareRail.svelte:135`'s
   `{#if footer.content}` is false. The copy exists (`firmwareSetup.ts:333`) and is unreachable.
   This is a functional bug, not a conformance nit, and it breaks the README's "one footer bar on
   every screen" on one of six panes.
2. **`Write`'s missing `Overwrites` plan row (W-11).** `Write.dc.html:93` names what the write
   destroys, in caution gold. Nothing in `FlashSection.svelte` derives what occupies the
   destination range; `grep -n 'Overwrites' apps/web/src/lib` has no hits. This is the README's
   "warnings say **what you are about to lose**, not which addresses are touched" rule, unbuilt,
   on the app's most destructive control.
3. **Overview's bank card is laid out differently from every bank artboard (A27–A29).** Head row,
   bar geometry and occupant block all diverge, and the occupant name/size render *inside* the
   segment instead of below the bar. `BankCard` is the sanctioned shared primitive, so this one
   component is wrong on `Main`, `BothEmpty`, `NoStockBank1/2`, `StockUnpatched` **and**
   `Firmware`'s target picker — six artboards from one fix.
4. **Overview's `Controls` section exists in no artboard (A20/A21/A23).** Built as written and now
   half retired: `Capture screenshot` belongs on the `Screen` label row, and the `Screen` label
   itself was missing entirely. `Restart flash utility` — which the board drew as the last child of
   *Internal flash*, under the bank cards — is gone from the app and, since `3e8feba` / `5992ad8`,
   from the boards; it is no longer part of this delta.
5. **`Main`'s external-flash panel is a different object (A33/A35/A37/A38).** The artboard's
   free-of-total headline, its swatch legend and its one-row `Filesystem` footer are replaced by a
   capacity caption and a four-row StatPanel — inside a box the artboard does not draw.
6. **The de-boxing pass never reached the asides (BackupPatch #11/#12, W-9, E-*).** The cross-model
   danger aside is still a bordered, `--surface-sunk`-filled box in `--caution` gold where
   `BackupPatchCross` specifies a `#8a241b` left rule on the page ground; `Write`'s `Plan` block is
   a sunken mono well where the artboard has a white surface with a `Plan` caption.
7. **The extflash palette and partition naming contradict every Flash-management artboard (X-4/X-5).**
   `.frogfs` is `#c0392b` — a literal in no artboard and no token — while `.littlefs` takes the green
   the artboards give FrogFS; and labels read `Games` / `Emulators & Saves` / `Free Space` where the
   artboards say `FrogFS` / `LittleFS` / `Free`.
8. **Install-pane copy diverges in meaning, not just wording (F5/F7/F9/F10).** `Keep installed games`
   / `Keep saves and settings` shipped as `Migrate games` / `Migrate saves and settings`; the `Version`
   and `Target` labels are wrong or absent; the per-card `Replaces stock` / `Dual boot` captions became
   one composed sentence.
9. **Custom checkboxes do not exist anywhere (BackupPatch #3/#14, F7, W-6).** Every artboard draws a
   16–17px mark — green with a white check, or a `#8a241b` outline for an acknowledgement — and every
   one of them is a bare native control. `grep accent-color|input[type="checkbox"]` over `styles/*.css`
   returns nothing.
10. **`Landing2`'s step-2 card icons and the `Modded with … Change` row (A9/A10).** Two of the three
    things that artboard adds over `Landing1` are unimplemented, on the app's second screen. The
    `Change` row is already 8.6 OPEN; the icons are new here.

Behind those: the Guided spine and the Firmware rail hold up well — 3.2–3.8, 3.15, 5.1, 5.6–5.8,
5.12 and 6.4 were all re-checked element by element and confirmed.

### Where this survey disagrees with `docs/audit-ui-conformance.md`

- **5.1's status block says `Firmware.dc.html`'s Install-pane footer bar was not adopted.** It has
  been — `RomSection.svelte:946-964` renders the `Advanced layout` link and the split
  `Flash Retro-Go` button in the shared `PaneFooter`, and `firmwareSetup.ts:185-186` carries the
  artboard-verbatim summary. That clause of 5.1 is stale.
- **5.1 is otherwise FIXED except on File browser**, where the bar is declared but unreachable
  (FB-9) — a case the original audit could not see because the markup is present.
- **5.13's `--model-accent` sweep missed `BankCard`'s selectable branch** (`BankCard.svelte:126-129`).
  The non-interactive `.occupied` branch was fixed; the selector was not.
- **`EraseSection.svelte:324-325`'s comment asserts the artboard draws the Selected block "bare on
  the page ground; no fill, no border".** `Erase.dc.html:82` says `background: #ffffff;
  border-radius: 6px`. The comment is wrong about its own citation.
- **5.10 is correctly FIXED** — the spine, the per-file rows and the extflash-collision warning are
  all present, and the row surface, `Valid` chip, disc geometry and radio ring were each re-measured
  and match.

---

## Everything needing an owner decision

Gathered from all four groups. Each is a question, not a patch — none should be actioned until it
is answered.

**Artboard conflicts — two artboards disagree and one control must ship.**

1. **A53 — `NoStockBank1` vs `NoStockBank2`.** One leaves the empty bank silent; the other offers
   `Install stock firmware`. The code always offers.
2. **GL1 — the chooser heading.** `GuidedLayout`: `How Do You Want the Device Set Up?`
   `GuidedLayoutStock`: `What Do You Want on the Device?` (shipped).
3. **GL2 — the Guided column's vertical placement.** Older `Guided.dc.html:75` is top-anchored 64px;
   the newer four-tab Guided artboards vertically centre the column. *(The independent half — the app
   applying both 64px paddings for 128px, wrong under either reading — is FIXED in `79cbd66`. What is
   left here is only the top-anchored-vs-centred ruling.)*
4. **GL3 — chooser card label alignment.** `GuidedLayout` centres it across the card;
   `GuidedLayoutStock` does not.
5. **BackupPatch #19 — the collision aside and the cross-model note** are drawn as mutually exclusive
   across `BackupPatchBoth` / `BackupPatchAllowed`, but the implementation can show both at once. No
   artboard covers the combined state.

**New copy with no artboard source — each is a seven-file i18n edit.**

6. **A33 — Main's `free of X` headline.** No key exists; the phrasing must be authored.
7. **A50 — `Empty` / `—`** for the empty bank card; blocks 8.3.
8. ~~**A21 — `Start Flash Util`.**~~ **No longer an i18n edit.** The control is retired in the app
   and removed from the boards (`3e8feba` / `5992ad8`); no key is to be authored.
9. **GSO2 — `Restore`.** The app reuses the whole step title `Restore Original Firmware`.
10. **F9 — `Target`**, the label above the bank picker.
11. **F10 — `Replaces stock` / `Dual boot`**, two new short keys retiring one long `bankTargetCaption`.
12. **W-11 — the `Overwrites` plan row**, plus a new derivation of what occupies the target range.
13. **D-5 — `matches LittleFS`**, plus a new "typed range equals a scanned partition" derivation.
14. **BackupPatch #18 — the allowed cross-model note.** The artboard's sentence is Mario→Zelda
    specific; the shipped one is model-agnostic and says far less. A generalised body plus a bold
    lead-in must be authored, not copied.
15. **GF6 — `Working. ` vs `Working — `.** A punctuation change across seven locales; confirm it is
    wanted. (The bold run's missing `#8a6508` is a plain fix, no decision needed.)
16. **F1 / F5 / F7 — Install-pane and mode-switch copy.** `Guided` vs `Guided Setup`; `Version` vs
    `Install version`; `Keep installed games` / `Keep saves and settings` vs `Migrate …`. The last
    pair is a change of meaning.

**Copy that would become false if conformed.**

17. **BackupPatch #7 — the collision aside.** The artboard names *"part of your FrogFS games
    partition"*; the implementation's `overlapsInstalled` (`OfficialFirmwareSection.svelte:123-129`)
    also fires for LittleFS and FAT, where that sentence would be a lie. Either the artboard wins and
    the condition narrows, or new copy must cover all three filesystems.
18. **X-4 — `FrogFS` / `LittleFS` / `Free` (artboards) vs `Games` / `Emulators & Saves` / `Free Space`
    (`shared.ts:80-82`).** A naming conflict; whichever wins must win everywhere, including Erase's
    Selected rows and Overview's legend (A36).

**Behaviour that does not exist, or would change if conformed.**

19. **A10 — `Landing2`'s step-2 card icons.** The gamepad glyph is not an asset anywhere, and the
    green tint on the Manage-device icon implies it tracks `device.targetMedia` — unspecified.
20. **A4 / A43 — outline vs filled media glyphs.** `FlashChipIcon.svelte:1-7` deliberately shares the
    filled glyphs between Landing and DeviceHeader; restyling to the artboard outline changes both.
21. **A15 — Overview's two extra `Device` rows.** Dropping `Game & Watch` and `Retro-Go` leaves the
    header slots as the only statement of install state.
22. **A24 — the capture area.** `OverviewTab.svelte:887` argues for a black ground against an artboard
    specifying `#e8e8e8`, and pins 320×240 where the artboard is a fluid `span 5` at 232px.
23. **A38 — the external-flash box.** The code argues the flash chip is "a real object" and so earns a
    border; the artboard draws no box at all.
24. **F12 — `BankCard` vs `Firmware.dc.html`'s stripped target card.** Either a new variant of the
    sanctioned primitive, or an artboard amendment.
25. **GF5 — a hazard lip on the progress modal.** `GuidedFlashing.dc.html:136` gives it a 5px crawling
    lip; `ModalShell` has one static 3px gold lip and **8.9** explicitly forbids growing it.
26. **GR9 — pending steps carrying live controls.** The artboards draw them as inert dimmed titles.
27. **W-3 — the `Image file` control.** A native file input cannot become the artboard's 40px mono
    field without a wrapper. Same choice as 3.12: accept the native control and amend the artboard, or
    commission a wrapper.
28. **W-8 — `Verify after write`'s default.** The artboard draws it unchecked; the code defaults it on
    (`FlashSection.svelte:26`), and CLAUDE.md's flash-verify-overhead note argues for off.
29. **W-13 — the acknowledgement gate.** `Write.dc.html` draws the ack for a bank-2 destination; the
    code gates it to bank 1 only, so the artboard's own case shows no ack.
30. **X-3 — internal-bar segmentation.** The artboard's two `Bank N · <os>` segments versus the
    implementation's per-bank used/free split. Adopting the artboard drops real information.
31. **F17 — unbacked developer surfaces in the Install pane** (the mono `.well` geometry dump,
    `Start bank N`, `Read back superblock (debug)`). Ship, gate behind a dev flag, or draw?
32. **BackupPatch #1 — Step 1's two intro paragraphs.** They serve the no-folder-chosen state, which no
    artboard draws. Make them conditional on `!dir`, or delete them.

**Re-sorted here on 2026-09-07** — carried OPEN by the first marking pass, but each waits on a
decision, not on a patch.

40. **A35 — Overview's external-flash legend.** Cannot be drawn without settling its swatch paint
    (X-5: `.frogfs` is `#c0392b`, a literal in no artboard and no token, `GeometryBar.svelte:185`) and
    its second label (A36). Build it first and you bake in both unruled answers.
41. **A37 — the external-flash footer row set.** Its copy half is done (`filesystemLabel`, `bc356de`).
    Its shape half is behind **A33**: cutting the four `panel-footer` rows to the artboard's one
    deletes `Free`, and A33's `free of X` headline is what is meant to carry that number instead.
42. **X-1 / A34 — the geometry bar's height, radius and track.** Write/Dump/Erase/FileBrowser say
    `34px`/`3px`; `Main.dc.html` says `10px`/`5px`; `InstallGeometry` and `RomSection` have no artboard
    at all. Needs a size prop **and** a ruling on what the two unbacked call sites take.
43. **X-7 — the hover-detail strip.** Removing it removes click-to-pin selectable-address detail from
    all eight `GeometryBar` call sites. That is a functionality call, not a conformance one.
44. **D-4 — the unit-picker chevron.** The fix is `appearance: none` plus a hand-drawn arrow on
    `advanced/RangeField.svelte`'s `<select>`; whether the result matches cannot be judged without a
    render, so it belongs with the browser pass, not the code backlog.

**States with no artboard at all.** Each needs one commissioned, or an explicit acceptance that the
app diverges here permanently.

33. **A13** — `(Unsupported Browser)` on Landing2's Manage device card.
34. **A40** — Overview disconnected / scanning / needs-scan.
35. **A41** — the `Boot Image` confirm modal (invented copy, no artboard source).
36. **A47** — the header's `patchMissing` value.
37. **FB-12 / W-16 / D-11 / E-13 / BackupPatch #6** — the `Enter Recovery Mode` gate that replaces
    each Flash-management pane, and the same affordance in the Backup & patch footer. Five panes, one
    undrawn state.
38. **D-10** — the Dump progress/cancel state (queued behind the same gap as **8.13**).
39. **F18** — the opened state of the `Advanced layout` drawer. The artboard names the affordance but
    never draws what it opens.

---

## What this survey could not determine

Read entirely from markup, CSS and the i18n tables. **Nothing was rendered.** Specifically unresolved:

- **Every measurement that depends on real width.** Whether the 470px Guided column, the 720px Install
  pane and the 880px Backup & patch body land where the artboards put them; whether the spine's disc
  and connector align to the 30px track; whether `RangeField`'s content-height control reaches the
  artboards' 40px.
- **Whether `GeometryBar`'s labels are legible at real segment widths.** `GeometryBar.svelte:78`
  suppresses a label below `pct > 7`, and the `LittleFS` segment in `FileBrowser.dc.html` is 5%.
- **Dark theme, everywhere.** Every artboard in this survey is light-only; every dark value in the app
  is derived. Same gap the earlier audit records at S7.16 / S8.11, and it remains the single
  highest-value unlooked-at thing.
- **`SplitButton`'s caret divider paint** (F16) and the `action` button variant's exact padding/radius
  against `9px 22px` / `5px` (GR7) — flagged rather than claimed.
- **`StockUnpatched`'s bank occupant name.** The artboard says `Zelda OFW (stock)`; the app takes the
  string from `classify()` at runtime, so its case and format could not be confirmed without running
  a scan — and no device was touched.

---

## OPEN-row re-verification — 2026-09-08 (triage pass, no status changed)

All **21** rows this file still carries as OPEN were re-read against the current tree, one by
one, citing code rather than recollection. **None is stale**: every stated defect is still
present, so no cell moved OPEN → FIXED and the `docs/CONFORMANCE.md` scoreboard is unchanged.
This is recorded because a prior session dispatched agents against already-finished work from a
list nobody had re-verified.

The 21 split three ways for dispatch purposes:

- **Safe to hand to an agent now (artboard states the answer unambiguously, no owner input):**
  RM7, RM8, MK6, SA8, SA5, SA4, FBF-1, RM6. Ordered by user-visible impact in the report that
  produced this note; RM7 (bold run rendered in `--ink-soft` instead of full ink) and FBF-1
  (green selection ring on a green fill — invisible) are the two that are actually *seen*.
- **Needs an owner decision — do NOT dispatch:** GF3, FF1, FF10, FB-13, FB-14, MK4, MK5, MK9,
  MK11, MK13, MK14, SA6. These need new copy in seven locales, a ruling on which of two drawn
  boards is wrong, or a behaviour call (`settling` vs idle on the error path).
- **Contract-only, not a shipping screen:** MK10 — `ConfirmModal`'s determinate branch is
  unreachable because no caller of `run` ever invokes `report` (`OverviewTab.svelte:286`
  `runBoot(report: any)` drops it; `DeviceHeader.svelte:298`'s `run` takes no argument).
