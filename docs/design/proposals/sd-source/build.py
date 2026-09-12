"""SD card as a local source -- twelve boards.

    python3 build.py

WHAT IS MEASURED. Every figure in `Contents` comes from `lib/sdStorage.svelte.ts`'s own shape:
bytes and a file count per bucket, a total, the picked folder's name, and `truncated`. Its
`bucketFor()` assigns buckets by `InstallPaths` role, which is where `sdDestPath()` writes, so
"Covers" on these boards is the directory the sync puts covers in by construction rather than by
naming agreement.

THE BUCKETS HERE ARE NINE AND THE STORE'S ARE FOUR. `SdCategory` is `games | covers | saves |
other`. The owner asked for BIOS, Covers, Fonts, Homebrew, Language, ROMs, Saves, Screenshots and
Other, ordered ALPHABETICALLY with the catch-all pinned last (`_sorted_buckets`). Five of the nine
need work below this layer -- `BUCKET_SOURCES` names each and the README says what each costs.
Screenshots, Language and Fonts have NO `InstallPaths` role at all.

WHAT IS STATED, AND WHY THAT IS NEW. Capacity is not measurable: a `FileSystemDirectoryHandle`
does not expose its volume, and `navigator.storage.estimate()` answers about the browser profile
rather than the card. The store's header says so at length, and the first pass of these boards
drew no denominator at all for that reason.

The owner has since chosen the workaround: THE USER STATES THE CARD'S SIZE, the app looks up
what that size really yields once formatted, subtracts a safety margin, and has a denominator it
could never measure. `docs/ELECTRON.md` step 6 records that this is a browser workaround which a
desktop build retires.

SO THE PAGE NOW CARRIES TWO KINDS OF FACT, and the difference has to survive being looked at
quickly. It is carried three ways, none of them a sentence:

  1. Stated values are CONTROLS. `Capacity` and the filesystem beside it have a chevron; `Folder`
     and `Files` do not. Only a value someone supplied can be changed.
  2. The two kinds live in different SECTIONS. `Contents` is the walk and keeps its own `Total`,
     undivided by anything. `Card` is what the user said plus what follows from it.
  3. Anything derived (`Free`, the bar) sits in `Card`, beside the stated number it came from,
     never in the measured table.

FIGURES ARE MEASURED, NOT PLACEHOLDERS. `apps/web/src/lib/data/sdCapacity.json` is read at build
time; see `_capacity_table()`. Change a bucket or the card size and every number and every bar
segment on every board follows.
"""

import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import shell
import parts as p
from shell import INK_SOFT, MUTED, RULE, GREEN, RED, MONO

OUT = os.path.dirname(os.path.abspath(__file__))

# ---- the fixture ------------------------------------------------------------------------
# One plausible card, used by every board so they can be compared. Sizes are what `formatSize`
# would print (2dp, trimmed) for the byte totals a real card of this shape carries.
#
# NINE BUCKETS, ALPHABETICAL WITH THE CATCH-ALL LAST. Declared in any order below and sorted by
# `_sorted_buckets`, so the order is derived rather than typed. Five of them do not exist in
# `sdStorage.svelte.ts` today -- see BUCKET_SOURCES, and README "Where the buckets come from".
CARD = "GNW-SD"

# THE CATCH-ALL, pinned last rather than sorted. `Other` is not a peer of the named buckets: it is
# "everything the walk could not place", so it belongs at the end of the list whatever letter it
# starts with, and in a locale where its translation sorts first it would otherwise lead the table.
CATCH_ALL = "Other"

_BUCKETS_DECLARED = [
    ("BIOS", "6 files", "2.4 MB", "bios/"),
    ("Covers", "212 files", "18.9 MB", "covers/"),
    ("ROMs", "184 files", "2.94 GB", "roms/"),
    ("Homebrew", "9 files", "48.6 MB", "roms/homebrew/"),
    ("Saves", "26 files", "4.1 MB", "data/"),
    ("Screenshots", "12 files", "1.8 MB", "screenshots/"),
    ("Language", "12 files", "396 KB", "lang/"),
    ("Fonts", "25 files", "847 KB", "fonts/"),
    ("Other", "41 files", "312.6 MB", None),
]


def _sorted_buckets(declared):
    """Alphabetical BY LABEL, with the catch-all pinned last.

    SORT THE LABEL, NOT THE KEY. `lang/` displays as `Language` and belongs under L, not under
    the directory's spelling. Any bucket whose label and directory differ has the same trap.

    AND SORTING IS PER LOCALE, which these boards can state but cannot show. Fifteen locales are
    wired: `BIOS`, `Covers` and `Fonts` translate to words that sort differently in German or
    Russian, and Arabic sorts right to left. The implementation must be
    `labels.sort((a, b) => a.localeCompare(b, locale.current))` against the ACTIVE locale, never
    a fixed array -- a hardcoded English order ships a list that looks arbitrary in fourteen
    languages. The boards are English, so they draw the English answer to that rule.
    """
    named = [b for b in declared if b[0] != CATCH_ALL]
    catch = [b for b in declared if b[0] == CATCH_ALL]
    return sorted(named, key=lambda b: b[0].casefold()) + catch


