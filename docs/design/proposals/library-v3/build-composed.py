#!/usr/bin/env python3
"""The composed Library: the pieces the owner picked out of the ten-board set, in one design.

Run: python3 build-composed.py

His words:

  "I also like the SummaryDock. I don't like the top portion but literally just the summary
  dock design in the SummaryDock. The OptionsModal is plenty extendable for what I'm
  imagining. I want to see the upper part as-is including the console filter buttons, game
  list and carousel. You make a good point with the search bar being missing. I want to add a
  'Favorites' filter to the right of 'All'. Then I want to add a button for 'Additional
  options' under/at the bottom of the info pane that pulls up your proposed
  LibraryOptionsModal. And at the bottom, your updated SummaryDock."

So: the approved upper arrangement unchanged, two additions to the chip strip, one button at
the foot of the info pane, and SummaryDock's dock with its top portion left behind.

The modal comes from `modal.py`, the same definition the promoted board uses, so the pair
cannot drift.
"""
import importlib.util as _il
import os as _os


def _load(name, mod):
    spec = _il.spec_from_file_location(
        mod, _os.path.join(_os.path.dirname(_os.path.abspath(__file__)), name))
    m = _il.module_from_spec(spec)
    spec.loader.exec_module(m)
    return m


_shell = _load("shell.py", "shell")
globals().update({k: v for k, v in vars(_shell).items() if not k.startswith("_")})
options_modal = _load("modal.py", "modal").options_modal


# --- the chip strip, with the two additions ---------------------------------------------

def chip_strip(active="All"):
    """Console filter, plus Favorites and a search field.

    FAVORITES SITS IMMEDIATELY RIGHT OF ALL, as asked. It is a filter over the library rather
    than a system in it, and the strip already carries one of those: `All`. So it is the same
    chip in the same row, and the only thing separating a filter from a system is the star,
    which is the conventional mark for this and not a new idiom. No new word is introduced.

    SEARCH IS AT THE FAR END, not among the chips. The chips are one single-select scope and
    grow left to right as sources are added; a text field is a different kind of control and
    joining the row would make it look like a ninth scope. Pushed right, the scope set stays
    one readable run and `All` keeps `Favorites` beside it.
    """
    items = [("NES", "63"), ("Genesis / Mega Drive", "22"), ("GW", "25"),
             ("Master System", "9"), ("PC Engine", "7"), ("Game Gear", "6"), ("Homebrew", "3")]

    def chip(label, count, on=False, star=False):
        mark = (f'<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" '
                f'stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-right: 5px;">'
                f'<polygon points="12 2 15.1 8.6 22 9.6 17 14.6 18.2 21.5 12 18.2 5.8 21.5 7 14.6 2 9.6 8.9 8.6 12 2">'
                f'</polygon></svg>') if star else ""
        if on:
            paint = f"font-weight: 600; background: {INK}; color: {WHITE}; border-radius: 3px;"
        else:
            paint = f"color: {SOFT};"
        return (f'<span style="font-size: 13px; padding: 5px 11px; display: inline-flex; '
                f'align-items: center; white-space: nowrap; {paint}">{mark}{label} {count}</span>')

    chips = [chip("All", "137", on=(active == "All")),
             chip("Favorites", "12", on=(active == "Favorites"), star=True)]
    chips += [chip(label, count, on=(label == active)) for label, count in items]

    search = f"""<span style="margin-left: auto; display: inline-flex; align-items: center; gap: 8px; height: 32px; padding: 0 12px; background: {WHITE}; border: 1px solid #dcdcdc; border-radius: 3px; min-width: 210px;">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="{DIM}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="7"></circle><line x1="20" y1="20" x2="16" y2="16"></line></svg>
      <span style="font-size: 13px; color: {DIM};">Search</span>
    </span>"""

    return f"""  <div style="padding: 22px 40px 0; display: flex; align-items: center; gap: 6px; flex-shrink: 0;">
    {''.join(chips)}
    {search}
  </div>"""


