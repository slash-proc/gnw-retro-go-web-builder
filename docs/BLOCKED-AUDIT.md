# The BLOCKED backlog, re-walked

> **Re-verified 2026-09-08 (third pass) — the number is 24, and 22 of them are here.**
>
> The second pass put the number at 20, derived by re-reading every question in this document
> *and* every still-live entry in [`docs/DECISIONS.md`](./DECISIONS.md) against the code. That
> reading still holds — the eight it closed are listed below and none of them has reopened. What
> it did not cover is the three artboards walked later the same day (`FlashingCancel`,
> `FlashingCancelConfirm`, `FlashFailure`). They added 30 rows to survey A, **14 of them
> BLOCKED**, and **four of those are questions that appear nowhere else** — including the
> largest single thing on this list. They are **Q20-Q23** below. 20 + 4 = **24**, of which 22 are
> here and 2 live in `DECISIONS.md`.
>
> **Re-derived 2026-09-08 (header-status pass): the number is 25, and 23 of them are here.**
> A branch-by-branch walk of the header's `statusText` found three connected wordings no board
> draws — recorded as one new BLOCKED row in survey B's `HeaderBusy` table and asked here as
> **Q24**. Blocked rows across both surveys go **39 → 40** (24 in A, 16 in B), and the count
> above becomes 24 + 1 = **25**, of which 23 are here and 2 live in `DECISIONS.md`.
>
> Eight questions were closed by the second pass, and each was re-checked today:
>
> | closed | what settled it |
> |---|---|
> | **Q1** (this doc) — the language control | Built in `9e0f750` under the standing *artboard wins on pure paint* ruling |
> | `DECISIONS.md` **#28** — Landing2's `Modded with / Change` row | Moot: `31cc2f7`'s re-synced board deletes the row (`Landing.svelte:58-59`) |
> | `DECISIONS.md` **#29** — the flashing Cancel mockups | The boards now exist (`70c35f7` / `3847935` / `00e65d5`); producing them was this side's job. **The behaviour gap they expose is now Q20** — it was parked on the backlog below, which was the wrong place for a question |
> | `DECISIONS.md` **#30** — states with no artboard | Not a question: the `Overwrites` row is built (`0bfd2db`), the rest is a drawing job, which is ours |
> | `DECISIONS.md` **#32** — a 34px display token | `--fs-display-lg` **is** 34px (`tokens.css:96`), minted in `19f818c` |
> | `DECISIONS.md` **#51** — two "probably stale" boards | Both halves already closed: the SD meter by CLAUDE.md's SD-vs-Flash rule, the static `EN` by `9e0f750` |
> | `DECISIONS.md` **#65** — the `BAD_HASH_FLASH` retry policy | You answered it (HANDOVER §4); built in `1fb5469` |
> | `DECISIONS.md` **#68** | Never a question — a record of the i18n waiver being used once |
>
> The two live questions that are not in this document are `DECISIONS.md` **#19** (the chooser
> heading — reframed; the app ships a *third* wording neither board draws) and **#66/#67** (the
> app can draw no failure at all — the *header status line*, not the install modal, which
> Q21/Q22 cover). See that document's "What survives supersession" section.

**Every row marked BLOCKED in both artboard surveys was opened, read against the current code
and the cited artboard, and re-decided.** Not against the row's own description — two previous
passes found rows that were simply out of date, including one that quoted a `1px` border which
turned out to be a `:disabled` reset a few lines above the real rule. So every verdict below
rests on a file and a line read on 2026-09-08, or on a ruling the owner has already given.

## Re-checked 2026-09-08 against the merges since `8ed21e6`

Eighteen merges have landed since this audit was written. **Every one of the questions was
re-read against current code.** Three things changed around them, and — found on the second pass,
2026-09-08 — **Q1 has since been answered by work and is closed below.**

- **Q4's recommendation is reversed.** It recommended keeping the em dash on the strength of one
  artboard. There are now **four** boards drawing `Working.` with a full stop — `GuidedFlashing`
  plus the three state boards added in `8c3e7c6` — and `31cc2f7` separately retired em dashes
  from five more strings across the `Erase` and `BackupPatch` boards
  (`wipes the OS on it, stock firmware or Retro-Go.`, `stays on disk. This only rewrites…`,
  `That works, because … uses, but …`). The canvas has made this call everywhere else. See the
  revised recommendation on Q4 below.
- **Q5's citation drifted.** `fb77abb` rebuilt the Guided step rail; the live controls the row
  describes are now at `Wizard.svelte:1064` and `:1067`. The substance is unchanged — a pending
  step still renders a live `Add Sources` button.
- **Q15 is unaffected but its "copy-the-pattern" note still holds** — `a0ae34b` conformed
  `AddSource` / `AddSourcesModal` to their boards without touching the Bundle-zip field shape.

Q6, Q8, Q10-Q14 and Q16-Q18 were each re-read against the file the question names and are
unchanged. Nothing here is closed by a merge.

## The headline

**71 rows were nominally waiting on the owner. 22 actually are, and they consolidate into 17
live questions.** Three artboards were walked after this table was built and added 14 more
blocked rows; they are counted separately, below the table, because folding two passes into one
column produces a total that means nothing.

| | rows |
|---|---:|
| **STALE — already built.** The code matches the artboard now; the row was never re-marked. | **20** |
| **NOT BLOCKED — a standing ruling already settles it.** Re-statused OPEN/CONFIRMED so it can be dispatched as ordinary work. | **25** |
| **DUPLICATE** — the same question wearing a second row number. | **4** |
| **GENUINELY BLOCKED** — needs you. | **22** |
| | **71** |

