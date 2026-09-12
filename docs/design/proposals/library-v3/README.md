# Library, ten boards

A proposal set for the Library tab, made to be **distilled from, not chosen from**. The owner:

> "I want a BUNCH of examples so we can distill the best view. [...] In general I want to keep
> everything because it was all intentional - it just hasn't come together like I had hoped."

Not registered on the main canvas: `apps/web/test/artboard-index.mjs` scans `docs/design/mockups/`
only, and this is a proposal. Open `canvas.json` here.

## How to read the canvas

Three rows, one per question. Every board in a row changes ONE thing from the approved
`mockups/Roms.dc.html` arrangement and holds the rest constant, so a preference between two boards
is a preference about that one thing rather than about taste. Same chrome, same coverflow, same
twelve games, same console counts (All 137, NES 63, Genesis / Mega Drive 22, GW 25, Master System 9,
PC Engine 7, Game Gear 6, Homebrew 3) on nine of the ten. `BigLibrary` changes the scale on purpose.

| Row | Board | The question it answers |
|---|---|---|
| Options | `OptionsRail` | A persistent third column, nothing hidden |
| Options | `OptionsSheet` | A sheet with its own section rail, one section at a time |
| Options | `OptionsInline` | The row opens in place |
| Options | `OptionsModal` | Today's drawer, promoted to a modal with tabs |
| Browsing | `CarouselFirst` | What if the nicest thing on the screen got the most room |
| Browsing | `CoverGrid` | What if covers were the library |
| Browsing | `DetailView` | One game, its own page |
| Frame | `ConsoleRail` | The console filter as a rail instead of a strip |
| Frame | `SummaryDock` | The summary given real room |
| Frame | `BigLibrary` | 912 games. What survives |

Per-row detail, including each board's weakness, is in `README-options.md`, `README-browsing.md`
and `README-frame.md`. Those were written by the people who drew the boards and they name their own
flaws; read them before picking.

## What the set actually found

Four results that are arguments rather than pictures, and none of them was the expected answer.

**A persistent options rail is the LEAST extendable arrangement, not the most.** Three sections at
full strength measure about 1110px against about 1015px of page, so `OptionsRail` already scrolls at
today's three sections and the third is cut by the page edge. It is the obvious-looking answer to
"make the options extendable" and it gets worse with every section added. `OptionsSheet` is the only
board with no ceiling: a new section costs one rail row, not 350px of column. On extendability the
order is Sheet, then Modal, then Inline and Rail together at the bottom.

**The summary and the options cannot both be open.** Today they share one drawer, which means the
numbers describing a write and the settings that change it can never be read together.
`SummaryDock` separates them and comes out 1480px tall against a 920px fixed viewport. It is drawn
full rather than scrolled so the cost is visible. Any options layout chosen here has to answer it.

**The big library rules things out.** `BigLibrary` (912 games, 318 NES) breaks three things and
draws all three: the chip strip wraps to two rows at eleven consoles, long names clip at 684px, and
21 rows of 318 is a scrollbar at true proportion. It rules out the cover grid, rules out per-row
inline expansion as the ONLY home for options, and makes a full-page detail view expensive. It
strengthens the rail and any layout that keeps options in a fixed page position.

**There is no search field, and that is the finding.** None exists today, and `UI_VOICE.md` forbids
inventing a control no board draws, so `BigLibrary` deliberately leaves the gap visible. All ten
boards inherit it. It is worth settling before a layout is chosen, because it changes what the list
has to do.

## Open questions, for the owner

1. **`Save states` on `OptionsSheet` is invented** and labelled `not built` on the board. It exists
   because that board's thesis is that the rail scales, and three items does not show it. One line
   to remove.
2. **`Sync Library` is green on the frame boards and red on the approved board.** The frame set
   followed `overview-v2`; `mockups/Roms.dc.html` paints it red. It is the button that writes, so
   the colour is a ruling, not a detail.
3. **Two fixture sets disagree.** These ten use `Roms.dc.html`'s (All 137, NES 63); `overview-v2`
   uses its own (All 128, Game Boy 34, GBC 51). Viewed side by side they will not match.
4. **BIOS rows and unknown-homebrew rows** are undrawn on several boards. They are on the
   keep-everything checklist. `overview-v2` answered BIOS with a rail item; this set does not settle it.

## Not verified

**Nothing here has been seen.** There is no headless browser in the dev container, so every layout
is arithmetic: column widths summed against the 1360px content width, coverflow reach against its
container, stacked section heights against the declared board height. Tag balance and the absence of
em-dashes and interpuncts are checked mechanically. Type sizes, vertical rhythm, and whether a
coverflow reads well at its drawn size are all unseen.