# --- the coverflow info pane, plus the one new button ------------------------------------

def info_pane():
    """The approved info pane, with `Additional options` at its foot.

    THE INTERPUNCT IS GONE. The approved board writes the filename and size as one string with
    a literal `Aerobiz Supersonic.md {sep} 1 MB`, which UI_VOICE forbids outright and
    `apps/web/test/copy-dashes.mjs` fails the build on. The board already draws a 3px dot
    between the system and that string, so the same drawn dot separates the two facts here and
    the character is dropped. That is the only change to the upper part and it is a correction,
    not a redesign.
    """
    dot = f'<span style="width: 3px; height: 3px; border-radius: 50%; background: {DIM};"></span>'
    return f"""      <div style="display: flex; flex-direction: column; gap: 18px; padding-top: 4px;">
        <div style="display: flex; flex-direction: column; gap: 4px;">
          <span style="font-size: 24px; font-weight: 600; letter-spacing: -0.015em; text-align: center;">Aerobiz Supersonic</span>
          <div style="display: flex; align-items: center; gap: 12px; justify-content: center;">
            <span style="font-size: 14px; color: {SOFT};">Genesis / Mega Drive</span>
            {dot}
            <span style="font-size: 13px; color: {SOFT}; font-family: {MONO};">Aerobiz Supersonic.md</span>
            {dot}
            <span style="font-size: 13px; color: {SOFT}; font-family: {MONO};">1 MB</span>
          </div>
        </div>
        <div style="display: flex; justify-content: center;">
          <div style="display: inline-flex; align-items: center; gap: 9px; font-size: 13px; font-weight: 600; color: {INK}; background: {WHITE}; border: 1px solid {BORDER}; border-radius: 5px; padding: 9px 18px;">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="{INK}" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"></circle><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"></path></svg>
            <span>Additional options</span>
          </div>
        </div>
      </div>"""


# --- SummaryDock's dock -------------------------------------------------------------------
# Lifted from SummaryDock.dc.html: the centred handle, the white panel, the six-category table
# with its trailing Total, the Install column, the meter strip and the bar. Two changes, both
# asked for: Sync Library is the approved board's red, and the bar's own `Additional options`
# disclosure is gone, because the trigger is now the info pane's button and two controls
# opening one thing is the duplication this set set out to remove.
#
# The numbers are the approved board's fitting scenario (3.54 MB of 50 MB, +0.12 MB), not
# SummaryDock's over-budget one, so the dock agrees with the list above it: six games selected,
# one of them newly added. Plausible, not measured.

SUM_COLS = "minmax(0, 1fr) 110px 110px"
NUM = f"font-family: {MONO}; font-variant-numeric: tabular-nums;"


def srow(label, after, change, last=False, total=False):
    edge = f" border-top: 1px solid {BORDER};" if total else ("" if last else f" border-bottom: 1px solid {HAIR};")
    weight = "600" if total else "400"
    return f"""            <div style="display: grid; grid-template-columns: {SUM_COLS}; gap: 20px; align-items: baseline; padding: 9px 0;{edge}">
              <span style="font-size: 13px; font-weight: {weight};">{label}</span>
              <span style="font-size: 13px; font-weight: {weight}; text-align: right; {NUM}">{after}</span>
              <span style="font-size: 13px; color: {SOFT}; text-align: right; {NUM}">{change}</span>
            </div>"""


