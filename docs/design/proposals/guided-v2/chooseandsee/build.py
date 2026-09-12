"""ChooseAndSee, driven by device state rather than hand-written per board.

One function, `board(state)`, emits the page for any row of LOGIC.md. Every gate below is the
live rule cited there, re-implemented rather than approximated, so a board cannot draw a
combination the app cannot produce.

THE MARKS WELL, which is what overlapped.

The Direction C draft put the marks in `width: 62px` with `flex-shrink: 0` on the span AND on
every image inside it. The Dual Boot mark is three items:

    logo-gnw-badge.svg  149.362 x 119.059 -> 1.2545 ratio, drawn at 24px high = 30.11px wide
    the plus glyph                                                              11.00px
    logo-rgo.png        64 x 12           -> 5.3333 ratio, drawn at 11px high = 58.67px wide
    two 8px gaps                                                                16.00px
                                                                       total = 115.78px

115.78px of unshrinkable content in a 62px box overflows by 53.78px, and the label starts at
62 + 16 = 78px, so the Retro-Go logo paints straight through it. The other two marks are one
image each (58.67px and 30.11px) and fit, which is why only Dual Boot looked broken.

The well is therefore sized from the WIDEST mark, not from a number that happened to suit the
narrowest. Same rule the Landing footer settled on: reserve the real box the real content
needs. `WELL` below is that measurement, not a guess.
"""

import html
import shell
from shell import INK, INK_SOFT, MUTED, QUIET, HAIRLINE, SURFACE, GREEN, CAUTION
from parts import marker, row, title, button, quiet, select, control_row, MARKS

# ---- real strings, all verified present in i18n/strings/wizard.ts -----------------------
T_TITLE = "What should this device run?"
T_RUBRIC = "Retro-Go is custom firmware that plays games from other consoles on this device."
T_DUAL, T_RGO, T_STOCK = "Dual Boot", "Only Retro-Go", "Return to Stock"
S_BACKUP_PATCH = "Backup &amp; Patch Original Firmware"
S_BACKUP_ONLY = "Back Up the Original Firmware"
S_INSTALL = "Install Retro-Go"
S_SOURCES = "Add Software Sources"
S_LIBRARY = "Add to Library"
S_SELECT_BACKUP = "Select Backup of Original Firmware"
S_RESTORE = "Restore Original Firmware"
S_REMOVE_RGO = "Remove Retro-Go"
S_OPTIONAL = "Optional"
B_BACKUP_PATCH = "Backup &amp; Patch"
B_BACKUP_ONLY = "Back Up"
B_SKIP = "Skip"
B_INSTALL = "Install"
B_RESTORE = "Restore"
B_REINSTALL = "Reinstall"
B_UPGRADE = "Upgrade"
B_DOWNGRADE = "Downgrade"

# The version the device is running, and what the picker offers. `v1.4.1-44-flash` is the
# owner's own installed string from `RGO_CHROME` below; the list is newest first, as
# `listVersions()` returns it (`artifacts.ts`, consumed at `Wizard.svelte:459`).
V_INSTALLED = "v1.4.1-44-flash"
V_NEWER = "v1.4.2 (latest)"
V_SAME = "v1.4.1-44-flash"
V_OLDER = "v1.4.0"

# `installTitleState` (`firmwareDist/compare.ts:219`) + `versionRelation` (`:163`). The relation
# is ALREADY four-valued -- "same" | "newer" | "older" | "unknown" -- and the app already folds
# "unknown" into reinstall on purpose: "an upgrade we cannot demonstrate must not be promised"
# (`compare.ts:212-214`). So the owner's three faces are three of four inputs, not a new axis.
FACE = {
    "install": (B_INSTALL, "red"),
    "newer": (B_UPGRADE, "red"),
    "same": (B_REINSTALL, "quiet"),
    "older": (B_DOWNGRADE, "red"),
    "unknown": (B_REINSTALL, "quiet"),
}


