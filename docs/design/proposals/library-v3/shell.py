#!/usr/bin/env python3
"""Shared shell for the library-v3 boards: chrome, console filter, list, coverflow, dock.

A generator rather than hand-copied files, for the reason `overview-v2/build-library.py` gives:
"hand-copying them is how a board set drifts". These four boards differ in exactly one thing,
WHERE THE ADDITIONAL OPTIONS LIVE, so everything else has to be byte-identical or the
comparison is worthless.

Palette, metrics and fixtures are LIFTED from `docs/design/mockups/Roms.dc.html` and
`RomsOptions.dc.html`, not re-picked. That is the shipped Library, and the owner's brief was
that he wants to keep what is there: "I want to keep everything because it was all intentional
- it just hasn't come together like I had hoped."

The console filter is held CONSTANT across all four as the horizontal chip strip that ships
today. These boards vary one axis; a sibling set varies the filter.
"""
import os

# Palette, from Roms.dc.html.
INK, SOFT, MUTE = "#1b1b1b", "#5c5c5c", "#6e6e6e"
WHITE, BORDER, HAIR, PAGE = "#ffffff", "#d8d8d8", "#ededed", "#f4f4f4"
GREEN, BLUE, GREY = "#3e9e4e", "#007bff", "#e8e8e8"
RED, RED_B = "#c8372b", "#9e2a20"
DIM = "#9a9aa0"
MONO = "ui-monospace, Menlo, monospace"

CAPS = f"font-size: 11px; font-weight: 700; letter-spacing: 0.11em; color: {SOFT}; text-transform: uppercase;"


def head(note, min_height=1000, exact_height=None):
    """`exact_height` draws the board at a FIXED height with overflow hidden.

    That is the honest model of the app page, which is a fixed viewport where `.tabpane` is the
    only scroll container (CLAUDE.md). A board that quietly grows to fit its content cannot show
    whether a design survives 920px, which is the question asked of the composed design.
    """
    if exact_height is not None:
        box = f"height: {exact_height}px; overflow: hidden;"
    else:
        box = f"min-height: {min_height}px;"
    return _head_body(note, box)


def _head_body(note, box):
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

<div style="width: 1440px; {box} background: {PAGE}; color: {INK}; font-family: 'Hanken Grotesk', ui-sans-serif, system-ui, sans-serif; font-size: 16px; line-height: 1.5; display: flex; flex-direction: column; position: relative;">
"""


def tail():
    return """</div>
