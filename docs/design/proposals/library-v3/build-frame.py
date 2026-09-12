#!/usr/bin/env python3
"""Chrome, rows and dock for the three FRAME boards. Run: python3 boards-frame.py

The frame is everything around the games list: how consoles are filtered, what the summary
becomes when it is given room, and whether either survives a library ten times the size of
the fixture. A generator rather than three hand-copied files, for the reason the overview-v2
set gives: hand-copying is how a board set drifts.

Palette and metrics are lifted from overview-v2/build-library.py, not re-picked. The fixture
is lifted from mockups/Roms.dc.html, so these boards can be read side by side with the
approved one.
"""
import os

INK, SOFT, MUTE = "#1b1b1b", "#5c5c5c", "#6e6e6e"
WHITE, BORDER, HAIR, PAGE = "#ffffff", "#d8d8d8", "#ededed", "#f4f4f4"
GREEN, GREEN_B, AMBER, DANGER = "#3e9e4e", "#35873f", "#b07d1a", "#8a241b"
BLUE, BLUE_B = "#0d6efd", "#0a58ca"
MONO = "ui-monospace, Menlo, monospace"

CAPS = f"font-size: 11px; font-weight: 700; letter-spacing: 0.11em; color: {SOFT}; text-transform: uppercase;"
CARD = f"background: {WHITE}; border: 1px solid {BORDER}; border-radius: 6px;"

# The fixture, lifted from mockups/Roms.dc.html so the boards read against the approved one.
CONSOLES = [
    ("All", "137"),
    ("NES", "63"),
    ("Genesis / Mega Drive", "22"),
    ("GW", "25"),
    ("Master System", "9"),
    ("PC Engine", "7"),
    ("Game Gear", "6"),
    ("Homebrew", "3"),
]

GAMES = [
    ("Aerobiz Supersonic", "MD", "1 MB", ("installed", "installed"), True),
    ("Aladdin", "MD", "1 MB", ("install", "pending"), True),
    ("Alex Kidd in Miracle World", "SMS", "128 KB", ("installed", "installed"), True),
    ("Alfonzo's Arctic Adventure", "NES", "256 KB", ("not installed", "idle"), False),
    ("Alwa's Awakening", "NES", "512 KB", ("installed", "installed"), True),
    ("Back to the Future", "GW", "64 KB", ("not installed", "idle"), False),
    ("Ball", "GW", "48 KB", ("installed", "installed"), True),
    ("Battle Kid: Fortress of Peril", "NES", "512 KB", ("not installed", "idle"), False),
    ("Battletoads (USA)", "NES", "256 KB", ("installed", "installed"), True),
    ("Super Mario World", "HB", "3 MB", ("prepare", "caution"), False),
    ("Beyond Oasis", "MD", "2 MB", ("installed", "installed"), True),
    ("Blow'em Out", "NES", "128 KB", ("not installed", "idle"), False),
]


def head(note, min_height=1120):
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


def chrome():
    """Header band, gold lip, tab strip. Library is the active tab."""
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


def chip_strip(active="All", consoles=None):
    """The console filter as it ships: a horizontal single-select strip with counts."""
    out = []
    for label, count in (consoles or CONSOLES):
        if label == active:
            out.append(f'<span style="font-size: 13px; font-weight: 600; background: {INK}; color: {WHITE}; border-radius: 3px; padding: 5px 11px; white-space: nowrap;">{label} {count}</span>')
        else:
            out.append(f'<span style="font-size: 13px; color: {SOFT}; padding: 5px 11px; white-space: nowrap;">{label} {count}</span>')
    return f"""      <div style="display: flex; align-items: center; gap: 6px; flex-wrap: wrap;">
        {''.join(out)}
      </div>"""


def console_rail(active="All", consoles=None, extra_group=None):
    """The console filter as a vertical rail, in OverviewRail's shape.

    244px, full-bleed to the page's own edge, group heading in caps, active item at 600 with
    an inset 2px green edge. Not a third rail idiom: the same one Firmware and Overview use.
    """
    groups = [("Library", consoles or CONSOLES)]
    if extra_group:
        groups.append(extra_group)
    out = [f'    <div style="border-right: 1px solid {BORDER}; background: {WHITE}; padding: 28px 16px 40px 32px; display: flex; flex-direction: column; gap: 24px;">']
    for heading, items in groups:
        out.append('      <div style="display: flex; flex-direction: column; gap: 2px;">')
        out.append(f'        <div style="{CAPS} padding-bottom: 8px;">{heading}</div>')
        for label, count in items:
            cnt = f'<span style="font-size: 13px; color: {SOFT}; font-variant-numeric: tabular-nums;">{count}</span>' if count else ''
            if label == active:
                out.append(f'        <div style="font-size: 14px; font-weight: 600; padding: 7px 0 7px 12px; margin-left: -12px; box-shadow: inset 2px 0 0 {GREEN}; display: flex; align-items: center; justify-content: space-between; gap: 10px;"><span>{label}</span>{cnt}</div>')
            else:
                out.append(f'        <div style="font-size: 14px; padding: 7px 0; display: flex; align-items: center; justify-content: space-between; gap: 10px;"><span style="color: {INK};">{label}</span>{cnt}</div>')
        out.append('      </div>')
    out.append('    </div>')
    return "\n".join(out)