BUCKETS = _sorted_buckets(_BUCKETS_DECLARED)
TOTAL = ("527 files", "3.32 GB")

# Where each bucket would actually come from, so the README's claims are derived from one place
# rather than retyped. `None` means NOTHING PRODUCES IT TODAY.
BUCKET_SOURCES = {
    "BIOS": "paths.bios, declared but never tested by bucketFor()",
    "Covers": "paths.covers, live",
    "ROMs": "paths.roms, live but merged with Homebrew as `games`",
    "Homebrew": "paths.homebrew, live but merged with ROMs as `games`",
    "Saves": "paths.data, live",
    "Screenshots": None,  # no InstallPaths role at all; firmware writes /screenshots
    "Language": None,  # no role; flashImage.ts already hardcodes `lang/` as a documented literal
    "Fonts": None,  # no role; the firmware routes `fonts` AND `font` to FrogFS
    "Other": "the catch-all, live",
}

# ---- the stated half --------------------------------------------------------------------
# REAL FIGURES, from `apps/web/src/lib/data/sdCapacity.json` (measured: every size formatted for
# real and read back, see docs/SDCARD_CAPACITY.md). Read at build time rather than transcribed,
# so a board cannot drift from the table the app will ship.
#
# THE CONSERVATIVE FIGURE. Where a capacity must be shown before the filesystem is known, the
# smaller of the two is taken. FAT32 is the lower figure at every one of the eight sizes -- this
# is ASSERTED below rather than assumed, because "conservative" silently becoming "whichever the
# JSON happens to list first" is exactly the drift a board cannot show.
#
# The gap between nominal and usable is not decoration: a "32 GB" card is decimal marketing, the
# app's own `formatSize` divides by 2^30, and the partition alignment, the FATs and the safety
# margin all come off before a byte is writable. A reader who picks 32 and reads 29.69 is seeing
# the same arithmetic every operating system shows them.
NOMINAL_GB = 32

# Card sizes are powers of two, which is what the capacity table already covers.
CARD_SIZES_GB = [2, 4, 8, 16, 32, 64, 128, 256]

# NEW COPY, and the only new string in this set. The row it sits on appears only when the walk
# stopped early, so the row being there is already the warning; the sentence says what was hit.
#
# `40,000` is `MAX_ENTRIES`, EXPORTED from `lib/sdStorage.svelte.ts:100`. It stays runtime data
# interpolated into the sentence rather than baked into fifteen translations (CLAUDE.md:
# device-derived numbers stay in component logic), so the i18n entry is `(limit: string) => ...`.
#
# THE SENTENCE NAMES ONE CAUSE AND `truncated` HAS THREE. The store sets it for `MAX_ENTRIES`
# (too many files), for `MAX_DEPTH` (a tree deeper than 8), and for a single file whose
# `getFile()` throws. Two of the three are not "too many files", so this wording is right for the
# common case and wrong for the other two. Flagged in the README rather than reworded, because
# the copy is the owner's.
PARTIAL_WALK = "Too many files on SD card. Unable to calculate more than 40,000 files"

# KEYED BY NAME, NOT BY POSITION. The table's order is derived (alphabetical, catch-all last), so
# a positional list silently hands ROMs the colour written for Fonts the moment the sort changes.
# It did exactly that once, between two edits of this file.
BUCKET_COLOURS = {
    "BIOS": "#8a7fa8",
    "Covers": "#7a8fa6",
    "Fonts": "#8fa898",
    "Homebrew": "#6ab469",  # a sibling green, because it IS nested under roms/
    "Language": "#b08fa0",
    "ROMs": GREEN,
    "Saves": "#c08a5e",
    "Screenshots": "#9a9aa0",
    "Other": MUTED,  # last and darkest
}

