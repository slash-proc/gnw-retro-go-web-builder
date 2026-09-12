# Library

A proposal for the Library tab in the language `overview-v2/` established. Not registered on
the main canvas: `apps/web/test/artboard-index.mjs` scans `docs/design/mockups/` only.

The brief was to meld the old with the new without losing functionality, keep the focus on the
games list and the bottom sync drawer, add a BIOS section that both shows what you have and
takes a file, and make Additional Options make sense.

## What the tab does today

The checklist these boards were designed against. Every line is either drawn or accounted for
under "What moved" below.

| | Today | Source |
|---|---|---|
| Console filter | Horizontal chip strip, single-select, All + per-system + Homebrew, each with a count | `RomManagementTab.svelte:2258-2270` |
| List header | `N selected`, `Select all`, folder button | `:2276-2310` |
| BIOS rows | Above the games, own `{#each}`, not selectable, chip opens `FilePromptModal` | `:2314-2340` |
| Game rows | Checkbox, system badge, name, size, action chip | `:2362-2380` |
| Action chip | installed / not installed / prepare / missing rom | `getActionState`, `:385` |
| Homebrew | Same rows; `prepare` converts, then `install` | `:2362` |
| Unknown homebrew | Row with `Remove` | `:2434` |
| Carousel | Cover strip, selects a game | `Carousel.svelte`, `:2385` |
| Info pane | Pretty name, system, filename, size, **and the action chip again** | `:2406-2420` |
| Additional options | Drawer: the selected game's cover art, saves, cheats | `GameDetailsPanel.svelte:893,1056,1128` |
| Summary drawer | `StatPanel variant="grid"`, bios note, `Compress ROMs`, and in SD mode the core bundle and its version | `:2506-2545` |
| Bottom bar | Storage meter strip, budget, net change, Additional options toggle, Sync Library | `:2547-2600` |
| Space alert | Modal when the selection does not fit | `:2647` |
| File prompts | Converter prepare, BIOS add | `:2612-2640` |

## Three arrangements, and why this one

**A. The console filter becomes the rail, and a second group holds what is not a game.** Drawn.

**B. Keep the horizontal chip strip; add a small rail for BIOS, Covers and Saves.** Rejected:
two navigation idioms on one page, and the page would be the only one in the app without a
rail while having one.

**C. Additional options becomes a tabbed drawer (Game / BIOS / Covers / Saves).** Rejected: it
keeps the list full width, which is real, but it buries BIOS in a drawer you have to know to
open, and the drawer is already the thing that was confusing.

A wins on a specific point rather than on taste. The console filter is *already* a
single-select list of named scopes with counts beside them. That is what a rail is. Drawing it
as chips and then having nowhere to put BIOS is what forced BIOS into the games list, where it
had to be excluded from the list's own header count and from Select all. The code says so out
loud at `:2314`: *"Deliberately its own `{#each}` and NOT merged into `visibleGames`: these are
not selectable entries, and Select All / the carousel must not see them."* A thing that must be
excluded from the list it is drawn in is not a list item.

The cost is 244px of width, which comes out of the list column. At 1440 the list keeps 660px
and the right column 400px, which is wider than the 360px the info pane gets today.

## What moved

**Additional Options is dissolved, not renamed.** It held two unrelated sets:

- *Per-game* cover art, saves and cheats. These are the right column now, under the carousel
  that selects the game. They were a drawer rising from the bottom bar and sharing one slot
  with the install summary, so opening either closed the other, and neither was drawn near the
  thing it acted on.
- *Per-install* `Compress ROMs`, the core bundle and its version. These are in the Install
  summary, which is where the rest of the write already is.

**The action chip stops appearing twice.** The row keeps it. The right column is settings for
a game, not a second place to install it.

**BIOS gets a rail item.** One row per declared slot from `biosState.installable`, so the
medium policy holds by construction: Flash drops a system with no games for it, SD keeps every
active source's slot. `biosState.sorted` puts what is wrong first. The chip is both the state
and the action, using the shipped three-way reading (`Found` / `needs a file` / `Optional`).

**Covers, Saves and Cheats get rail items too.** Drawn as `LibraryCovers`, `LibrarySaves`
and `LibraryCheats`.

**Cheats was missing from the rail entirely.** The first pass drew per-game cheats in
`LibraryGame`'s right column and left `Files` at BIOS, Covers and Saves, so the global half
had nowhere to go. `Files` is BIOS, Covers, Saves, Cheats now.

**Saves has no global half, and that changed what the pane is.** The first pass deferred
Covers and Saves together as "a straight lift of the global half of `GameDetailsPanel`".
That is true of Covers. It is not true of Saves: `views/GameDetailsPanel.svelte:1056-1125`
is slot tabs, a screenshot preview and one download, all for the selected game, and the only
thing in it that is not per-game is the util gate. So `LibrarySaves` is the device's saves
across games, which is the question the per-game section cannot answer and the reason to
open a pane called Saves. It needs no new copy: `SRAM`, `Slot n`, `Download save` and
`No saves found` all ship.