</x-dc>
</body>
</html>
"""


def chrome():
    """Header band, gold lip, tab strip. Lifted from Roms.dc.html, Library active."""
    tabs = []
    for name in ("Overview", "Firmware", "Sources", "Library"):
        if name == "Library":
            tabs.append(f'<div style="display: flex; align-items: center; height: 46px; padding: 0 2px; font-size: 14px; font-weight: 700; letter-spacing: 0.02em; color: {INK}; box-shadow: inset 0 -3px 0 {GREEN};">{name}</div>')
        else:
            tabs.append(f'<div style="display: flex; align-items: center; height: 46px; padding: 0 2px; font-size: 14px; font-weight: 600; letter-spacing: 0.02em; color: {MUTE};">{name}</div>')
    return f"""
  <div style="display: flex; flex-direction: column;">
    <div style="height: 56px; background: {WHITE}; display: flex; align-items: center; justify-content: space-between; padding: 0 40px;">
      <div style="display: flex; align-items: center; gap: 13px;">
        <svg width="19" height="19" viewBox="0 0 20 20" fill="none" stroke="{INK}" stroke-width="1.3" stroke-linecap="round">
          <rect x="5" y="5" width="10" height="10" rx="1.2"></rect>
          <path d="M7.5 5V3M10 5V3M12.5 5V3M7.5 17v-2M10 17v-2M12.5 17v-2M5 7.5H3M5 10H3M5 12.5H3M17 7.5h-2M17 10h-2M17 12.5h-2"></path>
        </svg>
        <div style="display: flex; align-items: center; gap: 11px;">
          <span style="position: relative; display: inline-flex; flex-shrink: 0;">
            <span style="height: 28px; width: 47px; background: #2e9e44; border: 1px solid rgba(0,0,0,0.35); border-radius: 2px; box-shadow: 0 1px 0 rgba(255,255,255,0.5) inset, 0 1px 2px rgba(0,0,0,0.25); display: flex; align-items: center; justify-content: center;">
              <img src="icon-console.svg" alt="" style="height: 100%; width: 100%; object-fit: contain; display: block;">
            </span>
            <span style="position: absolute; right: -4px; bottom: -4px; background: #c9c9cd; border: 1px solid rgba(0,0,0,0.35); border-radius: 999px; padding: 2px; display: flex; box-shadow: 0 1px 2px rgba(0,0,0,0.2);">
              <svg viewBox="0 0 10 6" width="10" height="6"><path d="M0 0 L5 6 L10 0 Z" fill="#161616"></path></svg>
            </span>
          </span>
          <span style="font-size: 14px; font-weight: 600;">Connected (Recovery Mode)</span>
        </div>
        <span style="width: 1px; height: 18px; background: {BORDER}; margin: 0 3px;"></span>
        <div style="display: flex; align-items: center; gap: 8px;">
          <img src="logo-gnw-badge.svg" alt="Game &amp; Watch" style="height: 27px; width: auto; display: block; flex-shrink: 0;">
          <span style="font-size: 14px; font-weight: 600;">Zelda (Patched)</span>
        </div>
        <span style="width: 1px; height: 18px; background: {BORDER}; margin: 0 3px;"></span>
        <div style="display: flex; align-items: center; gap: 8px;">
          <img src="logo-rgo.png" alt="Retro-Go" style="height: 14px; width: auto; display: block; flex-shrink: 0;">
          <span style="font-size: 13px; font-weight: 600; font-family: {MONO};">v1.4.1-44-flash</span>
        </div>
      </div>
      <div style="display: flex; align-items: center; gap: 18px;">
        <span style="font-size: 12px; font-weight: 500; color: {SOFT};">EN</span>
        <svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="{SOFT}" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round">
          <path d="M16 12.5A7 7 0 0 1 7.5 4a7 7 0 1 0 8.5 8.5z"></path>
        </svg>
      </div>
    </div>
    <div style="height: 3px; background: linear-gradient(180deg, #d9bc5e 0%, #c09a32 100%);"></div>
  </div>

  <div style="padding: 0 40px; background: {WHITE}; border-bottom: 1px solid {BORDER}; display: flex; align-items: stretch; justify-content: space-between;">
    <div style="display: flex; align-items: stretch; gap: 34px;">
      {''.join(tabs)}
    </div>
    <div style="display: flex; align-items: center; gap: 10px;">
      <svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="{SOFT}" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round">
        <path d="M2.5 6a1.5 1.5 0 0 1 1.5-1.5h3l1.5 2h6.5A1.5 1.5 0 0 1 16.5 8v6a1.5 1.5 0 0 1-1.5 1.5H4A1.5 1.5 0 0 1 2.5 14z"></path>
      </svg>
      <span style="font-size: 13px; font-weight: 500; color: {SOFT};">Change folder</span>
    </div>
  </div>
