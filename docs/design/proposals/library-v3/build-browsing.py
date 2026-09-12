#!/usr/bin/env python3
"""Three Library boards that vary HOW THE LIBRARY IS BROWSED. Run: python3 build-browsing.py

The set asks one question: how much of the screen should the cover art get, and what is the
primary surface for picking a game. Everything else is held still on purpose. Same chrome, same
console chips, same twelve games, same three option sections, same dock. A board set that varies
two things at once cannot be compared.

`overview-v2/build-library.py` is loaded by path (a hyphen is not an importable module name) for
its palette and chrome, so nothing here re-picks a colour. Its `write()` is NOT reused: that one
writes beside itself, and these belong in this directory.

The console filter stays a horizontal chip strip here, which is what ships today. overview-v2
argued it into a rail and that argument may well win, but it costs 244px of width and these three
boards are about width. Holding the filter still keeps the comparison clean; the rail question is
a separate board.
"""
import importlib.util as _il
import os as _os

_HERE = _os.path.dirname(_os.path.abspath(__file__))
_spec = _il.spec_from_file_location(
    "build_library", _os.path.join(_HERE, "..", "overview-v2", "build-library.py")
)
_build = _il.module_from_spec(_spec)
_spec.loader.exec_module(_build)
globals().update({k: v for k, v in vars(_build).items() if not k.startswith("_")})

# INK SOFT MUTE WHITE BORDER HAIR PAGE GREEN GREEN_B AMBER DANGER MONO CAPS CARD chrome()
# chip() sysbadge() check() game_row() tail() come from that module.

BLUE = "#007bff"          # the "install" pill on the shipped board
TINTS = ["#3d5a8a", "#7a4a2a", "#2f5a3a", "#5a3a6a", "#8a6a2a", "#2a5a6a",
         "#6a2f3a", "#43506a", "#4a6a2f", "#6a4a2a"]


def head(note, min_height=1100):
    return f"""<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <script src="./support.js"></script>
</head>
<body>
<x-dc>
<helmet>
  <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Hanken+Grotesk:wght@400;500;600;700&amp;display=swap">
  <style>
    body {{ margin: 0; }}
    a {{ color: {GREEN}; }} a:hover {{ color: #2f7a3c; }}
  </style>
</helmet>

<!--
{note}
-->

<div style="width: 1440px; min-height: {min_height}px; background: {PAGE}; color: {INK}; font-family: 'Hanken Grotesk', ui-sans-serif, system-ui, sans-serif; font-size: 16px; line-height: 1.5; display: flex; flex-direction: column; position: relative;">
"""


def write(name, note, inner, min_height=1100):
    with open(_os.path.join(_HERE, name), "w") as f:
        f.write(head(note, min_height) + chrome() + inner + tail())
    print("wrote", name)


# ---------------------------------------------------------------------------------------
# Fixtures. Twelve games, lifted row for row from the approved mockups/Roms.dc.html so these
# boards and that one can be read side by side.
# ---------------------------------------------------------------------------------------
GAMES = [
    ("MD", "Aerobiz Supersonic", "1 MB", "installed"),
    ("MD", "Aladdin", "1 MB", "install"),
    ("SMS", "Alex Kidd in Miracle World", "128 KB", "installed"),
    ("NES", "Alfonzo's Arctic Adventure", "256 KB", "not installed"),
    ("NES", "Alwa's Awakening", "512 KB", "installed"),
    ("GW", "Back to the Future", "64 KB", "not installed"),
    ("GW", "Ball", "64 KB", "not installed"),
    ("NES", "Battle Kid: Fortress of Peril", "256 KB", "installed"),
    ("NES", "Battletoads (USA)", "256 KB", "not installed"),
    ("HB", "Super Mario World", "880 KB", "prepare"),
    ("MD", "Beyond Oasis", "2 MB", "not installed"),
    ("NES", "Blow'em Out", "128 KB", "not installed"),
]

# Which fixtures have cover art. Four do not, and every board has to answer for them.
NO_ART = {"Ball", "Back to the Future", "Blow'em Out", "Alfonzo's Arctic Adventure"}

