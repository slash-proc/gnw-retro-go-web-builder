#!/usr/bin/env python3
"""Direction B, four recompositions of the Guided Setup's initial question.

Same flow, same step, same decision. Only the composition changes. Direction A keeps the
current structure and fixes its layout; Direction C proposes variations to the flow itself.

Every board keeps the icons and the button treatment the owner said he likes. Where a board
varies them it is a size or an arrangement, never a replacement.

Run: python3 build.py
"""
from shell import (
    DUAL, ESCAPE_ACTION, FAINT, GREEN, HAIR, INK, MUTE, ONLY_RGO, SOFT, STOCK, TAIL, TITLE,
    WHITE, escape_line, gap, head, label, marker_active, marks, pane, pips, rail_row, rubric,
    title, write,
)

# The Dual Boot marks row is 219.5px (see shell.py). A well wide enough to hold it, so that
# all three labels start at the same x, is the same idea as the live 120px well resized for
# icons that doubled. Everything under `ChooserRail` and `ChooserPlain` follows from it.
WELL = 224
COL = 470                      # every Guided artboard's column
CONTENT = COL - 30 - 18        # 422, the spine's content column beside its rail


def card(inner, width, pad="16px 20px", extra=""):
    return (
        f'<div style="width: {width}px; box-sizing: border-box; background: {WHITE}; '
        f'border: 1px solid {HAIR}; border-radius: 6px; padding: {pad}; {extra}">{inner}</div>'
    )


# =========================================================================================
# B1  ChooserRail - the chooser joins the spine
# =========================================================================================
# One idea: the two steps share one construction, so moving between them shifts nothing.
# The page gets the spine's rail, its marker, its 21px title and its left edge. Because the
# content column beside the rail is 422px, the marks finally fit BESIDE the label again, in a
# 224px well - the arrangement the original board had before the icons doubled.
#
# The connector below the marker FADES OUT rather than reaching a second marker. Step 2's
# title depends on the path not yet chosen, and drawing a specific one would be inventing a
# state (UI_VOICE 9). The fade says "there is more below" and claims nothing about what.

def build_rail():
    choices = []
    for kind, name in (("dual", DUAL), ("rgo", ONLY_RGO), ("stock", STOCK)):
        row = (
            '<div style="display: flex; align-items: center; gap: 18px;">'
            f'<span style="width: {WELL}px; flex: 0 0 auto; display: flex; '
            f'justify-content: center;">{marks(kind)}</span>'
            f"{label(name)}"
            "</div>"
        )
        choices.append(card(row, CONTENT))

    stack = (
        '<div style="display: flex; flex-direction: column; gap: 10px;">'
        + "".join(choices)
        + "</div>"
    )

    body = (
        title(TITLE)
        + gap(8)
        + rubric()
        + gap(20)
        + stack
        + gap(18)
        + escape_line()
        + gap(28)
    )

    inner = pips(0) + gap(26) + rail_row(marker_active(1), body, connector_fade=True)
    html = head(
        "B1 ChooserRail - the chooser drawn as step 1 of the same spine the next page uses."
    ) + pane(inner, COL) + TAIL
    write("ChooserRail.dc.html", html)


# =========================================================================================
# B2  ChooserSpan - the choice reads across, not down
# =========================================================================================
# One idea: three cards side by side, so the page stops being a tall centred stack.
#
# The cost is stated rather than hidden: 219.5px of marks plus 40px of padding is a 260px
# card floor, so three across need 812px and the column has to widen from 470 to 900. That
# breaks width parity with the spine, which is the opposite of what the brief asked for in
# one respect while fixing the alignment in another. It is the board's whole weakness and
# the reason it is drawn: to see whether the horizontal reading is worth the parity.
#
# Cards do not stretch. With two options the row is two cards left-aligned at the same width,
# with one it is one card. Nothing recentres, nothing resizes.

SPAN_COL = 900
SPAN_GAP = 16
SPAN_CARD = (SPAN_COL - 2 * SPAN_GAP) // 3   # 289


