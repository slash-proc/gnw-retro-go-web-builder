# Library: the frame

Three of ten Library boards. These three are about the FRAME around the games list: how
consoles are filtered, what the summary becomes when it is given room, and whether either
survives a library ten times the fixture.

Not registered on the main canvas. `apps/web/test/artboard-index.mjs` scans
`docs/design/mockups/` only, so nothing here touches the approved set.

`build-frame.py` holds the chrome, rows, coverflow, option sections and dock;
`boards-frame.py` composes the three. A generator rather than three hand-copied files, for the
reason `overview-v2/build-library.py` gives: hand-copying is how a board set drifts.

## One variable each

The fixture is lifted from `mockups/Roms.dc.html` so these read against the approved board:
the same twelve games, the same console counts (All 137, NES 63, Genesis / Mega Drive 22, GW
25, Master System 9, PC Engine 7, Game Gear 6, Homebrew 3), the same four action-chip states.
`BigLibrary` changes the scale on purpose and nothing else.

Each board differs from the approved arrangement in one thing, so a preference between them is
a preference about that thing rather than about taste.

| Board | Changed | Held |
|---|---|---|
| `ConsoleRail` | Filter is a 244px rail | Chip strip's contents, list, carousel, options, dock |
| `SummaryDock` | Summary drawer is a real dock | Chip strip, list, carousel, options |
| `BigLibrary` | 912 games, 318 in one console | Everything else |

---

## ConsoleRail

**For:** the console filter is already a single-select list of named scopes with a count beside
each. That is what a rail is. As chips it has a ceiling: about nine fit on one line at 1440,
and every core a user adds pushes the list further down the page. As a rail it has room for
twenty and the list never moves.

**Trades away:** 244px off the left, which comes out of the games list. The list column drops
from 1116 to 684. That is the whole argument against it and it is a real one, which is why
`BigLibrary` exists: at 684 long cartridge names already clip.

**Does the rail earn the width?** On this fixture, no. Eight consoles fit a strip comfortably
and the rail buys nothing while costing 244px. It earns the width at the moment a ninth console
appears, and it earns it decisively at `BigLibrary`'s eleven. So the honest answer is that the
rail is correct for the library the app is heading towards and wasteful for the one in the
fixture. If the strip stays, it needs a rule for what happens on the second line.

**At risk from the keep-everything checklist:** nothing directly. The filter keeps its counts,
its single-select behaviour and `All`. BIOS rows are still undrawn here (see Gaps).

---

## SummaryDock

**For:** the summary is the only thing on the page that says what the write will actually do,
and today it is one line of text plus a drawer that cannot be open at the same time as
Additional options, because they are the same drawer
(`RomManagementTab.svelte:2506-2600`). So the numbers describing a write and the settings that
change the write can never be read together. This board separates them: per-game options live
in the right column, the drawer is the summary alone, and the summary gets six categories
rather than one total. A 42.9 MB jump that is entirely one homebrew is a different fact from
42.9 MB spread across sixty ROMs, and only the table can say which.

**Trades away:** height, and more than expected. **The board is 1480px tall.** The app page is
a fixed viewport (`App.svelte`'s `.app` is `height: 100vh; overflow: hidden`, with `.tabpane`
the only scroller), so the summary open AND the per-game options visible at once does not fit a
920 viewport. It needs about 1480. Drawn full rather than scrolled, so the cost is visible.

**So this board asks a question rather than answering one:** if both must be readable at once,
something gives. The candidates are the coverflow's height, or the option sections collapsing
to headings until one is opened. `OptionsSheet` and `OptionsRail` from the sibling set are
where that question gets answered; this board is what makes it unavoidable.

**At risk:** the drawer is drawn at a selection that does not fit, so the total, the meter and
the overflow are red. The space-alert modal (`:2647`) is what fires on Sync; this is the state
before the click, and the modal itself is not drawn.

---

## BigLibrary

