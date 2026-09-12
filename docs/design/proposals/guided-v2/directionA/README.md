# Guided Setup, Direction A: keep the structure, fix the layout

Three boards of the Guided Setup's first page, the one that asks what the device should run.
Direction A of three. B rethinks the page's composition; C proposes variations to the flow itself.

The brief:

> "I like the icons and the buttons themselves (although I'm open to some minor variations
> thereof). [...] I like the rest for the most part so I don't want to see much change there.
> [...] make the things I like fit better into the overall design language and match the
> proceeding steps view."

So the three options stay, the logos stay, and step 2 is not touched. What changes is the
arrangement.

Not registered on the main canvas: `apps/web/test/artboard-index.mjs` scans
`docs/design/mockups/` only, and this is a proposal. Open `canvas.json` here.

## What the steps view does that the layout question does not

Read `mockups/Guided.dc.html` next to `mockups/GuidedLayout.dc.html`. The step 2 spine is a
different design language, not a different screen:

| Step 2, the spine | The layout question |
|---|---|
| One left edge. `grid-template-columns: 30px minmax(0, 1fr)` hangs a marker column and runs every title down a single x | Two axes. Title and rubric left-aligned at 470px, cards 304px and centred, so nothing shares an edge with anything |
| Nothing is a card. Rows sit on the page background, no fill and no border | Three white bordered boxes, an idiom used nowhere else in the flow |
| A 1px thread ties the rows into one list | Three loose boxes, nothing ties them |
| Focus is type scale. The active step is 21px, the others 16px | All three identical, so nothing leads |
| Availability is opacity. Pending steps sit at `0.5` | An unavailable option is removed entirely, and a separate note explains the absence |

And one defect that is arithmetic rather than taste. `.marks` is as tall as its tallest logo,
so with the live sizes (`--mark-gnw` 48px, `--mark-rgo` 22px) the three stacked cards come out:

```
Dual Boot        marks 48px -> card 120px
Only Retro-Go    marks 22px ->  card 94px     <- 26px shorter than both neighbours
Return to Stock  marks 48px -> card 120px
```

Three centred boxes of unequal height with no shared edge is most of the "off" feeling.

## The boards

| Board | The one idea it tests | What it gives up |
|---|---|---|
| `OneEdge` | Does sharing the title's left edge and equalising the row heights fix it, changing nothing else? | Keeps the card idiom step 2 never uses, so the two pages still do not look related |
| `Threaded` | The chooser drawn in step 2's own spine idiom, hanging marker and connector thread, no card | The button affordance gets quieter. A row on the page background has to earn its clickability from the marker and hover alone |
| `ThreeUp` | Seeing all three at once instead of scanning a stack | Needs a 660px column against the spine's 470px, so the page width changes between step 1 and step 2. Marks drop from 48px to 36px to fit |

### OneEdge

The minimal fix. Rows span the full 470px column, so the card's left edge, the title, the
rubric, the logos and the labels all start at the same x. A fixed 48px marks band makes every
row 120px whichever logos it holds. A trailing chevron carries the "this goes somewhere" the
card outline used to carry alone.

### Threaded

Lifts the spine's geometry verbatim: the 30px marker column, the 18px gap, the 24px circle and
the 1px connector thread. On the spine that hollow circle is the "pending" marker; on a chooser
the same circle reads as a radio, so the geometry carries over without inventing anything new.
No fill and no border, so step 1 and step 2 are visibly the same surface.

This is also the only one of the three that tolerates rows of different heights by design,
which is what the spine already does, so a long translation costs it nothing.

### ThreeUp

One row of three, `grid-template-columns: repeat(3, minmax(0, 1fr))` with `align-items:
stretch`, so equal heights come for free and the raggedness cannot arise. The trade is the
column width, and it is a real one: the spine that follows is 470px, and this page is 660px,
so the content jumps outward and back as you move through the flow.

## Behaviour these boards have to survive, and how each fares

**The option count is not three.** `Wizard.svelte` renders each option behind a condition:
`canDualBoot` (needs 16 MB of external flash), `canRetroGo` (needs 8 MB), and Return to Stock is
hidden outright when the device still has unpatched stock firmware, because there is nothing to
return from. So the real page draws **one, two or three** options, with
`tooSmallForRetroGo` / `tooSmallForDualBoot` explaining an absence underneath.

- `OneEdge` and `Threaded` degrade without comment: a list of one is a list.
- `ThreeUp` does not. One card in a three-column grid reads as two missing cards. If this
  direction is picked, that case needs an answer.

**Long strings.** German is the longest of the fifteen wired locales. `returnToStock` is
"Zurück zum Original", about 162px at 16px/600.

- `OneEdge`: 396px of label space, one line.
- `Threaded`: 422px, one line.
- `ThreeUp`: 178.7px of card content, one line, with 16px to spare. It is the tightest by a
  long way, and the title above it ("Was soll auf diesem Gerät laufen?") is near the 470px
  measure at 28px, so it will wrap to two lines in German on all three boards.

**RTL.** Arabic is wired and the app mirrors.

- `OneEdge` and `Threaded` mirror cleanly if the shipped CSS uses logical properties: the
  single left edge becomes a single right edge, and the marker column swaps sides the way the
  spine's already must.
- `ThreeUp` mirrors the column order, which is correct, but the chevron-free centred cards make
  it the least direction-sensitive of the three.

The chevron in `OneEdge` points right and must mirror. Note the existing strings already carry
literal arrows that mirror in Arabic (`spine.back` is "← Back", and the Arabic file reverses
them), so this is a solved problem in the codebase rather than a new one.

## Two things found while drawing these

**`GuidedLayout.dc.html` and `GuidedLayoutStock.dc.html` are stale.** They draw the title as
"How Do You Want the Device Set Up?" and carry all three struck captions:

- `Pick which one runs at power-on`
- `Keeps the original firmware. [...] and leaves more space for games.`
- `Restores the original firmware from your backup. Erases Retro-Go.`

`docs/UI_VOICE.md` §1 records those three as struck, by name, and the live string table has
already dropped them. The live title is "What should this device run?". These boards use the
live copy. The approved boards should probably be regenerated, but they are in
`docs/design/mockups/` under the artboard-index guard and that is not this task's to touch.

**The live component has also moved past the boards in layout.** `.marks` now sits above the
label rather than beside it in a 120px well, with the logos at roughly double their old size.
The boards still draw the old arrangement. The comparison above is against the live component,
not the stale board.

## Regenerating

```
python3 build.py
```

`shell.py` holds the chrome, the palette and the mark geometry; `build.py` holds the three
layouts. Hand-editing the `.dc.html` files is how a board set drifts.