"""


def console_chips(active="All"):
    """The shipped horizontal console filter. Single select, counts from Roms.dc.html."""
    items = [("All", "137"), ("NES", "63"), ("Genesis / Mega Drive", "22"), ("GW", "25"),
             ("Master System", "9"), ("PC Engine", "7"), ("Game Gear", "6"), ("Homebrew", "3")]
    out = []
    for label, count in items:
        if label == active:
            out.append(f'<span style="font-size: 13px; font-weight: 600; background: {INK}; color: {WHITE}; border-radius: 3px; padding: 5px 11px;">{label} {count}</span>')
        else:
            out.append(f'<span style="font-size: 13px; color: {SOFT}; padding: 5px 11px;">{label} {count}</span>')
    return f"""  <div style="padding: 22px 40px 0; display: flex; align-items: center; gap: 6px; flex-wrap: wrap; flex-shrink: 0;">
    {''.join(out)}
  </div>"""


# --- the games list ---------------------------------------------------------------------
# Fixtures lifted from Roms.dc.html: same twelve rows, same systems, sizes and states.

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


def pill(state):
    paint = {
        "installed": f"color: {WHITE}; background: {GREEN}; box-shadow: inset 0 -1px 0 rgba(0,0,0,0.18);",
        "install": f"color: {WHITE}; background: {BLUE}; box-shadow: inset 0 -1px 0 rgba(0,0,0,0.18);",
        "prepare": f"color: {WHITE}; background: {BLUE}; box-shadow: inset 0 -1px 0 rgba(0,0,0,0.18);",
        "not installed": f"color: {SOFT}; background: {GREY}; box-shadow: inset 0 -1px 0 rgba(0,0,0,0.06);",
    }[state]
    return f'<span style="font-size: 12px; font-weight: 600; border-radius: 999px; padding: 4px 12px; min-width: 80px; text-align: center; white-space: nowrap; flex-shrink: 0; {paint}">{state}</span>'


def sysbadge(text):
    return f'<span style="font-size: 10px; font-weight: 600; letter-spacing: 0.07em; color: {SOFT}; background: {GREY}; border-radius: 2px; padding: 3px 5px; width: 40px; text-align: center; flex-shrink: 0;">{text}</span>'


STAR_PATH = ("12 2 15.1 8.6 22 9.6 17 14.6 18.2 21.5 12 18.2 5.8 21.5 7 14.6 2 9.6 8.9 8.6 12 2")


def star(on):
    """A per-row favourite toggle, in a 26px box.

    26 IS THE WHOLE POINT. That is the height of the action pill, which is the tallest thing in
    a row and therefore what sets the row at 49px. A star in a box of the same height changes
    nothing; one with padding of its own would push the row to 52 and cost a visible row, which
    the eleven-row fit at 920 cannot spare.

    Gold when set, a grey outline when not. Not green: green is `installed` two columns to the
    right, and a favourite is not a status. The gold is the chrome's own lip colour rather than
    a new one, and the outline shape is the same polygon the Favorites chip uses.
    """
    if on:
        return (f'<span style="width: 26px; height: 26px; flex-shrink: 0; display: flex; align-items: center; justify-content: center;">'
                f'<svg width="17" height="17" viewBox="0 0 24 24" fill="#c09a32" stroke="#c09a32" stroke-width="1.6" '
                f'stroke-linejoin="round"><polygon points="{STAR_PATH}"></polygon></svg></span>')
    return (f'<span style="width: 26px; height: 26px; flex-shrink: 0; display: flex; align-items: center; justify-content: center;">'
            f'<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="{DIM}" stroke-width="1.6" '
            f'stroke-linecap="round" stroke-linejoin="round"><polygon points="{STAR_PATH}"></polygon></svg></span>')


def game_row(system, name, size, state, selected=False, last=False, compact=False, fav=None):
    """`fav=None` draws no star column at all, which is what every board before the composed
    set does, so adding this leaves them byte-identical."""
    bb = "" if last else f" border-bottom: 1px solid {HAIR};"
    bg = f" background: {WHITE}; box-shadow: inset 2px 0 0 {GREEN};" if selected else ""
    pad = "9px" if compact else "11px"
    # THE HIGHLIGHT BLEEDS OUTWARD; IT DOES NOT INSET THE CONTENT. This was `padding-left: 10px;
    # padding-right: 10px`, which pushed the selected row's star 10px right of the star column
    # and pulled its size and pill 10px left of theirs. Because the selected row is the first
    # row, it read as the top of the list being out of true with everything under it.
    #
    # Negative margin plus equal padding moves the row's BOX outward while its content stays on
    # the same x positions as every other row. The list card has 16px of side padding, so a 10px
    # bleed stays 6px inside the card and collides with neither its edge nor its 6px radius.
    px = (" margin-left: -10px; margin-right: -10px; padding-left: 10px; padding-right: 10px;"
          if selected else "")
    star_col = f"\n          {star(fav)}" if fav is not None else ""
    return f"""        <div style="display: flex; align-items: center; gap: 12px; padding: {pad} 0;{bb}{bg}{px}">{star_col}
          {sysbadge(system)}
          <span style="font-size: 14px; color: {INK}; flex-grow: 1; min-width: 0;">{name}</span>
          <span style="font-size: 12px; color: {SOFT}; font-family: {MONO};">{size}</span>
          {pill(state)}
        </div>"""


def list_header(selected_count="6 selected"):
    return f"""        <div style="display: flex; align-items: baseline; justify-content: space-between; padding-bottom: 12px; border-bottom: 1px solid {HAIR};">
          <span style="{CAPS}">{selected_count}</span>
          <span style="font-size: 13px; font-weight: 500; color: {GREEN};">Select all</span>
        </div>"""


def games_list(selected_idx=None, limit=None, compact=False, expanded_html=None, favourites=None):
    """The list. `expanded_html` is spliced in directly under the selected row.

    `favourites` is a set of row indices, and passing it is what turns the star column on. Left
    out, no row gets a star, which keeps every board drawn before the composed set unchanged.
    """
    rows = GAMES if limit is None else GAMES[:limit]
    out = [list_header()]
    for i, (system, name, size, state) in enumerate(rows):
        last = (i == len(rows) - 1) and not expanded_html
        out.append(game_row(system, name, size, state, selected=(i == selected_idx),
                            last=last, compact=compact,
                            fav=None if favourites is None else (i in favourites)))
        if expanded_html and i == selected_idx:
            out.append(expanded_html)
    return f"""      <div style="background: {WHITE}; border-radius: 6px; padding: 2px 16px; display: flex; flex-direction: column;">
{chr(10).join(out)}
      </div>"""


# --- the coverflow ----------------------------------------------------------------------
# The 3D carousel from Roms.dc.html. The owner: "the carousel is nice". `scale` shrinks the
# whole thing without re-picking any of its geometry.

COVERS = [
    ("Alwa's Awakening", "#d3d3d6", "#5c5c5c", -336, 48, 0.66, 1),
    ("Back to the Future", "#c6cbc4", "#4a4a4a", -258, 48, 0.74, 2),
    ("Aladdin", "#b9bcc4", "#3a3a3a", -162, 48, 0.84, 3),
    (None, "#8f9aa6", "#ffffff", 0, 0, 1.00, 5),
    ("Alex Kidd", "#b9bcc4", "#3a3a3a", 162, -48, 0.84, 3),
    ("Battletoads", "#c6cbc4", "#4a4a4a", 258, -48, 0.74, 2),
    ("Beyond Oasis", "#d3d3d6", "#5c5c5c", 336, -48, 0.66, 1),
]


def coverflow(scale=1.0, height=330):
    cards = []
    for label, tint, ink, dx, rot, sc, z in COVERS:
        w, h = round(168 * scale), round(218 * scale)
        tx = round(dx * scale)
        shadow = ("0 14px 34px rgba(0,0,0,0.28)" if z == 5 else
                  "0 8px 26px rgba(0,0,0,0.2)" if z == 3 else "0 6px 22px rgba(0,0,0,0.16)")
        rotate = f" rotateY({rot}deg)" if rot else ""
        if label is None:
            body = f'<span style="font-size: {round(15 * scale)}px; font-weight: 700; color: {ink}; line-height: 1.2;">Aerobiz<br>Supersonic</span>'
            flex = "flex-direction: column; justify-content: flex-end;"
        else:
            body = f'<span style="font-size: {round(12 * scale)}px; font-weight: 600; color: {ink};">{label}</span>'
            flex = "align-items: flex-end;"
        cards.append(
            f'<div style="position: absolute; top: 50%; left: 50%; width: {w}px; height: {h}px; '
            f'border-radius: 4px; background: {tint}; box-shadow: {shadow}; '
            f'transform: translate(-50%, -50%) translateX({tx}px){rotate} scale({sc}); '
            f'z-index: {z}; display: flex; {flex} padding: {round(14 * scale)}px;">{body}</div>'
        )
    return f"""      <div style="position: relative; height: {height}px; perspective: {round(900 * scale)}px; overflow: hidden;">
        {''.join(cards)}
      </div>"""


def coverflow_scrubber():
    return f"""      <div style="display: flex; align-items: center; gap: 14px; padding: 0 60px;">
        <div style="flex-grow: 1; height: 6px; border-radius: 3px; background: {GREY}; position: relative;">
          <span style="position: absolute; left: 4%; top: -4px; width: 46px; height: 14px; border-radius: 7px; background: {DIM};"></span>
        </div>
      </div>"""


def coverflow_caption(center=True):
    align = "center" if center else "left"
    just = "center" if center else "flex-start"
    return f"""      <div style="display: flex; flex-direction: column; gap: 4px; padding-top: 4px;">
        <span style="font-size: 24px; font-weight: 600; letter-spacing: -0.015em; text-align: {align};">Aerobiz Supersonic</span>
        <div style="display: flex; align-items: center; gap: 12px; justify-content: {just};">
          <span style="font-size: 14px; color: {SOFT};">Genesis / Mega Drive</span>
          <span style="font-size: 14px; color: {SOFT}; font-family: {MONO};">1 MB</span>
        </div>
      </div>"""


# --- the dock ---------------------------------------------------------------------------

def dock(options_open=False, options_label="Additional options", drawer_html=""):
    """Summary tab, meter strip, bar. The shipped arrangement from Roms.dc.html.

    `options_label=None` drops the disclosure entirely, for a board where the options do not
    live in the dock any more. That is a consequence worth drawing rather than hiding: a
    control that opens nothing is worse than no control.
    """
    chevron_up = '<path d="M15 12l-5-5-5 5"></path>'
    chevron_down = '<path d="M5 8l5 5 5-5"></path>'
    arrow = chevron_up if not options_open else chevron_down
    if options_label is None:
        disclosure = ""
    else:
        disclosure = f"""<span style="font-size: 13px; font-weight: 600; color: {INK};">{options_label}</span>
        <svg width="13" height="13" viewBox="0 0 20 20" fill="none" stroke="{INK}" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">{arrow}</svg>"""
    return f"""
  <div style="margin-top: auto; display: flex; flex-direction: column; flex: 0 0 auto; position: relative; z-index: 3;">
    <div style="position: absolute; left: 50%; top: 0; transform: translate(-50%, -100%); display: flex; align-items: center; gap: 7px; background: {WHITE}; border: 1px solid {BORDER}; border-bottom: none; border-radius: 7px 7px 0 0; padding: 7px 20px 8px; font-size: 12px; font-weight: 600; color: {SOFT}; box-shadow: 0 -3px 10px rgba(0,0,0,0.05); z-index: 4;">Summary<svg width="12" height="12" viewBox="0 0 20 20" fill="none" stroke="{SOFT}" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12l5-5 5 5"></path></svg></div>
{drawer_html}
    <div style="display: flex; height: 3px; background: {BORDER};">
      <div style="width: 7%; background: {GREEN};"></div>
      <div style="width: 5%; background: {DIM};"></div>
    </div>
    <div style="background: {WHITE}; padding: 0 40px; min-height: 72px; box-sizing: border-box; display: flex; align-items: center; flex: 0 0 auto;">
      <span style="font-size: 13px; color: {SOFT};">3.54 MB of 50 MB projected</span>
      <span style="font-size: 13px; color: {GREEN}; font-weight: 500; margin-left: 14px;">+0.12 MB net change</span>
      <div style="display: flex; align-items: center; gap: 18px; margin-left: auto;">
        {disclosure}
        <div style="background: {RED}; color: {WHITE}; font-size: 14px; font-weight: 600; padding: 9px 22px; border-radius: 5px; box-shadow: inset 0 -2px 0 {RED_B};">Sync Library</div>
      </div>
    </div>
  </div>
"""