**First correction: the number was never 90.** `docs/CONFORMANCE.md` says 114 BLOCKED and
`docs/DECISIONS.md` says 111. Both are stale headers. Counting the actual status cells in the
two surveys on 2026-09-08 gives **47 in survey A and 24 in survey B — 71**. The surveys' own
per-status tables had already drifted from their own rows (survey B's header claims 43 BLOCKED
over 24 real ones), which is the same failure this pass exists to fix. The BLOCKED counts in all
three documents were corrected to match the rows here; **the other status columns were not, and
were left summing 19 short in survey B.** That was closed on 2026-09-08 by counting every status
cell in both surveys — the gap was two status values the header table had no column for, not 19
missing rows. See `docs/CONFORMANCE.md`.

**Then the three flashing boards, and the count has to be re-derived rather than adjusted.**
`FlashingCancel`, `FlashingCancelConfirm` and `FlashFailure` were walked on 2026-09-08 after the
table above was built (survey A, 30 rows, 14 BLOCKED). Re-running the mechanical count over both
surveys today gives **39 rows still carrying a BLOCKED status cell — 24 in A, 15 in B** — and
they decompose exactly:

| | rows |
|---|---:|
| covered by **Q2-Q18** (20 genuine + the 4 duplicates below) | **24** |
| **FC3** and **FC5** — cross-board duplicates the survey itself points at Q2 and Q4 | **2** |
| covered by **Q20-Q23**, which this document did not carry until today | **13** |
| | **39** |

**22 rows → 17 questions.** That is not a padded list and it is not a squeezed one. Four
cross-survey merges do real work (the language control and the busy lip were each being asked
twice, once per survey), and one question carries two clearly-labelled parts because they are
the same screen and the same class of call. Nothing else collapses without lying.

---

## What "already built" turned out to mean

Nine of the twenty stale rows were closed by four commits that landed after the last marking
pass and never had the surveys updated behind them:

| commit | closes |
|---|---|
| `30bb7d6` — Install pane: artboard labels and per-card bank captions | F1, F5, F7, F9, F10 |
| `0bfd2db` — Write pane: `Overwrites` row, artboard file field | W-3, W-11 |
| `84cb50e` — Dump pane: matches-partition clause and the unit chevron | D-4, D-5 |
| `fa6ffed` — Backup & patch: real allowed cross-model note | BackupPatch #18 |
| `c6a52b9` / `79cbd66` — the empty bank card | A50 (and with it A54, A57, A63) |

**Two of those I had to correct against my own verification agents**, which is worth recording
because it is the same class of error the surveys made:

- **D-4** was reported still open ("a bare native `<select>`, no `appearance: none`"). It is not.
  `RangeField.svelte:133-148` sets `appearance: none` *and* bakes the artboard's exact
  `M5 8l5 5 5-5` chevron in as a data URI, with a dark-theme sibling at `:154-160`. The row also
  claimed it "cannot be judged without a render" — it can, and it is done.
- **X-1** was reported still open on stale line numbers. `GeometryBar` now has `default` /
  `tall` / `slim` variants (`:33-38`, `:138-158`), and **all thirteen call sites pass an explicit
  size** — including the two the row calls "unbacked": `InstallGeometry.svelte:158` and
  `RomSection.svelte:928-932` both take `tall`, with the reasoning written into the prop's own
  doc comment. The artboard-versus-artboard conflict this row was built on no longer exists.

---

## Every re-statused row

### STALE — already built (20)

| Row | New status | Evidence |
|---|---|---|
| A15 | FIXED | `OverviewTab.svelte:394-408` renders exactly the artboard's three Device rows |
| A21 | FIXED | no `startFlashUtil`/`restartFlashUtil` key exists in `overview.ts`; the string survives only in a CSS doc-comment at `OverviewTab.svelte:838` |
| A24 | FIXED | `OverviewTab.svelte:1019-1027` — `height: 232px`, `--surface-sunk`, fluid |
| A33 | FIXED | `OverviewTab.svelte:547-550` + `overview.ts:59` `freeOfTotal` |
| A35 | FIXED | `OverviewTab.svelte:566-576` renders `.ext-legend`; swatch paint read off the bar |
| A37 | FIXED | `OverviewTab.svelte:191-205` — one `Filesystem` / `FrogFS` row |
| A38 | FIXED | `OverviewTab.svelte:915-921` — `.ext-card` draws no border/radius/background |
| A50 | FIXED | `BankCard.svelte:91-96` `Empty` / `—`, dashed frame `:177`, key in all seven locales |
| A54, A57, A63 | FIXED | pointers to A48/A49/A50, all three now closed |
| F1 | FIXED | `firmwareSetup.ts:19-20` = `Guided` / `Advanced` |
| F5 | FIXED | `firmwareSetup.ts:172` = `Version` |
| F7 | FIXED | `firmwareSetup.ts:173-174` = `Keep installed games` / `Keep saves and settings` |
| F9 | FIXED | `RomSection.svelte:855` + `firmwareSetup.ts:175` `Target` |
| F10 | FIXED | `RomSection.svelte:856-861` per-card `Replaces stock` / `Dual boot` |
| W-3 | FIXED | `FlashSection.svelte:190-201`, `:413-424` — the artboard's 40px field |
| W-11 | FIXED | `FlashSection.svelte:77-110`, `:252-253`, `firmwareSetup.ts:274` |
| D-4 | FIXED | `RangeField.svelte:133-148` — `appearance: none` + the artboard's chevron |
| D-5 | FIXED | `DumpSection.svelte:185` + `firmwareSetup.ts:235` `matchesPartition` |
| X-1 | FIXED | `GeometryBar` size variants; all 13 call sites pass a size |
| X-5 | FIXED | `GeometryBar.svelte:220`, `:237` = `--seg-games` / `--seg-saves` (`tokens.css:61-62`). The `#c0392b` is gone |
| BackupPatch #18 | FIXED | `firmwareSetup.ts:71-73` + `OfficialFirmwareSection.svelte:573-576` |