def too_small_for_retro_go(mb):
    return f"Retro-Go needs 8 MB. This device has {mb} MB."


def too_small_for_dual_boot(mb):
    return f"Dual boot needs 16 MB. This device has {mb} MB."


# ---- geometry --------------------------------------------------------------------------
COL = 470          # the spine column width every approved Guided board uses
CARD = 360         # wide enough for "Retro-Go uniquement" (fr) on one line beside the well
WELL = 116         # the Dual Boot mark, measured. See the module docstring.
GUTTER = 48


def _text(s):
    return html.escape(s, quote=False)


def choice_card(kind, label, hovered=False):
    """The approved card treatment, with the marks in a well sized to the widest mark so the
    three labels start at one x and nothing overflows into them."""
    border = INK if hovered else HAIRLINE
    weight = "2px" if hovered else "1px"
    pad = "13px 17px" if hovered else "14px 18px"
    return (
        f'<div style="background: {SURFACE}; border: {weight} solid {border}; border-radius: 6px; '
        f'padding: {pad}; display: flex; align-items: center; gap: 16px; width: {CARD}px; '
        'box-sizing: border-box;">'
        f'<span style="width: {WELL}px; flex-shrink: 0; display: flex; align-items: center; '
        f'gap: 8px;">{MARKS[kind]}</span>'
        f'<span style="font-size: 16px; font-weight: 600; letter-spacing: -0.01em; '
        f'min-width: 0;">{_text(label)}</span></div>'
    )


def spacer(h):
    return f'<div style="height: {h}px;"></div>'


def centred(inner, width):
    return (
        '<div style="flex: 1; display: flex; align-items: center; justify-content: center; '
        f'padding: 0 40px;"><div style="width: {width}px;">{inner}</div></div>'
    )


def floor_note(text):
    """`--ink-mute`, NOT `--caution`. The live rule is stated at `Wizard.svelte:1439-1440`:
    "not styled as an error: the device simply cannot do the thing, which is a fact about the
    chip rather than a failure". The draft drew it gold, which reads as a warning about
    something the user did. Rows 1 and 5 have no note, so nothing exercised this until now."""
    return (
        f'<div style="font-size: 13px; color: {MUTED}; line-height: 1.5; max-width: 52ch;">'
        f'{_text(text)}</div>'
    )


# ---- the live gates, re-implemented from Wizard.svelte ---------------------------------
class State:
    """One row of LOGIC.md.

    bank1: "stock" | "retrogo" | "patched"
    ext:   int MB, or None for "not scanned yet". ALWAYS A POWER OF TWO: it is
           `externalFlashSizeBytes / (1 << 20)` off the info struct
           (`packages/gnw-flasher/src/index.ts:647`), so it is a real chip capacity.
    rel:   where the SELECTED version sits against the installed one, as `versionRelation`
           reports it (`firmwareDist/compare.ts:163`). Ignored when nothing is installed.
    """

    def __init__(self, bank1, ext, backup_taken=False, installed=None, rel="same", label=""):
        self.bank1 = bank1
        self.ext = ext
        self.backup_taken = backup_taken
        # isInstalled: kind retrogo-sd | retrogo-old  (Wizard.svelte:97-101)
        self.installed = installed if installed is not None else (bank1 == "retrogo")
        self.rel = rel
        self.label = label

    # Wizard.svelte:137-138 -- unknown size passes BOTH gates, deliberately.
    @property
    def can_retro_go(self):
        return self.ext is None or self.ext >= 8

    @property
    def can_dual_boot(self):
        return self.ext is None or self.ext >= 16

    # Wizard.svelte:113 / classify.ts:47 -- pristine stock in bank 1 only.
    @property
    def is_stock(self):
        return self.bank1 == "stock"

    @property
    def cards(self):
        """Draw order is the source order: Wizard.svelte:1090, :1103, :1114."""
        out = []
        if self.can_dual_boot:
            out.append(("dual", T_DUAL))
        if self.can_retro_go:
            out.append(("rgo", T_RGO))
        if not self.is_stock:
            out.append(("stock", T_STOCK))
        return out

    @property
    def note(self):
        """Wizard.svelte:1124-1133. Mutually exclusive, and neither fires on unknown size."""
        if self.ext is None:
            return None
        if not self.can_retro_go:
            return too_small_for_retro_go(self.ext)
        if not self.can_dual_boot:
            return too_small_for_dual_boot(self.ext)
        return None

    def spine(self, path):
        """Wizard.svelte:1012-1017, with showBackupStep from :182 and :1043."""
        if path == "stock":
            return ["select-backup", "restore", "remove-rgo"]
        # rgoNeedsBackup is LATCHED at choose(): isStock && !backupTaken.
        needs_backup = path == "dual" or (self.is_stock and not self.backup_taken)
        return (["backup"] if needs_backup else []) + ["install", "sources", "roms"]


