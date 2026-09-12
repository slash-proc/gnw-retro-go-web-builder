# UI conformance — the real state

**Read this before `docs/audit-ui-conformance.md`.** That document is a *findings list* and 38
of its 46 findings are closed, which is easy to mistake for "the app matches the design". It
does not. That audit was a structural pass: most artboards are cited in it once or twice,
meaning someone recorded one specific delta rather than comparing a screen element by element.
Quoting its 38/46 as progress against the mockups was wrong, and it sent this project chasing
cleanup work while whole screens sat unbuilt.

**The same trap applies to the numbers below.** Of the 616 rows, 228 read FIXED or
CLOSED. That is not "37% of the way to the design" — it is 37% of the *rows*, and the rows are
not equal. It was also measured against a set of artboards that moved under it. **That re-walk is now
finished** — every row on a board `31cc2f7` corrected has been re-read against the corrected
version (see below); two of them had been built to match board text the sync deleted, and were
rebuilt. Treat the percentage as a ceiling, not an estimate. The
closed ones cluster on four Flash-management panes, a bank card, Overview's copy and a handful of
modal nits; what is left includes whole sections that exist in no artboard and copy conflicts
nobody has ruled on. **The share that is closed went up mostly because the cheap rows were the
cheap ones** — a seven-file casing edit and a `border-radius` land in the same column as a screen
that was never built.

## The actual measurement, and where it now stands

**56 artboards have been walked** element by element against their implementation: 48 approved,
plus the eight drawn 2026-09-08 for surfaces that had no board.

**The canvas now holds 85, so 28 screens have never been surveyed at all** (plus
`Specimen.dc.html`, a type specimen rather than a screen, which has no implementation to walk
and never counts). The numerator above is correct and the old denominator of 57 was not: boards
were added after both surveys and the figure was never re-derived. **The scoreboard below counts
rows, not boards, so an unsurveyed board contributes nothing to it and cannot lower it**. A
board with no rows is invisible to a row count, which is exactly how this drifted unnoticed.
Read the percentages as a measure of the boards that were walked, never as coverage of the set.

The 28 cluster in two places, and both arrived after the last pass: the Sources surfaces
(`SourcesRail`, `SourcesCache`, `SourcesAddRoms`, `SourcesRomFolders`, the configure and
supplied-files boards, and the rest of that family) and the composed Library
(`LibraryComposed` and its four options and summary boards). `FirmwareUpgrade`, `GuidedLocked`,
`Landing2Unsupported`, the three `Modal*` boards and the four `Roms*` boards make up the
remainder. `apps/web/test/artboard-index.mjs` now fails when a board exists in no survey and is
not declared exempt, so the next one cannot arrive silently.
As of **2026-09-08 (merge sweep)** every status cell in both surveys has been counted
mechanically — every cell parsed, none inferred from a header — and the counts below are that
count, not a carried-forward figure. The sweep's own changes are set out in *Rows closed by
merges the surveys had not caught up with* below; the parser was re-validated against two
hand-counted tables before its output was trusted, as the derivation rule requires.
**Re-counted again on 2026-09-08 by the retired-controls pass** (*The three retired controls,
closed from the board side*, below) — four rows were re-stated, no status cell moved, and every
figure in the table reproduces.

**2026-09-08, visible-defects pass — +11 rows, +12 FIXED, and the provenance is the point.**
Eight user-visible fixes landed that day and **not one had a survey row**. Two of them are
defects the owner found **by opening the running app**, after every static pass had read the
surrounding code and missed them. They are now recorded: survey A goes **310 → 319**
(FIXED 117 → 127, OPEN 22 → 21), survey B **295 → 297** (FIXED 90 → 92).

- **A46 / A47** (survey A, `Main`): the header band was **centred** — `.header-left` and
  `.header-right` both `flex: 1` around a fixed middle child, so `space-between` had no slack,
  while `Main.dc.html:22` draws two children with the content hard left; and a hairline under the
  header that no board draws sat directly above the tab labels, which carry the region's only
  1px `#d8d8d8` (`Main.dc.html:65`). `a61fcd4`, `9d8baad`.
- **Footer dock / Sources bar** (survey B, `Roms` and `Repos`): both were capped at `--maxw`
  because `.page-body` sat on `.tabpane` itself, and a child can cancel padding but not a
  `max-width` — 280px short each side at 1920, invisible below 1440. `f2ad9db`. Firmware was
  always right: `.tabpane.bleed` drops the cap, which is why that tab "just sits".
- **F1a** (survey A, `Firmware`) moves OPEN → FIXED: the mode-switch idle word was `--ink-mute`
  where all 24 boards drawing it use `--ink-soft`. `c7e1577`.
- **G1–G7** are seven new rows in survey A's *Fixes with no artboard home*, because no board can
  adjudicate any of them: a viewport-level `scrollbar-gutter: stable` that reserved ~15px for a
  scrollbar `.app`'s `overflow: hidden` makes impossible, so **nothing full-bleed reached the
  right edge** (`a61fcd4`); the language menu's open list, replaced with a custom menu showing
  endonyms while the indicator keeps the short code (`92bb436`); `DeviceControls`' `var(--border)`,
  **defined nowhere**, so the menu border fell back to `currentColor` and the divider never
  painted (`43a1dfd`); and four declarations that resolve in one theme only (`74dd42f`).

**What this says about the surveys, plainly.** Six passes walked these tables and closed 216 rows
without seeing a centred header, a dead 15px gutter, or two footer bars stopping short of the
page edge. The static method found none of them and the owner found two in one sitting; the
remaining six came from two sweeps his finding prompted, not from an artboard walk. **The
surveys' coverage of anything that only resolves at a real width, in a real theme, or through a
UA-painted popup should be read as near zero** — which is the same conclusion the *What no
amount of code reading can settle* section reaches, now with worked examples.