# --- additional options content ---------------------------------------------------------
# Lifted from RomsOptions.dc.html. Cover art, Saves and Cheats, each at full strength.
# Cheats is a device feature equal to saves, so it keeps its presets AND its manual entry.

def field(label, value, width=148):
    return f"""<div style="display: flex; align-items: center; justify-content: space-between; gap: 12px;">
            <span style="font-size: 13px; color: {SOFT};">{label}</span>
            <span style="display: flex; align-items: center; gap: 10px; height: 32px; padding: 0 10px; background: {WHITE}; border: 1px solid #dcdcdc; border-radius: 2px; font-size: 13px; min-width: {width}px; justify-content: space-between;"><span>{value}</span><svg width="12" height="12" viewBox="0 0 20 20" fill="none" stroke="{SOFT}" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M5 8l5 5 5-5"></path></svg></span>
          </div>"""


def checkrow(label, on):
    """BOTH BOXES ARE THE SAME SIZE, which they were not.

    The checked box had no border and the unchecked one a 1px border, so under the default
    content-box sizing they measured 15 and 17 across and every checked label sat 2px left of
    every unchecked one. The same bug as the selected row's inset, two pixels instead of ten and
    in a list where checked and unchecked rows alternate, so it shows as a ragged left edge on
    the labels rather than one row being out of true.

    Fixed by giving the checked box a border of its own colour: same outer size, same visual
    weight, no change to how either state reads. Inherited from RomsOptions.dc.html, which has
    it too.
    """
    if on:
        box = f'<span style="width: 15px; height: 15px; border-radius: 2px; background: {GREEN}; border: 1px solid {GREEN}; display: flex; align-items: center; justify-content: center; flex-shrink: 0;"><svg width="9" height="9" viewBox="0 0 20 20" fill="none" stroke="{WHITE}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M4.5 10.5l3.5 3.5 7.5-8"></path></svg></span>'
        color = INK
    else:
        box = f'<span style="width: 15px; height: 15px; border-radius: 2px; border: 1px solid {DIM}; background: {WHITE}; flex-shrink: 0;"></span>'
        color = SOFT
    return f'<div style="display: flex; align-items: center; gap: 10px;">{box}<span style="font-size: 13px; color: {color};">{label}</span></div>'


