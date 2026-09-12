#!/usr/bin/env python3
"""Shared chrome for the guided-v2 Direction A boards.

A generator rather than three hand-copied files, for the reason library-v3's shell.py gives:
"hand-copying them is how a board set drifts". These boards differ in exactly one thing, HOW
THE THREE OPTIONS ARE LAID OUT, so everything else has to be byte-identical or the comparison
is worthless.

Chrome, palette and metrics are LIFTED from `docs/design/mockups/GuidedLayout.dc.html` and
`Guided.dc.html`, not re-picked. Copy is lifted from the LIVE string table
(`apps/web/src/lib/i18n/strings/wizard.ts`), which has moved on from the boards: the title is
"What should this device run?", and the three captions the boards still draw
("Pick which one runs at power-on", "and leaves more space for games", "Erases Retro-Go") were
struck and are recorded as struck in docs/UI_VOICE.md. They are not reproduced here.

Colours are the real tokens from src/styles/tokens.css, light theme.
"""

# --- tokens.css, light theme -------------------------------------------------------------
INK = "#1b1b1b"        # --ink
SOFT = "#5c5c5c"       # --ink-soft
MUTE = "#6e6e6e"       # --ink-mute
DIM = "#9a9a9a"        # --ink-dim
FAINT = "#c8c8c8"      # --ink-faint
SURFACE = "#ffffff"    # --surface
HAIR = "#d8d8d8"       # --hairline
PAGE = "#f4f4f4"       # --bg
GREEN = "#3e9e4e"      # --zelda-green

FONT = "'Hanken Grotesk', ui-sans-serif, system-ui, sans-serif"

# Intrinsic aspect ratios, measured from the asset files. The Dual Boot marks row is
# 219.6px wide at the live sizes (gnw 48px tall, rgo 22px tall, two 10px gaps, a 22px plus),
# which is the number the live `.marks` comment in Wizard.svelte cites. Any layout that puts
# that row in a fixed leading well has to hold 219.6px or shrink the marks.
GNW_ASPECT = 149.36205 / 119.0586   # 1.2545
RGO_ASPECT = 64 / 12                # 5.3333

COLUMN = 470   # the width Guided.dc.html's spine uses, and GuidedLayout.dc.html with it


def gnw(h):
    return (f'<img src="logo-gnw-badge.svg" alt="Game &amp; Watch" '
            f'style="height: {h}px; width: auto; display: block; flex-shrink: 0;">')


def rgo(h):
    return (f'<img src="logo-rgo.png" alt="Retro-Go" '
            f'style="height: {h}px; width: auto; display: block; flex-shrink: 0;">')


def plus(size):
    return (f'<svg width="{size}" height="{size}" viewBox="0 0 11 11" fill="none" '
            f'style="flex-shrink: 0;" aria-hidden="true">'
            f'<path d="M5.5 0.5 V10.5 M0.5 5.5 H10.5" stroke="{FAINT}" stroke-width="1.7"/>'
            f'</svg>')


def marks(which, gnw_h=48, rgo_h=22, gap=10, justify="flex-start"):
    """The three mark rows, at whatever scale the board asks for.

    `which` is one of "dual", "rgo", "gnw" and matches the live component's three cases:
    Dual Boot draws both logos with a plus between them, Only Retro-Go draws the Retro-Go
    wordmark alone, Return to Stock draws the Game & Watch badge alone.
    """
    box = (f'display: flex; align-items: center; justify-content: {justify}; '
           f'gap: {gap}px;')
    if which == "dual":
        inner = gnw(gnw_h) + plus(round(rgo_h)) + rgo(rgo_h)
    elif which == "rgo":
        inner = rgo(rgo_h)
    else:
        inner = gnw(gnw_h)
    return f'<span style="{box}">{inner}</span>'


# The three options, in the order the live component renders them.
OPTIONS = [
    ("dual", "Dual Boot"),
    ("rgo", "Only Retro-Go"),
    ("gnw", "Return to Stock"),
]

TITLE = "What should this device run?"
RUBRIC = "Retro-Go is custom firmware that plays games from other consoles on this device."
ESCAPE_PROMPT = "Something else?"
ESCAPE_ACTION = "Use the Advanced tab"


def head(note, height=920):
    """A FIXED height with overflow hidden.

    That is the honest model of the app page: a fixed viewport where `.tabpane` is the only
    scroll container (CLAUDE.md). A board that grows to fit its content cannot show whether a
    design survives 920px.
    """
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