# THE FOLDER NAME IS NOT DEPENDABLE. `sdStorage` reports `root.name`, and on Windows a removable
# volume commonly comes back with nothing usable, so the `Folder` row would render blank or as
# bare punctuation. The fallback is `SD`.
#
# THE TEST IS "NO ALPHANUMERIC CHARACTER", NOT "EMPTY". `-` and `___` fail a reader exactly the
# way `""` does; empty is one case of the rule rather than the rule itself.
#
# NOTE WHAT THE RULE DOES NOT CATCH, because it was nearly specified the other way: `(E:)` KEEPS
# its name, because `E` is a letter. The rule is "no alphanumerics at all", so a drive letter is
# a name by this test even though a reader gains little from it. Widening it to "no alphanumerics
# outside punctuation" or "fewer than two" would be a different rule, and would start discarding
# real one-character names -- a card labelled `A` or a CJK single-glyph name. Left as stated.
#
# AND IT MUST BE UNICODE-AWARE. Fifteen locales are wired. A card named in Japanese, Russian or
# Arabic is perfectly legible and must keep its name, so the test is a letter or digit in ANY
# script -- in JS, `/[\p{L}\p{N}]/u`. A naive `/[a-z0-9]/i` would silently rename every
# non-Latin card to `SD`, which is the failure worth stating loudest because it passes review.
#
# `SD` is a CONSTANT, not translatable copy: it stands in for the volume's name, and a name that
# changed per locale would be a different card to every reader. Same reasoning that keeps version
# strings and model names out of the string tables.
UNNAMED_FALLBACK = "SD"

# What Windows hands back for a removable volume with no label. Punctuation-only rather than
# empty on purpose: it is the case a naive `if (!name)` check would let through, and it is the
# one that proves the rule is about alphanumerics rather than about emptiness.
UNNAMED = "-"


def folder_name(raw):
    """`root.name`, or `SD` when it carries no letter or digit in any script."""
    return raw if any(ch.isalnum() for ch in raw) else UNNAMED_FALLBACK


def _bytes(text):
    """`formatSize`'s output, read back. It divides by 2^30 and 2^20 and calls them GB and MB
    (`util.ts:38-40`), so parsing has to use the same powers or the bar would disagree with the
    table it sits above."""
    n, unit = text.split(" ")
    return float(n) * {"GB": 1 << 30, "MB": 1 << 20, "KB": 1 << 10, "B": 1}[unit]


def _format_size(n):
    """`formatSize` itself: 2^30 / 2^20, two decimals, trailing zeroes trimmed."""
    for unit, div in (("GB", 1 << 30), ("MB", 1 << 20), ("KB", 1 << 10)):
        if n >= div:
            return f"{round(n / div, 2):g} {unit}"
    return f"{n:g} B"


def _capacity_table():
    """The measured table, read rather than transcribed. Asserts the conservative rule holds."""
    here = os.path.dirname(os.path.abspath(__file__))
    path = os.path.join(here, "..", "..", "..", "..", "apps", "web", "src", "lib", "data",
                        "sdCapacity.json")
    with open(os.path.normpath(path)) as fh:
        data = json.load(fh)
    table = {}
    for size in data["sizes"]:
        fat = size["filesystems"]["fat32"]["usableAfterMarginBytes"]
        exf = size["filesystems"]["exfat"]["usableAfterMarginBytes"]
        # THE CONSERVATIVE RULE, asserted rather than assumed. If exFAT ever came out lower at
        # some size, "take FAT32" would quietly stop meaning "take the smaller" and every board
        # would overstate that card by the difference.
        if fat > exf:
            raise AssertionError(
                f"{size['nominalGB']}GB: exFAT ({exf}) is lower than FAT32 ({fat}), so the "
                "conservative figure is no longer FAT32 and the boards overstate this size"
            )
        table[size["nominalGB"]] = {
            "fat32": fat,
            "exfat": exf,
            "conservative": min(fat, exf),
        }
    missing = [gb for gb in CARD_SIZES_GB if gb not in table]
    if missing:
        raise AssertionError(f"the capacity table does not cover {missing}")
    return table


CAPACITY = _capacity_table()
USABLE_BYTES = CAPACITY[NOMINAL_GB]["fat32"]
USED_BYTES = sum(_bytes(b[2]) for b in BUCKETS)

NOMINAL = f"{NOMINAL_GB} GB"
USABLE = _format_size(USABLE_BYTES)
FREE = _format_size(USABLE_BYTES - USED_BYTES)

# A segment thinner than this is invisible, so it is drawn at this width instead. See `segments`.
FLOOR_PX = 2.0
BAR_PX = 684