def chip(text, kind):
    """Row action chip. `kind` picks paint only; the words are the shipped ones."""
    paint = {
        "installed": f"color: {WHITE}; background: {GREEN}; border: 1px solid {GREEN_B};",
        "pending": f"color: {WHITE}; background: {BLUE}; border: 1px solid {BLUE_B};",
        "idle": f"color: {SOFT}; background: {WHITE}; border: 1px solid {BORDER};",
        "caution": f"color: {AMBER}; background: {WHITE}; border: 1px solid {AMBER};",
        "danger": f"color: {DANGER}; background: {WHITE}; border: 1px solid {DANGER};",
    }[kind]
    return f'<span style="font-size: 12px; font-weight: 600; border-radius: 4px; padding: 3px 10px; white-space: nowrap; {paint}">{text}</span>'


def sysbadge(text):
    return f'<span style="font-size: 11px; font-weight: 700; letter-spacing: 0.04em; color: {SOFT}; background: {PAGE}; border: 1px solid {BORDER}; border-radius: 3px; padding: 2px 7px; white-space: nowrap; flex-shrink: 0;">{text}</span>'


def check(on):
    if on:
        return f'<span style="width: 16px; height: 16px; border-radius: 3px; background: {GREEN}; border: 1px solid {GREEN_B}; flex-shrink: 0; display: flex; align-items: center; justify-content: center;"><svg viewBox="0 0 12 12" width="9" height="9" fill="none" stroke="{WHITE}" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 6.3 L4.7 9 L10 3.2"></path></svg></span>'
    return f'<span style="width: 16px; height: 16px; border-radius: 3px; background: {WHITE}; border: 1px solid {BORDER}; flex-shrink: 0;"></span>'


def game_row(name, system, size, state, selected, last=False, dense=False, highlight=False):
    bb = "" if last else f" border-bottom: 1px solid {HAIR};"
    pad = "7px 0" if dense else "11px 0"
    fs = "13px" if dense else "14px"
    bg = f" background: {PAGE};" if highlight else ""
    return f"""              <div style="display: flex; align-items: center; gap: 12px; padding: {pad};{bb}{bg}">
                {check(selected)}
                {sysbadge(system)}
                <span style="font-size: {fs}; flex-grow: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">{name}</span>
                <span style="font-size: 12px; color: {SOFT}; font-family: {MONO}; white-space: nowrap; font-variant-numeric: tabular-nums;">{size}</span>
                {chip(state[0], state[1])}
              </div>"""


def rows(games=None, dense=False, highlight_index=None):
    games = games or GAMES
    out = []
    for i, (name, system, size, state, sel) in enumerate(games):
        out.append(game_row(name, system, size, state, sel,
                            last=(i == len(games) - 1), dense=dense,
                            highlight=(i == highlight_index)))
    return "\n".join(out)


def list_header(selected, total_label="Select all"):
    return f"""          <div style="display: flex; align-items: center; justify-content: space-between; padding-bottom: 10px; border-bottom: 1px solid {BORDER};">
            <span style="{CAPS}">{selected} selected</span>
            <span style="font-size: 13px; font-weight: 600; color: {GREEN};">{total_label}</span>
          </div>"""


