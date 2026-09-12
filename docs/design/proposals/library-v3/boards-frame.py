#!/usr/bin/env python3
"""The three FRAME boards. Run: python3 boards-frame.py

`build-frame.py` is not an importable module name (hyphen), so it is loaded by path, the same
way boards-library.py loads build-library.py.
"""
import importlib.util as _il
import os as _os

_spec = _il.spec_from_file_location(
    "build_frame", _os.path.join(_os.path.dirname(_os.path.abspath(__file__)), "build-frame.py")
)
_build = _il.module_from_spec(_spec)
_spec.loader.exec_module(_build)
globals().update({k: v for k, v in vars(_build).items() if not k.startswith("_")})


# =======================================================================================
# 1. ConsoleRail - the console filter as a vertical rail.
# =======================================================================================
note1 = """  LIBRARY - the console filter as a rail.

  ONE VARIABLE. Everything else on this board is the shipped arrangement: the same list, the
  same carousel, the same three option sections, the same dock. The only thing that moved is
  the console filter, from a horizontal chip strip above the list to a 244px rail down the
  left. Judge the rail, not the page.

  WHY A RAIL IS EVEN ARGUABLE. The filter is already a single-select list of named scopes with
  a count beside each one. That is what a rail is. Drawn as chips it has a hard ceiling: at
  1440 the strip fits about nine before it wraps, and a wrapped filter strip pushes the list
  down the page every time a core is added.

  NOT A THIRD RAIL IDIOM. CLAUDE.md is explicit that FirmwareRail.svelte and OverviewRail.svelte
  are the two, and that a new grouped-navigation surface extends one of them. This is
  OverviewRail's shape: 244px, full-bleed, caps group heading, active item at 600 weight with
  an inset 2px green edge.

  WHAT IT COSTS. 244px off the left. The list column drops from 1116 to 684. That is the whole
  argument against it, and it is a real one: see BigLibrary, where long names are already
  clipping at 684.

  ADDITIONAL OPTIONS ARE THE RIGHT COLUMN, stacked under the carousel that selects the game.
  Cover art, Saves and Cheats are peers. A fourth section is appended, not fitted in.

  Sources, per element:
    Rail counts      romSelection.systems[].count, homebrew.titles   RomManagementTab:2258-2270
    Rows             visibleGames                                    RomManagementTab:328-344
    Action chip      getActionState(g)                               RomManagementTab:385
    Options          GameDetailsPanel.svelte:893, 1056, 1128
    Budget, net      budgetText, netChangeText                       RomManagementTab:1539

  Fixture lifted from mockups/Roms.dc.html. Numbers are plausible, not measured.
"""

right_col_1 = f"""          <div style="display: flex; flex-direction: column; gap: 20px;">
{coverflow(400, 230, "Aerobiz Supersonic", ["Aladdin", "Alwa's Awakening"], ["Alex Kidd", "Battletoads"])}
{options_stack("Aerobiz Supersonic", "Aerobiz Supersonic.md")}
          </div>"""

inner1 = f"""  <div style="display: grid; grid-template-columns: 244px minmax(0, 1fr); flex-grow: 1; min-height: 0;">
{console_rail(active="All")}
    <div style="display: flex; flex-direction: column; min-width: 0;">
      <div style="padding: 28px 40px 36px; display: flex; flex-direction: column; gap: 20px; flex-grow: 1;">
        <div style="font-size: 24px; font-weight: 600; letter-spacing: -0.015em;">All</div>
        <div style="display: grid; grid-template-columns: minmax(0, 1fr) 400px; gap: 32px; align-items: start;">

          <div style="display: flex; flex-direction: column; gap: 4px;">
{list_header(6)}
{rows()}
          </div>

{right_col_1}

        </div>
      </div>
      <div style="margin-top: auto;">
{summary_tab()}
{meter(7, 5)}
{dock_bar("3.54 MB of 50 MB projected", "+0.12 MB net change")}
      </div>
    </div>
  </div>
"""