ICON_DOWNLOAD = f'<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="{SOFT}" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>'
ICON_GEAR = f'<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="{SOFT}" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"></circle><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"></path></svg>'


def section_head(title, actions=""):
    return f"""<div style="display: flex; align-items: center; justify-content: space-between;">
            <div style="{CAPS}">{title}</div>
            <div style="display: flex; gap: 12px;">{actions}</div>
          </div>"""


def cover_section(preview_h=152, gap=14):
    return f"""<div style="display: flex; flex-direction: column; gap: {gap}px; min-width: 0;">
          {section_head("Cover art", ICON_DOWNLOAD + ICON_GEAR)}
          {field("Source", "ScreenScraper")}
          {field("Variant", "Box art")}
          <div style="height: {preview_h}px; background: {GREY}; border-radius: 4px; display: flex; align-items: center; justify-content: center;"><span style="font-size: 12px; color: {SOFT};">Preview</span></div>
          <div style="display: flex; align-items: center; gap: 16px;">
            <span style="background: {GREEN}; color: {WHITE}; font-size: 13px; font-weight: 600; padding: 7px 16px; border-radius: 4px;">Apply</span>
            <span style="font-size: 13px; color: {SOFT};">Drop an image to override</span>
          </div>
          <div style="display: flex; flex-direction: column; gap: 5px; margin-top: auto; padding-top: 8px;">
            <div style="display: flex; justify-content: space-between;">
              <span style="font-size: 11px; color: {SOFT};">Requests today</span>
              <span style="font-size: 11px; color: {SOFT}; font-family: {MONO};">842 / 20000</span>
            </div>
            <div style="height: 3px; background: {BORDER}; border-radius: 2px; overflow: hidden;"><div style="height: 100%; width: 4%; background: {INK};"></div></div>
          </div>
        </div>"""