SUMMARY_PANEL = f"""    <div style="background: {WHITE}; border-top: 1px solid {BORDER};">
      <div style="padding: 20px 40px 24px; display: grid; grid-template-columns: minmax(0, 1fr) 300px; gap: 48px; align-items: start;">
        <div style="display: flex; flex-direction: column;">
          <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 10px;">
            <span style="font-size: 14px; font-weight: 600;">Install summary</span>
          </div>
          <div style="display: grid; grid-template-columns: {SUM_COLS}; gap: 20px; padding-bottom: 8px; border-bottom: 1px solid {BORDER};">
            <span></span>
            <span style="{CAPS} text-align: right;">After</span>
            <span style="{CAPS} text-align: right;">Change</span>
          </div>
{srow("Games", "6", "+1")}
{srow("Homebrew", "1", "")}
{srow("Cores", "4", "")}
{srow("BIOS", "2", "")}
{srow("Cover art", "6", "+1")}
{srow("Cheats", "2 codes", "", last=True)}
{srow("Total", "3.54 MB", "+0.12 MB", total=True)}
        </div>
        <div style="display: flex; flex-direction: column; gap: 14px;">
          <span style="{CAPS}">Install</span>
          <div style="display: flex; align-items: center; gap: 10px;">
            <span style="width: 16px; height: 16px; border-radius: 3px; background: {WHITE}; border: 1px solid {BORDER}; flex-shrink: 0;"></span>
            <span style="font-size: 13px; color: {SOFT};">Compress ROMs</span>
          </div>
          <div style="display: flex; align-items: center; gap: 10px; flex-wrap: wrap;">
            <span style="width: 16px; height: 16px; border-radius: 3px; background: {GREEN}; border: 1px solid #35873f; flex-shrink: 0; display: flex; align-items: center; justify-content: center;"><svg viewBox="0 0 12 12" width="9" height="9" fill="none" stroke="{WHITE}" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 6.3 L4.7 9 L10 3.2"></path></svg></span>
            <span style="font-size: 13px;">Update Retro-Go and cores</span>
            <span style="font-size: 12px; color: {SOFT}; font-family: {MONO}; border: 1px solid {BORDER}; border-radius: 4px; padding: 2px 9px;">v2.0.0-rc3</span>
          </div>
        </div>
      </div>
    </div>"""


def summary_dock(expanded=False):
    chevron = "6 9 12 15 18 9" if expanded else "18 15 12 9 6 15"
    panel = SUMMARY_PANEL if expanded else ""
    return f"""
  <div style="margin-top: auto; flex-shrink: 0;">
    <div style="display: flex; justify-content: center; padding: 0 40px;">
      <div style="background: {WHITE}; border: 1px solid {BORDER}; border-bottom: none; border-radius: 7px 7px 0 0; padding: 7px 20px 8px; display: flex; align-items: center; gap: 8px; font-size: 12px; font-weight: 600; color: {SOFT}; box-shadow: 0 -3px 10px rgba(0,0,0,0.05);">
        <span>Summary</span>
        <svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="{chevron}"></polyline></svg>
      </div>
    </div>
{panel}
    <div style="height: 3px; background: {HAIR}; display: flex;" aria-hidden="true">
      <div style="width: 7%; background: {GREEN};"></div>
      <div style="width: 0.3%; background: {GREEN}; opacity: 0.45;"></div>
    </div>
    <div style="background: {WHITE}; border-top: 1px solid {BORDER}; min-height: 72px; box-sizing: border-box; padding: 0 40px; display: flex; align-items: center; justify-content: space-between; gap: 24px;">
      <div style="display: flex; align-items: baseline;">
        <span style="font-size: 13px; color: {SOFT};">3.54 MB of 50 MB projected</span>
        <span style="font-size: 13px; font-weight: 600; color: {GREEN}; margin-left: 14px;">+0.12 MB net change</span>
      </div>
      <div style="background: {RED}; color: {WHITE}; font-size: 14px; font-weight: 600; padding: 9px 22px; border-radius: 5px; box-shadow: inset 0 -2px 0 {RED_B};">Sync Library</div>
    </div>
  </div>
"""


# Three of the eleven visible rows are favourited: the selected Aerobiz Supersonic, Alex Kidd in
# Miracle World and Battle Kid. Three of eleven on screen against `Favorites 12` over the whole
# 137, which is a subset the chip's count can actually hold. A board whose rows contradict its
# own filter count reads as fake.
FAVOURITES = {0, 2, 7}


