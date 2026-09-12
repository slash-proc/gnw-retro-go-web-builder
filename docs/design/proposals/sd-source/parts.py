"""The Sources tab's own primitives, measured off SourcesCache.dc.html.

Every size here is read from that board rather than chosen: the rail is 244px with a 40px
outer gutter, a rail head is 11px/700 with 0.11em tracking, a panel is an 18px-padded white
box on a #d8d8d8 hairline with a 6px radius, and a row is 12px vertical on a #ededed rule with
84px numeric columns. Reproducing those by eye is how a proposal starts looking like a
different app.
"""

from shell import (
    INK,
    INK_SOFT,
    INK_FAINT,
    MUTED,
    QUIET,
    HAIRLINE,
    RULE,
    SURFACE,
    GREEN,
    RED,
    CAUTION,
    MONO,
)

# ---- rail -------------------------------------------------------------------------------


def rail_head(text):
    return (
        f'<div style="font-size: 11px; font-weight: 700; letter-spacing: 0.11em; '
        f'color: {INK_SOFT}; text-transform: uppercase; padding-bottom: 6px;">{text}</div>'
    )


def rail_item(label, count=None, active=False):
    """One rail entry. `count` is the grey badge; None draws none, as Cache does.

    NO SECOND LINE. The SD entry used to carry the card's name beneath its label, because it
    holds one thing rather than a list. The owner has ruled it out, and it is the same thought as
    putting the picker on the page: THE RAIL SAYS WHICH SOURCE IS SELECTED, THE PAGE SAYS WHAT
    THE CARD IS. A name in both places made the rail answer a question the page owns.
    """
    if active:
        style = (
            "font-size: 14px; font-weight: 600; padding: 7px 0 7px 14px; margin-left: -14px; "
            f"box-shadow: inset 2px 0 0 {GREEN}; display: flex; align-items: center; "
            "justify-content: space-between; gap: 10px;"
        )
    else:
        style = (
            "font-size: 14px; padding: 7px 0; display: flex; align-items: center; "
            "justify-content: space-between; gap: 10px;"
        )
    badge = (
        f'<span style="font-size: 12px; color: {INK_SOFT};">{count}</span>'
        if count is not None
        else ""
    )
    return f'<div style="{style}"><span>{label}</span>{badge}</div>'


def rail_group(heading, items):
    body = rail_head(heading) + "".join(items)
    return (
        '<div style="display: flex; flex-direction: column; gap: 4px;">' + body + "</div>"
    )


def rail(groups):
    return (
        '<div style="border-right: 1px solid #d8d8d8; padding: 32px 20px 40px 40px; '
        'display: flex; flex-direction: column; gap: 26px;">' + "".join(groups) + "</div>"
    )


# ---- pane -------------------------------------------------------------------------------


def pane_title(title, subtitle=""):
    sub = (
        f'<div style="font-size: 14px; color: {INK_SOFT};">{subtitle}</div>'
        if subtitle
        else f'<div style="font-size: 14px; color: {INK_SOFT};"></div>'
    )
    return (
        '<div style="display: flex; flex-direction: column; gap: 6px;">'
        f'<div style="font-size: 24px; font-weight: 600; letter-spacing: -0.015em;">{title}</div>'
        f"{sub}</div>"
    )


def cap(text):
    return (
        f'<div style="font-size: 11px; font-weight: 700; letter-spacing: 0.11em; '
        f'color: {INK_SOFT}; text-transform: uppercase;">{text}</div>'
    )


def panel(inner, pad=18):
    return (
        f'<div style="background: {SURFACE}; border: 1px solid {HAIRLINE}; '
        f'border-radius: 6px; padding: {pad}px;">{inner}</div>'
    )


def section(caption, inner):
    return (
        '<div style="display: flex; flex-direction: column; gap: 12px;">'
        + cap(caption)
        + inner
        + "</div>"
    )