def coverflow(width, height, centre, left, right, tile_w=132, tile_h=172):
    """Coverflow, sized to its column. `centre` is the selected title.

    Kept as the shipped shape: a rotated stack, the selected cover upright and full size, the
    neighbours turned away. The approved board draws it at 168x218 in a 700px column; these
    numbers are that shape scaled to the column each board gives it.
    """
    half = width / 2
    tiles = []
    steps = [
        (-2, 0.60, 0.34, "#d3d3d6", SOFT),
        (-1, 0.78, 0.55, "#c6cbc4", "#4a4a4a"),
        (0, 1.0, 1.0, "#8f9aa6", WHITE),
        (1, 0.78, 0.55, "#c6cbc4", "#4a4a4a"),
        (2, 0.60, 0.34, "#d3d3d6", SOFT),
    ]
    names = [left[1] if len(left) > 1 else "", left[0], centre, right[0],
             right[1] if len(right) > 1 else ""]
    for (pos, scale, opacity, tint, fg), name in zip(steps, names):
        if not name:
            continue
        offset = pos * (tile_w * 0.62)
        if abs(offset) + (tile_w * scale) / 2 > half:
            offset = (half - (tile_w * scale) / 2 - 4) * (1 if pos > 0 else -1)
        rot = 0 if pos == 0 else (46 if pos < 0 else -46)
        z = 5 - abs(pos)
        shadow = "0 14px 34px rgba(0,0,0,0.28)" if pos == 0 else "0 6px 22px rgba(0,0,0,0.16)"
        fs = "14px" if pos == 0 else "11px"
        weight = "700" if pos == 0 else "600"
        tiles.append(
            f'<div style="position: absolute; top: 50%; left: 50%; width: {tile_w}px; height: {tile_h}px; border-radius: 4px; background: {tint}; box-shadow: {shadow}; '
            f'transform: translate(-50%, -50%) translateX({offset:.0f}px) rotateY({rot}deg) scale({scale}); opacity: {opacity}; z-index: {z}; '
            f'display: flex; align-items: flex-end; padding: 10px; box-sizing: border-box;">'
            f'<span style="font-size: {fs}; font-weight: {weight}; color: {fg}; line-height: 1.2;">{name}</span></div>'
        )
    return f"""            <div style="position: relative; height: {height}px; perspective: 900px; overflow: hidden;">
              {''.join(tiles)}
            </div>"""


def opt_section(heading, body, action=None):
    """One additional-options section. Stacking another is appending one of these."""
    act = f'<span style="font-size: 12px; font-weight: 600; color: {SOFT}; background: {WHITE}; border: 1px solid {BORDER}; border-radius: 4px; padding: 3px 10px;">{action}</span>' if action else ""
    return f"""              <div style="display: flex; flex-direction: column; gap: 9px;">
                <div style="display: flex; align-items: center; justify-content: space-between;">
                  <span style="{CAPS}">{heading}</span>
                  {act}
                </div>
{body}
              </div>"""


def field(label, value):
    return f"""                <div style="display: flex; align-items: center; justify-content: space-between; gap: 12px;">
                  <span style="font-size: 13px; color: {SOFT};">{label}</span>
                  <span style="display: flex; align-items: center; gap: 10px; height: 30px; padding: 0 10px; background: {WHITE}; border: 1px solid {BORDER}; border-radius: 3px; font-size: 13px; min-width: 150px; justify-content: space-between;"><span>{value}</span><svg width="11" height="11" viewBox="0 0 20 20" fill="none" stroke="{SOFT}" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M5 8l5 5 5-5"></path></svg></span>
                </div>"""


def kvline(label, value, mono=False):
    m = f"font-family: {MONO};" if mono else ""
    return f"""                <div style="display: flex; align-items: center; justify-content: space-between; gap: 12px;">
                  <span style="font-size: 13px; color: {SOFT};">{label}</span>
                  <span style="font-size: 13px; font-weight: 600; {m}">{value}</span>
                </div>"""


def cheat_line(label, on):
    box = (f'<span style="width: 14px; height: 14px; border-radius: 3px; background: {GREEN}; border: 1px solid {GREEN_B}; flex-shrink: 0; display: flex; align-items: center; justify-content: center;"><svg viewBox="0 0 12 12" width="8" height="8" fill="none" stroke="{WHITE}" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M2 6.3 L4.7 9 L10 3.2"></path></svg></span>'
           if on else
           f'<span style="width: 14px; height: 14px; border-radius: 3px; background: {WHITE}; border: 1px solid {BORDER}; flex-shrink: 0;"></span>')
    color = INK if on else SOFT
    return f"""                <div style="display: flex; align-items: center; gap: 10px;">
                  {box}<span style="font-size: 13px; color: {color};">{label}</span>
                </div>"""


