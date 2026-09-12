#!/usr/bin/env python3
"""Direction A, three boards: keep the structure, fix the layout.

Each board changes ONE thing about how the three options are arranged and holds everything
else constant, so a preference between two boards is a preference about that one thing.

What they are all fixing, measured from the live component (Wizard.svelte, `.chooser`
/ `.choice` / `.marks`):

  1. TWO ALIGNMENT AXES. The title and rubric are left-aligned to the 470px column; the cards
     are 304px and centred. Nothing on the page shares a left edge with anything else.
  2. RAGGED HEIGHTS. `.marks` is as tall as its tallest logo, so the three stacked cards are
     120px / 94px / 120px. The middle one is 26px shorter than its neighbours.
  3. A CARD IDIOM THAT APPEARS NOWHERE ELSE IN THE FLOW. Step 2 is a spine drawn straight on
     the page background: no fill, no border, a hanging marker column and a connector thread.

Run: python3 build.py
"""
import os
import shell as S

HERE = os.path.dirname(os.path.abspath(__file__))


def write(name, html):
    path = os.path.join(HERE, name)
    with open(path, "w") as f:
        f.write(html)
    print(f"wrote {name}  ({len(html)} bytes)")


def chevron():
    return (f'<svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="{S.FAINT}" '
            f'stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" '
            f'style="flex-shrink: 0;" aria-hidden="true"><path d="M8 5l5 5-5 5"></path></svg>')


# ---------------------------------------------------------------------------------------
# OneEdge: the minimal fix. Rows span the column, and every element on the page starts at
# the same x. The marks band is a fixed 48px so a row holding only the 22px Retro-Go
# wordmark is exactly as tall as a row holding the 48px badge.
# ---------------------------------------------------------------------------------------
def one_edge():
    rows = []
    for which, label in S.OPTIONS:
        rows.append(
            f'<div style="width: {S.COLUMN}px; box-sizing: border-box; background: {S.SURFACE}; '
            f'border: 1px solid {S.HAIR}; border-radius: 6px; padding: 18px 20px; '
            f'display: flex; align-items: center; gap: 18px;">'
            f'<div style="flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 12px;">'
            # Fixed 48px band. This is the line that equalises the three rows.
            f'<div style="height: 48px; display: flex; align-items: center;">'
            f'{S.marks(which, justify="flex-start")}</div>'
            f'<span style="font-size: 16px; font-weight: 600; letter-spacing: -0.01em; color: {S.INK};">{label}</span>'
            f'</div>{chevron()}</div>'
        )
    inner = (
        S.title_block(S.COLUMN)
        + '<div style="height: 24px;"></div>'
        + f'<div style="display: flex; flex-direction: column; gap: 10px;">{"".join(rows)}</div>'
        + '<div style="height: 20px;"></div>'
        + S.escape()
    )
    note = ("OneEdge: the option rows span the column and share the title's left edge, and a "
            "fixed 48px marks band makes all three rows 120px tall.")
    return S.head(note) + S.chrome() + S.body(inner, S.COLUMN) + S.TAIL


# ---------------------------------------------------------------------------------------
# Threaded: the chooser drawn in step 2's own idiom. The 30px hanging marker column, the
# 1px connector thread and the 24px circle are lifted from Guided.dc.html's spine, where the
# hollow circle is the "pending" marker. On a chooser the same circle reads as a radio, so
# the geometry carries over without inventing anything. No card: the rows sit on the page
# background exactly as the spine's do.
# ---------------------------------------------------------------------------------------
def threaded():
    rows = []
    for i, (which, label) in enumerate(S.OPTIONS):
        last = i == len(S.OPTIONS) - 1
        thread = ("" if last else
                  f'<span style="width: 1px; flex-grow: 1; background: {S.HAIR}; margin: 8px 0;"></span>')
        pad = "0" if last else "26px"
        rows.append(
            f'<div style="display: grid; grid-template-columns: 30px minmax(0, 1fr); column-gap: 18px;">'
            f'<div style="display: flex; flex-direction: column; align-items: center;">'
            f'<span style="width: 24px; height: 24px; border-radius: 50%; border: 1px solid {S.HAIR}; '
            f'background: {S.SURFACE}; flex-shrink: 0;"></span>{thread}</div>'
            f'<div style="display: flex; flex-direction: column; gap: 10px; padding-bottom: {pad};">'
            f'<div style="height: 48px; display: flex; align-items: center;">'
            f'{S.marks(which, justify="flex-start")}</div>'
            f'<span style="font-size: 16px; font-weight: 600; letter-spacing: -0.015em; color: {S.INK};">{label}</span>'
            f'</div></div>'
        )
    inner = (
        S.title_block(S.COLUMN)
        + '<div style="height: 26px;"></div>'
        + "".join(rows)
        + '<div style="height: 22px;"></div>'
        + S.escape()
    )
    note = ("Threaded: the chooser redrawn in step 2's spine idiom, a hanging marker column "
            "and a connector thread on the page background, no card.")
    return S.head(note) + S.chrome() + S.body(inner, S.COLUMN) + S.TAIL


# ---------------------------------------------------------------------------------------
# ThreeUp: all three options seen at once. Grid stretch equalises the heights for free, and
# the raggedness cannot arise. The cost is the column: three cards wide enough to hold the
# Dual Boot marks row need 660px, so this page is 190px wider than the spine that follows
# it, and the marks come down from 48px to 36px to fit.
# ---------------------------------------------------------------------------------------
THREE_UP_COLUMN = 660


def three_up():
    cards = []
    for which, label in S.OPTIONS:
        cards.append(
            f'<div style="box-sizing: border-box; background: {S.SURFACE}; border: 1px solid {S.HAIR}; '
            f'border-radius: 6px; padding: 18px 16px; display: flex; flex-direction: column; '
            f'align-items: center; gap: 12px;">'
            f'<div style="height: 36px; display: flex; align-items: center;">'
            f'{S.marks(which, gnw_h=36, rgo_h=16, gap=8, justify="center")}</div>'
            f'<span style="font-size: 16px; font-weight: 600; letter-spacing: -0.01em; color: {S.INK}; '
            f'text-align: center;">{label}</span>'
            f'</div>'
        )
    inner = (
        # The rubric keeps the 470px measure even though the column is 660px: a line of body
        # text 660px long is past a comfortable measure, and both still start at the same x.
        S.title_block(S.COLUMN)
        + '<div style="height: 24px;"></div>'
        + f'<div style="display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 14px; '
          f'align-items: stretch;">{"".join(cards)}</div>'
        + '<div style="height: 20px;"></div>'
        + S.escape()
    )
    note = ("ThreeUp: one row of three, grid-stretched to equal heights. Needs a 660px column, "
            "190px wider than the spine that follows.")
    return S.head(note) + S.chrome() + S.body(inner, THREE_UP_COLUMN) + S.TAIL


if __name__ == "__main__":
    write("OneEdge.dc.html", one_edge())
    write("Threaded.dc.html", threaded())
    write("ThreeUp.dc.html", three_up())