write("ConsoleRail.dc.html", note1, inner1, min_height=1180)


# =======================================================================================
# 2. SummaryDock - the summary given room.
# =======================================================================================
note2 = """  LIBRARY - the summary given room.

  ONE VARIABLE. The console filter is the shipped chip strip here, deliberately, so this board
  and ConsoleRail differ in one thing each from the approved Roms board rather than two.

  THE SUMMARY STOPS SHARING A SLOT. Today the summary drawer and Additional options are the
  same drawer: opening either closes the other (RomManagementTab.svelte:2506-2600). So the
  numbers describing a write and the settings that change the write can never be read at once.
  Here the per-game options are the right column and the drawer is the summary alone.

  WHAT A WRITE ACTUALLY CHANGES. Six categories, not one total: games, homebrew, cores, BIOS,
  cover art and cheats. They are separate rows because they are separate files with separate
  reasons to be there, and because a 42.9 MB jump that is entirely one homebrew is a different
  fact from 42.9 MB spread across sixty ROMs.

  TWO COLUMNS, NOT ONE. The After / Change table on the left, the install settings on the
  right. Stacked, the drawer runs past 500px; side by side it is about 370 and the table still
  reads as a table.

  THIS BOARD IS 1480 TALL AND THAT IS THE FINDING. The app page is a fixed viewport
  (App.svelte's .app is height 100vh, overflow hidden, and .tabpane is the only scroller).
  The summary open AND the per-game options visible at once does not fit a 920 viewport: it
  needs about 1480. So the two can share the screen only if something else gives, and the
  candidates are the coverflow's height or the option sections collapsing to headings. Drawn
  full so the cost is visible rather than hidden by a scroll.

  THE SELECTION DOES NOT FIT, and that is drawn: the total is red, the meter is red, and the
  overflow is 15.3 MB past the gap. The space-alert modal (RomManagementTab:2647) is what
  fires on Sync; this is the state before the click.

  Sources, per element:
    Rows          composeSummaryRows(flags, rows)      sources/summaryRows.ts:85
    BIOS line     biosSummaryDecision                  sources/summaryRows.ts
    Budget, net   budgetText, netChangeText            RomManagementTab:1539
    Meter         meterInstalledPct, meterPendingPct   RomManagementTab:2552
    Compress      install.lzmaCheckboxLabel
    Core update   sdSync.upgradeLabelPre

  Fixture lifted from mockups/Roms.dc.html. Numbers are plausible, not measured.
"""

summary_table = f"""          <div style="display: grid; grid-template-columns: minmax(0, 1fr) 110px 110px; gap: 20px; padding-bottom: 8px; border-bottom: 1px solid {BORDER};">
            <span></span>
            <span style="{CAPS} text-align: right;">After</span>
            <span style="{CAPS} text-align: right;">Change</span>
          </div>
{srow("Games", "112", "+4")}
{srow("Homebrew", "3", "+1")}
{srow("Cores", "7", "")}
{srow("BIOS", "3", "")}
{srow("Cover art", "112", "+4")}
{srow("Cheats", "2 codes", "", last=True)}
{srow("Total", "65.3 MB", "+42.9 MB", last=True, total=True, warn=True)}"""

install_opts = f"""          <div style="display: flex; flex-direction: column; gap: 14px;">
            <span style="{CAPS}">Install</span>
            <div style="display: flex; align-items: center; gap: 10px;">
              {check(False)}
              <span style="font-size: 13px; color: {SOFT};">Compress ROMs</span>
            </div>
            <div style="display: flex; align-items: center; gap: 10px; flex-wrap: wrap;">
              {check(True)}
              <span style="font-size: 13px;">Update Retro-Go and cores</span>
              <span style="font-size: 12px; color: {SOFT}; font-family: {MONO}; border: 1px solid {BORDER}; border-radius: 4px; padding: 2px 9px;">v2.0.0-rc3</span>
            </div>
          </div>"""

