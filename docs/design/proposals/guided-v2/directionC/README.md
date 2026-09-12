# Guided Setup, direction C: the flow itself

Three boards. Direction A tidies the chooser page and direction B recomposes it; this set asks
whether the chooser should be a page at all. The owner asked for exactly one of the three
directions to do this:

> "I want one of those to be the creative one that proposes a few variations to the whole flow
> itself."

Not registered on the main canvas: `apps/web/test/artboard-index.mjs` scans `docs/design/mockups/`
only, and this is a proposal. Open `canvas.json` here.

Run `python3 build.py` to regenerate. `shell.py` holds the chrome lifted verbatim from the approved
Guided boards; `parts.py` holds the spine's rail geometry, also lifted. Both are held constant
across all three boards, so a preference between them is a preference about sequence rather than
about styling.

| Board | The idea in a sentence |
|---|---|
| `ChoiceOnTheRail` | The question becomes step 1 of the spine, so there is one layout instead of two |
| `PlanFirst` | The device already answers the question, so open on the plan and keep the choice visible |
| `ChooseAndSee` | Put the choice and the steps it produces on one page, so the steps are the explanation |

---

## What the steps pages do that the layout question does not

This is the finding the boards are built on, and it is worth stating before the variations because
it is the same list any of the three directions has to answer.

**1. The spine hangs everything off one left edge. The chooser centres a fixed-width stack inside a
wider left-aligned block.** The column is 470px on both. The spine fills it with a
`30px minmax(0, 1fr)` grid. The chooser puts a 304px card in the middle of it, so the cards align
with neither the title above them nor the escape line below them. The live CSS says so itself:

```
/* A fixed-width card in a stretch-aligned column would sit hard left -- centre them. */
align-items: center;
```

That comment is the defect. The cards are centred because they are the wrong width, and they are
the wrong width because nothing decided what the column is for.

**2. The spine weights the live thing and dims the rest.** Active step titles are 21px, every other
title is 16px, and inactive steps carry `opacity: 0.5`. The chooser gives all three cards identical
weight, so nothing on the page says which one most people want, or which one the device is already
set up for.

**3. The spine has a real button.** `--action-red` with `inset 0 -2px 0 --action-red-deep`. The
chooser's cards are hairline boxes with no button affordance at all, so the one page in the flow
that exists purely to be clicked is the one page with nothing that looks clickable.

**4. The spine carries status in small caps.** `Done`, `Optional`, 12px 600 uppercase with
`letter-spacing: 0.05em`. The chooser has no equivalent and no way to say "this is what you have
now".

**5. The spine is left-aligned throughout. The chooser mixes.** Icons sit left, the label is
`text-align: center` inside the card.

All three boards here fix 1 and 5 by construction, because they put the choice on the same rail or
in the same grid as the steps.

---

## The board set

### ChoiceOnTheRail

**The question becomes step 1 of the spine.** One rail, one left edge, one layout for the whole of
Guided Setup. Choosing collapses the row to a `Done` marker naming the chosen path and the
remaining steps appear beneath it on the same rail, which is the affordance the spine already has
(`Run again` on a completed step).

*What moves:* nothing merges. The chooser page is deleted and becomes row 1. The two pips are
deleted, because two pips describing two pages would be a lie once there is one page.

*The choice cards become rows.* Full cell width, marks in a fixed 62px zone, label left-aligned, so
they align with the title, the rail and the escape line. The card treatment and the marks are
unchanged from the approved chooser.

*What it gives up, and this is the real cost:* the first screen is sparser than today's. The board
draws row 1 and nothing below it, because **the step titles differ by path** and are genuinely
unknown before the choice is made. Dual boot's first step is `Backup & Patch Original Firmware`,
Retro-Go-only's is `Back Up the Original Firmware`, and Return to Stock has a different set
entirely. Drawing greyed future rows would mean either inventing placeholder titles, which
`UI_VOICE.md` §5 forbids, or showing titles that change under the user once they pick. Neither is
acceptable, so the rail starts short and grows. If that sparseness is the thing you dislike, this
variation is the one to drop.

### PlanFirst

**The app already knows the answer most of the time, so stop asking.** Open directly on the spine
with a path selected, and put the decision in a segmented control above it, the chosen one
outlined.

The inference is made of facts the app already reads: a stock device with 16 MB or more of external
flash wants Dual Boot; under 16 MB dual boot is impossible so Retro-Go-only is the only install
path; under 8 MB neither is possible. The board draws the stock case, which is why its header reads
`Zelda (Stock)`.

*What moves:* the chooser page is deleted for the determined cases. The pips go with it. Nothing
merges; one page is removed from the front of the flow.

*No new string.* The segmented control is built from `chooser.dualBoot`, `chooser.onlyRetroGo` and
`chooser.returnToStock`, which already exist, and selection is carried by the outline rather than
by a word. A control labelled `Change` would have needed a fifteen-file i18n edit and is not drawn.

*Where inference honestly fails:* a device that is already **patched** is ambiguous. The user may
be adding Retro-Go or removing it, and nothing in the device state distinguishes those intents. So
this variation is "infer when the facts determine it, ask when they do not", and a patched device
still gets the chooser. That is not a hedge; it is the boundary of what the device can tell you.

*What it gives up:* it makes a consequential decision on the user's behalf. Dual Boot and Only
Retro-Go differ in whether the original firmware survives, and a user who does not read the
selector could start down a path they did not intend. The selector is placed where the eye lands
first and every destructive step still confirms, but the risk is real and it is the price of the
variation.

### ChooseAndSee

**One page: the choices on the left, the steps they produce on the right, updating live.** Nothing
is sequenced, so nothing has to be explained.