def segments():
    """Bar widths DERIVED from the fixture the table prints, never hand-written beside it.

    Hardcoding these would let the bar and the `Contents` rows drift apart silently, which is the
    one failure a reader of the board could not catch: two pictures of the same data disagreeing.
    Change a bucket or the card size and the bar follows.

    THE SUB-PIXEL PROBLEM, AND WHERE THE ERROR IS PUT. At nine buckets and a realistic fill,
    SEVEN OF THE NINE are under a third of a percent of the card, which on a 684px bar is a
    fraction of one pixel. Language is the extreme: 0.009px true. Three ways to handle that, none
    free:

      - draw true proportions, and seven buckets render as nothing at all;
      - floor them and take the pixels from their siblings, which understates the big buckets;
      - floor them and take the pixels from the FREE REMAINDER.

    The third is taken. Every bucket big enough to be drawn to scale IS drawn to scale, no bucket
    is ever invisible, and the whole error lands on the grey remainder -- the largest quantity on
    the bar and the one least sensitive to drift. The caption beside the bar is text rather than
    pixels, so the numbers stay exact either way; only the free sliver is narrow. Measured at the
    fixture: used is drawn 12.27px wide of 684 more than it truly is, 1.79 percentage points.

    WHAT THE BAR THEREFORE DOES AND DOES NOT SAY, which is the honest part. It says how full the
    card is, and which buckets exist. It does NOT say how the small buckets compare with each
    other: seven of the nine are drawn at the same floor, so among those seven the widths carry
    no information at all. The `Contents` table sits directly below with every exact figure, and
    that is where a reader compares. Drawing a legend on the bar would undo this by inviting the
    comparison the widths cannot support, which is the other reason there is none.

    THE SMALL BUCKETS ARE PERMANENTLY SUB-PIXEL, not small because this card is empty. They are
    tiny against a CARD-SIZED denominator and stay tiny however full the card gets, so no fill
    level makes this go away and no realistic fixture would hide it.
    """
    floor_pct = FLOOR_PX / BAR_PX * 100
    out = []
    floored = []
    for name, _, size, _ in BUCKETS:
        colour = BUCKET_COLOURS[name]
        true_pct = _bytes(size) / USABLE_BYTES * 100
        if 0 < true_pct < floor_pct:
            floored.append((name, true_pct))
            out.append((round(floor_pct, 4), colour))
        else:
            out.append((round(true_pct, 4), colour))

    # The buckets must still add up to the Total the table prints, WITHIN THE ROUNDING the table
    # itself does. `formatSize` trims to 2dp, so "2.94 GB" is any value within 5.37 MB of that,
    # and a flat tolerance tighter than the display's own precision can never be met. The slack
    # is therefore derived from the printed figures rather than picked.
    slack = sum(_bytes("0.005 " + b[2].split(" ")[1]) for b in BUCKETS) + _bytes("0.005 GB")
    drift = abs(USED_BYTES - _bytes(TOTAL[1]))
    if drift > slack:
        raise AssertionError(
            f"the buckets miss the Total by {drift / (1 << 20):.2f} MB, "
            f"more than the {slack / (1 << 20):.2f} MB the printed rounding allows"
        )
    if USED_BYTES >= USABLE_BYTES:
        raise AssertionError(f"{TOTAL[1]} used does not fit in {USABLE}")
    return out, floored


def contents_rows():
    """The Contents table. `Other` is always drawn, at zero as much as at 312 MB: the store
    files everything it cannot place there, so hiding it would put bytes on the card that the
    reader cannot see.

    The `with_paths` and `split_other` variants are gone with `PanePaths`, the board that was
    their only caller.
    """
    out = ""
    for i, (name, count, size, _) in enumerate(BUCKETS):
        out += p.row(name, count, size, last=(i == len(BUCKETS) - 1))
    out += p.row("Total", TOTAL[0], TOTAL[1], total=True)
    return out


# ---- rails ------------------------------------------------------------------------------


def rail_as_entry(active="sd"):
    """SD Card as an ENTRY inside Local sources, above Directories.

    THE SETTLED ARRANGEMENT. The first pass drew two readings of "its own category above
    Directories" and the owner has ruled: the SD card is an entry UNDER Local sources. The group
    reading is deleted rather than kept, because a board that draws a rejected arrangement is an
    invitation to build it.

    It also disposes of the one real cost that reading carried: a group of one forced the
    heading and its only item to compete for the same word, so the item had to carry the card's
    name instead. As an entry beside Directories and Cache, the label is simply the label -- and
    the card's name now lives only on the page, which is also where the picker to change it is.
    """
    return p.rail(
        [
            p.rail_group(
                "Local sources",
                [
                    p.rail_item("SD card", None, active == "sd"),
                    p.rail_item("Directories", 2, active == "dirs"),
                    p.rail_item("Cache", None, active == "cache"),
                ],
            ),
            p.rail_group(
                "Remote sources",
                [p.rail_item("Cores", 5), p.rail_item("Homebrew", 4)],
            ),
        ]
    )


# ---- the Card section -------------------------------------------------------------------


def size_options():
    """The capacity list, with sizes the card has already outgrown marked unpickable."""
    return [(f"{gb} GB", CAPACITY[gb]["conservative"] >= USED_BYTES) for gb in CARD_SIZES_GB]