## Boards

| Board | Shows |
|---|---|
| `Library` | All selected, nothing picked, dock closed |
| `LibraryGame` | A game selected: cover, saves, cheats in the right column |
| `LibraryBios` | The BIOS pane, one row per slot, one amber |
| `LibrarySummary` | The summary drawer open with the install options in it, a selection that does not fit |
| `LibraryCovers` | Source, variant, the scraper budget, the two downloads |
| `LibrarySaves` | Which games have saves on the device, and how many slots |
| `LibraryCheats` | What is configured across the library, and the built-in library |

`build-library.py` holds the chrome, rail, dock and row primitives; `boards-library.py`
composes the seven. A
generator rather than seven hand-copied files because the chrome is identical across them and
hand-copying is how a board set drifts.

## Reused, not reinvented

**This is not a third rail.** CLAUDE.md is explicit that `FirmwareRail.svelte` and
`OverviewRail.svelte` are the two, and that a new grouped-navigation surface extends one of
them rather than inventing an idiom. These boards draw the same `244px minmax(0, 1fr)`
full-bleed grid, the same group heading, the same active item (600 weight, `inset 2px 0 0`
green), and the same footer band drawn as the pane column's second child. If this is built, it
is `OverviewRail`'s shape with different groups, not a new component family.

`Carousel.svelte`, `StatPanel` `variant="grid"` with its `total` flag for the trailing
aggregate, `StatusChip`'s three paints, the dock's 3px meter fused to the bar's top edge, the
`FilePromptModal` the BIOS chip already opens, and the rail grid, pane head and footer band
from `OverviewRail.svelte` / `FirmwareRail.svelte`. Chrome is lifted from `Status.dc.html`.

## Strings

Almost nothing is new. Existing: `All (n)`, `Homebrew (n)`, `n selected`, `Select all`,
`Select a game to see details`, `Sync Library`, `Install summary`, `Summary`, `After`,
`Change`, `Total`, `Games`, `Homebrew`, `Cores`, `Cover art`, `Cheats`, `Saves`, `BIOS`,
`needs a file`, `Found`, `Optional`, `n MB net change`, `n MB of m MB projected`, and the four
action-chip labels.

New, each a seven-file i18n edit if this is chosen:

- Rail group headings: `Library`, `Files`
- Rail items that are not console names: `Covers`, `Saves`
- BIOS pane: `1 needs a file` (count interpolated)
- Summary: `Update Retro-Go and cores` (shortens `sdSync.upgradeLabelPre`, "Upgrade Retro-Go
  and Cores to", whose version now sits in a chip beside it rather than trailing the sentence).
  It drops `sdSync.updatesWhenBoots`, "(updates when G&W next boots)", which explains when the
  update takes effect and is the kind of sentence this pass removes.
- Summary: `Compress ROMs` shortens `install.lzmaCheckboxLabel`, "Compress ROMs with LZMA ",
  and drops `install.lzmaSoon`, "uncompressed for now". The box is drawn unchecked and inert,
  as it ships, so the disabled state is the whole statement.
- Cheats pane: `Configured` shortens `cheats.configuredHeading`, "Configured (n)". It is a
  section heading over a list whose rows each carry their own count, so the count in the
  heading would be a second, different number in the same place.

Everything else on the three new panes is either an exact shipped string or a device-derived
value. Checked mechanically: every text node on the three boards, comments stripped, matched
against the English string tables. The only misses are console names, game titles, versions,
sizes and slot lists, which are data.

## Not drawn, and why

- **The saves gate.** With the RAM flasher util not loaded and outside SD mode, the whole
  saves section is replaced by `Run the RAM Flasher Util to view saves.` and `Connect`
  (`GameDetailsPanel.svelte:1059-1063`). That is a second state of `LibrarySaves`, not a
  second pane, so it is described rather than drawn.
- **The ScreenScraper settings and import modals.** `Settings` and `Import` are drawn as the
  header actions they already are (`:904,912`). Both open modals; a modal drawn inline would
  be a different surface.
- **SD mode.** The dock's meter is Flash-only by design (the flash gap is meaningless on a
  card, per CLAUDE.md's SD-vs-Flash note) and the button reads `Download ZIP` without a native
  picker. Same page, two substitutions, no new structure.
- **The empty state and the folder gate.** Unchanged by this proposal.
- **The space alert modal.** Unchanged; `LibrarySummary` draws the state that triggers it.
- **Numbers are plausible, not measured.** No device was attached and no card was read. The
  firmware version is the owner's real one.

## Open question

The rail's `Library` group mixes two kinds of scope: consoles that come from active cores, and
`Homebrew`, which is a category rather than a console. That is exactly how the chip strip
behaves today, so the boards keep it. If `Homebrew` should instead sit in `Files` with BIOS,
the rail has a cleaner reading and the games list loses a filter people probably use.