# --- the upper part, unchanged ------------------------------------------------------------
# The approved 12-column grid: list at span 5, coverflow at span 7, 32px gap. At 1440 with
# 40px page padding that is 548px and 780px, which is what Roms.dc.html draws.

def upper():
    return f"""  <div style="padding: 20px 40px 24px; display: grid; grid-template-columns: repeat(12, minmax(0, 1fr)); gap: 32px; align-items: start; flex: 1 1 auto; min-height: 0;">

    <div style="grid-column: span 5; display: flex; flex-direction: column; min-width: 0;">
{games_list(selected_idx=0, limit=11, favourites=FAVOURITES)}
    </div>

    <div style="grid-column: span 7; display: flex; flex-direction: column; gap: 20px; min-width: 0;">
{coverflow()}
{coverflow_scrubber()}
{info_pane()}
    </div>

  </div>"""


def upper_expanded():
    """The same body, squeezed to what is left once the dock is open.

    THE DOCK IS PINNED AND GROWS UPWARD. It eats the slack under the content first, and when
    that runs out it pushes the content up, which is the owner's ruling:

      "the bottom bar should be stuck to the bottom of the window and the summary opening up
      should push the carousel up once it bumps up to it. It should fill the space between the
      bottom of the carousel and bottom bar and opening the summary should fill that space
      until it reaches the bottom of the list/info box and then that makes the carousel move
      up."

    So the two columns are anchored differently, and that difference IS the behaviour:

      the LIST is anchored to the top and gets SHORTER. Four rows survive in 238 where eleven
      fitted in 607. The rest are below the fold, which is what the pane does at rest too.

      the CAROUSEL COLUMN is anchored to the BOTTOM, against the dock. It cannot shrink, so it
      rides up as the dock grows, and its top goes above the body's top edge rather than being
      covered by the dock. That is the movement the ruling asks for.

    The row is given an explicit height so an over-tall item overflows UPWARD. Left to size
    itself the grid row would take the tallest item and spill past the bottom instead, which is
    the carousel being clipped by the dock, and that is the thing the ruling rules out.
    """
    return f"""  <div style="padding: 20px 40px 24px; height: 282px; box-sizing: border-box; display: grid; grid-template-columns: repeat(12, minmax(0, 1fr)); grid-template-rows: minmax(0, 1fr); gap: 32px; overflow: hidden;">

    <div style="grid-column: span 5; align-self: start; display: flex; flex-direction: column; min-width: 0;">
{games_list(selected_idx=0, limit=4, favourites=FAVOURITES)}
    </div>

    <div style="grid-column: span 7; align-self: end; display: flex; flex-direction: column; gap: 20px; min-width: 0;">
{coverflow()}
{coverflow_scrubber()}
{info_pane()}
    </div>

  </div>"""