CONSOLES = [("All", "137", True), ("NES", "63", False), ("Genesis / Mega Drive", "22", False),
            ("GW", "25", False), ("Master System", "9", False), ("PC Engine", "7", False),
            ("Game Gear", "6", False), ("Homebrew", "3", False)]

SELECTED = "Aerobiz Supersonic"


def chips():
    """The shipped console filter: single-select, counts beside each name."""
    out = []
    for label, count, active in CONSOLES:
        if active:
            out.append(f'<span style="font-size: 13px; font-weight: 600; background: {INK}; color: {WHITE}; border-radius: 3px; padding: 5px 11px; white-space: nowrap;">{label} {count}</span>')
        else:
            out.append(f'<span style="font-size: 13px; color: {SOFT}; padding: 5px 11px; white-space: nowrap;">{label} {count}</span>')
    return f"""
  <div style="padding: 22px 40px 0; display: flex; align-items: center; gap: 6px; flex-wrap: wrap;">
    {''.join(out)}
  </div>
"""


def pill(state):
    """Row and tile state. The four words are the shipped ones."""
    paint = {
        "installed": f"color: {WHITE}; background: {GREEN}; box-shadow: inset 0 -1px 0 rgba(0,0,0,0.18);",
        "install": f"color: {WHITE}; background: {BLUE}; box-shadow: inset 0 -1px 0 rgba(0,0,0,0.18);",
        "not installed": f"color: {SOFT}; background: #e8e8e8;",
        "prepare": f"color: {WHITE}; background: {AMBER}; box-shadow: inset 0 -1px 0 rgba(0,0,0,0.18);",
    }[state]
    return f'<span style="font-size: 12px; font-weight: 600; border-radius: 999px; padding: 4px 12px; white-space: nowrap; flex-shrink: 0; {paint}">{state}</span>'


def row(idx, compact=False):
    """One list row. `compact` drops the size column for a narrow column."""
    system, name, size, state = GAMES[idx]
    sel = name == SELECTED
    bg = f"background: {PAGE};" if sel else ""
    ring = f"box-shadow: inset 2px 0 0 {GREEN};" if sel else ""
    size_html = "" if compact else f'<span style="font-size: 12px; color: {SOFT}; font-family: {MONO}; white-space: nowrap;">{size}</span>'
    return f"""            <div style="display: flex; align-items: center; gap: 10px; padding: 10px 12px; border-bottom: 1px solid {HAIR}; {bg} {ring}">
              {check(state in ("installed", "install"))}
              <span style="font-size: 10px; font-weight: 600; letter-spacing: 0.07em; color: {SOFT}; background: #e8e8e8; border-radius: 2px; padding: 3px 5px; width: 38px; text-align: center; flex-shrink: 0;">{system}</span>
              <span style="font-size: 13px; flex-grow: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">{name}</span>
              {size_html}
              {pill(state)}
            </div>"""


def list_header(n_selected=6):
    return f"""            <div style="display: flex; align-items: center; justify-content: space-between; padding: 0 12px 10px; border-bottom: 1px solid {BORDER};">
              <span style="{CAPS}">{n_selected} selected</span>
              <span style="font-size: 13px; font-weight: 600; color: {GREEN};">Select all</span>
            </div>"""


def cover(name, w, h, selected=False, tint_idx=0, show_title=False, state=None,
          checkbox=False):
    """One cover. A game with no art gets a drawn placeholder, not a blank rectangle.

    Four of the twelve fixtures have no art on purpose. A board that only draws the happy case
    is not showing what this library looks like.
    """
    ring = f"box-shadow: 0 0 0 3px {GREEN};" if selected else "box-shadow: 0 1px 3px rgba(0,0,0,0.18);"
    system = next(g[0] for g in GAMES if g[1] == name)
    if name in NO_ART:
        inner = f"""<div style="width: 100%; height: 100%; box-sizing: border-box; background: {WHITE}; border: 1px dashed #c4c4c4; border-radius: 4px; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 6px; padding: 8px;">
            <span style="font-size: 10px; font-weight: 700; letter-spacing: 0.07em; color: {SOFT}; background: #e8e8e8; border-radius: 2px; padding: 3px 6px;">{system}</span>
            <span style="font-size: 11px; color: {SOFT}; text-align: center; line-height: 1.25;">No cover</span>
          </div>"""
    else:
        inner = f'<div style="width: 100%; height: 100%; background: {TINTS[tint_idx % len(TINTS)]}; border-radius: 4px;"></div>'
    box = f"""<div style="position: relative; width: {w}px; height: {h}px; flex-shrink: 0; border-radius: 4px; {ring}">
          {inner}"""
    if checkbox:
        box += f"""
          <span style="position: absolute; top: 7px; left: 7px;">{check(state in ("installed", "install"))}</span>"""
    if state:
        box += f"""
          <span style="position: absolute; left: 7px; bottom: 7px;">{pill(state)}</span>"""
    box += "\n        </div>"
    if not show_title:
        return box
    weight = "600" if selected else "400"
    return f"""<div style="display: flex; flex-direction: column; gap: 7px; width: {w}px; flex-shrink: 0;">
        {box}
        <span style="font-size: 12px; font-weight: {weight}; line-height: 1.3; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">{name}</span>
      </div>"""