def options_stack(title, filename):
    """Cover art, Saves, Cheats for the selected game. Cheats is a peer, not a checkbox."""
    cover = f"""                <div style="display: flex; flex-direction: column; gap: 9px;">
{field("Source", "Scraper")}
{field("Variant", "Box art")}
                  <div style="height: 96px; background: {PAGE}; border: 1px solid {BORDER}; border-radius: 4px; display: flex; align-items: center; justify-content: center;">
                    <span style="font-size: 12px; color: {SOFT};">Preview</span>
                  </div>
                </div>"""
    saves = f"""                <div style="display: flex; flex-direction: column; gap: 9px;">
                  <div style="display: flex; gap: 6px;">
                    <span style="font-size: 12px; font-weight: 600; padding: 4px 10px; border-radius: 3px; background: {INK}; color: {WHITE};">SRAM</span>
                    <span style="font-size: 12px; font-weight: 500; padding: 4px 10px; border-radius: 3px; color: {SOFT};">Slot 1</span>
                    <span style="font-size: 12px; font-weight: 500; padding: 4px 10px; border-radius: 3px; color: {SOFT};">Slot 2</span>
                  </div>
{kvline("Written", "2026-08-29 21:14")}
                </div>"""
    cheats = f"""                <div style="display: flex; flex-direction: column; gap: 8px;">
{cheat_line("Infinite funds", True)}
{cheat_line("All aircraft unlocked", True)}
{cheat_line("Fast turn processing", False)}
{kvline("Configured", "2 codes")}
                </div>"""
    return f"""            <div style="display: flex; flex-direction: column; gap: 6px;">
              <span style="font-size: 18px; font-weight: 600; letter-spacing: -0.01em;">{title}</span>
              <span style="font-size: 12px; color: {SOFT}; font-family: {MONO};">{filename}</span>
            </div>
{opt_section("Cover art", cover, action="Apply")}
{opt_section("Saves", saves, action="Download save")}
{opt_section("Cheats", cheats, action="Add")}"""


def srow(label, after, change, last=False, total=False, warn=False):
    bb = "" if last else f" border-bottom: 1px solid {HAIR};"
    top = f" border-top: 1px solid {BORDER};" if total else ""
    weight = "600" if total else "400"
    ch = f'<span style="font-size: 13px; color: {DANGER if warn else SOFT}; text-align: right; font-family: {MONO}; font-variant-numeric: tabular-nums;">{change}</span>'
    return f"""            <div style="display: grid; grid-template-columns: minmax(0, 1fr) 110px 110px; gap: 20px; align-items: baseline; padding: 9px 0;{bb}{top}">
              <span style="font-size: 13px; font-weight: {weight};">{label}</span>
              <span style="font-size: 13px; font-weight: {weight}; text-align: right; font-family: {MONO}; font-variant-numeric: tabular-nums;">{after}</span>
              {ch}
            </div>"""


def meter(inst, pend, over=False):
    fill = DANGER if over else GREEN
    return f"""    <div style="height: 3px; background: {HAIR}; display: flex;" aria-hidden="true">
      <div style="width: {inst}%; background: {fill};"></div>
      <div style="width: {pend}%; background: {fill}; opacity: 0.45;"></div>
    </div>"""


def dock_bar(budget, net, over=False, options_label="Additional options"):
    opt = ""
    if options_label:
        opt = f"""<span style="font-size: 13px; font-weight: 600; color: {INK};">{options_label}</span>
        <svg width="13" height="13" viewBox="0 0 20 20" fill="none" stroke="{INK}" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M15 12l-5-5-5 5"></path></svg>"""
    netspan = f'<span style="font-size: 13px; font-weight: 600; color: {DANGER if over else GREEN}; margin-left: 14px;">{net}</span>' if net else ""
    return f"""    <div style="background: {WHITE}; border-top: 1px solid {BORDER}; min-height: 72px; box-sizing: border-box; padding: 0 40px; display: flex; align-items: center; justify-content: space-between; gap: 24px;">
      <div style="display: flex; align-items: baseline;">
        <span style="font-size: 13px; color: {SOFT};">{budget}</span>
        {netspan}
      </div>
      <div style="display: flex; align-items: center; gap: 18px;">
        {opt}
        <div style="font-size: 14px; font-weight: 600; color: {WHITE}; background: {GREEN}; border: 1px solid {GREEN_B}; border-radius: 5px; padding: 9px 22px;">Sync Library</div>
      </div>
    </div>"""


def summary_tab(open_state=False):
    arrow = "18 15 12 9 6 15" if open_state else "6 9 12 15 18 9"
    return f"""    <div style="display: flex; justify-content: center; padding: 0 40px;">
      <div style="background: {WHITE}; border: 1px solid {BORDER}; border-bottom: none; border-radius: 7px 7px 0 0; padding: 7px 20px 8px; display: flex; align-items: center; gap: 8px; font-size: 12px; font-weight: 600; color: {SOFT}; box-shadow: 0 -3px 10px rgba(0,0,0,0.05);">
        <span>Summary</span>
        <svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="{arrow}"></polyline></svg>
      </div>
    </div>"""


def tail():
    return """</div>
</x-dc>
</body>
</html>
"""


def write(name, note, inner, min_height=1120):
    path = os.path.join(os.path.dirname(os.path.abspath(__file__)), name)
    with open(path, "w") as f:
        f.write(head(note, min_height) + chrome() + inner + tail())
    print("wrote", name)