### NOT BLOCKED — a standing ruling settles it (25)

**"Nothing is cut merely for not appearing in a mockup" closes 12 rows on its own** — every
"EXTRA, no artboard" row. Five of those are literally the same element (the `Enter Recovery
Mode` gate) reported once per pane.

| Rows | Ruling that settles it |
|---|---|
| A40, A41, F17, FB-12, W-16, D-10, D-11, E-13, X-7, BackupPatch #6, B365, B410, B637, B825 | *Nothing is cut merely for not appearing in a mockup.* These are confirmed intentional, not gaps. |
| A34 | Already built — `GeometryBar` `slim` at `OverviewTab.svelte:554` is `Main.dc.html`'s 10px/5px |
| A36, X-4, BackupPatch #7 | *Segment labels are `Games & Homebrew` / `Cores & Saves` / `Free Space`.* `shared.ts:149-150` reads them verbatim (ruled as `Emulators & Saves`; the middle word moved with the core rename, the ruling did not); the legend reads its labels off the bar (`OverviewTab.svelte:189`) so it cannot diverge. The artboards' `FrogFS`/`LittleFS`/`Cores & saves` naming is superseded. |
| A53 | *Two artboards disagree? Pick the better one and note it.* The call is made and recorded at `OverviewTab.svelte:120-126`: stock only boots from bank 1, so the offer belongs to bank 1 alone — which is what `NoStockBank1` and `NoStockBank2` jointly imply. |
| BackupPatch #1 | *No filler, ever* + artboard wins. The two intro paragraphs go conditional: kept in the no-folder state (no artboard draws it, so nothing is cut), dropped in the found state the artboard does draw. |
| B319, B320, B798, B799 | CLAUDE.md's SD-vs-Flash budget rule. SD mode may not read `device.partitions`-derived state and has no gap total to meter against. The code is right; the artboard reuses a Flash affordance on an SD screen. This needed a *rule*, and the rule already exists. |
| FB-10 | Not a decision at all — unbuilt work needing a device-touching re-read handler. Hardware-dependent work is your own track and must not be raised as a question. |

### DUPLICATE (4)

B361, B362, B363 are row B358 (the cover-art panel). B548 is row B477 (the Bundle-zip field).
Both groups are one decision each.

---

## The questions — Q1 having closed, and Q20-Q23 added 2026-09-08

Each names the rows it closes. Every one has a recommendation attached, because a question with
a recommendation is cheaper to answer than an open one — if you agree with them all, "all as
recommended" is a complete reply and unblocks every row named here. **Q20 is the exception and is
the biggest thing on this list**: it has no recommendation, because whether a running flash can
be stopped is not a taste call.

**Numbering is deliberately not compacted.** Q1 stays in place, struck through, with what
settled it: three questions were once put to you that the code had already answered, and the
cheapest guard against repeating that is leaving the closed ones visible where they were asked.
Q2 is still Q2.

### ~~Q1. The language control — a plain `EN` label, or the dropdown?~~ **CLOSED — do not answer.** *(A2, B841)*

Asked as: *every artboard draws the header's language control as bare 12px text reading `EN`,
with no border and no box; the app draws a bordered `<select>` because seven locales are wired
in and a static two-letter label cannot offer a choice between them.*

**Settled by `9e0f750`, under the standing ruling *artboard wins on pure paint*.** The control
is now painted exactly as the boards draw it — bare text, `12px/500`, `--ink-soft`, no cap,
border, shadow or native arrow (`DeviceHeader.svelte:443-451`). **Corrected 2026-09-08:** it is no longer a `<select>` —
`92bb436` / `d9ec7e8` replaced it with a custom button-and-menu (`:236-244`, `.lang-picker` at
`:452`) so the menu could be themed, and the open menu lists the **endonyms** (Deutsch, Español…),
not codes. Only the closed indicator carries the uppercase code `EN`, as every board draws it. The
switcher survives either way.

This is not a technicality: the question was *bare or boxed*, it is a pure-paint question, you
have already ruled that the artboard wins those, and the ruling was applied and recorded.
*Closes A2 and B841 — and with them `DECISIONS.md` #51's `HeaderBusy` static-`EN` half.*

### Q2. The busy lip: 3px static gold, or 5px hazard crawl? *(GF5, B830)*

While the device is being written to, the artboards put a 5px animated diagonal "hazard" stripe
across the top of the header (`GuidedFlashing.dc.html:64`) *and* across the top of the progress
modal (`:81`, inline in the modal shell — **citation corrected 2026-09-08; the file is 85 lines
and has no `:136`**). The app draws a static 3px gold line in both places
(`ModalShell.svelte:77-79`, doc-comment at `:29-33`), and the code argues for it: a constant
height means the page cannot shift by 2px the moment a write starts.

- **(a)** Adopt the 5px crawl; accept a 2px shift when a write begins.
- **(b)** Keep 3px static everywhere and correct the artboards.
- **(c)** 5px crawl, but reserve 5px at rest so nothing moves.

→ **Recommendation revised 2026-09-08 to (a).** (c) was recommended before, and it should not
have been: **no board draws a 5px lip at rest** — every idle board draws 3px — so reserving 5px
is inventing a treatment, which §2 of the handover forbids. (a) is what *artboard wins on pure
paint* gives on its own. If the 2px jump is unacceptable to you, (b) is the honest alternative
and the boards get corrected; (c) is off the table.

### Q3. What does the **Retro-Go** slot say when there are games on the flash but no Retro-Go? *(A47)*

**Reframed 2026-09-08 — the question as written described the wrong slot, and its premise was
false.** The header has two independent slots, and the state in question belongs to the second:

- The **stock-firmware slot** (`ofwText`, `DeviceHeader.svelte:169-180`) reads `None`,
  `Zelda (Stock)` or `Zelda (Patched)`. The old wording — *"the device has stock firmware but it
  has not been patched"* — is this slot's `(Stock)` value, and **the boards do draw it**:
  `StockUnpatched.dc.html:42`, plus `Mario (Stock)` and `Zelda (Patched)` elsewhere. Nothing is
  open there.
- The **Retro-Go slot** (`retroGoStatus`, `:157-168`) reads the version, `Not installed`, or —
  when FrogFS game data is present on external flash but no Retro-Go is installed — the string
  `patchMissing`, today the words **`Patch missing`** (`deviceHeader.ts:13`). Across all 57
  boards that slot only ever draws `Not installed` or `v1.4.1-44-flash`. **That** third value is
  what no board has written.

→ **Recommendation revised.** `Not patched` was recommended on the strength of it reading
"parallel with `Not installed` beside it" — but `Not installed` is not beside it, it is *the same
slot's* other value, and neither phrase describes the real condition, which is *your games are
here, the firmware that runs them is not*. Today's `Patch missing` is no better. Something like
**`Games only`** or **`Firmware missing`** says the actual state; the words are yours. Seven-file
edit either way.

### Q4. `Working — do not unplug your device.` or `Working. do not unplug your device.` *(GF6)*

The progress modal's one line. The app uses an em dash (`shared.ts:22-24` —
`workingNotePre: "Working — "`); the artboard (`GuidedFlashing.dc.html:81`, **corrected
2026-09-08 from `:136`, a line that does not exist**) uses a full stop. Seven-file edit either way, and nothing else
turns on it.

→ **Recommendation revised 2026-09-08: take the artboard's full stop, and fix the lowercase.**
The original recommendation ("a full stop followed by a lowercase word is a typo") was right
about the typo and wrong about the conclusion — the fix is `Working. Do not unplug your device.`,
which needs the same seven-file edit either way. Four boards now draw the full stop, and
`31cc2f7` retired em dashes from five further strings on the `Erase` and `BackupPatch` boards.
The design has made this call consistently; the app is the last place still using the dash.

### Q5. Do the greyed-out Guided steps still have buttons? *(GR9)*

The Guided artboards draw steps 2, 3 and 4 as titles only at 50% opacity while you are still on
step 1. The app renders live controls inside them — an `Add Sources` button and a disabled
`Continue to Manage ROMs →` (`Wizard.svelte:1064-1067`).

- **(a)** Title only, per the artboard — a pending step affords nothing.
- **(b)** Keep the controls; a user who knows where they are going can skip ahead.

→ **Recommend (a).** Half the point of a numbered flow is that step 3 is not yet a choice.

### Q6. Does the Install pane's bank picker get a simpler bar? *(F12)*

`Firmware.dc.html:123-138` draws each of the two target cards as a plain 34x84 track with one
fill and a caption. The app renders the full shared `BankCard` there — segmented bar,
per-segment labels, sizes, a total.

- **(a)** Add a stripped "target" display variant to `BankCard`.
- **(b)** Amend the artboard; the fuller card tells you what is in the bank you are about to
  overwrite.

→ **Recommend (b).** You are choosing which bank to write over. What is in it is the whole
question.

### Q7. Two safety controls on the Write pane the artboard draws slacker than the code

Same screen, same class of call, so they are together — but they are two answers.

- **(a) `Verify after write`: default on or off?** The code defaults it **on**
  (`FlashSection.svelte:25`); `Write.dc.html:91` draws it **unchecked** — a white box with a
  `#9a9aa0` border, against the green filled box on the row above. *(W-8)*
- **(b) The overwrite acknowledgement: bank 1 only, or every write?** The code shows it only for
  bank 1 (`FlashSection.svelte:48`, `needsAck`); `Write.dc.html:96-97` draws it on a board whose
  `Start` field (`:85`) reads `0x08100000` — a **bank 2** destination — i.e. always. *(W-13)*

*(Both artboard citations corrected 2026-09-08; each was one line short. Both premises hold.)*

→ **Recommend on and always** — keep verify checked, widen the acknowledgement to both banks.
These are the two controls where being wrong costs the user data, and the artboard is a drawing.

### Q8. The internal-flash bar: two segments or four? *(X-3)*

The artboard draws one segment per bank — `Bank 1 · stock`, `Bank 2 · Retro-Go`, 50% each. The
app draws up to four (`intflashSegments`, `classify.ts:200-219` — corrected 2026-09-08, again),
splitting each bank into used and free at `:214` and `:216`.

→ **Recommend keeping four.** The artboard's two segments cannot answer "will this fit", which
is the only reason anyone looks at the bar.

### Q9. What if a backup is both cross-model *and* overlaps installed data? *(BackupPatch #19)*

`BackupPatchAllowed` draws the cross-model note with no collision aside; `BackupPatchBoth` draws
the collision aside with no cross-model note. The code treats them as independent conditions
(`OfficialFirmwareSection.svelte:570-584` — corrected 2026-09-08), so both can appear at once — a
state no artboard draws. **Worth knowing when you answer: the code today stacks them the other
way round** — the cross-model note renders at `:570-577`, the collision aside at `:579-584`.

→ **Recommend stacking, collision aside first.** It is the one that says you are about to lose
something.

### Q10. What should the SD `Sync Library` button look like with no card chosen? *(B318)*

`RomsSdNoCard.dc.html` draws the button exactly as it looks when ready — no disabled treatment
at all. The app disables it and drops it to 50% opacity (`RomManagementTab.svelte:2327`
`disabled={!device.sdReady || !sdSyncHasChanges}`, paint at `.install-btn:disabled`
`:3009-3012` — **both citations corrected again 2026-09-08**; the previous pair had drifted onto
the options-drawer toggle and into an unrelated button rule).