# ---------------------------------------------------------------------------------------
# The three option sections, identical on all three boards. Content is lifted from the
# shipped drawer (mockups/RomsOptions.dc.html) so the boards differ in PLACEMENT only.
# ---------------------------------------------------------------------------------------
def select(value, width=148):
    return f"""<span style="display: flex; align-items: center; gap: 10px; height: 32px; padding: 0 10px; background: {WHITE}; border: 1px solid #dcdcdc; border-radius: 2px; font-size: 13px; min-width: {width}px; justify-content: space-between;">
              <span>{value}</span>
              <svg width="12" height="12" viewBox="0 0 20 20" fill="none" stroke="{SOFT}" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M5 8l5 5 5-5"></path></svg>
            </span>"""


def field(label, value):
    return f"""<div style="display: flex; align-items: center; justify-content: space-between; gap: 12px;">
            <span style="font-size: 13px; color: {SOFT};">{label}</span>
            {select(value)}
          </div>"""


def section_head(title, right=""):
    return f"""<div style="display: flex; align-items: center; justify-content: space-between;">
            <div style="{CAPS}">{title}</div>
            {right}
          </div>"""


def opt_cover(preview_h=140):
    return f"""<div style="display: flex; flex-direction: column; gap: 12px;">
          {section_head("Cover art")}
          {field("Source", "ScreenScraper")}
          {field("Variant", "Box art")}
          <div style="height: {preview_h}px; background: #e8e8e8; border-radius: 4px; display: flex; align-items: center; justify-content: center;">
            <span style="font-size: 12px; color: {SOFT};">Preview</span>
          </div>
          <div style="display: flex; align-items: center; gap: 14px;">
            <span style="background: {GREEN}; color: {WHITE}; font-size: 13px; font-weight: 600; padding: 7px 16px; border-radius: 4px;">Apply</span>
            <span style="font-size: 13px; color: {SOFT};">Drop an image to override</span>
          </div>
          <div style="display: flex; flex-direction: column; gap: 5px;">
            <div style="display: flex; justify-content: space-between;">
              <span style="font-size: 11px; color: {SOFT};">Requests today</span>
              <span style="font-size: 11px; color: {SOFT}; font-family: {MONO};">842 / 20000</span>
            </div>
            <div style="height: 3px; background: {BORDER}; border-radius: 2px; overflow: hidden;">
              <div style="height: 100%; width: 4%; background: {INK};"></div>
            </div>
          </div>
        </div>"""


def opt_saves(preview_h=150):
    slots = []
    for i, (label, on) in enumerate([("SRAM", True), ("Slot 0", False), ("Slot 1", False)]):
        paint = f"background: {INK}; color: {WHITE};" if on else f"color: {SOFT};"
        slots.append(f'<span style="font-size: 12px; font-weight: 600; padding: 5px 11px; border-radius: 3px; {paint}">{label}</span>')
    return f"""<div style="display: flex; flex-direction: column; gap: 12px;">
          {section_head("Saves")}
          <div style="display: flex; gap: 6px;">{''.join(slots)}</div>
          <div style="display: flex; align-items: center; gap: 10px;">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#9a9aa0" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"></polyline></svg>
            <div style="flex-grow: 1; height: {preview_h}px; background: #e8e8e8; border-radius: 4px; display: flex; align-items: center; justify-content: center;">
              <span style="font-size: 12px; color: {SOFT};">Save preview</span>
            </div>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="{SOFT}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"></polyline></svg>
          </div>
          <div style="display: flex; align-items: center; justify-content: space-between; gap: 12px;">
            <span style="font-size: 13px; color: {SOFT};">Written</span>
            <span style="font-size: 13px; font-weight: 600;">2026-08-29 21:14</span>
          </div>
          <span style="font-size: 13px; font-weight: 600; color: {GREEN};">Download save</span>
        </div>"""


