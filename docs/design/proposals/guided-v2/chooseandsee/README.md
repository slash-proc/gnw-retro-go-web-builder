# ChooseAndSee, driven by device state

The shape the owner picked from Direction C: the choice on the left, the plan it produces on the
right. This directory turns that one drawing into a generator, so a board is a **device state**
rather than hand-written markup.

`LOGIC.md` is the authority. It is the live gating rules with a file and line for every claim, and
`build.py` re-implements those rules rather than approximating them, so a board cannot draw a
combination the app cannot produce. `python3 build.py` regenerates every board.

## Boards

| Board | State | Cards drawn | Plan shown |
| --- | --- | --- | --- |
| `StockBank1` | pristine stock Zelda or Mario in bank 1, 16 MB | Dual Boot, Only Retro-Go | the dual-boot spine, four steps |
| `RetroGoBank1` | Retro-Go in bank 1, 16 MB | Dual Boot, Only Retro-Go, **Return to Stock** | the restore spine, three steps |
| `StockBank1At8MB` | pristine stock, 8 MB (LOGIC.md row 2) | Only Retro-Go | the Retro-Go spine, four steps |
| `StockBank1Under8MB` | pristine stock, 4 MB (row 3) | **none** | none, there is no card to produce one |
| `StockBank1Unscanned` | pristine stock, size not yet read (row 4) | Dual Boot, Only Retro-Go | the dual-boot spine, four steps |
| `RetroGoSmall` | Retro-Go in bank 1, 8 MB (LOGIC.md row 6) | Only Retro-Go, Return to Stock | the reinstall spine, three steps, install already done |
| `RetroGoTooSmall` | Retro-Go in bank 1, 4 MB (row 7) | **Return to Stock alone** | the restore spine, three steps |
| `RetroGoUnknownSize` | Retro-Go in bank 1, size not scanned (row 8) | all three, **and no floor note** | the dual-boot spine, four steps |
| `VersionUpgrade` | Retro-Go in bank 1, 16 MB, a newer release picked | Only Retro-Go | the reinstall spine, control reading **Upgrade** |
| `VersionReinstall` | the same device, the installed release picked | Only Retro-Go | the same spine, control reading **Reinstall** |
| `VersionDowngrade` | the same device, an older release picked | Only Retro-Go | the same spine, control reading **Downgrade** |

`StockBank1` and `RetroGoBank1` differ in exactly one input, bank 1, and that difference produces
both a different card set and a different plan. The three stock rows below them vary the other
input, flash size, against a fixed bank 1, and include the two states **no approved board has ever
drawn**: under 8 MB with pristine stock, where every card is gated away and the floor note is the
whole page, and unknown flash size, where both gates pass and no note is drawn at all.

## Two things these boards settle

**The pointer, not a selection.** The live chooser has no selection state: `path` is `null` until a
card is clicked (`Wizard.svelte:1037-1044`). A board that drew a selected card would be inventing a
state, so the outline is a **hover** and the right column is what that card *would* produce.
`board(state, hover=n)` is that pointer.

**The plan is the argument for the shape.** Only Retro-Go draws four steps on a pristine stock
device with no recorded backup and three steps otherwise, because `rgoNeedsBackup` is latched at
the moment of choosing (`Wizard.svelte:1043`). That is a real consequence of a real choice that
today's chooser has no way to show, and it is the hole `UI_VOICE.md` §1 left when the three
captions were struck: the steps say what a choice costs, inventing no copy.

## The stock family, rows 2 to 4

**Row 3 is not an edge case. It is an unmodified Game and Watch.** Stock Zelda ships with 4 MB of
external flash and stock Mario with 1 MB (`engine/ofw.ts:147`, `:458`), both under the 8 MB floor.
Bank 1 holds pristine stock, so `isStock` hides Return to Stock as well. Every card is gated, and
the page is a question with no answers. The owner's rule at `Wizard.svelte:128-131` says "under
8 MB the ONLY thing it offers is returning to stock" -- on a pristine device that one remaining
option is hidden too, so it offers nothing at all.

**Rows 4 and 3 are the same device, seconds apart.** `extSizeMB` is null until the stub has read
the chip, and null passes both gates deliberately (`Wizard.svelte:133-135`). So a freshly connected
stock device first draws `StockBank1Unscanned` -- two cards, no note -- and then, when the scan
lands, draws `StockBank1Under8MB` -- no cards. **The page withdraws both choices as it learns.**
Read those two boards in that order; neither is interesting alone and together they are the
first-run experience of an unmodified device.

