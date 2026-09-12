# Open questions — artboard conformance survey A

**10 decisions.** They come from 14 OPEN rows in `docs/audit-artboard-conformance-a.md` plus one
finding in `docs/audit-dark-pairs.md`. Rows and decisions are different units: several rows are
the same call seen twice (MK4/MK5 are one typography ruling; MK10/MK11 are one dead-branch
ruling; MK13/MK14 are one failure-state ruling; FB-13/FB-14 are one footer-copy ruling; MK9 and
SA7 are the same colour token in two dialogs). Every defect below is real — none is stale.

Ordered by how much the answer changes what a user sees.

---

## 1. When an install fails, does the page stop saying "do not disconnect"?

**Today.** The install fails, the red-lipped failure dialog appears — and behind it the header
band is still amber, still reading `Writing flash. Do not disconnect`, with the gold hazard
stripe still crawling. It stays that way until the liveness poll next hears from the device.
The dialog says the write is dead; the chrome says it is still running.

**Why.** `installProgress.svelte.ts:288-292` releases the safety hold in `finally`, and
`:380-384` (`release()`) drops to `settling`, not `safe` — `settling` is still "unsafe", so the
band and lip keep their busy paint. The comment at `:290-291` states the reasoning: *"A failed
operation is if anything MORE likely to have left the device mid-write."* `markQuiet()`
(`:388-390`) clears it later.

**Candidate answers.**
- *Keep it (no change).* The warning survives a failed write, which is exactly when the device
  is most likely to still be mid-erase. The user sees a contradiction for a second or two.
- *Drop to safe on error.* The chrome matches the dialog immediately, as
  `FlashFailure.dc.html:27-79` draws it — white band, green chip, static gold lip. Costs the
  hazard warning in the one case it was most needed.
- *Third option: keep the hold but change what it says.* A distinct "device may still be
  writing" line rather than the running-flash warning. New copy in 7 locales.

**Recommendation:** the third option, or failing that keep it. The board's argument (*"A page
still shouting 'do not disconnect' behind a dead flash would be a lie"*) is about wording, and
wording is cheaper to fix than the safety property. Do not simply drop to safe.

**Evidence.** `apps/web/src/lib/installProgress.svelte.ts:292,380,388`;
`apps/web/src/lib/ui/DeviceHeader.svelte:105,192-201`; `apps/web/src/App.svelte`, the `.lip` /
`.lip.hazard` rules (`:169-178`). The path previously read `src/lib/App.svelte`, which has never
existed, and its line range no longer pointed at the lip; the symbol is cited rather than a
re-guessed range.
Board: `docs/design/mockups/FlashFailure.dc.html:27-79`. Survey row FF1
(`docs/audit-artboard-conformance-a.md:793`).

---

## 2. Does the failure dialog keep the phase checklist and the Log?

**Today.** When an install fails, the dialog shows: title, failure sentence, the list of failed
blocks, an advice note — *and* the full phase checklist above it (with the phase that died
marked `✗`) and the `Log (n)` disclosure below. The drawn board shows none of that: title,
sentence, block table, advice, footer, with `Save log` replacing the disclosure.

**Candidate answers.**
- *Keep both (no change).* The `✗` is the only thing on screen that names **which phase** died;
  the board can only imply it via the block table. Taller dialog.
- *Adopt the board.* Shorter, calmer failure screen focused on the blocks. The user loses the
  at-a-glance "it got as far as X" and must open the saved log to find it.

**Recommendation:** keep both. Nothing is cut merely for being absent from a mockup, and the
`✗` carries information the board's layout has no room for. This is a genuine structural
divergence though, so it should be ruled rather than left implicit.

**Evidence.** `apps/web/src/lib/ui/InstallProgressModal.svelte:102,112` (error branch),
`:130-172` (the checklist that stays). Board: `docs/design/mockups/FlashFailure.dc.html:84`.
Survey row FF10 (`docs/audit-artboard-conformance-a.md:802`).

---

## 3. When the small confirm dialog fails, does it get the failure treatment?

**Today.** Two failure surfaces, drawn two different ways, and they disagree.

The install dialog on failure: red 3px lip, a written failure sentence, a block table, advice,
`Save log` and `Close`.

The small confirm dialog (Boot Image, and every other `ConfirmModal` operation) on failure:
**gold** lip unchanged, unchanged title, one line of raw error text — literally
`Error.message`, e.g. `Not connected.` — and a single neutral `Close`. No retry, no way to
reach the device log. It is the thinnest failure state in the app.