summary_drawer = f"""    <div style="background: {WHITE}; border-top: 1px solid {BORDER};">
      <div style="padding: 20px 40px 24px; display: grid; grid-template-columns: minmax(0, 1fr) 300px; gap: 48px; align-items: start;">
        <div style="display: flex; flex-direction: column;">
          <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 10px;">
            <span style="font-size: 14px; font-weight: 600;">Install summary</span>
          </div>
{summary_table}
        </div>
{install_opts}
      </div>
    </div>"""

right_col_2 = f"""          <div style="display: flex; flex-direction: column; gap: 20px;">
{coverflow(400, 230, "Super Mario World", ["Battletoads", "Beyond Oasis"], ["Blow'em Out", "Ball"])}
{options_stack("Super Mario World", "smw.sfc")}
          </div>"""

inner2 = f"""  <div style="padding: 22px 40px 0;">
{chip_strip(active="All")}
  </div>
  <div style="padding: 22px 40px 32px; display: grid; grid-template-columns: minmax(0, 1fr) 400px; gap: 32px; align-items: start; flex-grow: 1;">

    <div style="display: flex; flex-direction: column; gap: 4px;">
{list_header(6)}
{rows()}
    </div>

{right_col_2}

  </div>
  <div style="margin-top: auto;">
{summary_tab(open_state=True)}
{summary_drawer}
{meter(7, 88, over=True)}
{dock_bar("65.3 MB of 50 MB projected", "+42.9 MB net change", over=True)}
  </div>
"""

write("SummaryDock.dc.html", note2, inner2, min_height=1480)


# =======================================================================================
# 3. BigLibrary - the stress test.
# =======================================================================================
note3 = """  LIBRARY - 912 games.

  THE STRESS TEST. Same tab, same arrangement, a library ten times the fixture: 912 games,
  318 of them NES, real cartridge names with their region and revision suffixes. Everything
  that reads well at 137 is meant to be judged here instead.

  THREE THINGS BREAK, AND THEY ARE DRAWN RATHER THAN DESCRIBED:

  1. THE CHIP STRIP WRAPS. Eleven consoles do not fit on one line at 1440, so the filter takes
     two rows and pushes the list down. Every core a user adds makes this worse. This is the
     strongest argument for ConsoleRail, and it is the reason that board exists.

  2. NAMES CLIP. "Teenage Mutant Ninja Turtles II: The Arcade Game" does not fit the column
     beside a checkbox, a badge, a size and a chip. Drawn clipping, with an ellipsis, because
     that is what the column does. Widening the column is the only fix and the rail is what
     takes the width away.

  3. TWENTY-ONE ROWS OF 318. The scrollbar is drawn at its real proportion. Selecting across
     318 rows by eye is the thing "Select all" cannot help with, and nothing on this page
     narrows the list except the console filter.

  WHAT IS NOT DRAWN, DELIBERATELY: a search or filter field. There is none today, and
  UI_VOICE.md is explicit that a board does not invent a control. The absence IS the finding
  at this scale, and it is written up rather than mocked up.

  ROW DENSITY. 34px rather than 46, which is what buys 21 rows instead of 15. The badge, the
  size and the chip are unchanged; only the padding and the title size moved.

  Sources, per element:
    Rows             visibleGames                     RomManagementTab:328-344
    Console counts   romSelection.systems[].count     RomManagementTab:2258-2270
    Action chip      getActionState(g)                RomManagementTab:385

  Counts sum to 912. Names are real cartridge titles. No device was attached.
"""

BIG_CONSOLES = [
    ("All", "912"),
    ("NES", "318"),
    ("Genesis / Mega Drive", "204"),
    ("Master System", "88"),
    ("Game Boy", "71"),
    ("Game Boy Color", "64"),
    ("MSX", "58"),
    ("PC Engine", "43"),
    ("Game Gear", "29"),
    ("GW", "25"),
    ("Homebrew", "12"),
]

