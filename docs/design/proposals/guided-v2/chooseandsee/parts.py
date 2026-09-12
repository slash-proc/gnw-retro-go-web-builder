"""Spine rows and choice marks, matching the approved Guided boards exactly.

The rail geometry is lifted from mockups/Guided.dc.html: a 30px marker column and an
18px column gap, a 24px round marker, a 1px connector with 8px margins, and 30px of
padding under each step's content. The active step's title is 21px and every other
title is 16px; dimmed steps carry opacity 0.5. Those are the facts Direction C keeps
constant, because they are the language the owner says he already likes.
"""

from shell import INK, INK_SOFT, INK_FAINT, MUTED, QUIET, HAIRLINE, SURFACE, GREEN, RED, RED_DEEP, CAUTION

GNW = '<img src="logo-gnw-badge.svg" alt="Game &amp; Watch" style="height: 24px; width: auto; display: block; flex-shrink: 0;">'
RGO = '<img src="logo-rgo.png" alt="Retro-Go" style="height: 11px; width: auto; display: block; flex-shrink: 0;">'
PLUS = (
    '<svg width="11" height="11" viewBox="0 0 20 20" fill="none" stroke="' + INK_FAINT + '" '
    'stroke-width="1.7" stroke-linecap="round" style="flex-shrink: 0;"><path d="M10 4.5v11M4.5 10h11"></path></svg>'
)

MARKS = {
    "dual": f'{GNW}{PLUS}{RGO}',
    "rgo": RGO,
    "stock": GNW,
}


def marks(kind, gap=10):
    return (
        f'<span style="display: flex; align-items: center; justify-content: center; gap: {gap}px;">'
        f'{MARKS[kind]}</span>'
    )


def pips(active):
    """Two pips, drawn above the content on every approved Guided board."""
    on = f'width: 22px; height: 6px; border-radius: 3px; background: {GREEN};'
    off = f'width: 6px; height: 6px; border-radius: 3px; background: {HAIRLINE};'
    a = on if active == 0 else off
    b = on if active == 1 else off
    return (
        '<div style="display: flex; align-items: center; gap: 6px;">'
        f'<span style="{a}"></span><span style="{b}"></span></div>'
    )


def marker(kind, n=None):
    """done | active | future | stop -- the four marker states the boards draw."""
    base = "width: 24px; height: 24px; border-radius: 50%; display: flex; align-items: center; justify-content: center; flex-shrink: 0;"
    if kind == "done":
        return (
            f'<span style="{base} background: {GREEN};">'
            '<svg width="13" height="13" viewBox="0 0 20 20" fill="none" stroke="#ffffff" stroke-width="2.6" '
            'stroke-linecap="round" stroke-linejoin="round"><path d="M4.5 10.5l3.5 3.5 7.5-8"></path></svg></span>'
        )
    if kind == "active":
        return f'<span style="{base} background: {INK}; color: #ffffff; font-size: 12px; font-weight: 700;">{n}</span>'
    if kind == "stop":
        return (
            f'<span style="{base} background: {CAUTION}; color: #ffffff; font-size: 13px; font-weight: 700;">!</span>'
        )
    return (
        f'<span style="{base} border: 1px solid {HAIRLINE}; background: {SURFACE}; color: {INK_SOFT}; '
        f'font-size: 12px; font-weight: 700;">{n}</span>'
    )


def row(mark, content, last=False, dim=False, pad=30):
    """One spine row: marker column with its connector, then the content cell."""
    connector = "" if last else f'<span style="width: 1px; flex-grow: 1; background: {HAIRLINE}; margin: 8px 0;"></span>'
    opacity = " opacity: 0.5;" if dim else ""
    bottom = 0 if last else pad
    return (
        '<div style="display: grid; grid-template-columns: 30px minmax(0, 1fr); column-gap: 18px;">'
        f'<div style="display: flex; flex-direction: column; align-items: center;">{mark}{connector}</div>'
        f'<div style="display: flex; flex-direction: column; gap: 10px; padding-bottom: {bottom}px;{opacity}">'
        f'{content}</div></div>'
    )


def title(text, active=False, chip=None, chip_color=None):
    size = 21 if active else 16
    chip_html = ""
    if chip:
        c = chip_color or GREEN
        chip_html = (
            f'<span style="font-size: 12px; font-weight: 600; letter-spacing: 0.05em; color: {c}; '
            f'text-transform: uppercase;">{chip}</span>'
        )
    return (
        '<div style="display: flex; align-items: baseline; gap: 12px;">'
        f'<span style="font-size: {size}px; font-weight: 600; letter-spacing: -0.015em;">{text}</span>'
        f'{chip_html}</div>'
    )


def button(label, tone="red", small=False):
    """A control sized to its label.

    `display: inline-flex` is load-bearing and is a FIDELITY fix, not a design change. A bare
    `div` in the spine's content cell -- a flex COLUMN, so `align-items: stretch` -- grew to the
    full 470px, which is the "super wide" the owner reported. The live app never had that: every
    control there sits in `<div class="row">`, `display: flex` (`Wizard.svelte:1610-1614`), where
    a child is sized by its content. The boards were drawing a button the app does not have.
    """
    pad = "7px 16px" if small else "9px 22px"
    size = 13 if small else 14
    base = (
        f"display: inline-flex; align-items: center; font-size: {size}px; font-weight: 600; "
        f"padding: {pad}; border-radius: 5px; white-space: nowrap;"
    )
    if tone == "red":
        return (
            f'<div style="{base} background: {RED}; color: #ffffff; '
            f'box-shadow: inset 0 -2px 0 {RED_DEEP};">{label}</div>'
        )
    return (
        f'<div style="{base} background: {SURFACE}; color: {INK}; '
        f'border: 1px solid {HAIRLINE};">{label}</div>'
    )


def select(text, width=168):
    """The version picker, drawn as `advanced/RomSection.svelte` draws its own: a `select` in
    mono beside the control it acts on. That picker is the precedent; a second idiom for
    choosing a firmware version would be the third-rail CLAUDE.md warns about for rails."""
    return (
        f'<div style="display: inline-flex; align-items: center; justify-content: space-between; '
        f'gap: 8px; width: {width}px; box-sizing: border-box; background: {SURFACE}; '
        f'border: 1px solid {HAIRLINE}; border-radius: 5px; padding: 7px 10px; font-size: 13px; '
        f'font-family: ui-monospace, SFMono-Regular, Menlo, monospace; color: {INK};">'
        f'<span style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">{text}</span>'
        '<svg width="10" height="10" viewBox="0 0 20 20" fill="none" stroke="' + INK_SOFT + '" '
        'stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink: 0;">'
        '<path d="M5 7.5l5 5 5-5"></path></svg></div>'
    )


def control_row(inner, align="flex-start", gap=10):
    """One row of controls inside a spine step. `align` is `flex-end` for the install step,
    which is the half of the owner's "smaller and to the right" that is a real design change:
    the live `.row` is `justify-content: flex-start`, so today every control is left-aligned."""
    return (
        f'<div style="display: flex; align-items: center; gap: {gap}px; '
        f'justify-content: {align};">{inner}</div>'
    )


def quiet(text, size=13, color=None):
    return f'<span style="font-size: {size}px; color: {color or INK_SOFT};">{text}</span>'