**The boards conflict.** `ModalConfirmError.dc.html:200` draws it with the gold lip kept:
`height: 3px; background: linear-gradient(180deg, #d9bc5e 0%, #c09a32 100%)`.
`FlashFailure.dc.html:84` swaps the same shell to `height: 3px; background: #8a241b`.
Both are drawn boards; neither is a mistake on its face. `lip="danger"` already exists and has a
live caller (`InstallProgressModal.svelte:102`), so adopting it here is one prop.

**Candidate answers (one ruling, three levels).**
- *Nothing.* Both boards stand; the small dialog stays quiet on failure.
- *Lip only.* Pass `lip="danger"` when the phase is error. One line. The two error surfaces
  then read as one system, and `ModalConfirmError.dc.html` becomes the board that changes.
- *Lip plus copy plus a way out.* A real failure sentence instead of the developer string, and
  either a `Retry` or a `View log` action. New copy in 7 locales, and a retry means re-running
  a device operation.

**Recommendation:** lip plus copy. The gold-vs-red split reads as an oversight rather than a
distinction, and `Not connected.` shown to a user is a developer string that escaped. I would
hold retry back — retrying a half-finished device operation is its own decision.

**Evidence.** `apps/web/src/lib/ui/ConfirmModal.svelte:62` (`Error.message`), `:73` (no `lip`
passed), `:100-102` (the error branch); `ModalShell.svelte:52` (gold default);
`OverviewTab.svelte:287` (the thrown string the board drew). Boards:
`docs/design/mockups/ModalConfirmError.dc.html:200` vs
`docs/design/mockups/FlashFailure.dc.html:84`. Survey rows MK13, MK14
(`docs/audit-artboard-conformance-a.md:1278-1279`).

---

## 4. The "Cores & saves" bar label is hard to read in dark theme, token flip or leave it?

**Today.** On the storage bar, the "Cores & saves" segment is a mid grey with near-black
11px bold text on it. In light theme that is crisp. In dark theme the segment darkens but the
text does not, so the label sits at roughly 3.6:1 — legible, but visibly muddier than every
other label on the same bar. It cannot be fixed by picking a side: white text on the light-mode
version of that fill is about 2.8:1, which is worse.

**Candidate answers.**
- *New theme-flipping token.* A label ink that is dark in light theme and light in dark theme,
  used only where it sits on this family of neutral fills. Small, contained; adds one token to
  a palette that is otherwise settled.
- *Change the segment fill in dark theme only.* Lighten it enough that dark ink holds. Touches
  the palette, which you have said is settled.
- *Accept it.* It is legible, just poorer than its neighbours.

**Recommendation:** the theme-flipping token. It is the only option that does not reopen the
palette, and `--ink-on-face` is documented as deliberately never flipping, so this needs a
sibling rather than a change to it.

**Evidence.** `apps/web/src/lib/ui/GeometryBar.svelte:233` (the rule), `:244` (the in-code note
that white is ~2.8:1 here), `:277,283` (`--seg-saves` fills);
`apps/web/src/styles/tokens.css:77` (`--seg-saves: var(--silver-edge)`).
`docs/audit-dark-pairs.md:92` (the measurement), `:48`, `:98`. No artboard covers dark theme.

---

## 5. Should the "working" shuttle and the OK button be the device's colour?

**Today.** Two affordances take `--model-accent`, which is green on a Zelda unit and red on a
Mario unit:

- The indeterminate progress shuttle in the small confirm dialog. On a Mario device the
  "Working — do not unplug your device" bar sweeps **red**, which reads as an error.
- The `OK` button on the "Space Limit Reached" dialog — a dialog whose border and title are
  already `--danger`. On a Mario device a red OK button sits inside a red-framed error dialog.

Both boards drew the Zelda case, so both look correct in the drawing and only the Mario case is
wrong.

Same group, one small extra: the `<strong>` in "do not unplug your device" is bare, so it
renders at the browser's 700 while the board asks for 600.

**Candidate answers.**
- *Fix the colour to green* (`--zelda-green`) for both, as drawn. Loses nothing — device
  identity is carried by the header, not by a progress bar.
- *Neutral* for the OK button (the plain `.action` variant), fixed green for the shuttle.
- *Leave it.* Device identity everywhere, including here.

**Recommendation:** fix both to the drawn green, and set the `<strong>` to 600. A model-shifting
colour says nothing on a progress bar and actively misleads on an error acknowledgement.