def card_defs(truncated=False, sized=False, card=CARD, picker_open=False):
    """The facts about the card itself, as a definition grid.

    UNSET IS THE DEFAULT AND DOES NOT GO AWAY. A user who has not answered gets `None`, which is
    UI_VOICE section 5's established pattern for an absent value, and the page reads exactly as
    it did before the selector existed. Nothing here assumes the size is known.

    THERE IS NO FILESYSTEM CONTROL. The card page asked for one beside the size until the
    measured table settled it: exFAT's usable space exceeds FAT32's by 1.7 MB at 2 GB, 12.4 MB at
    16 GB and 52.7 MB at 256 GB, every one of them smaller than the 100 MB margin already
    withheld. The answer could not move the figure, so the question is gone rather than asked and
    ignored, and every capacity here is the conservative side of the pair.

    `Files` IS THE WALK'S OWN CAVEAT AND APPEARS ONLY WHEN THERE IS ONE. A complete walk needs
    no row to say it was complete -- that is section 3, presence carrying the fact rather than a
    word. The row exists exactly when the walk stopped early, so its presence IS the warning and
    the string only has to say what the consequence is.

    THERE IS NO `Free` ROW ANYWHERE, and that is a consequence rather than an omission. Every
    board that states a capacity now draws the bar, whose caption already reads "X free of Y", so
    a `Free` row would be the same figure twice. It survived only on `CardSize`, the board that
    drew this page WITHOUT the bar, and that board is deleted as a rejected alternative.
    """
    capacity = (
        p.select_open(NOMINAL, size_options())
        if picker_open
        else p.select(NOMINAL if sized else "None")
    )
    # THE PICKER LIVES ON THE PAGE, not only in the rail. The page is where you look at a card
    # and decide it is the wrong one, so the control to change it belongs beside the name it is
    # changing. `folders.choose` is the existing artboard-verbatim string.
    rows = [
        (
            "Folder",
            '<span style="display: flex; align-items: center; justify-content: space-between; '
            f'gap: 12px;"><span>{folder_name(card)}</span>' + p.choose_link() + "</span>",
        ),
        ("Capacity", capacity),
    ]
    if truncated:
        rows.append(("Files", p.caution(PARTIAL_WALK)))
    return p.defs(rows)


# ---- boards -----------------------------------------------------------------------------


def board_rail_as_entry():
    """Entry inside Local sources, and the SELECTED state with the summary under it."""
    body = p.body(
        rail_as_entry(),
        [
            p.pane_title("SD card"),
            p.section(
                "Card",
                p.panel(
                    '<div style="display: flex; align-items: center; gap: 13px; padding: 2px 0;">'
                    '<div style="display: flex; flex-direction: column; gap: 2px; flex-grow: 1; min-width: 0;">'
                    f'<span style="font-size: 14px; font-weight: 600;">{CARD}</span>'
                    + p.mono("/Volumes/GNW-SD", size=13)
                    + "</div>"
                    + p.choose_link()
                    + "</div>"
                ),
            ),
            p.section("Contents", p.panel(contents_rows())),
        ],
        p.footer(),
    )
    return shell.page(shell.chrome() + body)


def board_card_unset():
    """THE ONE CARD PAGE with no capacity stated: where every user starts and where some stay.

    Not a separate "overview" -- that split was a drafting artefact and the owner has collapsed
    it. This is the same page as `CardSizeBar` with one fact missing, which is why it keeps the
    same section order and the same picker. `Capacity` reads `None` and `Filesystem` is absent
    rather than a disabled second control, because it qualifies a capacity that is not there.

    No bar and no headline: both need a denominator. The page is honest with none, which is the
    state the whole first pass was designed around.
    """
    body = p.body(
        rail_as_entry(),
        [
            p.pane_title("SD card"),
            p.section("Card", p.panel(card_defs())),
            p.section("Contents", p.panel(contents_rows())),
        ],
        p.footer(buttons=("Rescan",)),
    )
    return shell.page(shell.chrome() + body)


def card_panel(truncated=False, card=CARD, picker_open=False):
    """THE CHOSEN PAGE'S `Card` PANEL, defined once.

    Headline, bar, then the definition grid. Every state that has a stated capacity draws this,
    because there is one page and this is its shape. `CardPartial` and `CardSizePick` used to
    build the panel themselves and had drifted into drawing `CardSize`'s bar-less layout -- a
    design that has since been rejected outright, so two boards were quietly showing it after it
    was cut. Sharing the definition is what stops that recurring; it is the same fault
    `PaneLibrary`'s hardcoded bucket list had.
    """
    bars, _ = segments()
    return p.panel(
        p.headline(FREE, f"free of {USABLE}")
        + '<div style="height: 18px;"></div>'
        + p.bar(bars)
        + '<div style="height: 20px;"></div>'
        + card_defs(sized=True, truncated=truncated, card=card, picker_open=picker_open)
    )