def row(name, count, size, action="", last=False, total=False, name_weight=None):
    """One Contents row: name / count / size / action, at SourcesCache's exact metrics."""
    if total:
        edge = f"border-top: 1px solid {HAIRLINE};"
    elif last:
        edge = ""
    else:
        edge = f"border-bottom: 1px solid {RULE};"
    weight = name_weight or ("600" if total else "400")
    size_weight = "600" if total else "400"
    act = (
        f'<span style="font-size: 13px; color: {INK_SOFT}; width: 46px; text-align: right;">{action}</span>'
        if action
        else '<span style="width: 46px;"></span>'
    )
    return (
        f'<div style="display: flex; align-items: center; gap: 16px; padding: 12px 0; {edge}">'
        f'<span style="font-size: 14px; font-weight: {weight}; flex-grow: 1; min-width: 0;">{name}</span>'
        f'<span style="font-size: 13px; color: {INK_SOFT}; width: 84px; text-align: right;">{count}</span>'
        f'<span style="font-size: 13px; font-weight: {size_weight}; width: 84px; text-align: right;">{size}</span>'
        f"{act}</div>"
    )


def defs(pairs):
    """The Storage block's two-column definition grid, 148px label column."""
    cells = ""
    for label, value in pairs:
        cells += f'<span style="font-size: 13px; color: {INK_SOFT};">{label}</span>'
        cells += f'<span style="font-size: 13px;">{value}</span>'
    return (
        '<div style="display: grid; grid-template-columns: 148px minmax(0, 1fr); '
        f'gap: 10px 20px; align-items: baseline;">{cells}</div>'
    )


def footer(left="", buttons=()):
    """The pane's single footer bar, 72px, one per page."""
    btns = "".join(
        f'<div style="font-size: 13px; font-weight: 600; color: {INK}; background: {SURFACE}; '
        f'border: 1px solid {INK}; border-radius: 5px; padding: 8px 18px;">{b}</div>'
        for b in buttons
    )
    return (
        f'<div style="border-top: 1px solid {HAIRLINE}; background: {SURFACE}; padding: 0 40px; '
        'min-height: 72px; box-sizing: border-box; margin-top: auto; display: flex; '
        'align-items: center; justify-content: space-between;">'
        f'<span style="font-size: 13px; color: {INK_SOFT};">{left}</span>'
        f'<div style="display: flex; align-items: center; gap: 12px;">{btns}</div></div>'
    )


def body(rail_html, sections, foot):
    """The rail grid: 244px column, then the pane with its footer pinned to the bottom."""
    inner = "".join(sections)
    return (
        '<div style="display: grid; grid-template-columns: 244px minmax(0, 1fr); gap: 0; '
        'flex-grow: 1;">'
        + rail_html
        + '<div style="display: flex; flex-direction: column; justify-content: space-between;">'
        '<div style="padding: 32px 40px 40px; display: flex; flex-direction: column; '
        f'gap: 32px; max-width: 720px;">{inner}</div>'
        + foot
        + "</div></div>"
    )


# ---- shared bits ------------------------------------------------------------------------


def status_dot(colour):
    return (
        f'<span style="width: 8px; height: 8px; border-radius: 50%; background: {colour}; '
        'flex-shrink: 0; display: inline-block;"></span>'
    )


def chip(text, colour=INK_SOFT):
    return (
        f'<span style="font-size: 12px; font-weight: 600; color: {colour}; '
        'letter-spacing: 0.02em;">' + text + "</span>"
    )


def mono(text, colour=INK_SOFT, size=12):
    return (
        f'<span style="font-size: {size}px; color: {colour}; font-family: {MONO};">{text}</span>'
    )


def choose_link(text="Choose…"):
    return (
        f'<span style="font-size: 13px; font-weight: 600; color: {GREEN}; '
        f'white-space: nowrap;">{text}</span>'
    )


def select(text, width=112):
    """A picker, drawn exactly as `guided-v2/chooseandsee`'s version picker draws its own, which
    in turn follows `advanced/RomSection.svelte`. A second idiom for choosing a value would be
    the third-rail CLAUDE.md warns about for rails.

    A `<span>` rather than a `<div>` so it nests inside `defs()`'s value cell, which is a span.

    THE CONTROL IS THE STRUCTURE THAT CARRIES "you told us this". Every other value in that grid
    is read-only text; this one has a chevron. A reader does not need a sentence to know which
    facts were measured, because only the stated ones can be changed.
    """
    return (
        f'<span style="display: inline-flex; align-items: center; justify-content: space-between; '
        f'gap: 8px; width: {width}px; box-sizing: border-box; background: {SURFACE}; '
        f'border: 1px solid {HAIRLINE}; border-radius: 5px; padding: 5px 9px; font-size: 13px; '
        f'color: {INK}; vertical-align: middle;">'
        f'<span style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">{text}</span>'
        f'<svg width="10" height="10" viewBox="0 0 20 20" fill="none" stroke="{INK_SOFT}" '
        'stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink: 0;">'
        '<path d="M5 7.5l5 5 5-5"></path></svg></span>'
    )