def preset(label, on):
    if on:
        box = f'<span style="width: 15px; height: 15px; border-radius: 2px; background: {GREEN}; display: flex; align-items: center; justify-content: center; flex-shrink: 0;"><svg width="9" height="9" viewBox="0 0 20 20" fill="none" stroke="{WHITE}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M4.5 10.5l3.5 3.5 7.5-8"></path></svg></span>'
        color = INK
    else:
        box = '<span style="width: 15px; height: 15px; border-radius: 2px; border: 1px solid #9a9aa0; background: #ffffff; flex-shrink: 0;"></span>'
        color = SOFT
    return f'<div style="display: flex; align-items: center; gap: 10px;">{box}<span style="font-size: 13px; color: {color};">{label}</span></div>'


def opt_cheats():
    return f"""<div style="display: flex; flex-direction: column; gap: 12px;">
          {section_head("Cheats")}
          {field("Detected game", "Aerobiz Supersonic")}
          <div style="display: flex; flex-direction: column; gap: 9px;">
            <span style="font-size: 11px; font-weight: 700; letter-spacing: 0.09em; color: {SOFT}; text-transform: uppercase;">Presets</span>
            {preset("Infinite funds", True)}
            {preset("All aircraft unlocked", True)}
            {preset("Fast turn processing", False)}
          </div>
          <div style="display: flex; flex-direction: column; gap: 9px;">
            <span style="font-size: 11px; font-weight: 700; letter-spacing: 0.09em; color: {SOFT}; text-transform: uppercase;">Manual entry</span>
            <div style="display: flex; gap: 8px;">
              <span style="flex: 1; height: 32px; display: flex; align-items: center; padding: 0 10px; background: {WHITE}; border: 1px solid #dcdcdc; border-radius: 2px; font-size: 13px; color: #9a9aa0; font-family: {MONO};">Code</span>
              <span style="flex: 1; height: 32px; display: flex; align-items: center; padding: 0 10px; background: {WHITE}; border: 1px solid #dcdcdc; border-radius: 2px; font-size: 13px; color: #9a9aa0;">Description</span>
              <span style="height: 32px; display: flex; align-items: center; padding: 0 14px; font-size: 13px; font-weight: 600; color: {GREEN};">Add</span>
            </div>
          </div>
          <div style="display: flex; justify-content: space-between; align-items: baseline; padding-top: 10px; border-top: 1px solid {BORDER};">
            <span style="font-size: 13px; color: {SOFT};">Configured</span>
            <span style="font-size: 13px; font-weight: 600;">2 codes</span>
          </div>
        </div>"""


def options_title():
    return f'<div style="font-size: 15px; font-weight: 600;">Additional options</div>'


# ---------------------------------------------------------------------------------------
# The dock. Same arrangement the shipped bar has: meter strip fused to the top edge, budget
# and net change left, Sync Library right.
# ---------------------------------------------------------------------------------------
def dock(inst=7, pend=5, options_tab=None):
    """`options_tab` draws the Additional options affordance when a board keeps it here."""
    tab = ""
    if options_tab:
        arrow = "M5 12l5-5 5 5" if options_tab == "up" else "M15 12l-5-5-5 5"
        tab = f"""<div style="display: flex; align-items: center; gap: 10px;">
          <span style="font-size: 13px; font-weight: 600;">Additional options</span>
          <svg width="13" height="13" viewBox="0 0 20 20" fill="none" stroke="{INK}" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="{arrow}"></path></svg>
        </div>"""
    return f"""
  <div style="margin-top: auto;">
    <div style="display: flex; height: 3px; background: {BORDER};">
      <div style="width: {inst}%; background: {GREEN};"></div>
      <div style="width: {pend}%; background: #9a9aa0;"></div>
    </div>
    <div style="background: {WHITE}; border-top: 1px solid {BORDER}; min-height: 72px; box-sizing: border-box; padding: 0 40px; display: flex; align-items: center; gap: 24px;">
      <span style="font-size: 13px; color: {SOFT};">3.54 MB of 50 MB projected</span>
      <span style="font-size: 13px; color: {GREEN}; font-weight: 500;">+0.12 MB net change</span>
      <div style="display: flex; align-items: center; gap: 18px; margin-left: auto;">
        {tab}
        <div style="background: #c8372b; color: {WHITE}; font-size: 14px; font-weight: 600; padding: 9px 22px; border-radius: 5px; box-shadow: inset 0 -2px 0 #9e2a20;">Sync Library</div>
      </div>
    </div>
  </div>
"""