def board_card_size_bar():
    """THE CHOSEN BOARD: the budget drawn, not just stated.

    The headline and the bar are `Main.dc.html`'s External flash card, lifted rather than
    invented -- that card is the approved drawing of this exact statement, and it is the card
    `sdStorage`'s header says could not be built for an SD card because nothing could supply the
    denominator. A stated size supplies one. So this board is that blocked card, unblocked, with
    the denominator coming from the user instead of from a measurement.

    NO LEGEND. `Main.dc.html` puts values in a legend under its bar, but that board has no table.
    Here the `Contents` table is directly below and already carries every bucket's count and
    size, so a legend would be the same data twice.

    NO `Free` ROW. The headline beside the bar already reads "26.37 GB free of 29.69 GB", so a
    `Free` row one line below states the same figure twice. No board keeps it now: the only one
    that did was `CardSize`, which drew this page without the bar and has been deleted.

    SECTION ORDER. This board puts `Card` first, because a budget headline is the first thing on
    the page or it is not a headline. Every other board now follows it rather than the reverse:
    the chosen arrangement should be the norm, and having them all agree restores the row-for-row
    comparison that the flip used to cost.
    """
    body = p.body(
        rail_as_entry(),
        [
            p.pane_title("SD card"),
            p.section("Card", card_panel()),
            p.section("Contents", p.panel(contents_rows())),
        ],
        p.footer(buttons=("Rescan",)),
    )
    return shell.page(shell.chrome() + body)


def board_card_size_pick():
    """The chosen page with the capacity picker open, and the sizes this card cannot be struck.

    VALIDATION IS A MEASUREMENT, WHICH IS WHY IT CAN REFUSE. The walk found 3.32 GB on the card.
    A 2 GB card yields 1.76 GB after formatting and the margin, so "2 GB" is not a preference the
    app disagrees with, it is a statement the card has already disproved. Refusing it is honest in
    a way that refusing a guess would not be.

    PRESENT AND STRUCK, NOT ABSENT. Dropping the impossible sizes would make the list's LENGTH
    depend on the card's contents, so a reader could not tell a size that is impossible from one
    the app does not offer. Struck in place says which, and why, without a sentence.

    A TRUNCATED WALK STILL REFUSES. `truncated` makes the total a floor, and a floor is enough:
    having SEEN 3.32 GB is proof the card holds at least that, whatever the walk missed. The
    refusal never needs the total to be complete, only to be real.

    It draws the bar like every other state with a capacity. This board built its own rows until
    the bar-less layout it inherited was rejected with `CardSize`.
    """
    body = p.body(
        rail_as_entry(),
        [
            p.pane_title("SD card"),
            p.section("Card", card_panel(picker_open=True)),
            p.section("Contents", p.panel(contents_rows())),
        ],
        p.footer(buttons=("Rescan",)),
    )
    return shell.page(shell.chrome() + body)


def board_card_unnamed():
    """A card whose volume name came back with nothing usable.

    Windows routinely hands back a removable volume with no meaningful name, so this is the
    ordinary case on the commonest platform rather than an edge one. The `Folder` row reads `SD`;
    everything else on the page is unchanged, because the name is the only thing missing.

    The RAIL is the other half of the same rule. Its SD entry carries the card's name as its
    second line, so a nameless volume would leave the entry looking truncated rather than named.
    It takes the same fallback, from the same helper, rather than a second copy of the test.
    """
    body = p.body(
        rail_as_entry(),
        [
            p.pane_title("SD card"),
            p.section("Card", card_panel(card=UNNAMED)),
            p.section("Contents", p.panel(contents_rows())),
        ],
        p.footer(buttons=("Rescan",)),
    )
    return shell.page(shell.chrome() + body)


def board_card_unselected():
    """NO CARD SELECTED, and the Library never opened so nothing ever prompted for one.

    `PaneUnreadable`'s shape, because the owner named it as the basis and it is right: no
    `Contents` table at all, one panel saying what we have, and the picker. What it must NOT do
    is borrow that board's CLAIM. Unreadable means we hold a folder and cannot read it.
    Unselected means there is no folder. Same shape, different fact.

    THREE THINGS DIFFER, all structural rather than worded:

      1. NO STATUS DOT. Nothing has gone wrong. A fresh user who has not opened the Library has
         simply not picked a card yet, and a red dot would accuse them of a failure. This is the
         store's `unavailable`, whose own comment says it is "not the same as a card with nothing
         on it" -- and it is not the same as a card we cannot read either.
      2. NO CARD NAME, because there is no card. The row's value is `No folder chosen`, which is
         `folders.noFolderChosen`, the existing artboard-verbatim value for exactly this.
      3. NO `Rescan`. There is nothing to rescan. The only action is the one that changes it.

    So the page says one thing and offers one control, which is the whole of what is true here.
    """
    body = p.body(
        rail_as_entry(),
        [
            p.pane_title("SD card"),
            p.section(
                "Card",
                p.panel(
                    '<div style="display: flex; align-items: center; gap: 13px; padding: 2px 0;">'
                    '<div style="display: flex; flex-direction: column; gap: 2px; flex-grow: 1; min-width: 0;">'
                    f'<span style="font-size: 14px; color: {INK_SOFT};">No folder chosen</span>'
                    "</div>" + p.choose_link() + "</div>"
                ),
            ),
        ],
        p.footer(),
    )
    return shell.page(shell.chrome() + body)


