#!/usr/bin/env python3
"""Emits the Guided Firmware chooser boards.

A generator rather than five hand-copied files: the chrome and the column are identical
across boards and the five differ only in which cards the device's own facts allow. Hand
copying them is how a board set drifts.

Palette and metrics are lifted from overview-v2/Status.dc.html and the shipped
Wizard.svelte, not re-picked. Every string here is the shipped English value; nothing on
these boards is written for the board.
"""
import os

INK, SOFT, MUTE, DIM, FAINT = "#1b1b1b", "#5c5c5c", "#6e6e6e", "#8a8a8a", "#b4b4b4"
WHITE, BORDER, HAIR, PAGE = "#ffffff", "#d8d8d8", "#ededed", "#f4f4f4"
GREEN = "#3e9e4e"
MONO = "ui-monospace, Menlo, monospace"

# Wizard.svelte's own numbers. The column is 470px; a card is 304px; the marks stack above
# the label because the doubled row (219.6px) will not sit beside one inside that column.
COL, CARD = 470, 304
GNW_H, RGO_H, PLUS = 48, 22, 22


def head(note):
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
  </style>
</helmet>

<!--
{note}
-->

<div style="width: 1440px; min-height: 900px; background: {PAGE}; color: {INK}; font-family: 'Hanken Grotesk', ui-sans-serif, system-ui, sans-serif; font-size: 16px; line-height: 1.5; display: flex; flex-direction: column;">
"""


def chrome(connected="Connected", model="Zelda (Patched)"):
    """Header band, gold lip, tab strip. Firmware is the active tab in Guided Setup."""
    tabs = []
    for name in ("Overview", "Firmware", "Sources", "Library"):
        if name == "Firmware":
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
          </span>
          <span style="font-size: 14px; font-weight: 600;">{connected}</span>
        </div>
        <span style="width: 1px; height: 18px; background: {BORDER}; margin: 0 3px;"></span>
        <div style="display: flex; align-items: center; gap: 8px;">
          <img src="logo-gnw-badge.svg" alt="Game &amp; Watch" style="height: 27px; width: auto; display: block; flex-shrink: 0;">
          <span style="font-size: 14px; font-weight: 600;">{model}</span>
        </div>
      </div>
      <div style="display: flex; align-items: center; gap: 18px;">
        <svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="{SOFT}" stroke-width="1.5" stroke-linecap="round"><path d="M4 5.5h12M4 10h12M4 14.5h7"></path></svg>
        <span style="font-size: 12px; font-weight: 500; color: {SOFT};">EN</span>
      </div>
    </div>
    <div style="height: 3px; background: linear-gradient(180deg, #d9bc5e 0%, #c09a32 100%);"></div>
  </div>

  <div style="padding: 0 40px; background: {WHITE}; border-bottom: 1px solid {BORDER}; display: flex; align-items: stretch; gap: 34px;">
    {''.join(tabs)}
  </div>

  <div style="padding: 0 40px; background: {WHITE}; border-bottom: 1px solid {BORDER}; display: flex; align-items: stretch; gap: 26px;">
    <div style="display: flex; align-items: center; height: 40px; font-size: 13px; font-weight: 600; color: {INK}; box-shadow: inset 0 -2px 0 {GREEN};">Guided</div>
    <div style="display: flex; align-items: center; height: 40px; font-size: 13px; font-weight: 500; color: {MUTE};">Advanced</div>
  </div>
"""


def pips(on=0):
    """22x6 bar for the step you are on, 6px dot for the other. 12px under, on the chooser."""
    def pip(i):
        if i == on:
            return f'<span style="width: 22px; height: 6px; border-radius: 3px; background: {GREEN};"></span>'
        return f'<span style="width: 6px; height: 6px; border-radius: 3px; background: {HAIR};"></span>'
    return f'''      <div style="display: flex; align-items: center; gap: 6px; margin-bottom: 12px;">{pip(0)}{pip(1)}</div>'''


def marks(kind):
    """The badge, the wordmark, or both with a plus between them. Doubled from 24/11."""
    gnw = f'<img src="logo-gnw-badge.svg" alt="" style="height: {GNW_H}px; width: auto; display: block;">'
    rgo = f'<img src="logo-rgo.png" alt="" style="height: {RGO_H}px; width: auto; display: block;">'
    plus = (f'<svg width="{PLUS}" height="{PLUS}" viewBox="0 0 11 11" style="display: block; flex: 0 0 auto;">'
            f'<path d="M5.5 0.5 V10.5 M0.5 5.5 H10.5" stroke="{FAINT}" stroke-width="1.7" fill="none"></path></svg>')
    inner = {"both": gnw + plus + rgo, "rgo": rgo, "gnw": gnw}[kind]
    return f'<span style="display: flex; align-items: center; justify-content: center; gap: 10px;">{inner}</span>'