def detail_head(size="1 MB"):
    """Pretty name, system, filename, size. The shipped info pane, minus its second action
    chip: the row already carries the action and two of them was the confusion."""
    return f"""<div style="display: flex; flex-direction: column; gap: 3px;">
          <div style="font-size: 22px; font-weight: 600; letter-spacing: -0.015em;">{SELECTED}</div>
          <div style="display: flex; align-items: center; gap: 10px;">
            <span style="font-size: 13px; color: {SOFT};">Genesis / Mega Drive</span>
            <span style="width: 1px; height: 12px; background: {BORDER};"></span>
            <span style="font-size: 13px; color: {SOFT}; font-family: {MONO};">aerobiz-supersonic.md</span>
            <span style="width: 1px; height: 12px; background: {BORDER};"></span>
            <span style="font-size: 13px; color: {SOFT}; font-family: {MONO};">{size}</span>
          </div>
        </div>"""


# =======================================================================================
# 1. CarouselFirst - the coverflow gets the room.
# =======================================================================================
note1 = """  CAROUSEL FIRST - what if the nicest thing on the screen got the most room.

  The coverflow is the page. It runs full width at the top of the body, the selected cover is
  large and centred, its neighbours are smaller and dimmed, and picking one is how you move
  through the Library. Underneath, the selected title's three option sections sit side by side
  at full width, and the games list is a narrow column on the right.

  WHAT THIS BUYS. The cover art is the fastest way to recognise a game, and at 200px it is
  actually recognisable. The three option sections all fit on one row with no drawer, no tabs
  and no mode, so cheats are as visible as cover art, which is what the owner asked for.

  WHAT IT COSTS, and this is the reason to look hard at it. The list is 340px wide and shows
  eight rows. Selecting fifty games for an install means scrolling a narrow column while the
  biggest thing on screen is art for one game you already picked. The Library is a bulk
  selection tool first and a browser second, and this board inverts that.

  THE NO-ART CASE. Four of the twelve fixtures have no cover. They are drawn as dashed
  placeholders carrying the system badge, because a carousel of grey rectangles is what this
  arrangement actually looks like for a folder of homebrew and Game and Watch titles.

  Sources, per element:
    Console chips      romSelection.systems[].count            RomManagementTab.svelte:2258
    Rows, chip state   visibleGames, getActionState            RomManagementTab.svelte:328, 385
    Carousel           Carousel.svelte                         RomManagementTab.svelte:2385
    Options            GameDetailsPanel.svelte:893, 1056, 1128
    Budget, net        budgetText, netChangeText               RomManagementTab.svelte:1539

  Numbers are plausible, not measured. No device was attached and no card was read.
"""

# Big carousel: selected centre, neighbours smaller.
_big = []
for i, (system, name, size, state) in enumerate(GAMES[:7]):
    sel = name == SELECTED
    w, h = (168, 210) if sel else (124, 156)
    _big.append(cover(name, w, h, selected=sel, tint_idx=i, show_title=True))