→ **Recommend keeping the disabled treatment.** The artboard almost certainly just reuses the
ready-state button; a live-looking button that does nothing is worse.

### Q11. The cover-art panel has two modes and the artboard drew one *(B358, B361, B362, B363, B367)*

`RomsOptions.dc.html` draws one static cover-art panel: import and gear glyphs, a `Variant` row,
a preview box, and `Apply` sitting beside the drop hint. The app has **two** modes — file and
scraper — and the artboard's panel is the scraper one. In file mode there is no scraper behind
any of it.

**File corrected 2026-09-08: this panel is in `GameDetailsPanel.svelte`, not
`RomManagementTab.svelte`.** The `Source` select is at `:910-919`, the whole scraper branch
(`Variant` row, preview box, `Apply`) is gated by `{#if coverSource === 'scraper'}` at `:921-951`,
and the file-mode drop area is the `{:else}` at `:952`. The old citation would have sent you to
an unrelated SD-sync phase list.

- **(a)** Render the scraper controls always, inert without ScreenScraper credentials.
- **(b)** Keep them conditional and treat the artboard as drawing the scraper mode only.

→ **Recommend (b).** A permanently dead button that offers to fetch something it cannot fetch is
worse than a control that appears when it works.

### Q12. Add a `Written <timestamp>` row to the cover-art panel? *(B368)*

The artboard has one. Re-checked 2026-09-08: still no key in `roms.ts`, no row in
`GameDetailsPanel.svelte`, and the file's modification time is not plumbed through to that
component.

→ **Recommend dropping it from the design.** It is a label whose value nobody acts on, and it
costs a plumbing change plus a seven-locale key.

### Q13. The cheats panel footer: a summary row, or the editable list? *(B373)*

The artboard closes the panel with a static `Configured` / `2 codes` summary. The app renders an
editable list of the actual codes (`GameDetailsPanel.svelte:1180`, `{#each presets as p}` —
**file corrected 2026-09-08**; `RomManagementTab.svelte:1208` is an unrelated BIOS tool
builder). These are different objects, not two paints of one object.

→ **Recommend keeping the editable list.** The summary tells you a number you can already count.

### Q14. Should the filename inside the "BIOS missing" warning be mono? *(B407)*

The artboard sets just the filename in mono inside a sentence. Today `missingDetail`
(`sources.ts:127`) is a single string, so doing it means splitting the sentence into fragments
the template reassembles around a `<code>` — exactly the Pre/Post pattern CLAUDE.md warns
produces broken grammar in the other six languages, and it already did once, in French.

→ **Recommend not doing it.** One mono run is not worth a six-language grammar hazard.

### Q15. The Bundle-zip file field *(B477, B548)*

Two Repos artboards draw the Bundle-zip tab as a bordered field with the filename in it and an
`Add` button beside it. The app stacks a label over a native file input
(`AddSource.svelte:219-231`, `AddSourcesModal.svelte:124-131` — verified 2026-09-08).

Worth knowing: **the sibling Write-pane version of this exact question is now built** —
`FlashSection.svelte:190-201` wraps the native input in the artboard's 40px field. So this is
closer to a copy-the-pattern job than the row implies.

→ **Recommend building it**, reusing the Write pane's wrapper.

### Q16. `Choose…` or `Change…` once a folder is already picked? *(B634)*

The artboard keeps the button reading `Choose…` in both states. The app swaps it to `Change…`
once something is selected — **`FolderGateModal.svelte:56` and `:78`, `shared.ts:26`; the file
was corrected 2026-09-08 and the string's line again on the third pass**
(`RomManagementTab.svelte:56` is not this control, and `shared.ts:25` is the `done` key). This is copy that carries state, which the
artboard-wins-on-paint ruling does not reach.

→ **Recommend keeping `Change…`.** It is the only thing on the row that says the picker is not
empty.

### Q17. The busy artboards contradict their own caption *(B831)*

`HeaderBusy`'s caption (`:64`) reads *"The lip crawls, the light pulses amber, the install slots
go stale and dim."* Its own markup draws the slots identical to idle, in all three busy states —
re-verified 2026-09-08. So the artboard cannot be
implemented as drawn *or* as captioned — one of the two has to give.

- **(a)** Redraw the artboards with the slots actually dimmed.
- **(b)** Drop the caption; the slots stay bright during a write.

→ **Recommend (b).** The hazard stripe and the status line already say the device is busy;
dimming what is installed suggests it went away.

### Q18. Should `Disconnect device` be greyed out while flash is being written? *(B840)*

It is clickable today (`DeviceControls.svelte:70-72`, rendered unconditionally as a menu item at
`:107` — corrected 2026-09-08) underneath a header that reads
*Writing flash. Do not disconnect*. No artboard draws a disabled menu state at all — so this is
a behaviour call, not a paint one. It pairs with the amber halo already on that control, which
warns about exactly the click this would prevent.

→ **Recommend disabling it** (with the halo kept) for the duration of a write. A warning you can
click through is decoration.

---

## A question with no survey row behind it

**Q19. Confirm the selection ring contrasts with the fill it marks — or pick something else.**
*(no survey row — found 2026-09-08 while drawing the File browser's FrogFS state; re-framed
2026-09-08 after the boards were re-read)*

`GeometryBar.svelte`'s `.gseg.sel` paints `inset 0 0 0 2px var(--zelda-green)`, unconditionally.
Two segment fills are that same colour, so selecting either one shows nothing:

- `.frogfs` / `.frogfs-changed` are `--seg-games`, which is `var(--zelda-green)`
  (`tokens.css:76`). Reachable from `FileBrowserSection`'s partition picker and from
  `FlashSection` / `DumpSection`'s external-flash bar.