The dark sweep also reported **three things it deliberately did not fix** — twelve `#ffffff`
declarations over themed accent fills (`StatusChip`'s white-on-green is 3.39:1 light / 2.69:1
dark, failing AA in *both*, whose remedy is audit 8.1's already-open on-fill-ink token),
`GeometryBar`'s four unthemed Material partition fills, and `GeometryBar`'s dead `.bank-empty`
rule. They are written up under *Reported by the dark sweep and deliberately not fixed* in
survey A and carry **no rows**, so no count above moves for them.

**2026-09-08, header-status pass — +2 rows in survey B, both new, neither built.** The header's
`statusText` derivation (`DeviceHeader.svelte:49-63`) was walked branch by branch against every
board. It has **eight** outcomes; the canvas draws **four** of them. Three connected wordings —
`Connected (Retro-Go)`, `Connected (${label})` and a bare `Connected`, all on the pre-stub path —
appear on no board and are recorded as one BLOCKED row in `HeaderBusy`, now **Q24** in
`docs/BLOCKED-AUDIT.md`. The unscanned and post-disconnect header is the second row, CONFIRMED
under the standing ruling. Survey B goes **293 → 295**, BLOCKED 15 → 16, CONFIRMED 172 → 173.
`Connection lost` / `No connection` were checked in the same walk and are **not** a finding: no
board draws either, so there is no delta, and the lowercase they are sometimes written in is
`docs/DECISIONS.md` #66's prose, not an approved wording.

| survey | artboards | rows walked | FIXED | CLOSED (decided, kept) | OPEN | BLOCKED | CONFIRMED | CANCELLED | undetermined | no status |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| [`audit-artboard-conformance-a.md`](./audit-artboard-conformance-a.md) — Landing, Guided x7, **flash boards x3**, Overview/banks x5, Firmware **+ FirmwareLayout**, Write/Dump/Erase **+ EraseCustomRange**/FileBrowser **+ FileBrowserFrogfs**, BackupPatch x4, **the eight new boards** (ModalRecoveryMode, ModalConfirm **+ Running/Progress/Done/Error**, RomsNoFolder, ModalSpaceAlert) | 37 | 319 | 141 | 0 | 15 | 16 | 144 | 0 | 1 | 2 |
| [`audit-artboard-conformance-b.md`](./audit-artboard-conformance-b.md) — Roms x4, LibrarySummary, Repos x4, Modals x9, HeaderBusy | 19 | 297 | 92 | 9 | 0 | 16 | 173 | 2 | 2 | 3 |
| | **56** | **616** | **233** | **9** | **15** | **32** | **317** | **2** | **3** | **5** |

Both rows sum to their own row count: 319 and 297.

**2026-09-08, new-boards pass — +4 artboards and +34 rows, and the FIXED column does not
move.** `ModalRecoveryMode`, `ModalConfirm`, `RomsNoFolder` and `ModalSpaceAlert` were drawn
hours earlier for four surfaces that ship and had never had a board; before this pass neither
survey carried one row for any of them. Survey A goes **271 → 305**: CONFIRMED 121 → 143,
OPEN 7 → 16, BLOCKED 23 → 24, COULD NOT DETERMINE 1 → 2. Per board: `ModalRecoveryMode` 11
(8 CONFIRMED / 3 OPEN), `ModalConfirm` 9 (6 / 2 / 1 undetermined), `RomsNoFolder` 6
(5 CONFIRMED / 1 BLOCKED), `ModalSpaceAlert` 8 (4 / 4). Nothing was built.

**Then four more boards landed the same day** — `ModalConfirmRunning`, `ModalConfirmProgress`,
`ModalConfirmDone`, `ModalConfirmError` — and the placeholder row above was replaced with a real
walk. Survey A goes **305 → 310** (six new rows for one retired placeholder), OPEN 16 → 22,
CONFIRMED 143 → 144. `ConfirmModal` is now the most thoroughly drawn component in the app: five
boards for four phases.

That walk found the app's **thinnest failure state** and a **board that cannot be reached**:

- `ConfirmModal`'s error phase renders a bare `Error.message` under an unchanged title with a
  single `Close` — no retry, no route to the device log — and keeps the **gold** lip while
  `FlashFailure.dc.html:84` swaps its dialog to `--danger`. The `lip="danger"` prop is **not**
  unused, as first reported: `InstallProgressModal.svelte:102` drives it off
  `modalPhase === "error"`. The true finding is narrower and worse — **two error surfaces
  disagree, and the app answers by omission rather than by decision**.
- `ModalConfirmProgress` draws a determinate two-bar state **no code path can produce**: the
  branch needs `report()` to have been called, and neither call site calls it (`runBoot` takes
  the argument and drops it; `DeviceHeader`'s inline `run` does not take it). Read that board as
  an API contract, not a shipping screen.
- The two `Progress` bars have **zero separation** and no board says otherwise — including the
  new one, which was drawn from this code. Not an artboard-vs-code delta; a defect with no
  artboard authority either way.
- `ModalConfirm.dc.html`'s own body spacing is **wrong about us**: it draws a `display: flex;
  gap: 8px` stack of `<span>`s, a model this component never uses. The four later boards draw
  what actually renders — `<p>` elements carrying the UA's `1em` margin, because `global.css`
  resets `h1,h2,h3` and never `<p>`. Rows MK4 and MK5 are re-statused as **defects in our own
  board**, MK5 having been CONFIRMED in this pass's first draft by reading the `h3` margin and
  stopping before the `<p>`'s.
- The indeterminate shuttle's mid-stop is `--model-accent`, so it runs green on a Zelda device
  and red on a Mario one. **That is the space-alert `OK` defect a second time**, in a second
  dialog; the two should be ruled on together.

**Those 22 new CONFIRMED rows are the weakest CONFIRMED in this document, and the survey says
so on its face.** The four boards were drawn *from* the components, so a match records what the
code does — not that the owner approved the drawing and the code met it. Every other CONFIRMED
here sits behind an approved board. **Do not total the two as if they were equal**; the
denominator grew 6% on evidence that is a grade thinner than the rest.

What the pass actually found is in the nine OPEN rows, three of them real defects nobody had
seen: the space-alert's `OK` takes `--model-accent`, so it renders Zelda green on one device and
Mario red on another **on a dialog whose border and title are `--danger`**; `ConfirmModal`'s and
the space alert's body lines both render at 16px against the boards' 14px, each because the
paragraph's styling sets colour and no size; and `StubLoadModal`'s bold runs inherit
`--ink-soft` where the board steps them up to full ink. A fourth reported delta — that Cancel
draws as bare text but renders as a bordered pill — **was checked and is not real**;
`Button`'s `cancel` variant has been bare text since `7fd667f`, and it is recorded once, at that
scope, rather than as a row on each board.

Two rows are questions rather than measurements. `RomsNoFolder` has **no footer bar**, which its
own board documents and which `docs/design/mockups/README.md` both asserts (`:70`, *"One footer
bar on every screen"*) and contradicts (`:47`, *"and no footer bar"*) — the README disagrees with
itself and this is the screen where it shows. And the space alert's body copy (*"Not enough space
on device! Required: 26.42 MB, Available: 24.06 MB"*, under a title reading *Space Limit
Reached*) is raised under the standing instruction to flag clumsy copy: an exclamation mark and a
machine-register key/value pair under a calm sentence-case title, saying the same thing twice.

`ConfirmModal`'s running / done / error phases are still unboarded — a concurrent pass is
drawing them. They carry one placeholder row (COULD NOT DETERMINE) so the gap is visible on the
scoreboard rather than silently absent, and are deliberately not surveyed: there is nothing yet
to measure against.

**2026-09-08, nav-band pass — the only movement, and it is +2 rows, not +2 built things.**
Survey A gained **F0** and **F1a**: the tab bar and the Guided/Advanced mode switch, measured for
the first time because the premise that kept them out — that most boards were an *older three-tab
generation* whose nav chrome was retired and therefore exempt — is dead. After `31cc2f7` re-synced
the mockups, **all 44 boards in `docs/design/mockups/` that draw the nav band draw the same four
tabs**, and the exact lines survey A cited as three-tab evidence (`Guided.dc.html:67-69`,
`Firmware.dc.html:65-67`) now hold four-tab markup. Survey A's preamble and its two per-board
"generation notes" have been rewritten in place. **Six citations of 8.5 were re-statused** — the
four that name it as BLOCKED outright (the `F1` row cell, the `F1` bullet in Firmware's
owner-decision list, the "also carried" line, and the `BackupPatch` shared-skeleton paragraph) and
the two per-board generation notes on `Guided` and `Firmware` that supplied its premise — plus the
preamble that stated the premise in the first place. **8.5 is no longer blocked**: 24 boards draw the switch, byte-identically, so
there is nothing left to decide. What survives is a single token — `.modeswitch button`
(`Advanced.svelte:425`) paints idle words `--ink-mute` `#6e6e6e` where every board draws `#5c5c5c`
= `--ink-soft` — recorded as **F1a OPEN**. The tab bar matches value for value and is **F0
CONFIRMED**. Nothing was built; a block became a one-line fix, and a nine-value element that had
never been counted got counted.

**How these numbers are derived (2026-09-08, counts pass) — so this does not have to be
re-litigated a fourth time.** Every line beginning `|` in each survey is parsed. A table counts as
a *row* table only if it carries a `Status …` column that is not column 0; that excludes the eight
summary tables across the two files, whose first column is `Status`, `Artboard` or `the row said`.
Cells are split on `|` **outside** backtick spans, so a row whose content contains an inline pipe
cannot shift the column indices. A row's status is the **leading** token of its status cell alone,
never a status word appearing later in that cell's prose — the bug that once made 30 rows count as
31. Split verdicts (`FIXED in part`, `FIXED (glyph) / CONFIRMED (the swap)`, `SETTLED —
CONFIRMED`) resolve to their leading family, which is what every previous header did.

**Re-validated 2026-09-08 (new-boards pass), for the third time.** The rule in the paragraph
above was re-implemented from that paragraph alone and run against both surveys *before* any
edit: it reproduced the published split exactly in every cell — survey A 271 (FIXED 117 / OPEN 7
/ BLOCKED 23 / CONFIRMED 121, counting the one `SETTLED — CONFIRMED` under its leading family /
undetermined 1 / no status 2) and survey B 293 (FIXED 90 / CLOSED 9 / BLOCKED 15 / CONFIRMED 172
/ CANCELLED 2 / undetermined 2 / no status 3). Two whole tables were then **hand-counted**, both
in survey A: **`Landing1`** (8 rows: FIXED 7, CONFIRMED 1) and **`Erase`** (13 rows: FIXED 7,
CONFIRMED 6), each by reading every status cell in the table. Both matched the parser exactly.
Only then were the 34 new rows added, and re-running it gives survey A **305**; the
ConfirmModal-phases rows that followed take it to **310**, re-run under the same rule. Two rows had to
be re-cut to be countable by the rule rather than to change their verdict: one was missing its
*Implementation* cell, which shifted the column index, and one led its status cell with the word
`Placeholder`, which is not a status family — it is now `COULD NOT DETERMINE`.

**Validated before it was trusted**: the parse reproduces the per-artboard `rows` column of both
surveys' own summary tables, board for board, for all 48 artboards; and two whole tables were
counted by hand — survey A's `Main` (32 rows: FIXED 25, CONFIRMED 7) and survey B's `HeaderBusy`
(31 rows: FIXED 7, BLOCKED 4, CONFIRMED 19, COULD NOT DETERMINE 1). Both matched the parser
exactly.

**Re-validated 2026-09-08 (nav-band pass), independently.** The rule above was re-implemented from
this paragraph alone and run against both surveys *before* any edit: it reproduced the previous
figures exactly — survey A 269 rows (FIXED 117 / OPEN 6 / BLOCKED 23 / CONFIRMED 120 / undetermined
1 / no status 2), survey B 293 (FIXED 90 / CLOSED 9 / BLOCKED 15 / CONFIRMED 172 / CANCELLED 2 /
undetermined 2 / no status 3). Two further whole tables were then **hand-counted**, both in survey
A and both chosen because this pass edits them: **`Guided.dc.html`** (8 rows, all CONFIRMED) and
**`Firmware.dc.html`** (18 rows: FIXED 8, CONFIRMED 9, BLOCKED 1 — counted by reading all eighteen
status cells, and taking care not to miscount the `**Yes**` / `**Yes for the copy**` entries in the
*Owner decision?* column as statuses). Both matched. The parser also independently reproduced the
doc's own earlier hand-count of `Main` (32 / 25 / 7). Only then were the two new rows added, and
re-running it gives survey A **271** — the +2 above, and no other cell moved. Note that
`Firmware.dc.html` therefore now carries **20** rows, not 18; the frozen 2026-09-07 per-artboard
table in survey A still reads 18 by design, exactly as it still reads 12 for `FileBrowser`.

**Survey B needed no correction** — its stated split was right in every column, so the previous
pass's rewrite of it stands and nothing has been reversed. **Survey A was wrong in one place
only**: one row (`Destructive hover`, *"out of artboard scope, noted only"*) had been counted as
CONFIRMED although its cell carries no status, so survey A reads CONFIRMED 94 / no-status 2, not
95 / 1. No row count moves. Survey A's own flash-boards summary table was also still showing
FlashFailure as 2 FIXED / 7 BLOCKED, the pre-`5e6f658` figures its own prose had already
superseded; it now reads 7 / 2, and that table's total 8 / 2 / 14 / 6.

**The 2026-09-08 flash-boards pass moved survey A from 211 rows to 241** — 30 new rows for
`FlashingCancel`, `FlashingCancelConfirm` and `FlashFailure`, the three boards that had never been
walked (FIXED 3, OPEN 2, BLOCKED 19, CONFIRMED 6). It is the only change to these figures; every
other cell is the previous mechanical count, unre-counted by that pass and marked as such. Note
what it does to the BLOCKED column: **26 to 45**. Nothing regressed — nineteen questions that were
never being tracked are now on the scoreboard, sixteen of them the same question.

**Then `5e6f658` built the FlashFailure dialog, and 2026-09-08's status-application pass recorded
it** (each row re-verified against the code, not transcribed). Six FlashFailure rows moved —
FF3 (danger lip), FF5 (head-band failure sentence), FF7 (`Blocks that failed` caption), FF8 (the
block rows), FF9 (the advice aside) out of BLOCKED, and FF6 from *FIXED in part* to FIXED. Survey
A's FIXED goes **105 → 110** and its BLOCKED **29 → 24**; the totals row goes **193 → 198** FIXED
and **45 → 40** BLOCKED. Row counts are unchanged at 241 / 534 — nothing was added, statuses
moved. The 16 rows behind the running-flash Cancel question are untouched, and FF11
(`Retry install`) stays BLOCKED, which is why FF9's aside still ends by naming an action the app
does not have.

## 2026-09-08 — the three retired controls, closed from the board side

`3e8feba` and `cc09387` (merged as `5992ad8`) removed three controls the owner had already retired
but the artboards were still drawing: **`Restart flash utility`** from the 12 boards that carried
it, the **`new` system badge** from `RomsNewSystem`, and the **privacy note** from `ReposDetail`
and `ReposDetailReady`. `grep` over `docs/design/mockups/*.dc.html` now returns nothing for any of
the three, and neither does `apps/web/src` — the only residue anywhere is the phrase inside
`OverviewTab.svelte:842`'s CSS doc-comment.

Four survey rows cite them. **Not one status cell moves**, and the counts in the table above are
unchanged. What moved is the *reason* each row reads as it does:

| row | survey | its claim | why it now closes | status |
|---|---|---|---|---|
| A20 — the `Controls` section | A | app drew a `Controls` section no board shows; the board put `Restart flash utility` elsewhere | already FIXED in code (`02d83be`); the restart half of the delta is now gone from the board too, leaving only `Capture screenshot` | FIXED, unchanged |
| A21 — flash-utility action copy | A | app's `Restart Flash Util` / `Start Flash Util` did not match the board's `Restart flash utility`, and the not-loaded state had no board copy | the control is gone from the app and now from the boards; the copy question it carried is moot | FIXED, unchanged |
| New-system filter chip | B | board draws a green-outlined `WonderSwan 4` chip with a `new` pill; app has no `isNew` concept | CANCELLED on the owner's ruling; the drawing has now been withdrawn, so the row records conformance rather than a cancelled gap | CANCELLED, unchanged |
| Privacy note under the section | B | board draws `Runs in your browser. Your ROM never leaves your computer.`; app has it nowhere | same — and the "add it, or accept the modal subtitle as coverage" decision is moot | CANCELLED, unchanged |

**The two directions are not the same case and the rows are not the same kind of close.** A20 and
A21 ran *app-draws-what-no-board-shows* and were closed by fixing the app. The two survey-B rows
ran *board-draws-what-the-app-lacks* and are closed by withdrawing the drawing. **Neither survey's
status vocabulary distinguishes a board-side close from a code-side one** — FIXED and CANCELLED
carry both — so the distinction is recorded in each row's prose and here, not in a new column.
Nothing was invented to hold it.

Two corrections to what a previous pass reported:

- **The `Restart flash utility` row was never in the Device panel.** It was the last child of the
  **Internal flash** section, under the two bank cards (`3e8feba`'s diff shows it removed from
  exactly there in all 12 boards). No survey row placed it in the Device panel — A20 said
  *Internal flash* and was right — but the misplacement was reported, so it is on the record.
- **That is unrelated to the open Device-panel delta.** HANDOVER §4 records the Overview Device
  panel as *the mockup's three rows* and `DECISIONS.md` #33 records the app rendering five. That
  question is untouched by any of this and stays open.

Four prose lists were also re-cut, none of them row tables and none affecting a count: survey A's
*Owner decisions* bullet and its *New copy with no artboard source* item 8 both carried A21 as
outstanding, its *ten most significant deltas* item 4 described the retired row as a live
divergence, and survey B's *Sources* item 13 carried the privacy note as an open decision.

**Counts re-derived, and the parser hand-validated first.** The rule stated below was
re-implemented from its own paragraph and run against both surveys before any edit; it reproduced
the published split exactly in every cell of both — survey A 310 (FIXED 117 / OPEN 22 /
BLOCKED 24 / CONFIRMED 144 / undetermined 1 / no status 2) and survey B 293 (FIXED 90 / CLOSED 9 /
BLOCKED 15 / CONFIRMED 172 / CANCELLED 2 / undetermined 2 / no status 3). Two whole tables were
hand-counted before the parser's output was trusted, both in survey A: **`Landing1`** (8 rows:
FIXED 7, CONFIRMED 1) and **`Erase`** (13 rows: FIXED 7, CONFIRMED 6), each read status cell by
status cell. Both matched. Re-running after the edits gives the same figures, cell for cell.

Two implementation notes for whoever re-derives this a fifth time, since both cost a wrong answer
on the way to the right one. A markdown row line begins with `|`, so a naive split yields an
**empty leading cell** — drop it, or every summary table whose first column is `Status` passes the
"not at index 0" test and adds seven phantom rows to survey A. And the leading-token split must
treat a **trailing full stop** as a delimiter: three cells read `**BLOCKED**.` / `**CONFIRMED**.`
and are otherwise counted as carrying no status.

### The arithmetic that was wrong, stated plainly

- **Survey B did not sum to 293. It summed to 274**, and the previous pass said so but attributed
  the 19-row gap to an inherited undercount it did not have time to close. It is closed here, and
  the gap was not 19 missing rows — it was **two whole status values the header table had no
  column for**: nine rows reading `CLOSED — DECIDED` (a question ruled on and the code kept) and
  a second `CANCELLED` row. Counting those, plus the eight rows the header put under CONFIRMED
  that their own cells mark FIXED, closes it exactly. **No row was missing; the header was.**
- **Survey A's total was right; its FIXED/OPEN split was not.** The header read FIXED 102 / OPEN 5
  / cross-reference 2. The cells read FIXED 105 / OPEN 3 / cross-reference 1: A54, A57 and A63
  were re-statused to FIXED in the blocked audit and the summary list that still calls them
  "pointers, still open" was never re-cut. 102+5+2 and 105+3+1 are both 109, which is why the
  error survived a total-checking pass.
- **The 174 FIXED in the previous version of this table was an undercount.** The real figure is
  **190** across both surveys — 193 before this pass reopened three of survey A's against the
  corrected artboards, **198** since `5e6f658`'s FlashFailure rows were applied, and **207** since
  the 2026-09-08 merge sweep applied nine more that had been closed in code without the surveys
  being updated.

None of this means more of the design is built than yesterday. The rows moved between columns;
almost none of them moved because code was written.

## 2026-09-08 — rows closed by merges the surveys had not caught up with

`cadf918` re-statused both surveys. **Twenty-three commits landed after it**, and nine survey rows
were closed by them without either survey being updated — the same failure mode this document
records twice already, running the other way: bookkeeping that reads worse than the code.

Every row below was verified **against the code**, not against a commit message. The commit is
named so the claim can be re-checked, but nothing here was closed on the strength of one.

| row | survey | was | now | verified against |
|---|---|---|---|---|
| FBF-7 — footer summary per selection | A | OPEN | FIXED (`347ef5b`) | `FileBrowserSection.svelte:123-129` switches on `selectedFs`; `footerSummaryFrogfs` in `firmwareSetup.ts:341` and in all seven sibling locale files |
| FB-4 — partition caption | A | OPEN | FIXED (`5442258`, comment `0763892`) | `captionTitle` at `FileBrowserSection.svelte:31-37` = `Cores, saves (LittleFS)`, no `captionAddr`; `.cap` `:316-322` is 11px/700/`0.11em` uppercase on the page ground, inside `.caprow` `:309-315` |
| FB-6 — read-status copy and placement | A | OPEN | FIXED (`5442258`) | `firmwareSetup.ts:334` is `reading · {pct}%`; rendered as `.capstat` beside the caption (`:248`), not in place of the tree |
| E-7 — Erase caution line | A | OPEN | FIXED (`5442258`) | `firmwareSetup.ts:306` carries the comma, not the em-dash |
| row 10 — backup row size column | A | OPEN | FIXED (`5442258`) | `OfficialFirmwareSection.svelte:463` uses `formatSize`, which trims `.00`; the local `rowSize`/`toFixed(2)` is gone |
| row 18 — cross-model allowed note | A | OPEN | FIXED (`fa6ffed` + `5442258`) | `firmwareSetup.ts:71-73` — bold lead-in plus a model-generalised body with both em-dashes gone |
| A2 — header right controls | A | BLOCKED | FIXED (`9e0f750`, `8492751`) | `.icon` `DeviceHeader.svelte:316-325` has no background, border, shadow or radius; `.lang-select` `:326-335` is `--fs-micro`/500/`--ink-soft`; theme control is the 16px stroked crescent SVG `:170` |
| Language control | B | BLOCKED | FIXED (`9e0f750`) | same code; the options now carry the uppercase locale code, so the closed state is the boards' `EN` and seven locales stay reachable |
| Caution ring on the busy chip | B | CONFIRMED | FIXED (`352e8af`) | `DeviceControls.svelte:167-169` — `.unsafe` drives only the throb; the 2px `--caution` halo and caution border are gone, so the busy chip keeps the idle chip's border and inset shadow (`:125-140`) |

Five of the nine are the rows `cadf918` itself reopened against the resynced artboards (FB-4,
FB-6, E-7, #10, #18). `5442258` rebuilt every one of them eighteen commits later. **A survey row
can go stale in the hour after it is written**, and OPEN is as unreliable a reading as FIXED.

### Two rows added, both OPEN, neither written

Both are the same shape as FBF-7 — the footer telling the user to do something the pane will not
let them do — in states **no artboard draws**, so neither can be closed by an agent:

- **FB-13 — LittleFS selected, Recovery Mode off.** `canDownload` also requires
  `device.utilLoaded` (`FileBrowserSection.svelte:116`), so the rows render as inert divs while
  the footer still reads *"Click a file to download it from the device."* The rows carry a
  `downloadNeedsRecovery` tooltip; the footer does not. Needs the owner's wording, or a ruling
  that the tooltip is enough.
- **FB-14 — no partition selected.** The summary is `undefined` (`:123-129`), so the 72px bar
  renders with an empty slot. The code states the reasoning (neither board draws a footer line
  with no selection, so none was invented) and the pane head's subtitle carries the instruction,
  but it is an undrawn state that no row covered.

### What this pass did not touch

- **`docs/BLOCKED-AUDIT.md`'s Q1** is closed by `9e0f750` and still written up as open there. That
  file is outside this pass's ownership; it needs its own pass.
- Survey B's `Busy state disables destructive controls` row cites the amber ring as the app's
  substitute signal for controls it does not disable. `352e8af` removed the ring, so that clause
  is stale — but the row's question (Q18) is unaffected and its status does not move.
- `DeviceHeader.svelte`'s `.theme-btn` comment still says *"the language control keeps that silver
  cap; its treatment is an open owner question"*. `9e0f750` removed the cap in the same file and
  left the comment behind. A defect, recorded not fixed — this is a verification pass.
- **FBF-1 was re-checked and stays OPEN.** `GeometryBar.svelte:199-201` still rings the selection
  in `--zelda-green` over a `--seg-games` fill, and `FileBrowser.dc.html` and
  `FileBrowserFrogfs.dc.html` still specify two different ring colours. Nothing has moved.

## 2026-09-08 — re-status against the merges since `8ed21e6`

The surveys were last re-statused in `8ed21e6`. **Eighteen merges have landed since**, and the
one that matters most is `31cc2f7`, which synced 19 artboards that were a generation behind the
published canvas. What follows is what that changed, verified by diffing every one of the 19
boards rather than by reading the sync commit's own message — which claims the pane bodies were
byte-identical and is wrong on nine of them.

### The class of verdicts `31cc2f7` invalidated — now walked

**Survey B closed 29 rows on the grounds that `Roms.dc.html` and `RomsOptions.dc.html` were "the
older three-tab generation, superseded where it conflicts."** As of `31cc2f7` both boards draw
the app's real four tabs and are the same generation as `RomsNewSystem` and `LibrarySummary`, so
that premise was gone; they also moved more than any other board in the sync — 79 and 95
substantive lines outside the tab bar.

**All 29 were walked on 2026-09-08 and no status cell moves.** On every contested point the
corrected board now draws what the code already does: no row checkbox, one name weight at
`14px #1b1b1b`, the status *pill* in place of the uppercase `Installed` caption (`StatusChip`
matches it token for token), `Sync Library` as the primary action, the footer caption split into
two spans, a Summary notch the row claimed the board did not have, and the bottom dock in place
of the free-standing options card. `0ebbe67` had already built the four deltas that did move
(whole-MB trim, the drawer's `Additional options — <game>` caption, the Summary tab handle, the
full-viewport frame). The rows now read as conformance rather than supersession.

### Rows whose verdict rests on a pre-`31cc2f7` reading — the walk is finished

**198 of the 504 rows then surveyed** sat on a board that moved in the sync (169 in survey A across 17 boards
plus `GuidedFlashing`; 29 in survey B). Every one of them was verdicted before the sync.

They are now all re-walked, in four pieces, and **not one status cell moved**:

| piece | rows | boards | closed by |
|---|---:|---|---|
| Landing / Guided | 21 | Landing1, Landing2, Guided | `1e67d11` + `7d561e9`, `fb77abb` + `7ee5e06` |
| the pass that took the count | 6 | FileBrowser, Erase, BackupPatch, Main | `cadf918` (5 reopened, A33 corrected in place) |
| the Advanced tab | 84 | Firmware, FileBrowser, Write, Dump, Erase, BackupPatch x4 | `5442258` |
| Overview family + GuidedFlashing + Roms/RomsOptions | 87 | Main, BothEmpty, NoStockBank1, NoStockBank2, StockUnpatched, GuidedFlashing, Roms, RomsOptions | this pass |

**87 was the real outstanding figure**, not the 142 the previous pass recorded — `5442258` had
already closed 84 of the 142 by re-deriving every line the sync changed in the nine Advanced
boards, and survey B's 29 were never in survey A's 142 to begin with.

The 87 walk clean for a specific, checkable reason. The five Overview-family boards changed in
exactly two ways and no others — the tab bar (three tabs to four, `gap: 30px` to `34px`, built
in `4630392`) and `free of 50.00 MB` to `free of 50 MB` (`OverviewTab.svelte:550` composes it
from `formatSize`, which trims). `GuidedFlashing` was not in `31cc2f7` at all; its only change,
`e68d6f1`, replaced the step-rail backdrop with the corrected Guided pane — now byte-identical
to `Guided.dc.html`'s, which was already rebuilt — and GF1–GF9 measure the busy header and the
progress modal, neither of which it touched. Survey B's 29 are covered above.

**Nothing now rests on a stale drawing, and no row remains unsettleable for that reason.**

The sync's substantive changes were exhaustively these, and all of them are built:

| change | boards | built? |
|---|---|---|
| four-tab bar replaces the three-tab strip | all 17 | yes (`4630392`) — verified unanimous, `gap: 34px` |
| whole-MB figures lose `.00` (`50.00 MB` -> `50 MB`, `4.00` -> `4`) | Main, BothEmpty, NoStockBank1/2, StockUnpatched, BackupPatch x4 | yes — `formatSize` throughout (`0ebbe67`, `a05cec3`, `affaa83`, and `5442258` for `OfficialFirmwareSection`'s `rowSize`) |
| footer primary action gains `margin-left: auto` | Firmware, Dump, Erase, Write, FileBrowser, BackupPatch x4 | yes — stated explicitly on `FirmwareRail`'s `.panefoot .actions` (`5442258`) |
| em-dashes retired from prose | Erase, BackupPatch x4 | yes (`5442258`), seven files each |
| FileBrowser partition caption drops the address | FileBrowser | yes (`5442258`) — `Cores, saves (LittleFS)` |
| FileBrowser read status drops the transport | FileBrowser | yes (`5442258`) — `reading · 62%` |
| the collision aside stops naming FrogFS | BackupPatchBoth | deliberately divergent (`799b8f1`) — the board's sentence is untrue; a board fix is in progress |
| Firmware "version row" gains `margin-left: auto` | Firmware | yes — this is the footer action cluster at `Firmware.dc.html:151`, the same declaration as the row above, not a separate element. The previous "not measured" was a misreading. |

**Six rows are directly contradicted and are re-statused in survey A:** FB-4, FB-6, E-7, #10 and
#18 reopen; A33's quoted board value is corrected in place and its FIXED verdict survives.
Two of those — **FB-4 and FB-6 — were built to match the board text the sync deleted** (`0b19acd`
put the address into the caption; the board has since taken it out). That is the exact cost of
measuring against a stale drawing, and it is now on the record twice.

`FileBrowserSection.svelte:16` cites the dead board value in a code comment. It is not corrected
here — this is a documentation pass — but it is the kind of citation HANDOVER §2 says had to be
fixed the last time boards went stale.

**All five of those reopened rows are now closed, and the survey took nineteen commits to notice.**
`5442258` re-derived every line the sync changed in the nine Advanced boards and rebuilt FB-4,
FB-6, E-7, #10 and #18 to match; `0763892` re-pointed the stale comment at
`FileBrowserSection.svelte:16`. Neither commit touched the surveys, so five rows sat OPEN against
code that already matched the corrected drawings. The 2026-09-08 merge sweep re-read each one
against the code and closed it; the section below records them.

### The three unsurveyed artboards — walked 2026-09-08

`FlashingCancel`, `FlashingCancelConfirm` and `FlashFailure` were drawn in `70c35f7` / `3847935` /
`00e65d5`, indexed in `5777f6d`, and until now neither survey had a single row for them. **They
are now walked: 30 rows added to survey A** (`13664d9`), beside `GuidedFlashing`, whose page all
three reuse unchanged. There is no approved artboard left that has never been surveyed.

**They are mostly not paint, and the rows say so.** FIXED 3, OPEN 2, BLOCKED 19, CONFIRMED 6.
Sixteen of the nineteen BLOCKED rows sit behind a single question — **whether a running flash gets
a user-facing Cancel** — and the rest behind the `BAD_HASH_FLASH` retry work now in the engine.

Two corrections to what this section previously said:

- **A running flash IS cancellable.** `GnwFlasher.flash()` takes an `abortSignal` and checks it at
  the top of every 256 KiB chunk (`packages/gnw-flasher/src/index.ts`), so a stop lands on a block
  boundary and never mid-erase — exactly what `FlashingCancel.dc.html:21-27` claims. The
  *"NOT cancellable once started"* comment this section quoted was stale and has been corrected
  (`installProgress.svelte.ts:119-124`). The gap is the UI end: nothing in `apps/web` constructs an
  `AbortController` for a user. **That is the owner's open question**, not an agent's to build.
- The behaviour gap is real but smaller than "of a different size from anything else": the engine
  half already exists.

**A third correction, 2026-09-12: the Cancel control was built, and the two paragraphs above are
now history rather than status.** The owner asked for it by name after a run hung at 0% with no
way out but a page reload. `installProgress` constructs an `AbortController` per run and hands
its signal to `exec`; `apps/web/test/flashcancel.mjs` asserts the abort at the far end, so a
control that only set a flag would fail it. The verdicts in survey A were re-walked the same day,
which is why the counts in the paragraph above no longer match the table: **for these three
boards the live rows are FIXED 15, CONFIRMED 7, BLOCKED 7, OPEN 4**, not the FIXED 3 / OPEN 2 /
BLOCKED 19 / CONFIRMED 6 recorded when the pass was written. One half of the question genuinely
remains, and it is the half this section called the hard one: **what a half-written bank leaves
the user with**, unestablished against hardware, keeping `FCC5` BLOCKED. See
[`BLOCKED-AUDIT.md`](./BLOCKED-AUDIT.md) Q20, which records the same answer.

Built by that pass, and only this — all of it paint that decides nothing (`ee63de2`): the failure
modal's footer becomes the full-bleed ruled band `FlashFailure.dc.html:85` draws, and the dialog's
title→body gap is keyed on the modal phase, since `ModalInstallConfirm` draws that head at 4px
while the running and failure boards both draw 6px. Deliberately **not** built: the Cancel control
and its confirm dialog (owner's question), the block-failure table and `Retry install` (the data
does not exist on this branch), the danger-red modal lip and the failure sentence's type (they are
the failure state's only two red cues and belong together, and the lip needs a prop on
`ModalShell`, a file outside that pass's ownership).

(`Specimen.dc.html`, added in `9a370c9`, is a type-and-grey reference rather than a screen and is
correctly not surveyed. The board inventory is now 49 files: **48 surveyed**, 1 specimen.

That sentence read *"46 files: 45 surveyed, 1 specimen"* until 2026-09-08 and was wrong twice
over. There were already **47** files: `FileBrowserFrogfs.dc.html` had been in the mockups README
index since it landed, had rows in neither survey, and was in nobody's count. It is now walked
(survey A, `FileBrowserFrogfs`, 10 rows). The same pass **drew** two boards for states the app
renders and no artboard depicted — `FirmwareLayout.dc.html` (the `Advanced layout` drawer,
`RomSection.svelte:876-931`) and `EraseCustomRange.dc.html` (the custom-range fields,
`EraseSection.svelte:252-257`) — closing survey A's F18 and E-9, which were OPEN only for want of
a drawing. Both are drawn from the shipping components and walked (9 and 7 rows).)

### Coverage, checked in both directions

Every one of the 504 rows that existed before 2026-09-08 was parsed out of the two survey tables
mechanically and lands in exactly one state; the per-survey totals in the table above are that
parse plus the 30 rows the flash-boards pass added and the 26 the missing-states pass added, and
they equal each survey's own stated row count. In the other direction, every count in this document traces back to rows: 219 FIXED,
9 CLOSED, 21 OPEN, 40 BLOCKED, 317 CONFIRMED, 2 CANCELLED, 3 undetermined and 5 carrying no
status of their own — **616**, which is the guard's own figure. That splits as the 504 pre-2026-09-08 rows
(190 / 9 / 8 / 26 / 261 / 2 / 3 / 5) plus the three flash boards' 30
(8 / 0 / 2 / 14 / 6 / 0 / 0 / 0) plus the missing-states pass's 26
(0 / 0 / 2 / 0 / 24 / 0 / 0 / 0) plus the merge sweep's 2 new rows
(0 / 0 / 2 / 0 / 0 / 0 / 0 / 0) plus the nav-band pass's 2 new rows
(0 / 0 / 1 / 0 / 1 / 0 / 0 / 0) plus the new-boards pass's 34
(0 / 0 / 9 / 1 / 22 / 0 / 1 / 1) plus the ConfirmModal-phases pass's net 5
(0 / 0 / 6 / 0 / 1 / 0 / -1 / -1, one placeholder row retired for six real ones), and each part
sums to its own row count — 504 + 30 + 26 + 2 + 2 + 34 + 5 = 603, plus the visible-defects
pass's 11 (11 / 0 / 0 / 0 / 0 / 0 / 0 / 0, and one further row moved OPEN → FIXED) = **616**.
The merge sweep then moved 9 rows between columns without adding any: 7 into FIXED from OPEN
(FBF-7, FB-4, FB-6, E-7, #10, #18) and from BLOCKED (A2) in survey A, and 2 into FIXED in survey B
(the Language control, from BLOCKED; the Caution ring, from CONFIRMED). The missing-states pass
also moved F18 and E-9 OPEN → CONFIRMED inside the first part. The stale-board figures are sums of the per-artboard
row counts in each survey's own summary table, listed board by board so they can be re-added:
198 rows on a moved board, split 21 / 6 / 84 / 87 across the four pieces that closed them, which
sums to 198. Every status cell in both surveys was re-counted by the stated rule after the merge
sweep's edits, and the parser was re-validated first against two hand-counted tables — survey A's
`Main` (32 rows: FIXED 25, CONFIRMED 7, unchanged by this pass) and survey B's `HeaderBusy`
(31 rows, now FIXED 9, BLOCKED 3, CONFIRMED 18, COULD NOT DETERMINE 1, having been 7 / 4 / 19 / 1
before the two rows this pass moved). The table above is that count.

(Five rows carry no status of their own: two in survey A — GS6, a pointer to GR3/GR9, and row
16, *"out of artboard scope, noted only"* — and three in survey B: `RomsSdNoCard`'s *Everything
else* pointer, `ReposAdd`'s *Field placeholder* and its *ABI green when unknown*.)

**Statuses:** **FIXED** — closed, with the commit named on the row. **OPEN** — still true as
written; actionable today. **BLOCKED** — needs an owner decision, named on the row. **CONFIRMED**
— walked again, still conforms. **COULD NOT DETERMINE** — needs a browser.

The original severity counts (19 MISSING / 62 WRONG / 27 EXTRA / 31 COSMETIC in A; 8 / 52 / 29 /
51 in B, 279 deltas total) are kept in each survey's own summary section, now labelled superseded.

**That 114 was wrong, and so was the ratio built on it.** On 2026-09-08 every row marked BLOCKED
in either survey was re-opened and read against current code and its artboard. The real count of
BLOCKED status cells was **71**, not 114 — the 114 was a header nobody re-cut. Of the 71:

- **20 were stale — already built.** Nine of them were closed by four commits (`30bb7d6`,
  `0bfd2db`, `84cb50e`, `fa6ffed`) that landed without the surveys being updated behind them.
- **25 were never blocked at all** — a standing ruling already covered them. Twelve fall under
  *nothing is cut merely for not appearing in a mockup*; four under CLAUDE.md's SD-vs-Flash
  budget rule; the rest under the segment-label, no-filler and artboard-conflict rulings.
- **4 are duplicates** of another row.
- **22 are genuinely blocked**, and they consolidate to **18 questions**.

The full walk, with the evidence for every re-statused row and the 18 questions written out with
a recommendation each, is in [`docs/BLOCKED-AUDIT.md`](./BLOCKED-AUDIT.md). It supersedes
`docs/DECISIONS.md`'s 68-question list, which was built on the inflated row count.

That ratio got worse, not better, and deliberately so. The 2026-09-07 re-verification found rows
mis-sorted in **both** directions. Twenty-nine rows the first marking pass left OPEN were in fact
closed — twenty-four by the branches that landed after it, and five that were already conformant
when the pass recorded them as OPEN (BackupPatch #4 under `81ad3aa`, `ModalFilesBiosError`'s three 11px
hash rows and `ModalFilesBios`' `Found` state under `d3d7176` / `7fd667f`). Fifteen more were
never actionable at all and are now BLOCKED with the decision named on the row: the ext-flash
legend and footer row set, the geometry bar's contradictory height, the hover-detail strip,
`RomsOptions`' four behavioural rows, the shared disabled-button cap, and three fills that would
each mint a new token. One row — `LibrarySummary`'s `Change` cell — was a **false positive**:
`tokens.css:41` is `--danger: #8a241b`, the artboard value exactly.

**Superseded by the merge sweep below — read that first; this paragraph is the reading it
replaced.** **The honest reading as of 2026-09-08 (stale-board re-walk):** 8 OPEN rows (5 of them reopened
by the artboard resync), 26 still marked BLOCKED (22 real questions plus 4 duplicates), 18
questions in front of the owner — Q4 is now a much easier one to answer, see
`BLOCKED-AUDIT.md`, but it is still copy and still his — **0 rows needing a re-walk against a
corrected board**, and 3 artboards nobody has walked at all. The 45 rows that moved out of
BLOCKED are ordinary work now, and most of them are already done.

The three unwalked artboards are the only measurement gap of any size left on this scoreboard,
and they are the one that matters: `FlashingCancel`, `FlashingCancelConfirm` and `FlashFailure`
all draw a `Cancel` affordance on a running flash. `c320eda` built `FlashFailure`'s Save-log
footer and `ed106af` corrected the cancellability comment, but neither surveyed the boards, so
they still hold **0 of 3 walked** and an unknown number of rows.

## The five real bugs are fixed

All five functional bugs the surveys turned up — as distinct from conformance nits — were closed
under `9283ee2`:

1. **`FileBrowserSection`'s 72px footer never rendered** — `FirmwareRail`'s `{#if footer.content}`
   dropped the bar when a section declared only a summary. Fixed in `af22d7d`, which also removed
   the duplicate `PaneFooter` declaration (survey FB-9, FB-11).
2. **`RomsSdNoCard`'s gate caption was unreachable** — `flashGateNote` returns `null`
   unconditionally in SD mode. Fixed in `c7aae47` with a separate `sdGateNote` derived from
   `device.sdReady` alone, so no `device.partitions`-derived state is consulted in SD mode; new key
   `roms.sdSync.chooseCardPrompt` in all seven locales.
3. **The BIOS modal's `note` prop was dead repo-wide** — one call site showed no subtitle, the
   other printed the *Convert* artboard's line. Fixed in `ceeddf4` (new `subtitleBios` key, both
   call sites pass it, `converts={false}` on the RomManagementTab one).
4. **The two BIOS call sites disagreed on `monoDescriptions`** — fixed in `89c3e03`.
5. **The install-confirm button contradicted itself** — oxblood outline in Flash, filled red in SD.
   Fixed in `6d803f2` by dropping `danger: true`; both paths now render the `action` fill both
   artboards specify, with confirm-gate behaviour unchanged.

## Corrections to the older audit — where they stand now

- **2.1's `max-width: 900px` clause has landed** (`cf14a7f` / `884ebdd`): the ReposDetail body has
  its own 900px / 30px-gap wrapper, scoped to the view so `--maxw` is untouched. The correction was
  right; it is no longer outstanding.
- **5.1's claim that Firmware's Install-pane footer was not adopted was stale** — re-verified: the
  bar is there (`RomSection.svelte`), and 5.1's one real exception (File browser) is now closed too.
- **5.13's `--model-accent` sweep missed `BankCard`'s selectable branch** — closed in `bc356de`;
  the selected card now takes `--zelda-green`, with the reasoning in the component comment.
- **`LibrarySummary` is the NEWER four-tab generation**, not older — re-verified against
  `Roms.dc.html`. The earlier briefing was wrong.
- **`RomsNewSystem`/`RomsSdNoCard`'s footer dock copy has landed** (`bc71f68`): `summary.projected`
  is a new seven-locale key and `summary.netChange` — which already existed — is now wired to the
  dock instead of only the summary row.

## Two rows that were themselves wrong

Marked in place in survey B rather than deleted:

- **The `ReposAdd` URL-field radius finding is a false positive.** `--r-control` **is** `2px`
  (`tokens.css:118`); the field already carries the artboard's flat 2px.
- **The `curated` chip is not a gap.** It was dropped from the design (`docs/UX_DESIGN.md:130`);
  its absence is conformance.

Likewise re-verified as *not* findings: `Add languages from translated ROMs` /
`Additional Language` are converter-input manifest text resolved through `pickText`
(`AdditionalFiles.svelte:100-111`), not missing copy.

## The missing type tokens — closed, all of them

**Nothing in this section is outstanding any more.** It is kept as the record of what was asked,
because the counts above were taken while it was open.

**`--fs-btn-sm` is 13px** and **`--r-control` is 2px** — both exist, both were once reported
missing, and the literals that cited a phantom token are now on the token (`4694cdf`,
`85d8be8`).

The three sizes reported genuinely missing have since been minted: **`--fs-title` 18px** (every
panel and modal title), **`--fs-lede` 15px** (Landing's rubric, Repos' row name) and
**`--fs-badge` 10px** (the `required`/`optional` badges) — `tokens.css:167-169`. The 20px
`--fs-lg` this section used to name as the stand-in was **retired and deleted** in `51ac881`;
its last two consumers were themselves modal titles and read `--fs-title` now. No modal title is
2px too large, and there is no 20px token to be too large.

The second family named here — **`#e0e0e0`** and **`#f0f0f0`** — was settled in `852df8d`, and
it split rather than resolving one way. `#f0f0f0` earned a token, **`--chip-fill`** (dark
`#2e2e2e`): one value in one role, a badge/chip `background`, 13 times across six boards.
`#e0e0e0` earned none: it is a divider in one place and a disabled fill in the other, so it
snaps by role to `--rule` and `--surface-sunk` respectively. The reasoning is on the record in
`tokens.css:105-126`.

**No status cell moved when these closed** — the rows behind them were already carrying their
post-fix status when the table above was counted, so the arithmetic is unchanged.

## One defect no artboard can settle

`GeometryBar.svelte`'s selection ring is `--zelda-green`, and two of the fills it can land on are
that same colour: `.frogfs`/`.frogfs-changed` (`--seg-games` *is* `--zelda-green`) and `.bank` on
a Zelda unit (`--model-accent` is `--zelda-green` under `[data-model="zelda"]`). Selecting either
shows nothing. Every board that draws the ring draws it over a neutral fill — `#c9c9cd`,
`#9a9aa0` — and none over the green, so the drawings cannot rule on it. Written up as the
nineteenth question in [`docs/BLOCKED-AUDIT.md`](./BLOCKED-AUDIT.md), and it closes no survey
row, so no count in this document moves.

## Two places the artboard is probably the defect, not the code

- `RomsSdNoCard` draws a meter and Summary notch whose value the project's SD-vs-Flash rule
  forbids computing (`device.partitions`-derived state must early-out in SD mode).
- `HeaderBusy`'s static `EN` label predates the seven-locale switcher.

**The first is no longer blocked.** CLAUDE.md's SD-vs-Flash budget rule *is* the ruling: SD mode
may not read `device.partitions`-derived state, and SD has no gap total to meter against, so the
code is right and the artboard is the defect. Rows 319, 320, 798 and 799 are CONFIRMED on that
basis. **The second is no longer open either, and neither artboard turned out to be the defect.**
`9e0f750` drew the language control as every board draws it — bare `12px/500 #5c5c5c` text with no
cap, border or shadow — while keeping it a real `<select>` whose closed state and options show the
uppercase locale CODE. The board's `EN` and seven working locales were never in conflict; the
chrome was the only delta. Survey A's **A2** and survey B's **Language control** are both FIXED.
Question 1 in [`docs/BLOCKED-AUDIT.md`](./BLOCKED-AUDIT.md), which merged the two, is closed by
code — that file is outside the merge sweep's ownership and still carries the question, so it
needs a pass of its own.

## What no amount of code reading can settle

Every real-width measurement, and **the dark theme** — the artboards are light-only throughout,
and finding 0.4 was closed by reasoning about tokens, never by looking at a screen. Only three rows
across 616 are marked COULD NOT DETERMINE, because most render-dependent questions are recorded in
the surveys' own per-artboard "could not determine" lists rather than as rows; those lists stand
unchanged. Looking at the app in a browser, in both themes, remains the highest-value hour the
owner could spend.