inner1 = f"""{chips()}
  <div style="padding: 24px 40px 0;">
    <div style="background: {WHITE}; border: 1px solid {BORDER}; border-radius: 8px; padding: 22px 26px;">
      <div style="display: flex; align-items: flex-end; gap: 18px; overflow: hidden;">
        {''.join(_big)}
      </div>
    </div>
  </div>

  <div style="padding: 24px 40px 32px; display: grid; grid-template-columns: minmax(0, 1fr) 340px; gap: 28px; align-items: start; flex-grow: 1;">

    <div style="display: flex; flex-direction: column; gap: 18px; min-width: 0;">
      {detail_head()}
      <div style="background: {WHITE}; border: 1px solid {BORDER}; border-radius: 8px; padding: 22px 26px; display: flex; flex-direction: column; gap: 18px;">
        {options_title()}
        <div style="display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 26px; align-items: start;">
          {opt_cover(preview_h=132)}
          <div style="border-left: 1px solid {HAIR}; padding-left: 26px;">{opt_saves(preview_h=142)}</div>
          <div style="border-left: 1px solid {HAIR}; padding-left: 26px;">{opt_cheats()}</div>
        </div>
      </div>
    </div>

    <div style="background: {WHITE}; border: 1px solid {BORDER}; border-radius: 8px; padding: 14px 4px 0; display: flex; flex-direction: column;">
      {list_header()}
{chr(10).join(row(i, compact=True) for i in range(8))}
      <div style="padding: 12px; font-size: 12px; color: {SOFT};">129 more</div>
    </div>

  </div>
{dock()}"""

write("CarouselFirst.dc.html", note1, inner1, min_height=1180)


# =======================================================================================
# 2. CoverGrid - the grid IS the library.
# =======================================================================================
note2 = """  COVER GRID - no list and carousel split. The grid is the Library.

  Every game is a tile. The tile carries its own checkbox and its own state pill, so selecting
  for an install and seeing what is installed are the same gesture in the same place. The
  console chips filter the grid. The selected tile drives the options column on the right.

  WHAT THIS BUYS. One surface instead of two. Today the same game appears twice, once as a row
  and once as a cover, and the action chip is drawn in both places; this removes the duplication
  rather than tidying it. It also scales: at 150px the grid wraps five across in the 972px left
  column, so 137 games is 28 rows, which is a scroll, not a redesign.

  WHAT IT COSTS. Size and filename are gone from the browse surface. They are in the options
  column for the selected game only, so "which of these is the 2MB one" becomes a per-game
  question. For a medium with a hard budget that is a real loss, and the dock's projected total
  is doing more work here than on any other board.

  THE NO-ART CASE IS THE WHOLE PROBLEM. Four of twelve fixtures have no cover, drawn here as
  dashed tiles with the system badge and the title. Five across, they read as holes. A library
  of Game and Watch titles and homebrew is mostly holes, and this board should be judged on
  those tiles rather than on the four that happen to have art.

  Sources, per element:
    Console chips      romSelection.systems[].count            RomManagementTab.svelte:2258
    Tile state         getActionState(g)                       RomManagementTab.svelte:385
    Cover lookup       getCoverUrl                             RomManagementTab.svelte:660
    Options            GameDetailsPanel.svelte:893, 1056, 1128
    Budget, net        budgetText, netChangeText               RomManagementTab.svelte:1539

  Numbers are plausible, not measured. No device was attached and no card was read.
"""

_tiles = []
for i, (system, name, size, state) in enumerate(GAMES):
    _tiles.append(cover(name, 150, 150, selected=(name == SELECTED), tint_idx=i,
                        show_title=True, state=state, checkbox=True))

inner2 = f"""{chips()}
  <div style="padding: 22px 40px 32px; display: grid; grid-template-columns: minmax(0, 1fr) 360px; gap: 28px; align-items: start; flex-grow: 1;">

    <div style="display: flex; flex-direction: column; gap: 16px; min-width: 0;">
      <div style="display: flex; align-items: center; justify-content: space-between;">
        <span style="{CAPS}">6 selected</span>
        <span style="font-size: 13px; font-weight: 600; color: {GREEN};">Select all</span>
      </div>
      <div style="display: flex; flex-wrap: wrap; gap: 22px 24px;">
        {''.join(_tiles)}
      </div>
      <div style="font-size: 12px; color: {SOFT};">125 more</div>
    </div>

    <div style="background: {WHITE}; border: 1px solid {BORDER}; border-radius: 8px; padding: 22px 24px; display: flex; flex-direction: column; gap: 18px;">
      {detail_head()}
      {options_title()}
      {opt_cover(preview_h=128)}
      <div style="border-top: 1px solid {HAIR}; padding-top: 18px;">{opt_saves(preview_h=132)}</div>
      <div style="border-top: 1px solid {HAIR}; padding-top: 18px;">{opt_cheats()}</div>
    </div>

  </div>
{dock()}"""