**Evidence.** `apps/web/src/lib/ui/ConfirmModal.svelte:85` (the strong), `:128-143` (`.indet`
gradient using `--model-accent`); `apps/web/src/lib/views/RomManagementTab.svelte:2395` (`class="action primary"`), `:2637-2641` (`background: var(--model-accent)`);
`apps/web/src/styles/tokens.css:330,333` (`--model-accent` is green on `.model-zelda`, red on
`.model-mario`). Boards: `docs/design/mockups/ModalConfirmRunning.dc.html:200`
(`linear-gradient(90deg, #e8e8e8 30%, #3e9e4e 50%, #e8e8e8 70%)`, `<strong style="font-weight:
600">`) and the `RomsNoFolder.dc.html` OK at `background:#3e9e4e`. Survey rows MK9, SA7
(`docs/audit-artboard-conformance-a.md:1274,1307`).

---

## 6. The busy stripe: 3px static, or 5px crawling as drawn?

**Today.** While the app is writing to the device, a thin gold stripe runs under the header. It
is 3px tall and only changes fill when a write starts — the same height at rest and at work, so
nothing on the page moves. It does animate (a crawl) while busy.

The board draws it 5px and crawling — i.e. the stripe grows when a write begins.

**Candidate answers.**
- *Keep 3px, correct the board.* The code carries a written rationale: one lip, always 3px, so
  there is no layout shift when a write starts or ends.
- *Adopt 5px.* Matches the drawing; every element below the header shifts down 2px the moment a
  write begins and back up when it ends.

**Recommendation:** keep 3px and change the board. A whole-page nudge at the start and end of
every write is a worse cost than a slightly thinner stripe, and the constant height is the
reason it was chosen.

**Evidence.** `apps/web/src/App.svelte:169-173` (`.lip { height: 3px }` and the comment at
`:167-168`), `:174-178` (`.lip.hazard` crawl). Path and lines re-derived 2026-09-10; the path
previously read `src/lib/App.svelte`, which has never existed. Board:
`docs/design/mockups/GuidedFlashing.dc.html:64` (`height: 5px; background-image:
repeating-linear-gradient(115deg, #b8860b 0 14px, #e8c25a 14px 28px)`). Survey row GF3
(`docs/audit-artboard-conformance-a.md:698`).

---

## 7. File browser footer: two undrawn states need copy, or a ruling that none is needed

**Today.** The file browser's footer bar has two states no board covers.

*With LittleFS selected but Recovery Mode off:* the footer says **"Click a file to download it
from the device."** — and none of the files is clickable, because downloading needs Recovery
Mode. Hovering a row does reveal "Enter Recovery Mode to download files", but the footer
instruction is simply false.

*With no partition selected at all:* the 72px footer bar renders empty. The instruction the user
needs ("Pick a partition above to read its contents.") is on screen, but up in the pane
subtitle, not in the bar.

**Candidate answers.**
- *One new string for the gated case* (e.g. the footer echoing the Recovery Mode requirement),
  and leave the empty slot alone. 7-locale edit.
- *Two new strings*, the second filling the empty bar when nothing is selected. 7-locale edit ×2.
- *Neither.* Rule that the row tooltip is enough and the empty bar is correct. Costs nothing;
  leaves a false instruction on screen.

**Recommendation:** the first. The false instruction is a real defect; the empty bar is not — it
is deliberate and the code says so, and no board draws a footer line for an empty selection.

**Evidence.** `apps/web/src/lib/advanced/FileBrowserSection.svelte:116` (`canDownload` also
requires `device.utilLoaded`), `:118-129` (the summary, and the comment stating the
no-selection case is deliberate), `:228` (the row tooltip);
`apps/web/src/lib/i18n/strings/firmwareSetup.ts:340` (`footerSummary`), `:327` (`intro`). Boards:
`docs/design/mockups/FileBrowser.dc.html:87` (draws the LittleFS footer only for the
downloadable case) and `FileBrowserFrogfs.dc.html:87`. Survey rows FB-13, FB-14
(`docs/audit-artboard-conformance-a.md:990-991`).

---

## 8. Reword the "not enough space" message?

**Today.** The dialog is titled **Space Limit Reached** — calm, sentence-cased. Its body reads:

> Not enough space on device! Required: 26.42 MB, Available: 24.06 MB

Two registers in one small dialog: a calm title, then an exclamation mark and a machine-style
`Label: value, Label: value` readout. The body also restates the title.

**Candidate answers.**
- *New wording.* One line stating the shortfall once — e.g. naming how much over the selection
  is — replacing both halves. 7-locale edit; the wording is yours to pick.
- *Leave it.* Correct, just clumsy.

**Recommendation:** reword. No wording is proposed here because it is a 7-file i18n edit and the
sentence should be yours.

