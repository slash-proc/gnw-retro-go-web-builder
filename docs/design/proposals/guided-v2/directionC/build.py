"""Direction C: three variations on how Guided Setup is SEQUENCED.

Every string here is a real one from apps/web/src/lib/i18n/strings/wizard.ts or
deviceHeader.ts. Nothing is invented; where a variation would need a string the app does
not have, the README says so instead of inventing it.
"""

import shell
from shell import INK, INK_SOFT, MUTED, QUIET, HAIRLINE, RULE, SURFACE, GREEN, CAUTION
from parts import marks, pips, marker, row, title, button, quiet, MARKS

# ---- real strings ---------------------------------------------------------------------
T_TITLE = "What should this device run?"
T_RUBRIC = "Retro-Go is custom firmware that plays games from other consoles on this device."
T_DUAL, T_RGO, T_STOCK = "Dual Boot", "Only Retro-Go", "Return to Stock"
S_BACKUP_PATCH = "Backup &amp; Patch Original Firmware"
S_INSTALL = "Install Retro-Go"
S_SOURCES = "Add Software Sources"
S_LIBRARY = "Add to Library"
S_OPTIONAL = "Optional"
B_BACKUP_PATCH = "Backup &amp; Patch"
B_SKIP = "Skip"
B_INSTALL = "Install"
V_LATEST = "v1.4.1 (latest)"

COL = 470          # the column width every approved Guided board uses
CELL = COL - 48    # 30px marker column + 18px gap


def centred(inner, width=COL):
    return (
        '<div style="flex: 1; display: flex; align-items: center; justify-content: center; padding: 0 40px;">'
        f'<div style="width: {width}px;">{inner}</div></div>'
    )


def spacer(h):
    return f'<div style="height: {h}px;"></div>'


def choice_row(kind, label, selected=False, width=CELL):
    """The card treatment and the marks from the approved chooser, laid out as a ROW that
    hangs off the same left edge as everything else rather than being centred."""
    border = INK if selected else HAIRLINE
    weight = "2px" if selected else "1px"
    pad = "14px 18px" if selected else "15px 19px"
    return (
        f'<div style="background: {SURFACE}; border: {weight} solid {border}; border-radius: 6px; '
        f'padding: {pad}; display: flex; align-items: center; gap: 16px; width: {width}px; box-sizing: border-box;">'
        f'<span style="width: 62px; flex-shrink: 0; display: flex; align-items: center; gap: 8px;">{MARKS[kind]}</span>'
        f'<span style="font-size: 16px; font-weight: 600; letter-spacing: -0.01em;">{label}</span></div>'
    )


# =========================================================================================
# 1. ChoiceOnTheRail -- the question becomes step 1 of the spine. One layout, one left edge.
# =========================================================================================
def choice_on_the_rail():
    choices = "".join(
        [
            choice_row("dual", T_DUAL),
            '<div style="height: 8px;"></div>',
            choice_row("rgo", T_RGO),
            '<div style="height: 8px;"></div>',
            choice_row("stock", T_STOCK),
        ]
    )
    content = (
        title(T_TITLE, active=True)
        + f'<span style="font-size: 13px; color: {MUTED}; line-height: 1.45;">{T_RUBRIC}</span>'
        + '<div style="height: 6px;"></div>'
        + choices
    )
    body = row(marker("active", 1), content, last=True)
    inner = body + spacer(20) + shell.escape_line()
    return shell.page(shell.chrome() + centred(inner))


# =========================================================================================
# 2. PlanFirst -- infer the path from the device, open on the plan, keep the choice visible.
# =========================================================================================
def plan_first():
    seg = []
    for kind, label, on in (("dual", T_DUAL, True), ("rgo", T_RGO, False), ("stock", T_STOCK, False)):
        bg = SURFACE if on else "transparent"
        border = INK if on else "transparent"
        color = INK if on else MUTED
        seg.append(
            f'<div style="display: flex; align-items: center; gap: 9px; padding: 7px 13px; border-radius: 5px; '
            f'background: {bg}; border: 1px solid {border}; color: {color};">'
            f'<span style="display: flex; align-items: center; gap: 7px;">{MARKS[kind]}</span>'
            f'<span style="font-size: 13px; font-weight: 600; letter-spacing: -0.01em;">{label}</span></div>'
        )
    selector = (
        f'<div style="display: inline-flex; align-items: center; gap: 4px; padding: 4px; background: {RULE}; '
        f'border-radius: 7px;">{"".join(seg)}</div>'
    )

    step1 = row(
        marker("active", 1),
        title(S_BACKUP_PATCH, active=True)
        + '<div style="display: flex; align-items: center; gap: 16px;">'
        + button(B_BACKUP_PATCH)
        + f'<span style="font-size: 13px; font-weight: 500; color: {INK_SOFT};">{B_SKIP}</span></div>',
    )
    step2 = row(marker("future", 2), title(S_INSTALL), dim=True)
    step3 = row(marker("future", 3), title(S_SOURCES, chip=S_OPTIONAL, chip_color=QUIET), dim=True)
    step4 = row(marker("future", 4), title(S_LIBRARY), last=True, dim=True)

    inner = selector + spacer(26) + step1 + step2 + step3 + step4 + spacer(20) + shell.escape_line()
    return shell.page(shell.chrome(firmware_state="Stock") + centred(inner))


# =========================================================================================
# 3. ChooseAndSee -- the choice and the plan it produces, on one page, side by side.
# =========================================================================================
def choose_and_see():
    left = (
        f'<div style="font-size: 21px; font-weight: 600; letter-spacing: -0.02em; line-height: 1.2;">{T_TITLE}</div>'
        + spacer(8)
        + f'<div style="font-size: 13px; color: {MUTED}; line-height: 1.45;">{T_RUBRIC}</div>'
        + spacer(20)
        + choice_row("dual", T_DUAL, selected=True, width=300)
        + spacer(8)
        + choice_row("rgo", T_RGO, width=300)
        + spacer(8)
        + choice_row("stock", T_STOCK, width=300)
        + spacer(20)
        + shell.escape_line()
    )

    step1 = row(
        marker("active", 1),
        title(S_BACKUP_PATCH, active=True)
        + '<div style="display: flex; align-items: center; gap: 16px;">'
        + button(B_BACKUP_PATCH)
        + f'<span style="font-size: 13px; font-weight: 500; color: {INK_SOFT};">{B_SKIP}</span></div>',
    )
    step2 = row(marker("future", 2), title(S_INSTALL) + quiet(V_LATEST), dim=True)
    step3 = row(marker("future", 3), title(S_SOURCES, chip=S_OPTIONAL, chip_color=QUIET), dim=True)
    step4 = row(marker("future", 4), title(S_LIBRARY), last=True, dim=True)
    right = step1 + step2 + step3 + step4

    grid = (
        '<div style="display: flex; align-items: flex-start; gap: 48px;">'
        f'<div style="width: 300px; flex-shrink: 0;">{left}</div>'
        f'<div style="width: 1px; align-self: stretch; background: {HAIRLINE};"></div>'
        f'<div style="width: {COL}px; flex-shrink: 0;">{right}</div></div>'
    )
    return shell.page(shell.chrome() + centred(grid, width=867))


BOARDS = {
    "ChoiceOnTheRail.dc.html": choice_on_the_rail,
    "PlanFirst.dc.html": plan_first,
    "ChooseAndSee.dc.html": choose_and_see,
}

if __name__ == "__main__":
    for name, fn in BOARDS.items():
        open(name, "w").write(fn())
        print("wrote", name)