def saves_section(preview_h=168, gap=14, divider=True):
    edge = f"border-left: 1px solid {HAIR}; padding-left: 28px;" if divider else ""
    return f"""<div style="display: flex; flex-direction: column; gap: {gap}px; min-width: 0; {edge}">
          <div style="{CAPS}">Saves</div>
          <div style="display: flex; gap: 6px;">
            <span style="font-size: 12px; font-weight: 600; padding: 5px 11px; border-radius: 3px; background: {INK}; color: {WHITE};">SRAM</span>
            <span style="font-size: 12px; font-weight: 500; padding: 5px 11px; border-radius: 3px; color: {SOFT};">Slot 0</span>
            <span style="font-size: 12px; font-weight: 500; padding: 5px 11px; border-radius: 3px; color: {SOFT};">Slot 1</span>
          </div>
          <div style="display: flex; align-items: center; gap: 10px;">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="{DIM}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"></polyline></svg>
            <div style="flex-grow: 1; height: {preview_h}px; background: {GREY}; border-radius: 4px; display: flex; align-items: center; justify-content: center;"><span style="font-size: 12px; color: {SOFT};">Save preview</span></div>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="{SOFT}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"></polyline></svg>
          </div>
          <div style="display: flex; align-items: center; justify-content: space-between; gap: 12px;">
            <span style="font-size: 13px; color: {SOFT};">Written</span>
            <span style="font-size: 13px; font-weight: 600;">2026-08-29 21:14</span>
          </div>
          <span style="font-size: 13px; font-weight: 600; color: {GREEN};">Download save</span>
        </div>"""