write("CoverGrid.dc.html", note2, inner2, min_height=1320)


# =======================================================================================
# 3. DetailView - one game, everything about it.
# =======================================================================================
note3 = """  DETAIL VIEW - picking a game opens the game.

  A mode, entered from the list and left by the back control beside the title. The cover is
  large, the metadata sits beside it, and the three option sections are full-width cards below.
  The carousel is kept as a strip along the bottom so the next game is one click away and
  leaving the mode is not the only way to move.

  WHAT THIS BUYS. Room. Additional options is the part the owner expects to grow, and this is
  the only arrangement in the set where a fourth and fifth section cost nothing: they are two
  more cards down the page. Nothing is squeezed, nothing is behind a tab, and cheats get the
  same width as cover art.

  WHAT IT COSTS. A mode switch, and the selection work happens in the other one. You cannot see
  what else is selected while you are in here, so the dock's running total is the only thread
  back to the install you are assembling. That is the trade to weigh.

  THE CAROUSEL AS NAVIGATION. This is the one board where the carousel has a job beyond being
  pleasant: it is how you move between games without returning to the list. The no-art titles
  are drawn in the strip too, because moving through a run of them is the case that decides
  whether this works.

  Sources, per element:
    Pretty name, sys   visibleGames                            RomManagementTab.svelte:328
    Action chip        getActionState(g)                       RomManagementTab.svelte:385
    Carousel           Carousel.svelte                         RomManagementTab.svelte:2385
    Options            GameDetailsPanel.svelte:893, 1056, 1128
    Budget, net        budgetText, netChangeText               RomManagementTab.svelte:1539

  Numbers are plausible, not measured. No device was attached and no card was read.
"""

_strip = []
for i, (system, name, size, state) in enumerate(GAMES[:10]):
    _strip.append(cover(name, 72, 90, selected=(name == SELECTED), tint_idx=i))

inner3 = f"""
  <div style="padding: 22px 40px 0; display: flex; align-items: center; gap: 14px;">
    <div style="display: flex; align-items: center; gap: 8px;">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="{INK}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"></polyline></svg>
      <span style="font-size: 13px; font-weight: 600;">All 137</span>
    </div>
    <span style="width: 1px; height: 14px; background: {BORDER};"></span>
    <span style="font-size: 13px; color: {SOFT};">Genesis / Mega Drive 22</span>
  </div>

  <div style="padding: 20px 40px 0; display: grid; grid-template-columns: 240px minmax(0, 1fr); gap: 28px; align-items: start;">
    <div style="display: flex; flex-direction: column; gap: 14px;">
      {cover(SELECTED, 240, 300, selected=False, tint_idx=0)}
      {pill("installed")}
    </div>
    <div style="display: flex; flex-direction: column; gap: 18px; min-width: 0;">
      {detail_head()}
      <div style="display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 22px; align-items: start;">
        <div style="background: {WHITE}; border: 1px solid {BORDER}; border-radius: 8px; padding: 20px 22px;">{opt_cover(preview_h=118)}</div>
        <div style="background: {WHITE}; border: 1px solid {BORDER}; border-radius: 8px; padding: 20px 22px;">{opt_saves(preview_h=126)}</div>
        <div style="background: {WHITE}; border: 1px solid {BORDER}; border-radius: 8px; padding: 20px 22px;">{opt_cheats()}</div>
      </div>
    </div>
  </div>

  <div style="padding: 26px 40px 30px; margin-top: auto;">
    <div style="background: {WHITE}; border: 1px solid {BORDER}; border-radius: 8px; padding: 14px 18px; display: flex; align-items: center; gap: 12px; overflow: hidden;">
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="{SOFT}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink: 0;"><polyline points="15 18 9 12 15 6"></polyline></svg>
      {''.join(_strip)}
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="{SOFT}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink: 0;"><polyline points="9 18 15 12 9 6"></polyline></svg>
    </div>
  </div>
{dock()}"""

write("DetailView.dc.html", note3, inner3, min_height=1180)