# =======================================================================================
# 1. LibraryComposed - the design at rest, in a 920px viewport.
# =======================================================================================
note1 = """  LIBRARY - the composed design, at rest.

  THE PIECES THE OWNER PICKED, IN ONE PLACE. The approved upper arrangement unchanged, two
  additions to the chip strip, one button at the foot of the info pane, and SummaryDock's dock
  without its top portion.

  920px IS THE CONSTRAINT, AND IT IS MET, WITH ELEVEN ROWS. This board is drawn at a FIXED 920
  with overflow hidden rather than growing to fit, because the app page is a fixed viewport and
  `.tabpane` is its only scroll container. Heights derived from the declared styles at the
  inherited line-height of 1.5:

    chrome      56 header + 3 lip + 47 tab strip             = 106
    chip strip  22 padding + 32 search field                 =  54
    dock        34 handle + 3 meter + 72 bar                 = 109
    body box    920 - 106 - 54 - 109                         = 651
    body inner  651 - 20 top padding - 24 bottom padding     = 607

  Against that 607, a game row is 49: 11 padding, a 26px action pill, 11 padding and a 1px
  hairline. The pill is the tallest thing in the row, which is what makes a row 49 rather than
  the 43 a first estimate gives. With the 29.5px list header and 4px of card padding:

    11 rows  571.5   fits, 35.5 to spare
    12 rows  620.5   overflows by 13.5

  So ELEVEN rows are drawn. The twelfth and everything after it are below the fold and reached
  by scrolling the pane, which is what the real page does. The coverflow column needs 494.5 and
  has 112.5 to spare, so the list is the binding constraint, not the carousel.

  The dock being COLLAPSED is what buys all of this. See LibraryComposedSummary for the cost of
  opening it.

  THE DOCK'S OWN `Additional options` DISCLOSURE IS GONE. The trigger is the info pane's
  button now, and two controls opening one thing is the duplication this set set out to
  remove.

  ONE CORRECTION TO THE UPPER PART, not a redesign: the approved info pane writes the filename
  and size as a single string joined by an interpunct, which UI_VOICE forbids and
  copy-dashes.mjs fails the build on. The board already draws a 3px dot between facts, so that
  dot separates them here and the character is dropped.

  Fixtures lifted from mockups/Roms.dc.html. Numbers are plausible, not measured, and the
  dock's agree with the list: six games selected, one newly added.
"""

write("LibraryComposed.dc.html", note1,
      chip_strip() + "\n" + upper() + summary_dock(expanded=False), exact_height=920)


# =======================================================================================
# 2. LibraryComposedSummary - the same board, dock expanded.
# =======================================================================================
note2 = """  LIBRARY - the composed design, summary open, in the same 920 viewport.

  THE OWNER'S RULING, which this board now draws:

    "that's fine, the bottom bar should be stuck to the bottom of the window and the summary
    opening up should push the carousel up once it bumps up to it. It should fill the space
    between the bottom of the carousel and bottom bar and opening the summary should fill that
    space until it reaches the bottom of the list/info box and then that makes the carousel
    move up."

  An earlier version of this board grew to 1290 to show the whole table. That was the wrong
  answer: the page is a fixed viewport, so the expanded state has to be shown inside one.

  THE ARITHMETIC, all of it derived from the declared styles rather than seen:

    dock expanded   34 handle + 369 panel + 3 meter + 72 bar     = 478
    body box        920 - 106 chrome - 54 chips - 478            = 282
    body inner      282 - 20 - 24                                = 238

  THE LIST GETS SHORTER. At 238, with the 29.5 header and 4 of card padding, a 49px row gives
  four rows at 228.5 and five at 277.5. So FOUR are drawn where eleven fitted at rest, and the
  rest are below the fold exactly as row twelve is at rest.

  THE CAROUSEL RIDES UP, and this is where the ruling costs something real. The carousel column
  is 494.5 and cannot shrink, so anchored to the dock it moves up 256.5. Its top goes above the
  body's top edge rather than under the dock, which is what was asked for. But 256.5 of the way
  up leaves 73.5 of the 330px coverflow in view, and since the cards are 218 centred in that
  box, only about 17.5px of card is visible.

  SO THE RULING IS DRAWN AND IT WORKS, AND AT THIS TABLE HEIGHT THE CAROUSEL IS EFFECTIVELY
  GONE WHILE THE SUMMARY IS OPEN. That is not an argument against the ruling; it is the ruling
  applied to a 369px panel. If the carousel should stay legible with the summary open, the
  panel is the thing to cap: at about 200 of panel the coverflow keeps roughly half its height.
  Not drawn, because that is a second decision and it has not been made.

  Fixtures as the board at rest. Two of the four visible rows are favourited, against the same
  `Favorites 12` chip: rows one and three of the eleven, which are the first four here.
"""

write("LibraryComposedSummary.dc.html", note2,
      chip_strip() + "\n" + upper_expanded() + summary_dock(expanded=True), exact_height=920)