- `.bank` is `--model-accent`, which is `var(--zelda-green)` under `[data-model="zelda"]`
  (`tokens.css:332-334`). So every Zelda unit's internal-flash bar has it too — a second
  collision, on a different axis.

Both hold in dark theme, where `--zelda-green` becomes `#4fb163` and `--seg-games` follows it.
The ring itself is `GeometryBar.svelte:209-211`; the same facts are in that file's comment.

**Correction to what this question used to say.** It previously claimed the artboards could not
settle this, because every board drawing the ring drew it over a neutral fill and none over the
green. That is no longer true. Fill → ring, as drawn:

| board | segment fill | ring |
| --- | --- | --- |
| `Write.dc.html:81` | `#c9c9cd` grey | `#3e9e4e` green |
| `Dump.dc.html:81` | `#9a9aa0` grey | `#3e9e4e` green |
| `FileBrowser.dc.html:81` | `#9a9aa0` grey (LittleFS) | `#3e9e4e` green |
| `FileBrowserFrogfs.dc.html:81` | `#3e9e4e` green (FrogFS) | `#1b1b1b` near-black |
| `Erase.dc.html:81` | — | selection *filled* `#8a241b`, not ringed |

**But `FileBrowserFrogfs.dc.html` is our own board, drawn 2026-09-08 (`ccef13f`), and the agent
who drew it chose near-black precisely because it hit this green-on-green invisibility.** It is
this side's proposed answer recorded in a drawing — not independent evidence of a pre-existing
design intent. Read together the boards are *arguably* consistent on a principle — the ring
contrasts with the fill it marks — but that is an inference we drew, and it is stated here as
one.

→ **Recommend: the ring contrasts with its fill.** Green (`--zelda-green`) on the neutral fills,
near-black (`--ink`) on the green ones, `Erase` keeping its filled-`--danger` treatment. That is
a conditional paint rule in `GeometryBar.svelte`, not a token change, and it fixes both
collisions.

**Still open, but much cheaper than it was.** It is now a confirm-or-replace, not an open design
problem: say yes to the contrast rule, or name a different treatment (e.g. the Erase pattern
generalised — a selected segment filled in a non-partition colour, which also cannot collide).
It stays open because nobody has ruled: our own board proposing an answer is not a decision, and
the paint sits on thirteen call sites across Overview, four Advanced panes and
`InstallGeometry`, so it is not a local edit. **Nothing is being changed in the ring's
implementation until you answer.**

**This changes no arithmetic below or above.** Q19 closes no survey row — no row records this
defect, in either survey — so the questions-to-rows coverage stated at the end of this document
is unaffected. It is listed here because it is a real thing waiting on you, not
because a row asked for it.

## Four more, from the three boards this document had never covered

`FlashingCancel`, `FlashingCancelConfirm` and `FlashFailure` were drawn after both surveys and
walked into survey A on 2026-09-08 (`docs/audit-artboard-conformance-a.md:705-805`). Fourteen of
their 30 rows are BLOCKED. Twelve of those, plus `RomsNoFolder`'s RN2, are these four questions.
They were on nobody's list until now.

### Q20. Does a running flash get a user-facing `Cancel`? *(FC8, FC9, FC10, FCC1-FCC7)*

**ANSWERED 2026-09-11: yes, and it is built.** The owner asked for it by name after a run hung
at 0% with no way out but a page reload, which also cost him the activity log. `FC8`/`FC9`/`FC10`
and `FCC3`/`FCC4`/`FCC6` are FIXED; `FCC1`, `FCC2` and `FCC7` are now OPEN rather than blocked.

**One half of this question is still open, and it is the half this item said was the hard one:**
what a half-written bank leaves the user with. Nothing has been established against hardware, so
the shipped confirmation says only what is true of every writer here -- `What is already written
stays written. The install is incomplete until you run it again.` The board's own sentence
(*"Your stock firmware in bank 1 is not touched"*) is NOT shipped: it is true of a Retro-Go
install into bank 2 and false of an OFW patch flash, which writes bank 1. `FCC5` stays BLOCKED,
and `apps/web/test/flashcancel.mjs` fails if a bank claim reappears in that string.

The original entry follows.

**The largest single thing on this list, and the only one here with no recommendation.**

Three boards draw a way out of a running write. `FlashingCancel` puts a bare `Cancel` text link
in the progress modal's footer, with the caption `Stops after the current block`, and its own
comment (`:21-27`) explains the choice: *"the primary act on this screen is waiting, and a filled
control would compete with the progress it sits under. It is never disabled."*
`FlashingCancelConfirm` then draws the confirmation over it — `Stop writing Retro-Go?`, with a
body that names the bank, the percentage written, and asserts that stock firmware in bank 1 is
untouched.

**The engine already supports it.** `GnwFlasher.flash()` takes an `abortSignal` and checks it at
the top of every 256 KiB chunk (`packages/gnw-flasher/src/index.ts`), so the boards' "takes effect
at the next block boundary" is accurate, and the store's comment now says so
(`installProgress.svelte.ts:126-132` — **citation corrected 2026-09-08**). **What does not exist
is any UI end**: `apps/web`'s only `AbortController` is `Wizard.svelte:329`'s stall-timeout one,
which no user can reach, and `installProgress.cancel()` (`installProgress.svelte.ts:305` —
**corrected**) resolves the *confirm* prompt only.

Building it is not paint. It needs an `AbortController` per run, a store field, a second stacked
`ModalShell` with a lighter scrim and a `--danger` lip (both new props), and four new strings
across seven locales — but above all it needs a ruling on **what a half-written bank leaves the
user with**, which the confirm dialog has to state truthfully and which nobody has established
against hardware.

→ **No recommendation.** Yes, and we build it and you tell us what the confirm body may claim;
or no, and the three boards are retired. Answering "no" is a complete answer and closes ten rows.