This is the variation that answers the problem `UI_VOICE.md` §1 created. Three captions under the
chooser's cards were struck for narrating, and that left the page with no way to say what a choice
costs. Here the steps say it. Picking `Return to Stock` redraws the right column as
`Select Backup of Original Firmware` / `Restore Original Firmware` / `Remove Retro-Go`, which tells
you more than a sentence would and invents no copy at all. State in structure, per §3.

*What moves:* the chooser page and the spine page merge into one. Both pips go.

*What it gives up:* it is the widest departure and the most expensive. The 470px column becomes an
867px two-column grid, so it is the only board here that changes the page's proportions, and it is
the one that will be tightest in German and at small widths. The right column is also a **preview**
of work not yet started, which risks reading as work in progress; the primary button has to stay
inert until a choice is made, and the board does not have a way to show inertness that the approved
set already draws. With only one choice available, which the hardware floors can cause, the left
column is nearly empty and the composition looks broken.

---

## How each variation survives the branching states

The flow branches on what the device turns out to be. These are the states, taken from
`Wizard.svelte` rather than from the boards, and every variation has to serve all of them.

| State | Source | ChoiceOnTheRail | PlanFirst | ChooseAndSee |
|---|---|---|---|---|
| Locked (`isLocked`) | `GuidedLocked` | Row 1's marker is a stop, `lockedTitle` + `lockedBody` + `lockedHow` in its cell, no rows below because none are possible | Nothing can be inferred: a locked flash cannot be read, so the chooser page is kept for this state alone | Left column is the locked notice, right column is empty |
| Stock device (`isStock`) | `GuidedLayoutStock` | Two rows in the choice cell, not three. `Return to Stock` is never offered when there is nothing to return from | This is the case inference serves best: Dual Boot preselected | Two cards on the left |
| Under 16 MB (`!canDualBoot`) | **no board draws this** | `tooSmallForDualBoot` sits under the remaining choices | Retro-Go-only is the only install path, so it is selected and the note explains why | Note under the left column |
| Under 8 MB (`!canRetroGo`) | **no board draws this** | Only the floor note is shown, since every card can be hidden | No install path exists, so there is nothing to infer and the note stands alone | Left column is the note alone, and this is where this variation looks worst |
| Skip backup | `GuidedSkipBackup` | Unchanged, it is a step 1 concern | Unchanged | Unchanged, inside the right column |
| Retro-Go-only spine | `GuidedRetroGoOnly` | Rows below the collapsed choice row | The selected path's spine | The right column |
| Return to Stock spine | `GuidedStockOnly` | Three rows rather than four | The selected path's spine | The right column, three rows |
| Flashing | `GuidedFlashing` | Unchanged, a modal over the rail | Unchanged | Unchanged |

**Two states have no artboard.** `chooser.tooSmallForRetroGo` and `chooser.tooSmallForDualBoot` are
live strings enforcing hard hardware floors, 8 MB for Retro-Go and 16 MB for dual boot, and under
8 MB every card can be hidden and the note is the entire page. No approved board draws either.
Reported rather than filled in, per §5.

---

## Long strings and RTL

| Board | A long German string | `dir=rtl` |
|---|---|---|
| `ChoiceOnTheRail` | Safest of the three. Choice rows are full cell width with the label after a fixed 62px mark zone, so a long label wraps inside a row that is already as wide as the column | Clean. The rail is a two-column grid and the marks are a flex row, so both mirror. The rail moves to the right edge with the content beside it |
| `PlanFirst` | Weakest of the three. The segmented control holds all three path names on one line, and German (`Nur Retro-Go`, `Zurück zum Auslieferungszustand`) will not fit at 470px. It has to wrap to two rows or drop to a stacked list, and the board does not draw that | Clean, given the above. Nothing is positioned by physical side |
| `ChooseAndSee` | Tight. The left column is 300px and the right is a fixed 470px spine, so a long label wraps in the cards while the spine stays put. Workable but it is the one to test first | Clean. Uses flex order, not physical sides, so the columns swap |

Nothing in these boards uses `padding-left`, `margin-right`, `left`, `right`, `float` or
`text-align: left|right`. `apps/web/test/direction.mjs` enforces that rule in `apps/web/src`; these
are docs, but following it here keeps a board from becoming an RTL bug when it is built.

---

## The approved Guided boards are stale, and it matters for this pass

Found while reading them. The live strings have moved and the boards have not, so anyone designing
against `docs/design/mockups/Guided*.dc.html` is designing against copy that no longer exists.

| Board text | Live string | Note |
|---|---|---|
| `How Do You Want the Device Set Up?` (`GuidedLayout`) | `chooser.title` = `What should this device run?` | Two boards, two different titles, for one question |
| `What Do You Want on the Device?` (`GuidedLayoutStock`) | same | |
| `Keeps the original firmware. Pick which one runs at power-on.` | deleted | Struck by `UI_VOICE.md` §1 |
| `Replaces the original firmware and leaves more space for games.` | deleted | Struck by §1 |
| `Restores the original firmware from your backup. Erases Retro-Go.` | deleted | Struck by §1 |
| `Add ROMs and Homebrew` | `spine.addRoms` = `Add to Library` | The board wording is the one `core-vocabulary.mjs` fails the build on |
| `Unlocking needs gnwmanager's unlock command and a power cycle you do by hand.` | `chooser.lockedHow` now says the Advanced tab unlocks it | The board still sends the reader to another tool |

The boards in this set use the live strings throughout, verified against
`apps/web/src/lib/i18n/strings/wizard.ts` and `deviceHeader.ts`.

Worth settling before any direction is built: the approved set should be re-synced, or it will keep
producing this drift. That is a separate job from this proposal.