def cheats_section(gap=14, divider=True):
    return f"""<div style="display: flex; flex-direction: column; gap: {gap}px; min-width: 0; {f'border-left: 1px solid {HAIR}; padding-left: 28px;' if divider else ''}">
          <div style="{CAPS}">Cheats</div>
          {field("Detected game", "Aerobiz Supersonic")}
          <div style="display: flex; flex-direction: column; gap: 9px; padding-top: 2px;">
            <span style="font-size: 11px; font-weight: 700; letter-spacing: 0.09em; color: {SOFT}; text-transform: uppercase;">Presets</span>
            {checkrow("Infinite funds", True)}
            {checkrow("All aircraft unlocked", True)}
            {checkrow("Fast turn processing", False)}
          </div>
          <div style="display: flex; flex-direction: column; gap: 9px; padding-top: 6px;">
            <span style="font-size: 11px; font-weight: 700; letter-spacing: 0.09em; color: {SOFT}; text-transform: uppercase;">Manual entry</span>
            <div style="display: flex; gap: 8px;">
              <span style="flex: 1; height: 32px; display: flex; align-items: center; padding: 0 10px; background: {WHITE}; border: 1px solid #dcdcdc; border-radius: 2px; font-size: 13px; color: {DIM}; font-family: {MONO};">Code</span>
              <span style="flex: 1; height: 32px; display: flex; align-items: center; padding: 0 10px; background: {WHITE}; border: 1px solid #dcdcdc; border-radius: 2px; font-size: 13px; color: {DIM};">Description</span>
              <span style="height: 32px; display: flex; align-items: center; padding: 0 14px; font-size: 13px; font-weight: 600; color: {GREEN};">Add</span>
            </div>
          </div>
          <div style="display: flex; justify-content: space-between; align-items: baseline; padding-top: 10px; border-top: 1px solid {BORDER}; margin-top: auto;">
            <span style="font-size: 13px; color: {SOFT};">Configured</span>
            <span style="font-size: 13px; font-weight: 600;">2 codes</span>
          </div>
        </div>"""


def options_title(name="Aerobiz Supersonic"):
    """The drawer's own heading. Two facts, two elements: never an em-dash between them."""
    return f"""<div style="display: flex; align-items: baseline; gap: 14px;">
          <div style="{CAPS}">Additional options</div>
          <div style="font-size: 13px; font-weight: 600; color: {INK};">{name}</div>
        </div>"""


def write(name, note, inner, min_height=1000, exact_height=None):
    path = os.path.join(os.path.dirname(os.path.abspath(__file__)), name)
    with open(path, "w") as f:
        f.write(head(note, min_height, exact_height) + chrome() + inner + tail())
    print("wrote", name)