### Q21. Should the install modal change its title when the install fails? *(FF4)*

`FlashFailure.dc.html:84` heads the failed dialog `Install failed` (**corrected 2026-09-08 from
`:85`**). The app renders `prompt.title` in every phase (`InstallProgressModal.svelte:108` —
**corrected from `:74`**), so a failure is still headed
`Install Retro-Go`. A per-phase title is a new store field plus a seven-file i18n edit, and the
word is yours.

→ **Recommend taking the board's title.** A dialog headed with the thing it did not do is the
one place the copy should not stay calm.

### Q22. Does the failure dialog offer `Retry install`? *(FF11)*

The board makes it the primary action. The app's failure footer offers `Save log` and `Close`
only, and `Close` is deliberately left bare (`ee63de2`) precisely because the primary beside it
does not exist — so today the failure dialog has no visible action at all.

This pairs with your `BAD_HASH_FLASH` ruling (HANDOVER §4: sanity check, retry twice, then a real
error naming the blocks). By the time this dialog is up, the two automatic retries have already
been spent, so `Retry install` is a *third* attempt the user asks for by hand, after a partial
write. That is a device operation, not paint — the paint is `Button`'s existing `action` variant.

→ **Recommend building it.** The automatic retries are for transport flakiness; this one is for
the user who has just reseated the programmer, which is exactly what the advice aside beside it
tells them to do (`InstallProgressModal.svelte:229`). If the answer is no, that aside's closing
*"then retry"* has to go with it.

### Q23. Which component owns the nav band's right slot? *(RN2)*

`RomsNoFolder.dc.html:70-76` puts a `Change folder` control on the **tab strip**, right-aligned.
The app's only change-folder affordance is the glyph in the games-pane header
(`RomManagementTab.svelte:2074` — **corrected 2026-09-08**), which lives in the `{:else}` branch — so in the no-folder state
there is no way to change folders except the gate button itself. `RomManagementTab` does not own
the tab strip, so building it means deciding which component does.

→ **Recommend amending the board** and leaving the nav band to navigation. In the state the board
draws, the gate button *is* the folder picker, sitting in the middle of an otherwise empty pane;
a second one in the chrome duplicates it. If you would rather the control be permanent, it is a
new slot on the tab strip and a prop down into it, which is a bigger change than the row implies.

### Q24. Three `Connected …` wordings the canvas has never drawn *(HeaderBusy, the three-connected-wordings row)*

*Added 2026-09-08 by a walk of the header's status derivation, which nothing had ever surveyed
branch by branch.* `statusText` (`DeviceHeader.svelte:130-145` — **corrected 2026-09-08**) has **eight** outcomes. The canvas
draws four: `Connected (Recovery Mode)` (51 occurrences), `Writing flash. Do not disconnect`,
`Finishing up. Do not disconnect`, and nothing for the two link-failure strings. The other three
are all on the pre-stub path — the link is up, the RAM stub is not loaded:

- `connectedRetroGo` — **`Connected (Retro-Go)`** when the scan classifies the device as Retro-Go.
- `connectedAs(label)` — **`Connected (<label>)`** for any other classified device, i.e. the
  status line interpolates a `deviceClass` label written for a scan report.
- `connected` — a bare **`Connected`** when nothing classified.

`docs/DECISIONS.md` #66 states the status line carries only five values. It carries eight, and
that error is load-bearing: #66 asks whether failures need a header treatment on the strength of
an inventory that was three strings short.

**This is not closed by the standing rulings.** The *states* are legitimate and nothing here
proposes cutting them, so *nothing is cut merely for not appearing in a mockup* does not apply;
and *artboard wins on pure paint* has no artboard to win with. What is open is the words, plus
whether a scan label belongs in the status line at all.

→ **Recommend collapsing all three to `Connected`.** The one thing the status line is for is
whether the app can talk to the device; which firmware is on it is what the two install slots
beside it already say, in the same band, with the version. `Connected (Retro-Go)` restates the
Retro-Go slot, and `Connected (<label>)` puts a classifier string on the most-read line in the
app. That is a delete in one file plus dropping two keys from seven locale files. If you would
rather keep the distinction, the wording is yours and it needs a board.

---

## Not decisions — work someone still has to do

These came out of the walk and belong on a backlog, not in front of you:

1. **`Re-read partition`** (`FileBrowser.dc.html:89`, and `FileBrowserFrogfs.dc.html:87` —
   **corrected 2026-09-08 from `:72`, which is the `Advanced` tab label**) is drawn and
   unimplemented; it needs a device-touching re-read handler. *(FB-10)*
2. ~~**A stale `MiB` literal** at `RomManagementTab.svelte:1455`~~ — **done** (`affaa83`). The SD
   dock caption now goes through `util.ts`'s `formatSize()` (`:1468`). The local `MiB` stays for
   Flash mode on purpose, and `0ebbe67` made it trim trailing zeros to match the corrected
   `Roms` board. The same defect was found and fixed twice more the same day: segment tooltips
   (`a05cec3`) and the Library's own figures (`0ebbe67`). ~~**A fourth instance is still open** —
   `OfficialFirmwareSection.svelte:161`~~ — **also done** (`5442258`), re-verified on the third
   pass: the row it fed is survey A row #10, which now reads FIXED, and `rowSize`'s `toFixed(2)`
   is gone — `:463` renders `formatSize` directly. The local `MiB` helper survives at `:162` but
   no board row cites either of its three remaining callers (the backup progress readout `:496`
   and `:532`, and `tooBigNotice` at `:588`). Nothing outstanding here.
3. ~~**`BackupPatch #1`** — make the two intro paragraphs conditional on no folder being
   chosen.~~ — **done** (`fa6ffed`), verified on the third pass:
   `OfficialFirmwareSection.svelte:393` gates both paragraphs behind `{#if !dir}`, with the
   reasoning written in above them at `:390-392`. This is exactly what the NOT-BLOCKED section
   above recommended, and it landed.