# ---- the spine column ------------------------------------------------------------------
def _step_state(sid, state, path):
    """done | active | dim, from Wizard.svelte:1144-1155.

    `roms` and `remove-rgo` appear in no done clause, so they are never drawn done.
    `sources` is unconditionally active when not done.
    """
    step1_done = state.backup_taken if path == "rgo" else False
    if sid == "backup":
        return "done" if step1_done else "active"
    if sid == "install":
        if state.installed:
            return "done"
        # step2Active = step1Done && !isInstalled
        return "active" if (step1_done or "backup" not in state.spine(path)) else "dim"
    if sid == "sources":
        return "active"
    if sid == "roms":
        return "active" if state.installed else "dim"  # step3Active = isInstalled
    if sid == "select-backup":
        return "active"
    if sid == "restore":
        return "dim"  # restoreValid is false until a backup is picked
    if sid == "remove-rgo":
        return "dim"
    return "dim"


TITLES = {
    "install": S_INSTALL,
    "sources": S_SOURCES,
    "roms": S_LIBRARY,
    "select-backup": S_SELECT_BACKUP,
    "restore": S_RESTORE,
    "remove-rgo": S_REMOVE_RGO,
}


def _step_body(sid, st):
    if sid == "backup":
        btn = B_BACKUP_PATCH if st == "dual-title" else B_BACKUP_ONLY
        return btn
    return None


def spine_column(state, path):
    ids = state.spine(path)
    out = []
    n = 0
    for i, sid in enumerate(ids):
        st = _step_state(sid, state, path)
        n += 1
        last = i == len(ids) - 1
        mark = marker("done", n) if st == "done" else marker("active" if st == "active" else "future", n)
        head = S_BACKUP_PATCH if (sid == "backup" and path == "dual") else TITLES.get(sid, S_BACKUP_ONLY)
        chip = S_OPTIONAL if sid in ("sources", "remove-rgo") and st != "done" else None
        content = title(head, active=(st == "active"), chip=chip, chip_color=QUIET)

        if sid == "backup" and st == "active":
            btn = button(B_BACKUP_PATCH if path == "dual" else B_BACKUP_ONLY)
            skip = (
                f'<span style="font-size: 13px; font-weight: 500; color: {INK_SOFT};">{B_SKIP}</span>'
                if path == "rgo"
                else ""
            )
            content += (
                '<div style="display: flex; align-items: center; gap: 16px;">' + btn + skip + "</div>"
            )
        elif sid == "install":
            # ONE control, four faces. Wizard.svelte:1211-1233 splits this step into two
            # branches that share nothing: done draws Upgrade-or-Reinstall with no version,
            # not-done draws a `v1.4.1 (latest)` STRING beside Install. The owner's correction
            # collapses both into the same pair -- a version picker and a verb -- because the
            # picker is what makes the verb true. Pick an older release and Upgrade becomes
            # Downgrade; there is nothing else to change.
            #
            # Which verb is NOT a new rule: `versionRelation` already answers it for any
            # candidate (`compare.ts:163`). Today the app only ever asks about `versions[0]`.
            face = "install" if not state.installed else state.rel
            label, tone = FACE[face]
            if face == "install":
                shown = V_NEWER
            else:
                shown = {"newer": V_NEWER, "same": V_SAME, "older": V_OLDER}.get(face, V_SAME)
            # The control is drawn on a dim step too. The live app renders the button
            # `disabled={!step2Active}` (`Wizard.svelte:1230`), not absent, and `row(dim=True)`
            # already puts the whole step behind `opacity: 0.5` -- which IS the disabled look.
            # Omitting it here would invent a step with no control, which no board draws.
            content += control_row(
                select(shown) + button(label, tone=tone, small=True), align="flex-end")
        elif sid == "restore" and st == "active":
            content += button(B_RESTORE)

        out.append(row(mark, content, last=last, dim=(st == "dim")))
    return "".join(out)


