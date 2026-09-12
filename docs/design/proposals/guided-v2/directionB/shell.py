#!/usr/bin/env python3
"""Shared shell for the guided-v2 Direction B boards: chrome, pips, rail, marks, choices.

A generator rather than hand-copied files, for the reason `library-v3/shell.py` gives:
"hand-copying them is how a board set drifts". These four boards differ in exactly one thing,
HOW THE PAGE IS COMPOSED, so the chrome and the fixtures have to be byte-identical or the
comparison is worthless.

Chrome is LIFTED from `docs/design/mockups/GuidedLayout.dc.html`, not re-picked: same header,
same gold lip, same nav band, same "Connected (Recovery Mode)" / "Zelda (Patched)" /
"Not installed" fixture. Only the pane below the nav band changes.

Palette is LIFTED from `apps/web/src/styles/tokens.css` rather than sampled from a board.

THE MARKS ARITHMETIC, which drives every composition here. The Dual Boot marks row is the
widest thing on the page and it is not close:

    logo-gnw-badge.svg  149.36 x 119.06  ->  at 48px tall, 60.2px wide
    plus glyph                               22.0px
    logo-rgo.png        64 x 12          ->  at 22px tall, 117.3px wide
    two 10px gaps                            20.0px
                                            ------
                                            219.5px

`Wizard.svelte`'s own comment puts it at 219.6px and says this is why the live cards stack the
marks ABOVE the label: a 304px card cannot hold that row beside a label. Every board below is a
different answer to that one number.
"""
import os

HERE = os.path.dirname(os.path.abspath(__file__))

# tokens.css
INK, SOFT, MUTE, DIM, FAINT = "#1b1b1b", "#5c5c5c", "#6e6e6e", "#9a9a9a", "#c8c8c8"
WHITE, HAIR, PAGE = "#ffffff", "#d8d8d8", "#f4f4f4"
GREEN = "#3e9e4e"

# Real strings, en, from apps/web/src/lib/i18n/strings/wizard.ts `chooser`.
TITLE = "What should this device run?"
RUBRIC = "Retro-Go is custom firmware that plays games from other consoles on this device."
DUAL, ONLY_RGO, STOCK = "Dual Boot", "Only Retro-Go", "Return to Stock"
ESCAPE_PROMPT, ESCAPE_ACTION = "Something else?", "Use the Advanced tab"

with open(os.path.join(HERE, "chrome.html"), encoding="utf-8") as fh:
    CHROME = fh.read().rstrip("\n")


def head(note, height=920):
    """Boards are drawn at a FIXED height with overflow hidden.

    That is the honest model of the app page: a fixed viewport where `.tabpane` is the only
    scroll container (CLAUDE.md). A board that quietly grows to fit its content cannot show
    whether a composition survives 920px, which is the whole question here.
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
<div style="width: 1440px; height: {height}px; overflow: hidden; background: {PAGE}; color: {INK}; font-family: 'Hanken Grotesk', ui-sans-serif, system-ui, sans-serif; font-size: 16px; line-height: 1.5; display: flex; flex-direction: column;">

{CHROME}
"""


TAIL = """</div>
</x-dc>
</body>
</html>
"""


def pane(inner, width):
    """The pane below the nav band: centred column, same as every Guided artboard."""
    return (
        '<div style="flex: 1; display: flex; align-items: center; justify-content: center; '
        'padding: 0 40px;">'
        f'<div style="width: {width}px;">{inner}</div>'
        "</div>\n"
    )


def pips(active=0):
    """Two pips, ABOVE the content on every Guided artboard. The active one is the long bar."""
    out = ['<div style="display: flex; align-items: center; gap: 6px;">']
    for i in (0, 1):
        if i == active:
            out.append(
                f'<span style="width: 22px; height: 6px; border-radius: 3px; background: {GREEN};"></span>'
            )
        else:
            out.append(
                f'<span style="width: 6px; height: 6px; border-radius: 3px; background: {HAIR};"></span>'
            )
    out.append("</div>")
    return "".join(out)