def caution(text):
    """A value that carries a warning, on a row whose PRESENCE is already the warning.

    `--caution` (#b8860b) from `src/styles/tokens.css`, not an invented gold. The dot is the same
    `status_dot` every other state row on these boards uses, so this is the established shape for
    "something about this row wants attention" rather than a new one.
    """
    return (
        '<span style="display: inline-flex; align-items: center; gap: 7px;">'
        + status_dot(CAUTION)
        + f'<span style="color: {CAUTION};">{text}</span></span>'
    )


def select_open(current, options, width=112):
    """The capacity picker with its list open, so a board can show which sizes are refused.

    A refused option is drawn PRESENT AND DISABLED rather than removed. Absent entries would make
    the list's length depend on the card's contents, so a reader could not tell a size that is
    impossible from one the app does not offer. Dimmed-in-place says "this size exists and your
    card already holds more than it", which is a fact the walk measured.
    """
    items = ""
    for label, enabled in options:
        if enabled:
            style = f"color: {INK};"
        else:
            style = f"color: {INK_FAINT}; text-decoration: line-through;"
        mark = (
            '<svg width="11" height="11" viewBox="0 0 20 20" fill="none" stroke="'
            + GREEN
            + '" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round">'
            '<path d="M4.5 10.5l3.5 3.5 7.5-8"></path></svg>'
            if label == current
            else '<span style="width: 11px;"></span>'
        )
        items += (
            '<span style="display: flex; align-items: center; gap: 8px; padding: 6px 9px; '
            f'font-size: 13px; {style}">{mark}<span>{label}</span></span>'
        )
    return (
        '<span style="display: inline-flex; flex-direction: column; vertical-align: top;">'
        + select(current, width=width)
        + f'<span style="display: flex; flex-direction: column; width: {width}px; '
        f'box-sizing: border-box; background: {SURFACE}; border: 1px solid {HAIRLINE}; '
        'border-radius: 5px; margin-top: 4px; padding: 3px 0; '
        'box-shadow: 0 6px 18px rgba(0,0,0,0.13);">'
        + items
        + "</span></span>"
    )


def headline(value, caption):
    """`Main.dc.html`'s External flash card: a 30px figure with a 14px caption beside it. Lifted
    rather than invented, because that card is the approved drawing of this exact statement."""
    return (
        '<div style="display: flex; align-items: baseline; gap: 8px;">'
        f'<span style="font-size: 30px; font-weight: 600; letter-spacing: -0.02em;">{value}</span>'
        f'<span style="font-size: 14px; color: {INK_SOFT};">{caption}</span></div>'
    )


def bar(segments):
    """The stacked bar from `Main.dc.html`: 10px tall, 5px radius, `#e8e8e8` behind.

    `segments` is a list of `(percent, colour)`. The widths are the real proportions of the
    fixture against the stated capacity, which is the whole point: three of the four buckets
    come out sub-pixel, and that is a finding about the bar rather than a reason to fudge it.
    """
    total = round(sum(pct for pct, _ in segments), 4)
    if total > 100.0:
        raise AssertionError(f"bar segments sum to {total}%, which overflows the bar")
    inner = "".join(
        f'<div style="width: {pct}%; background: {colour};"></div>' for pct, colour in segments
    )
    return (
        '<div style="display: flex; height: 10px; border-radius: 5px; overflow: hidden; '
        f'background: #e8e8e8;">{inner}</div>'
    )


def empty_note(text):
    """A pane with nothing in it. `folders.none` is the app's own shape for this."""
    return panel(
        f'<div style="font-size: 14px; color: {INK_SOFT}; padding: 4px 0;">{text}</div>'
    )