<!-- {note} -->
<div style="width: 1440px; height: {height}px; overflow: hidden; background: {PAGE}; color: {INK}; font-family: {FONT}; font-size: 16px; line-height: 1.5; display: flex; flex-direction: column;">
"""


TAIL = """</div>
</x-dc>
</body>
</html>
"""


def chrome():
    """Header band, gold strip and nav band, lifted verbatim from GuidedLayout.dc.html.

    Held constant across all three boards, including the fixture: a patched Zelda in recovery
    mode with Retro-Go not yet installed, which is the device state that makes all three
    options available (the live component hides Return to Stock when the device still has
    unpatched stock firmware).
    """
    return f"""  <div style="display: flex; flex-direction: column;">
    <div style="height: 56px; background: {SURFACE}; display: flex; align-items: center; justify-content: space-between; padding: 0 40px;">
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

        <span style="width: 1px; height: 18px; background: {HAIR}; margin: 0 3px;"></span>

        <div style="display: flex; align-items: center; gap: 8px;">
          <img src="logo-gnw-badge.svg" alt="Game &amp; Watch" style="height: 27px; width: auto; display: block; flex-shrink: 0;">
          <span style="font-size: 14px; font-weight: 600;">Zelda (Patched)</span>
        </div>

        <span style="width: 1px; height: 18px; background: {HAIR}; margin: 0 3px;"></span>

        <div style="display: flex; align-items: center; gap: 8px; opacity: 0.42;">
          <img src="logo-rgo.png" alt="Retro-Go" style="height: 14px; width: auto; display: block; flex-shrink: 0;">
          <span style="font-size: 14px; font-weight: 600;">Not installed</span>
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

  <div style="padding: 0 40px; background: {SURFACE}; border-bottom: 1px solid {HAIR}; display: flex; align-items: stretch; justify-content: space-between;">
    <div style="display: flex; align-items: stretch; gap: 34px;">
      <div style="display: flex; align-items: center; height: 46px; padding: 0 2px; font-size: 14px; font-weight: 600; letter-spacing: 0.02em; color: {MUTE}; box-shadow: inset 0 -3px 0 transparent;">Overview</div>
      <div style="display: flex; align-items: center; height: 46px; padding: 0 2px; font-size: 14px; font-weight: 700; letter-spacing: 0.02em; color: {INK}; box-shadow: inset 0 -3px 0 {GREEN};">Firmware</div>
      <div style="display: flex; align-items: center; height: 46px; padding: 0 2px; font-size: 14px; font-weight: 600; letter-spacing: 0.02em; color: {MUTE}; box-shadow: inset 0 -3px 0 transparent;">Sources</div>
      <div style="display: flex; align-items: center; height: 46px; padding: 0 2px; font-size: 14px; font-weight: 600; letter-spacing: 0.02em; color: {MUTE}; box-shadow: inset 0 -3px 0 transparent;">Library</div>
    </div>
    <div style="display: flex; align-items: center; gap: 18px;">
      <span style="font-size: 13px; font-weight: 600; box-shadow: inset 0 -2px 0 {GREEN}; padding: 4px 0;">Guided</span>
      <span style="font-size: 13px; font-weight: 500; color: {SOFT};">Advanced</span>
    </div>
  </div>
"""


def pips():
    """Step 1 of 2, the same two-pip row every Guided board draws."""
    return (f'<div style="display: flex; align-items: center; gap: 6px;">'
            f'<span style="width: 22px; height: 6px; border-radius: 3px; background: {GREEN};"></span>'
            f'<span style="width: 6px; height: 6px; border-radius: 3px; background: {HAIR};"></span>'
            f'</div>')


def title_block(width):
    """Title and rubric, left-aligned to the column edge. Both boards' headers are identical;
    only what sits under them changes."""
    return (
        f'{pips()}'
        f'<div style="height: 12px;"></div>'
        f'<div style="font-size: 28px; font-weight: 600; letter-spacing: -0.02em; line-height: 1.15;">{TITLE}</div>'
        f'<div style="height: 8px;"></div>'
        f'<div style="font-size: 14px; color: {SOFT}; line-height: 1.45; max-width: {width}px;">{RUBRIC}</div>'
    )


def escape():
    return (f'<span style="font-size: 13px; color: {DIM};">{ESCAPE_PROMPT} '
            f'<span style="font-weight: 600; color: {MUTE};">{ESCAPE_ACTION}</span></span>')


def body(inner, width):
    """The centred column, the same flex:1 centring every Guided board uses."""
    return (f'  <div style="flex: 1; display: flex; align-items: center; justify-content: center; padding: 0 40px;">'
            f'<div style="width: {width}px;">{inner}</div></div>\n')