def board_pane_unreadable():
    """`sdStorage`'s `unreadable` state: a folder we hold and cannot read.

    The store is explicit that this is never reported as an empty card, so the Contents table is
    ABSENT rather than drawn at zero. The sentence is `folderGateModal.errRead`, reused verbatim
    rather than written again -- it already promises no cause, which is right, because the catch
    holds a DOMException that may be a removed volume, a revoked permission or a read failure.
    """
    body = p.body(
        rail_as_entry(),
        [
            p.pane_title("SD card"),
            p.section(
                "Card",
                p.panel(
                    '<div style="display: flex; align-items: center; gap: 13px; padding: 2px 0;">'
                    + p.status_dot(RED)
                    + '<div style="display: flex; flex-direction: column; gap: 2px; flex-grow: 1; min-width: 0;">'
                    f'<span style="font-size: 14px; font-weight: 600;">{CARD}</span>'
                    f'<span style="font-size: 13px; color: {INK_SOFT};">That folder could not be read.</span>'
                    "</div>" + p.choose_link() + "</div>"
                ),
            ),
        ],
        p.footer(buttons=("Rescan",)),
    )
    return shell.page(shell.chrome() + body)


def board_library_missing():
    """The Library tab when the SD source is gone.

    The Library's own bar states it, because that is where the user is standing when a sync
    stops being possible. `folders.missing` is the existing word for exactly this row state.
    """
    left_col = (
        '<div style="display: flex; flex-direction: column; gap: 14px;">'
        f'<div style="font-size: 24px; font-weight: 600; letter-spacing: -0.015em;">Library</div>'
        + p.panel(
            '<div style="display: flex; align-items: center; gap: 13px;">'
            + p.status_dot(RED)
            + '<div style="display: flex; flex-direction: column; gap: 2px; flex-grow: 1; min-width: 0;">'
            f'<span style="font-size: 14px; font-weight: 600;">{CARD}</span>'
            f'<span style="font-size: 13px; color: {INK_SOFT};">Missing</span>'
            "</div>" + p.choose_link() + "</div>"
        )
        + "</div>"
    )
    games = [
        ("Link's Awakening DX", "gbc"),
        ("Super Mario Bros. 3", "nes"),
        ("Sonic the Hedgehog 2", "md"),
    ]
    rows = ""
    for i, (name, system) in enumerate(games):
        # The rows are DIMMED, not removed: the Library still knows these games, it just cannot
        # write them anywhere until the card is back. Removing them would read as data loss.
        edge = "" if i == len(games) - 1 else f"border-bottom: 1px solid {RULE};"
        rows += (
            f'<div style="display: flex; align-items: center; gap: 14px; padding: 11px 0; '
            f'{edge} opacity: 0.5;">'
            '<span style="width: 15px; height: 15px; border: 1px solid #c8c8c8; border-radius: 3px; '
            'flex-shrink: 0;"></span>'
            f'<span style="font-size: 14px; flex-grow: 1; min-width: 0;">{name}</span>'
            + p.mono(system, size=12)
            + "</div>"
        )
    body = (
        '<div style="padding: 32px 40px 40px; display: flex; flex-direction: column; gap: 24px; '
        'flex-grow: 1;">'
        + left_col
        + p.panel(rows)
        + "</div>"
        + p.footer(buttons=("Sync Library",))
    )
    return shell.page(
        shell.chrome(active="Library")
        + '<div style="display: flex; flex-direction: column; flex-grow: 1;">'
        + body
        + "</div>"
    )