def build_span():
    cards = []
    for kind, name in (("dual", DUAL), ("rgo", ONLY_RGO), ("stock", STOCK)):
        inner = (
            '<div style="display: flex; flex-direction: column; align-items: center; '
            'gap: 14px;">'
            f'<span style="height: 48px; display: flex; align-items: center;">{marks(kind)}</span>'
            f'{label(name, align="center", width="100%")}'
            "</div>"
        )
        cards.append(card(inner, SPAN_CARD, pad="20px 20px"))

    row = (
        f'<div style="display: flex; align-items: stretch; gap: {SPAN_GAP}px;">'
        + "".join(cards)
        + "</div>"
    )

    inner = (
        pips(0)
        + gap(26)
        + title(TITLE)
        + gap(8)
        + rubric()
        + gap(24)
        + row
        + gap(18)
        + escape_line()
    )
    html = head(
        "B2 ChooserSpan - three cards across a 900px measure. Costs width parity with the spine."
    ) + pane(inner, SPAN_COL) + TAIL
    write("ChooserSpan.dc.html", html)


# =========================================================================================
# B3  ChooserWeighted - the page has an opinion
# =========================================================================================
# One idea: the three are not peers. The path most devices want takes the full measure with
# its marks at full size; the other two sit below as a compact pair.
#
# NO "Recommended" badge. There is no such string in `wizard.ts` and inventing one is against
# UI_VOICE 4, so the weighting is carried entirely by size and order (UI_VOICE 3, state lives
# in structure). If he wants it said out loud that is a new key and his call, not ours.

def build_weighted():
    primary_inner = (
        '<div style="display: flex; align-items: center; gap: 22px;">'
        f'<span style="width: {WELL}px; flex: 0 0 auto; display: flex; '
        f'justify-content: center;">{marks("dual")}</span>'
        f"{label(DUAL, size=18)}"
        "</div>"
    )
    primary = card(primary_inner, COL, pad="22px 24px")

    secondary = []
    for kind, name in (("rgo", ONLY_RGO), ("stock", STOCK)):
        inner = (
            '<div style="display: flex; flex-direction: column; align-items: center; '
            'gap: 10px;">'
            f'<span style="height: 30px; display: flex; align-items: center;">'
            f'{marks(kind, scale=0.62)}</span>'
            f'{label(name, size=14, align="center", width="100%")}'
            "</div>"
        )
        secondary.append(card(inner, (COL - 10) // 2, pad="14px 16px"))

    pair = (
        '<div style="display: flex; gap: 10px;">' + "".join(secondary) + "</div>"
    )

    inner = (
        pips(0)
        + gap(26)
        + title(TITLE)
        + gap(8)
        + rubric()
        + gap(22)
        + primary
        + gap(10)
        + pair
        + gap(18)
        + escape_line()
    )
    html = head(
        "B3 ChooserWeighted - one full-measure path, two compact alternatives. No badge, no word."
    ) + pane(inner, COL) + TAIL
    write("ChooserWeighted.dc.html", html)


# =========================================================================================
# B4  ChooserPlain - delete the card
# =========================================================================================
# One idea: the spine draws no boxes at all, so neither does this. The choices become rows on
# the same rail, divided by hairlines, with the marks in the same 224px well.
#
# This is the most literal reading of "match the proceeding steps view", and it carries the
# set's sharpest risk: the spine's rows are not controls, so a row that looks exactly like one
# of them but IS clickable may not read as clickable. Drawn so that risk can be judged rather
# than argued.

def build_plain():
    rows = []
    for i, (kind, name) in enumerate((("dual", DUAL), ("rgo", ONLY_RGO), ("stock", STOCK))):
        border = "" if i == 0 else f"border-top: 1px solid {HAIR};"
        rows.append(
            f'<div style="display: flex; align-items: center; gap: 18px; padding: 14px 0; '
            f'{border}">'
            f'<span style="width: {WELL}px; flex: 0 0 auto; display: flex; '
            f'justify-content: center;">{marks(kind)}</span>'
            f"{label(name)}"
            "</div>"
        )

    body = (
        title(TITLE)
        + gap(8)
        + rubric()
        + gap(16)
        + '<div style="display: flex; flex-direction: column;">' + "".join(rows) + "</div>"
        + gap(16)
        + escape_line()
        + gap(28)
    )

    inner = pips(0) + gap(26) + rail_row(marker_active(1), body, connector_fade=True)
    html = head(
        "B4 ChooserPlain - no boxes. The spine's own construction, with the choices as its rows."
    ) + pane(inner, COL) + TAIL
    write("ChooserPlain.dc.html", html)


if __name__ == "__main__":
    build_rail()
    build_span()
    build_weighted()
    build_plain()