Row 2 is where the plan earns its place: one card survives, and the spine beside it is **four**
steps rather than three, because `rgoNeedsBackup` is `isStock && !backupTaken` (`:1043`) and both
hold. The same card on a device that already has a backup draws three.

### Three decisions in these boards

**The floor note is grey, not gold.** `Wizard.svelte:1439-1440` states the rule: "not styled as an
error: the device simply cannot do the thing, which is a fact about the chip rather than a failure".
The draft drew it `--caution`; it is now `--ink-mute`, as the live page has it. Rows 1 and 5 carry no
note, so nothing exercised this until these three.

**Nothing is drawn where the cards would be.** On row 3 the note takes the position the cards held.
No empty box, no placeholder. Absence is absence (`UI_VOICE.md` §3).

**The measure falls back to 470px when there are no cards.** `CARD` is 360px because that is what
holds a card; with no card it is an arbitrary crop on a page of nothing but text. 470px is the
measure every approved Guided board uses, and it is what the note's own `max-width: 52ch` wants.

### Two things reported rather than drawn

**The pips.** The live chooser draws two pips with the first active (`Wizard.svelte:1068-1071`),
unconditionally. On row 3 the flow cannot reach step 2, so a two-step indicator is a claim the page
cannot honour. No board in this directory draws pips at all, which sidesteps rather than answers it.
Set-wide question, not a row 3 one.

**A ghost 20px.** `.chooser` carries `margin-bottom: 20px` (`Wizard.svelte:1353-1354`) whether or not
it has children, so the live row 3 page has 20px of empty flex column between its rubric and its
note. The boards do not reproduce it. Worth a look at the live page before it is called a bug.

## The overlap

The Direction C draft put the marks in a `62px` well with `flex-shrink: 0` on the span and on every
image inside it. The Dual Boot mark is three items:

```
logo-gnw-badge.svg  149.362 x 119.059  drawn 24px high  ->  30.11px
the plus glyph                                              11.00px
logo-rgo.png        64 x 12            drawn 11px high  ->  58.67px
two 8px gaps                                                16.00px
                                                   total = 115.78px
```

115.78px of unshrinkable content in a 62px box overflows by 53.78px, and the label starts at
`62 + 16 = 78px`, so the Retro-Go logo paints straight through it. The other two marks are one
image each and fit, which is why only Dual Boot looked broken.

The well is now sized from the **widest** mark rather than from a number that suited the narrowest.
`check_geometry.py` measures both logos from the asset files themselves and fails if the well is
too small for the widest mark, or if the card leaves the label less than the ~170px the longest
translation needs (`Retro-Go uniquement`, fr). Both mutants were verified: restoring the 62px well
reports the 53.78px overflow, and narrowing the card to 300px reports a 128px label.

## What the Retro-Go rows say

**Row 7 is the case the shape was picked for.** One card survives under 8 MB, and the earlier
mockup round flagged a single surviving card as the thing most compositions degrade badly on: a
lone box floating under a heading, with the page's whole right side empty. Here the left column
carries one card and the floor note that explains why it is alone, and the right column is
**full** -- the restore spine is three steps whatever the flash size, because restoring has no
size floor. The asymmetry is the argument: the plan does not shrink just because the choice did.

**Row 8 is the one nothing has drawn.** `extMB === null` passes both gates, so an unscanned device
is offered Dual Boot, and both note branches require `extMB !== null`, so **no note is drawn to
say the offer is provisional**. The pointer sits on Dual Boot deliberately: that card exists here
only because the device has not been measured.

**The header is part of the state.** A device with Retro-Go in bank 1 has it installed, so these
three boards draw the version in the header slot rather than `Not installed`, undimmed, the
treatment `GuidedFlashing.dc.html` uses. Drawing `Not installed` beside a spine whose install step
is done would have contradicted itself on one page.

## Three things these rows expose