def board_gate_prompt():
    """The Library's first-run prompt, as ModalFolder.dc.html already draws it.

    Both rows exist in the approved board and in the string table today. What the proposal adds
    is that picking the SD row REGISTERS a source rather than holding a loose handle, and that
    the two rows are not equally required: the SD row is what a Flash-mode user can skip, which
    the modal has no way of saying today -- `subtitleSingular`/`subtitlePlural` swap on the
    COUNT of rows, not on which are optional.
    """
    def gate_row(title, hint, path=None, done=False, last=False, extra=""):
        mark = (
            '<span style="width: 18px; height: 18px; border-radius: 50%; background: #3e9e4e; '
            'display: flex; align-items: center; justify-content: center; flex-shrink: 0;">'
            '<svg width="11" height="11" viewBox="0 0 20 20" fill="none" stroke="#ffffff" '
            'stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round">'
            '<path d="M4.5 10.5l3.5 3.5 7.5-8"></path></svg></span>'
            if done
            else '<span style="width: 18px; height: 18px; flex-shrink: 0;"></span>'
        )
        edge = "" if last else f"border-bottom: 1px solid {RULE};"
        pathline = (
            f'<span style="font-size: 12px; color: {INK_SOFT}; font-family: {MONO}; '
            f'padding-top: 3px;">{path}</span>'
            if path
            else ""
        )
        return (
            f'<div style="display: flex; align-items: center; gap: 13px; padding: 14px 0; {edge}">'
            + mark
            + '<div style="display: flex; flex-direction: column; gap: 2px; flex-grow: 1; min-width: 0;">'
            f'<span style="font-size: 14px; font-weight: 600;">{title}</span>'
            f'<span style="font-size: 13px; color: {INK_SOFT};">{hint}</span>'
            + pathline
            + "</div>"
            + extra
            + p.choose_link()
            + "</div>"
        )

    modal = (
        '<div style="width: 416px; background: #ffffff; border: 1px solid #d8d8d8; '
        'border-radius: 6px; box-shadow: 0 12px 40px rgba(0,0,0,0.32); overflow: hidden;">'
        '<div style="height: 3px; background: linear-gradient(180deg, #d9bc5e 0%, #c09a32 100%);"></div>'
        '<div style="padding: 22px 24px 20px; display: flex; flex-direction: column; gap: 4px;">'
        '<span style="font-size: 18px; font-weight: 600; letter-spacing: -0.01em;">Folders needed</span>'
        f'<span style="font-size: 14px; color: {INK_SOFT};">Select the folders below to continue.</span>'
        '<div style="display: flex; flex-direction: column; padding-top: 12px;">'
        + gate_row("ROM Folder", "Your local collection of ROM files", "~/roms", done=True)
        + gate_row(
            "SD Card Folder",
            "The root of your SD card volume",
            last=True,
            extra=p.select("Size", width=96),
        )
        + "</div>"
        '<div style="display: flex; align-items: center; justify-content: flex-end; gap: 20px; '
        'padding-top: 20px;">'
        f'<span style="font-size: 14px; font-weight: 500; color: {INK_SOFT};">Cancel</span>'
        '<div style="background: #c8372b; color: #ffffff; font-size: 14px; font-weight: 600; '
        'padding: 9px 22px; border-radius: 5px; box-shadow: inset 0 -2px 0 #9e2a20;">Continue</div>'
        "</div></div></div>"
    )
    under = p.body(
        rail_as_entry(active="dirs"),
        [p.pane_title("Directories"), p.section("", p.empty_note("No folders yet."))],
        p.footer(),
    )
    return shell.page(
        shell.chrome(active="Library")
        + '<div style="position: relative; display: flex; flex-direction: column; flex-grow: 1;">'
        + under
        + '<div style="position: absolute; inset: 0; background: rgba(0,0,0,0.5); display: flex; '
        'align-items: center; justify-content: center;">'
        + modal
        + "</div></div>"
    )


def board_card_partial():
    """THE ONE CARD PAGE after a truncated walk: every figure is a FLOOR.

    The store says this is not cosmetic -- a pane drawing a partial walk without saying it is
    partial presents a floor as a total. Drawn on the row the claim belongs to (`Files`)
    rather than as a banner, so the qualification sits beside the number it qualifies.
    """
    body = p.body(
        rail_as_entry(),
        [
            p.pane_title("SD card"),
            p.section("Card", card_panel(truncated=True)),
            p.section("Contents", p.panel(contents_rows())),
        ],
        p.footer(buttons=("Rescan",)),
    )
    return shell.page(shell.chrome() + body)


# THERE IS ONE CARD PAGE. Every `Card*` board below is that page in a different state, not a
# different page: same rail, same sections in the same order, same picker on the `Folder` row.
# An earlier pass drew an "overview" and a "card page" as separate idioms; the owner collapsed
# that, and `PanePaths` / `PaneLibrary` were deleted with it rather than kept as alternatives.
BOARDS = {
    # Where it lives.
    "RailAsEntry.dc.html": board_rail_as_entry,
    # The one page, capacity stated. CardSizeBar is the chosen arrangement.
    "CardSizeBar.dc.html": board_card_size_bar,
    "CardSizePick.dc.html": board_card_size_pick,
    "CardUnnamed.dc.html": board_card_unnamed,
    # The one page, in its other states.
    "CardUnset.dc.html": board_card_unset,
    "CardPartial.dc.html": board_card_partial,
    "CardUnselected.dc.html": board_card_unselected,
    "PaneUnreadable.dc.html": board_pane_unreadable,
    # The Library, untouched.
    "LibraryMissing.dc.html": board_library_missing,
    # The prompt.
    "GatePrompt.dc.html": board_gate_prompt,
}


if __name__ == "__main__":
    for name, fn in BOARDS.items():
        with open(os.path.join(OUT, name), "w") as fh:
            fh.write(fn())
        print(f"wrote {name}")