**For:** the stress test. 912 games, 318 of them NES, real cartridge names with their region
and revision suffixes. Everything that reads well at 137 should be judged here instead.

**Three things break, and they are drawn rather than described:**

1. **The chip strip wraps.** Eleven consoles do not fit one line at 1440, so the filter takes
   two rows and pushes the list down. This is the strongest argument for `ConsoleRail`.
2. **Names clip.** `Teenage Mutant Ninja Turtles II: The Arcade Game` does not fit beside a
   checkbox, a badge, a size and a chip. Drawn clipping with an ellipsis, because that is what
   the column does. Widening the column is the only fix, and the rail is what takes the width.
3. **Twenty-one rows of 318.** The scrollbar is drawn at its real proportion. Selecting across
   318 rows by eye is what `Select all` cannot help with.

**Not drawn, deliberately: a search or filter field.** There is none today, and `UI_VOICE.md`
is explicit that a board does not invent a control. **The absence is the finding.** At 912
games the console filter is the only thing that narrows the list, and NES alone is 318. This is
the one gap in the set that is worth acting on before any of the ten layouts is chosen, because
every one of them inherits it.

**Trades away:** row density. 34px rather than 46, which buys 21 rows instead of 15. The badge,
size and chip are unchanged; only padding and title size moved. At this density the rows read
as data rather than as objects, which suits 318 and is worse for 8.

### What BigLibrary rules out

This is the most useful thing this board can say, so it is said plainly.

- **It rules out the cover grid**, if the sibling set proposes one at tile sizes that show
  twenty or thirty covers. At 318 per console a grid is a scroll of hundreds of tiles with no
  ordering a user can exploit, and the majority have no cover art at all until scraped. A grid
  is a browsing surface for a shelf, and this is a filing cabinet.
- **It rules out per-row inline expansion** as the only home for options. Expanding a row in
  place inside a 318-row scroll means the thing you opened scrolls away from the thing you
  opened it from, and there is no stable place for the panel to be.
- **It weakens the full-page detail view**, though it does not rule it out: a mode switch per
  game is affordable when you touch three games and expensive when you are working through
  forty.
- **It strengthens the rail** and, separately, **it strengthens any layout that keeps the
  options in a fixed position on the page** rather than one tied to the row.

---

## Gaps in all three

Stated rather than filled in, per `UI_VOICE.md`: where a board does not cover something, report
it.

- **BIOS rows are not drawn.** Today they sit above the games list, in their own `{#each}`,
  unselectable, excluded from the header count and from `Select all`
  (`RomManagementTab.svelte:2314`). None of these three boards has a place for them, and the
  `overview-v2` proposal's answer was to give BIOS a rail item. That is a live question these
  boards do not settle.
- **Unknown homebrew** (the row with `Remove`, `:2434`) is not drawn.
- **The info pane** is drawn as the title and filename under the coverflow, without the second
  action chip it carries today (`:2414`). The row keeps the action.
- **The space-alert modal and the file prompts** are not drawn; they are modals over these
  pages, not states of them.
- **SD mode** is not drawn. The meter is Flash-only by design and the button reads
  `Download ZIP` there.

## One palette divergence, on purpose

`Sync Library` is green here, following `overview-v2/build-library.py`, which is the generator
these boards extend. The approved `mockups/Roms.dc.html` paints it red (`#c8372b`). Worth a
ruling either way, since it is the one button on the page that writes to the device.

## Not verified

**Nothing here has been looked at.** There is no headless browser in the dev container, so
every layout is arithmetic: column widths, coverflow offsets against the column half-width, and
stacked section heights against the declared board height. Tag balance and the absence of
em-dashes and interpuncts are checked mechanically. The rendering is not.

The heights most likely to be wrong are `SummaryDock`'s drawer, where the two-column split was
sized by adding up row heights, and `BigLibrary`'s 21 rows, which were chosen to fit 1180 with
about 70px to spare.