# ---- the page --------------------------------------------------------------------------
def board(state, hover=0, chrome=None):
    """`hover` indexes state.cards. It is a POINTER state, not a selection: the live chooser
    has no selection at all (path is null until a card is clicked, Wizard.svelte:1037-1044),
    so a board that drew one would be inventing a state. The outline says where the pointer
    is; the right column says what that card would produce.

    `chrome` overrides the header band. It exists because the header states, in words, the
    same fact bank 1 decides: a device with Retro-Go in bank 1 cannot draw "Not installed"
    beside a spine whose install step is already done. Default is unchanged."""
    chrome = shell.chrome() if chrome is None else chrome
    cards = state.cards
    left = (
        f'<div style="font-size: 21px; font-weight: 600; letter-spacing: -0.02em; '
        f'line-height: 1.2;">{_text(T_TITLE)}</div>'
        + spacer(8)
        + f'<div style="font-size: 13px; color: {MUTED}; line-height: 1.45;">{_text(T_RUBRIC)}</div>'
        + spacer(20)
    )
    for i, (kind, label) in enumerate(cards):
        left += choice_card(kind, label, hovered=(i == hover))
        if i < len(cards) - 1:
            left += spacer(8)
    if state.note:
        left += (spacer(16) if cards else "") + floor_note(state.note)
    left += spacer(20) + shell.escape_line()

    if not cards:
        # Row 3: every card gated away. There is no plan to draw beside nothing, so the page is
        # one column -- and the column falls back to COL, the measure every approved Guided
        # board uses, rather than staying at CARD. CARD is the width of a card; with no card to
        # hold it is an arbitrary 360px crop on what is now a page of nothing but text.
        return shell.page(chrome + centred(left, width=COL))

    path = {"dual": "dual", "rgo": "rgo", "stock": "stock"}[cards[hover][0]]
    right = spine_column(state, path)
    grid = (
        '<div style="display: flex; align-items: flex-start; gap: {g}px;">'
        '<div style="width: {c}px; flex-shrink: 0;">{l}</div>'
        '<div style="width: 1px; align-self: stretch; background: {h};"></div>'
        '<div style="width: {s}px; flex-shrink: 0;">{r}</div></div>'
    ).format(g=GUTTER, c=CARD, l=left, h=HAIRLINE, s=COL, r=right)
    return shell.page(chrome + centred(grid, width=CARD + GUTTER * 2 + 1 + COL))