BIG_GAMES = [
    ("Batman: Return of the Joker (USA)", "NES", "256 KB", ("installed", "installed"), True),
    ("Bucky O'Hare (USA)", "NES", "256 KB", ("installed", "installed"), True),
    ("Castlevania III: Dracula's Curse (USA)", "NES", "384 KB", ("install", "pending"), True),
    ("Crystalis (USA)", "NES", "384 KB", ("not installed", "idle"), False),
    ("Dragon Warrior IV (USA)", "NES", "512 KB", ("not installed", "idle"), False),
    ("Duck Tales 2 (USA)", "NES", "256 KB", ("installed", "installed"), True),
    ("Final Fantasy III (Japan) (Translation)", "NES", "512 KB", ("not installed", "idle"), False),
    ("Gargoyle's Quest II: The Demon Darkness", "NES", "256 KB", ("not installed", "idle"), False),
    ("Gimmick! (Japan)", "NES", "256 KB", ("installed", "installed"), True),
    ("Jackal (USA)", "NES", "128 KB", ("installed", "installed"), True),
    ("Journey to Silius (USA)", "NES", "256 KB", ("not installed", "idle"), False),
    ("Kid Icarus (USA)", "NES", "128 KB", ("installed", "installed"), True),
    ("Kirby's Adventure (USA) (Rev A)", "NES", "768 KB", ("install", "pending"), True),
    ("Little Nemo: The Dream Master (USA)", "NES", "256 KB", ("not installed", "idle"), False),
    ("Mega Man 4 (USA) (Rev A)", "NES", "384 KB", ("installed", "installed"), True),
    ("Mighty Final Fight (USA)", "NES", "384 KB", ("not installed", "idle"), False),
    ("Ninja Gaiden III: The Ancient Ship of Doom", "NES", "256 KB", ("not installed", "idle"), False),
    ("Power Blade 2 (USA)", "NES", "384 KB", ("not installed", "idle"), False),
    ("Recca: Summer Carnival '92 (Japan)", "NES", "256 KB", ("installed", "installed"), True),
    ("Shatterhand (USA)", "NES", "256 KB", ("not installed", "idle"), False),
    ("Teenage Mutant Ninja Turtles II: The Arcade Game", "NES", "512 KB",
     ("not installed", "idle"), False),
]

scrollbar = f"""      <div style="width: 6px; background: {HAIR}; border-radius: 3px; align-self: stretch; position: relative; flex-shrink: 0;" aria-hidden="true">
        <div style="position: absolute; top: 0; left: 0; width: 6px; height: 7%; background: #b4b4ba; border-radius: 3px;"></div>
      </div>"""

right_col_3 = f"""    <div style="display: flex; flex-direction: column; gap: 20px;">
{coverflow(400, 218, "Kirby's Adventure", ["Jackal", "Gimmick!"], ["Mega Man 4", "Kid Icarus"], tile_w=124, tile_h=162)}
{options_stack("Kirby's Adventure", "Kirby's Adventure (USA) (Rev A).nes")}
    </div>"""

inner3 = f"""  <div style="padding: 20px 40px 0;">
{chip_strip(active="NES", consoles=BIG_CONSOLES)}
  </div>
  <div style="padding: 20px 40px 28px; display: grid; grid-template-columns: minmax(0, 1fr) 400px; gap: 32px; align-items: start; flex-grow: 1;">

    <div style="display: flex; gap: 10px; min-width: 0;">
      <div style="display: flex; flex-direction: column; gap: 4px; flex-grow: 1; min-width: 0;">
{list_header(84)}
{rows(BIG_GAMES, dense=True, highlight_index=12)}
      </div>
{scrollbar}
    </div>

{right_col_3}

  </div>
  <div style="margin-top: auto;">
{summary_tab()}
{meter(62, 9)}
{dock_bar("41.8 MB of 50 MB projected", "+1.14 MB net change")}
  </div>
"""

write("BigLibrary.dc.html", note3, inner3, min_height=1180)