def card(label, kind):
    """A chooser card: marks stacked above the name. The name is the whole caption."""
    return f'''        <div style="width: {CARD}px; box-sizing: border-box; display: flex; flex-direction: column; align-items: center; gap: 12px; padding: 18px 20px; background: {WHITE}; border: 1px solid {HAIR}; border-radius: 6px;">
          {marks(kind)}
          <span style="width: 100%; text-align: center; font-size: 15px; font-weight: 600; letter-spacing: -0.01em; color: {INK};">{label}</span>
        </div>'''


def column(inner):
    return f'''
  <div style="flex-grow: 1; display: flex; align-items: center; justify-content: center; padding: 56px 40px;">
    <div style="width: {COL}px; display: flex; flex-direction: column;">
{inner}
    </div>
  </div>
'''


def title(text):
    return f'      <h2 style="margin: 0 0 24px; font-size: 28px; font-weight: 600; letter-spacing: -0.02em; line-height: 1.15; color: {INK};">{text}</h2>'


def rubric(text):
    return f'      <p style="margin: -16px 0 24px; font-size: 13px; line-height: 1.45; color: {SOFT};">{text}</p>'


def cards(items):
    inner = "\n".join(card(l, k) for l, k in items)
    return f'''      <div style="display: flex; flex-direction: column; align-items: center; gap: 10px; margin-bottom: 20px;">
{inner}
      </div>'''


def floor_note(text):
    return f'      <p style="margin: 0 0 20px; max-width: 52ch; font-size: 13px; line-height: 1.5; color: {MUTE};">{text}</p>'


def escape():
    return f'      <p style="margin: 0; font-size: 13px; color: {DIM};">Something else? <span style="color: {MUTE}; font-weight: 600;">Use the Advanced tab</span></p>'


def locked():
    return f'''      <div style="display: flex; flex-direction: column; gap: 8px; max-width: 420px; margin-bottom: 24px;">
        <p style="margin: 0; font-size: 15px; line-height: 1.45; color: {INK};">Its internal flash is read-protected, so nothing here can read the original firmware or back it up, and every guided path is built on a backup.</p>
        <p style="margin: 0; font-size: 13px; line-height: 1.45; color: {SOFT};">Installing from the Advanced tab unlocks it for you. Unlocking erases both flashes, and the original firmware cannot be saved first, so it will be gone.</p>
      </div>'''


def tail():
    return """</div>
</x-dc>
</body>
</html>
"""


def write(name, note, inner, chrome_args=None):
    path = os.path.join(os.path.dirname(os.path.abspath(__file__)), name)
    with open(path, "w") as f:
        f.write(head(note) + chrome(**(chrome_args or {})) + column(inner) + tail())
    print("wrote", name)


RUBRIC = "Retro-Go is custom firmware that plays games from other consoles on this device."
TITLE = "What should this device run?"

DUAL = ("Dual Boot", "both")
ONLY = ("Only Retro-Go", "rgo")
STOCK = ("Return to Stock", "gnw")

write("GuidedChooser.dc.html",
      "The chooser as most people meet it: a patched device with room for anything.\n"
      "Three names, three marks, nothing under them. The card is the answer to the title;\n"
      "a consequence that has to be stated does not belong in a button caption.",
      pips(0) + "\n" + title(TITLE) + "\n" + rubric(RUBRIC) + "\n"
      + cards([DUAL, ONLY, STOCK]) + "\n" + escape())

write("GuidedChooserStock.dc.html",
      "An untouched device. There is nothing to return FROM, so the third card is absent\n"
      "rather than disabled: an option that cannot apply is not drawn.",
      pips(0) + "\n" + title(TITLE) + "\n" + rubric(RUBRIC) + "\n"
      + cards([DUAL, ONLY]) + "\n" + escape(),
      {"model": "Zelda (Stock)"})

write("GuidedChooserSmallFlash.dc.html",
      "8 to 15 MB of external flash. Dual boot needs 16, so its card is gone and the floor\n"
      "note says which number was missed. The note is grey, not red: the chip is the size it\n"
      "is, which is a fact rather than a failure.",
      pips(0) + "\n" + title(TITLE) + "\n" + rubric(RUBRIC) + "\n"
      + cards([ONLY, STOCK]) + "\n"
      + floor_note("Dual boot needs 16 MB. This device has 8 MB.") + escape(),
      {"model": "Mario (Patched)"})

write("GuidedChooserTinyFlash.dc.html",
      "Under 8 MB. Every card that installs anything is gone and the note is the only thing\n"
      "left, so it has to stand on its own. This is the state that proves the note cannot be\n"
      "a footnote to the cards.",
      pips(0) + "\n" + title(TITLE) + "\n" + rubric(RUBRIC) + "\n"
      + cards([STOCK]) + "\n"
      + floor_note("Retro-Go needs 8 MB. This device has 4 MB.") + escape(),
      {"model": "Mario (Patched)"})

write("GuidedChooserLocked.dc.html",
      "A locked device. RDP means internal flash cannot be read, so there is no backup to be\n"
      "had and every guided path is built on one. No cards at all, and the escape line below\n"
      "is the real route rather than a second dead end: the Advanced tab can now unlock.",
      pips(0) + "\n" + title("This device is locked") + "\n" + locked() + "\n" + escape(),
      {"model": "Locked", "connected": "Connected"})