# ---- the boards ------------------------------------------------------------------------
# A device with Retro-Go in bank 1 has it INSTALLED, so the header cannot say "Not installed"
# beside a spine whose install step is drawn done. GuidedFlashing.dc.html draws this slot as a
# version string, undimmed, which is the treatment for a device that has it.
RGO_CHROME = shell.chrome(rgo="v1.4.1-44-flash", rgo_dim=False)
BOARDS = {
    # Row 1 of LOGIC.md: pristine stock in bank 1, 16 MB. No Return to Stock.
    "StockBank1.dc.html": lambda: board(State("stock", 16), hover=0),
    # Row 5: Retro-Go in bank 1, 16 MB. All three cards, and the pointer is on the one card
    # bank 1 earned -- Return to Stock -- so the plan beside it is the restore spine.
    "RetroGoBank1.dc.html": lambda: board(State("retrogo", 16), hover=2),
    # Row 2: pristine stock, 8 MB. Dual boot is gated, Return to Stock was never offered, so
    # one card survives. The plan beside it is the four-step spine: rgoNeedsBackup is
    # isStock && !backupTaken (Wizard.svelte:1043), and both hold here.
    "StockBank1At8MB.dc.html": lambda: board(State("stock", 8), hover=0),
    # Row 3: pristine stock, 4 MB. Every card gated away. This is a STOCK ZELDA -- 4 MB is its
    # real external flash (engine/ofw.ts:147) -- so this is not an exotic row, it is what an
    # unmodified device draws once its scan lands.
    "StockBank1Under8MB.dc.html": lambda: board(State("stock", 4)),
    # Row 4: the SAME device one moment earlier. extSizeMB is null until the stub has read the
    # chip (Wizard.svelte:133-135), and null passes both gates, so two cards are offered and no
    # note is drawn. The scan completing turns this page into the one above.
    "StockBank1Unscanned.dc.html": lambda: board(State("stock", None), hover=0),
    # Row 6: Retro-Go in bank 1, 8 MB. Dual Boot is gated away and the floor note says why;
    # the pointer sits on Only Retro-Go, whose spine is the three-step one -- no backup step,
    # because rgoNeedsBackup needs isStock and this device is not stock (Wizard.svelte:1043).
    #
    # 8 MB, not 12. `externalFlashSizeMiB` is a chip capacity, so the band ">= 8 and < 16" has
    # exactly ONE realisable member. See the size note in LOGIC.md section 1.
    "RetroGoSmall.dc.html": lambda: board(
        State("retrogo", 8), hover=0, chrome=RGO_CHROME),
    # Row 7: Retro-Go in bank 1, under 8 MB. Both install cards gated away, so Return to Stock
    # stands alone -- the case wizard.ts's own comment names, "Guided Setup offers returning to
    # stock only". One card on the left, a full three-step plan on the right.
    "RetroGoTooSmall.dc.html": lambda: board(
        State("retrogo", 4), hover=0, chrome=RGO_CHROME),
    # Row 8: Retro-Go in bank 1, size not scanned. Both gates PASS on null, so all three cards
    # are drawn and NO floor note appears. The pointer is on Dual Boot, the card that exists
    # here only because the device has not been measured.
    "RetroGoUnknownSize.dc.html": lambda: board(
        State("retrogo", None), hover=0, chrome=RGO_CHROME),
    # --- the version control, one control and three of its faces --------------------------
    # Same device, same page, same pointer, same everything: 16 MB with Retro-Go installed and
    # the pointer on Only Retro-Go. The ONLY difference between these three is which release is
    # selected in the picker, and therefore what `versionRelation` says about it. Read them as
    # one control, not three designs.
    "VersionUpgrade.dc.html": lambda: board(
        State("retrogo", 16, rel="newer"), hover=1, chrome=RGO_CHROME),
    "VersionReinstall.dc.html": lambda: board(
        State("retrogo", 16, rel="same"), hover=1, chrome=RGO_CHROME),
    "VersionDowngrade.dc.html": lambda: board(
        State("retrogo", 16, rel="older"), hover=1, chrome=RGO_CHROME),
}

if __name__ == "__main__":
    for name, fn in BOARDS.items():
        open(name, "w").write(fn())
        print("wrote", name)