**Evidence.** `apps/web/src/lib/i18n/strings/roms.ts:47-48`. Board:
`docs/design/mockups/RomsNoFolder.dc.html:2003` — the board's copy is character-identical to the
code, so this is a copy call, not a conformance defect. Survey row SA6
(`docs/audit-artboard-conformance-a.md:1307`).

---

## 9. Confirm dialog body text: 14px or 16px? (Our own boards disagree)

**Today.** The confirm dialog's explanatory line renders at **16px**, with **16px** of space
between the title and it.

Four of the five boards for this dialog draw exactly that. One draws it smaller and tighter. So
this is not a code defect — it is two of our own drawings contradicting each other, and one of
them has to be corrected.

The conflict, verbatim:

- `docs/design/mockups/ModalConfirm.dc.html:200` — a flex head band, `gap: 8px`, body
  `font-size: 14px; color: #5c5c5c`.
- `docs/design/mockups/ModalConfirmRunning.dc.html:200` (and `…Progress`, `…Done` identically) —
  no flex, no gap, body `<p style="margin: 16px 0; font-size: 16px; color: #5c5c5c;">`.
- `docs/design/mockups/ModalConfirmError.dc.html:200` is a third reading again — `margin: 14px
  0; font-size: 14px` — but that line is an error message, not the body text.

**Candidate answers.**
- *16px wins.* Correct `ModalConfirm.dc.html`; no code change at all.
- *14px wins.* Correct the four phase boards, and add a `.muted` size rule plus an 8px flex gap
  to the component.

**Recommendation:** 16px — the four-to-one majority is also what already ships, so the answer
that costs nothing is also the consistent one. But the ruling is yours; some board is wrong
either way.

**Evidence.** `apps/web/src/lib/ui/ConfirmModal.svelte:79` (`<p class="muted">`, no size rule in
the component), `:113` (`h3 { margin-bottom: 0.5rem }` colliding with the paragraph's UA
`margin: 1em 0`); `apps/web/src/styles/global.css:53-55` (`.muted` sets colour only);
`apps/web/src/styles/tokens.css:92` (`--fs-body: 16px`). Survey rows MK4, MK5
(`docs/audit-artboard-conformance-a.md:1269-1270`).

---

## 10. Determinate progress bars: wire a producer, or delete the branch?

**Today.** The small confirm dialog has two ways to show progress. It always shows the
indeterminate shuttle. It has a second, fully built path — a real percentage bar with a
`118 / 256 KB` style caption, plus a second bar for a sub-step — that **no user has ever seen**,
because nothing feeds it. `ModalConfirmProgress.dc.html` draws a screen the app cannot reach.

Every value in that branch matches the board. The branch is simply unreachable: it needs
`report()` to be called, and neither caller calls it — `runBoot` accepts `report` and drops it,
and the device-header caller takes no argument at all.

There is also no spacing between the two bars if it ever did render; they touch, which reads as
one control. No board settles that gap (the board was drawn *from* this code), so it is a design
call — but it costs nothing while the branch is dead.

**Candidate answers.**
- *Wire a producer.* Make at least the boot path report real byte progress. The user gets a real
  percentage instead of a shuttle on the operations that can measure themselves. Then the bar
  gap needs a value.
- *Delete the branch and the board.* Less dead code; the shuttle is honest for operations that
  genuinely cannot measure progress.
- *Leave it as an API contract.* `report` is part of `run`'s published signature; the branch is
  the documented shape a future caller would use.

**Recommendation:** none — I don't have one. This turns on whether you intend more
`ConfirmModal` operations to report byte progress, which is a roadmap question, not a design
one. If the answer is no, delete it; leaving unreachable UI with a board in front of it is how
it got surveyed as a conformance row in the first place.

**Evidence.** `apps/web/src/lib/ui/ConfirmModal.svelte:29-31` (`report` in the signature), `:55-59`
(the only thing that sets `done`/`total`/`sub`), `:86-94` (`{#if total > 0}` and the two
`Progress` renders); `apps/web/src/lib/views/OverviewTab.svelte:286-291` (`runBoot(report)`, wired at `:609`, never
calls it); `apps/web/src/lib/ui/DeviceHeader.svelte:298` (inline `run` takes no argument);
`apps/web/src/lib/ui/Progress.svelte:14-18` (`.wrap`, no margin). Board:
`docs/design/mockups/ModalConfirmProgress.dc.html:200`. Survey rows MK10, MK11
(`docs/audit-artboard-conformance-a.md:1275-1276`).