def gap(px):
    return f'<div style="height: {px}px;"></div>'


def title(text, size=21):
    """21px is the SPINE's active-step size (Guided.dc.html). The live chooser uses 28px, which
    is one of the things that makes the two pages read as different surfaces."""
    return (
        f'<div style="font-size: {size}px; font-weight: 600; letter-spacing: -0.015em; '
        f'line-height: 1.2;">{text}</div>'
    )


def rubric(text=RUBRIC):
    return (
        f'<div style="font-size: 14px; color: {SOFT}; line-height: 1.45;">{text}</div>'
    )


def escape_line():
    return (
        f'<span style="font-size: 14px; color: {DIM};">{ESCAPE_PROMPT} '
        f'<span style="font-weight: 600; color: {MUTE};">{ESCAPE_ACTION}</span></span>'
    )


# --- marks -------------------------------------------------------------------------------
# `scale` multiplies the live sizes (gnw 48px, rgo 22px). The live plus glyph is 22px square.

def marks(kind, scale=1.0, justify="center"):
    gnw = round(48 * scale, 1)
    rgo = round(22 * scale, 1)
    plus = round(22 * scale, 1)
    gapx = round(10 * scale, 1)
    g = (
        f'<img src="logo-gnw-badge.svg" alt="" style="height: {gnw}px; width: auto; '
        'display: block; flex-shrink: 0;">'
    )
    r = (
        f'<img src="logo-rgo.png" alt="" style="height: {rgo}px; width: auto; '
        'display: block; flex-shrink: 0;">'
    )
    p = (
        f'<svg width="{plus}" height="{plus}" viewBox="0 0 11 11" aria-hidden="true" '
        'style="display: block; flex: 0 0 auto;">'
        f'<path d="M5.5 0.5 V10.5 M0.5 5.5 H10.5" stroke="{FAINT}" stroke-width="1.7" '
        'fill="none"></path></svg>'
    )
    body = {"dual": g + p + r, "rgo": r, "stock": g}[kind]
    return (
        f'<span style="display: flex; align-items: center; justify-content: {justify}; '
        f'gap: {gapx}px;">{body}</span>'
    )


def label(text, size=16, align="start", width="auto"):
    return (
        f'<span style="font-size: {size}px; font-weight: 600; letter-spacing: -0.01em; '
        f'color: {INK}; text-align: {align}; width: {width};">{text}</span>'
    )


# --- the spine rail ----------------------------------------------------------------------
# Guided.dc.html: a 30px marker column, an 18px column gap, then the content column.

RAIL_W, RAIL_GAP = 30, 18


def rail_row(marker, content, connector=True, connector_fade=False):
    """One row of the spine grid: marker column on the left, content on the right."""
    if connector_fade:
        line = (
            f'<span style="width: 1px; flex-grow: 1; margin: 8px 0; background: '
            f'linear-gradient(180deg, {HAIR} 0%, rgba(216,216,216,0) 100%);"></span>'
        )
    elif connector:
        line = (
            f'<span style="width: 1px; flex-grow: 1; background: {HAIR}; margin: 8px 0;"></span>'
        )
    else:
        line = ""
    return (
        f'<div style="display: grid; grid-template-columns: {RAIL_W}px minmax(0, 1fr); '
        f'column-gap: {RAIL_GAP}px;">'
        '<div style="display: flex; flex-direction: column; align-items: center;">'
        f"{marker}{line}</div>"
        f"<div>{content}</div>"
        "</div>"
    )


def marker_active(n=1):
    """The spine's current-step marker: filled ink circle, white numeral."""
    return (
        f'<span style="width: 24px; height: 24px; border-radius: 50%; background: {INK}; '
        f'color: {WHITE}; font-size: 12px; font-weight: 700; display: flex; '
        'align-items: center; justify-content: center; flex-shrink: 0;">'
        f"{n}</span>"
    )


def write(name, html):
    path = os.path.join(HERE, name)
    with open(path, "w", encoding="utf-8") as fh:
        fh.write(html)
    print(f"wrote {name} ({len(html)} bytes)")