# =======================================================================================
# 3. LibraryComposedOptions - the same board, options modal open.
# =======================================================================================
note3 = """  LIBRARY - the composed design, additional options open.

  THE PAIR, MADE CONSISTENT. The promoted board draws this modal over the frame set's
  arrangement and the frame set's dock, so the modal and the design it belongs to disagreed.
  This is the same modal over the design the owner actually picked.

  THE BUTTON IS THE ONLY WAY IN. The dock's disclosure is gone, so the info pane's
  `Additional options` is the single trigger, and it sits under the metadata of the game the
  modal is about.

  THE MODAL IS THE SAME DEFINITION, not a copy: `modal.py` is imported by this generator and
  by the one that emits the promoted board, so the two cannot drift.

  Tabs across the top are the extension point. Four fit comfortably at 980px, which is what
  "plenty extendable for what I'm imagining" has to hold.

  Fixtures as the board at rest.
"""

write("LibraryComposedOptions.dc.html", note3,
      chip_strip() + "\n" + upper() + summary_dock(expanded=False) + options_modal(),
      exact_height=920)


# =======================================================================================
# 4 and 5. The other two tabs of the same modal.
# =======================================================================================
# A tabbed modal shows one panel at a time, so drawing only Cover art was not wrong. What was
# wrong was the set: the brief says cheats is a device feature equal to saves, and the owner
# picked this modal partly on all three sections surviving at full strength. With only Cover
# art drawn anywhere, that was a promise nobody could check.
#
# Content lifted from mockups/RomsOptions.dc.html, where these sections are drawn today.

note_saves = """  LIBRARY - the composed design, additional options, Saves.

  THE SAME MODAL, THE SAME FRAME, a different tab. Only the active tab and the panel under it
  differ from LibraryComposedOptions.

  THE SLOT PICKER IS THE SHIPPED ONE: `SRAM`, `Slot 0`, `Slot 1`, with SRAM selected. Those are
  the labels RomsOptions draws, and they are what the firmware calls them: SRAM is the battery
  save, the numbered slots are save states. The preview keeps the 300px column Cover art uses,
  so the modal's frame does not move between tabs, and the arrows sit outside it as they do
  today.

  SAVES FITS A TAB COMFORTABLY. Four things (the picker, the preview, the written date, the
  download) in a panel sized for a 300px image. No crowding, nothing dropped.

  Fixtures as the board at rest.
"""

write("LibraryComposedOptionsSaves.dc.html", note_saves,
      chip_strip() + "\n" + upper() + summary_dock(expanded=False) + options_modal(active="Saves"),
      exact_height=920)


note_cheats = """  LIBRARY - the composed design, additional options, Cheats.

  THE ANSWER TO WHETHER A TAB IS ENOUGH ROOM FOR CHEATS: yes, and with space left over, but the
  panel is not shaped like the other two.

  Cover art and Saves each have an image on the right, so both use a `1fr 300px` body. Cheats
  has nothing to preview. Stacking its four parts in one column would leave half the modal
  empty, so it is two equal columns: what is set on the left (the detected game and the
  presets), what you can add on the right (manual entry, and the configured count under it).

  THAT THE BODY GRID IS NOT THE SAME ON ALL THREE TABS IS THE THING TO LOOK AT. It is not a
  problem in itself, and a tabbed panel changing shape per tab is ordinary. It does mean the
  modal cannot be built as one fixed two-column frame with swapped contents.

  EVERY STRING SHIPS. `Detected game`, `Presets`, `Manual entry`, `Code`, `Description`, `Add`
  and `Configured` are RomsOptions' own; the three preset names are its fixture.

  Fixtures as the board at rest.
"""

write("LibraryComposedOptionsCheats.dc.html", note_cheats,
      chip_strip() + "\n" + upper() + summary_dock(expanded=False) + options_modal(active="Cheats"),
      exact_height=920)