4. **The Install pane's superblock-debug link** (`RomSection.svelte:1002`, a bare
   `button.dbglink` — **the "now a `SplitButton`" note added 2026-09-08 was wrong and is
   withdrawn; the line number is right**) is a developer
   affordance sitting in a user pane; moving it behind Advanced was already recommended and
   never done.
5. **`logConnectingFlashUtil`** is untranslated — byte-identical English in all six non-English
   locale files (`firmwareSetup.<code>.ts`), and `roms.<code>.ts`'s `logConnecting` likewise.
   Re-checked 2026-09-08: unchanged. Check it against `6cdd9de` first, which deliberately
   *restored* an English-only audit-log marker in the Spanish tables — some log text is English
   by design, and this item should not be "fixed" without establishing which.

6. ~~**Three artboards have never been surveyed**~~ — **false, and it was false when written.**
   `FlashingCancel`, `FlashingCancelConfirm` and `FlashFailure` were walked on 2026-09-08;
   `docs/audit-artboard-conformance-a.md:87-94` records the walk and `:320-322` carries the
   per-board tables (30 rows). There is now no approved artboard that has never been surveyed.
   **The behaviour gap the item actually described was also in the wrong place** — a `Cancel`
   affordance drawn over an operation nobody has ruled is stoppable is a question, not work, and
   it is now **Q20**, with FC8/FC9/FC10 and FCC1-FCC7 attached to it.

7. ~~**148 rows across 15 artboards carry a verdict reached against a board `31cc2f7` has since
   corrected**~~ — **finished.** `docs/CONFORMANCE.md:298-325` records the re-walk in four
   pieces (Landing/Guided, the pass that took the count, the Advanced tab, and the
   Overview family + `GuidedFlashing` + `Roms`/`RomsOptions`), against a real outstanding figure
   of 87 rather than the 142 a previous pass carried. **Not one status cell moved**, and the
   sync's substantive changes are enumerated there and all built. Six rows were directly
   contradicted and were re-statused in survey A at the time (FB-4, FB-6, E-7, #10, #18 reopened;
   A33 corrected in place) — of those, **#10 and #18 have since closed** and are in the STALE
   table above. Nothing now rests on a stale drawing.

---

## Coverage, checked in both directions

The last consolidation mapped 111 rows to 31 questions and a later check found **48 of those
rows mapped to nothing**. So both directions were checked explicitly here:

**Rows → buckets.** The 71 rows were enumerated mechanically, not from a prose list: every table
row in both surveys whose status cell begins with `**BLOCKED**` (47 in A, 24 in B). Each was
assigned exactly one bucket, and each was edited in place with a dated `RE-STATUSED 2026-09-08`
clause naming its bucket and, if still blocked, its question number. Re-running the same
mechanical count after the edits gave **26 rows still marked BLOCKED — the 22 genuine ones plus
the 4 duplicates, which keep their status but carry a pointer to the row they duplicate.**
20 + 25 + 4 + 22 = 71, with no row in two buckets and none in none.

**Questions → rows.** Each question carries its row IDs in its heading. Collecting those headings
yields exactly the 22 genuinely-blocked rows plus the 4 duplicates, with no ID appearing twice and
no question citing a row that is not in the blocked set. No question was invented that no row asks
for, and no blocked row is missing from the list.

**Updated 2026-09-08 (second pass).** Q1 closing takes **A2** and **B841** out of the blocked set,
so the arithmetic for the 71-row set is **17 questions covering 20 blocked rows**, plus Q19 (which
closes no row) and the 4 duplicates.

**Re-derived 2026-09-08 (third pass), and it is the only number here that is allowed to move.**
The same mechanical count was re-run over both surveys today: **39 rows carry a BLOCKED status
cell — 24 in survey A, 15 in survey B.** That is not a drift in the 26 the second pass recorded;
it is that pass's set (which counted 10 in A and 16 in B) minus B841, which Q1 closed, plus the
14 rows the three flashing boards added to survey A afterwards. Every one of the 39 resolves:

- 24 to **Q2-Q18** (20 genuine plus the 4 duplicates, which keep their status and carry a pointer
  to the row they duplicate),
- 2 (**FC3**, **FC5**) to Q2 and Q4, which the survey rows themselves already say,
- 13 to **Q20-Q23**.

**Re-derived again 2026-09-08 (header-status pass).** The same count now gives **40 rows — 24 in
A, 16 in B**: the 39 above plus one new row in survey B's `HeaderBusy` table, which is **Q24**.
Both directions still hold; the new row is the only one attached to the new question, and no
existing row moved. `docs/CONFORMANCE.md`'s scoreboard was updated in the same change, and
`apps/web/test/conformance-counts.mjs` re-derives it — the figures here are that gate's output,
not a hand count.

Both directions hold after the change: every question's row IDs still resolve to a row that is
still BLOCKED, and no still-blocked row is left without a question. **RN2 was the one that had
been left without one** — it came in with the missing-states pass, after the row-to-bucket walk,
and nothing had picked it up. It is Q23.

**One deliberate disagreement, recorded.** A parallel agent proposed keeping **A53** blocked as
an artboard-versus-artboard conflict. I re-statused it CONFIRMED instead: the standing ruling
*"two artboards disagree? pick the better one and note it"* covers exactly that shape, and the
call has already been made and written down at `OverviewTab.svelte:120-126`. If you would rather
rule on it yourself it is one more question — but it does not need to be.

## What is still true that no code reading can fix

Every real-width measurement, and an hour looking at the app in a browser. That is not on this
list, because it is not a question. The dark theme is settled and is not raised here.