**One page for two different devices.** A dual-boot device has *patched* stock in bank 1 and
Retro-Go in bank 2, so `isPristineStock` is false and it classifies `retrogo-sd`, identical to a
Retro-Go-only device whose bank 1 holds the app (`classify.ts:47`, LOGIC.md §2). Rows 6, 7 and 8
are drawn as the code produces them, which means **each of these boards stands for both devices**,
and the chooser never says whether the original firmware is still there. `Wizard.svelte:109-112`
records that as deliberate. Row 9, patched OFW with no app, collapses into these same rows for the
same reason and needs no board of its own. Whether the page *should* distinguish them is a real
question and not one a board can answer on its own.

**Several steps are active at once.** On row 6 the install step is done, and both `sources` and
`roms` are active, because `sources` is unconditionally active when not done and
`step3Active = isInstalled` (LOGIC.md §6). The spine draws every active step's title at 21px, a
treatment that reads as "you are here" and assumes there is one of them. A reinstall produces two.
Drawn as the code produces it, not designed around.

**The install step is two different steps, and these boards stop it being that.**
`Wizard.svelte:1211-1233` splits on `step2Done`: done draws a Reinstall control and **no** version
string, not-done draws a `v1.4.1 (latest)` *string* beside Install. Two branches, two shapes, one
step. The version control replaces both with the same pair, a picker and a verb, so the step looks
like itself whether or not the install has happened. See "The version control" below.

## The locked board is deleted

`LockedDevice.dc.html` is gone, on the owner's ruling:

> "WE DON'T CARE! We unlock the device if it is locked! The user is not explicitly prompted.
> Unlocking is an inherent part of the Backup phase."

A locked device draws the ordinary chooser. `LOGIC.md` section 3 carries the full account,
including the part that matters beyond this board: unlocking erases both flashes, it happens
inside Backup, and nothing after it can recover the original firmware if Backup does not finish.
That is why the Backup phase succeeding is load-bearing rather than merely first.

This is the one place these boards **disagree with the live component** rather than with an
approved board. `Wizard.svelte:115-125` and `:1073-1084` still draw a locked page; the
implementation removes them.

## The version control

`VersionUpgrade`, `VersionReinstall` and `VersionDowngrade` are one control, not three designs.
Same device, same page, same pointer. Diffed against each other, they differ in exactly two
places: the tag shown in the picker, and the button's label and tone. Everything else is
byte-identical.

The picker is what makes the verb true, so picking an older release turns Upgrade into Downgrade
with nothing else to decide. `versionRelation` (`firmwareDist/compare.ts:163`) already returns
`same | newer | older | unknown` for any candidate; today every call site asks it only about
`versions[0]`. That is the whole of the downgrade work, which is what the owner said it should
cost.

`unknown` renders as Reinstall and deliberately gets no face of its own, per the rule already
written at `compare.ts:212-214`: an upgrade we cannot demonstrate must not be promised.

Two notes for whoever implements it, both in `LOGIC.md` section 8: `wizard.step2` has **no
downgrade string**, and `upgradeButtonLabel` should lose its `(tag)` parameter now that the picker
carries the tag. Both are 15-file edits, and the second is a type change that will fail every
sibling at once.

### The buttons were never that wide in the app

Half of "super wide" was a defect in these boards. A bare `div` in the spine's content cell, a
flex column, stretched to the full 470px; the live app wraps every control in `<div class="row">`,
`display: flex` (`Wizard.svelte:1610-1614`), where a child is sized by its content. Fixed with
`display: inline-flex`, which is a fidelity repair rather than a proposal.

The right-alignment is the real request, and it is scoped to the install control. Backup, Skip and
Restore stay left-aligned, because `.row` has no `justify-content` and he was not looking at them.

## Long strings and RTL

The cards are 360px with a 116px well and a 188px label, so every wired locale's three labels sit
on one line; German is shorter than French here (`Zurück zum Original`). Nothing in the generator
uses a physical inline property, so the two-column grid mirrors under `dir=rtl` as a unit, and the
marks well leads the label in both directions.

## Files

- `LOGIC.md` -- the cited state matrix. Read this before drawing anything.
- `build.py` -- `board(state, hover)`; `State` carries the live gates.
- `check_geometry.py` -- the well must hold the widest mark. Run it after touching either logo.
- `check_markup.py` -- every board parses, each element closed in order. Self-tests first against
  an approved board and against both shapes of the bug, so a parser that cannot fail says so
  rather than passing a broken board.
- `shell.py`, `parts.py` -- the chrome and spine rows, lifted from `directionC/` unchanged.
