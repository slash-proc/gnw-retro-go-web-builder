#!/usr/bin/env python3
"""The Additional options modal, defined once.

`build-options.py` draws it over the frame set's arrangement (that board is promoted to the
approved set as `mockups/LibraryOptionsModal.dc.html`) and `build-composed.py` draws it over
the composed design. The two must not drift: the composed board exists precisely to pair this
modal with the dock the owner picked, so a second copy of the markup would let that pairing rot.

Imported by path, like `shell.py`, because a hyphenated filename is not an importable name.
"""
import importlib.util as _il
import os as _os

_spec = _il.spec_from_file_location(
    "shell", _os.path.join(_os.path.dirname(_os.path.abspath(__file__)), "shell.py")
)
_shell = _il.module_from_spec(_spec)
_spec.loader.exec_module(_shell)
globals().update({k: v for k, v in vars(_shell).items() if not k.startswith("_")})


def tab(label, active=False):
    if active:
        return f'<div style="font-size: 14px; font-weight: 700; color: {INK}; padding: 0 2px 12px; box-shadow: inset 0 -3px 0 {GREEN};">{label}</div>'
    return f'<div style="font-size: 14px; font-weight: 600; color: {MUTE}; padding: 0 2px 12px;">{label}</div>'


PANEL_COVER = f"""    <div style="padding: 24px 28px; display: grid; grid-template-columns: minmax(0, 1fr) 300px; gap: 36px; align-items: start;">
      <div style="display: flex; flex-direction: column; gap: 16px; min-width: 0;">
        {field("Source", "ScreenScraper", width=200)}
        {field("Variant", "Box art", width=200)}
        <div style="display: flex; align-items: center; gap: 16px; padding-top: 4px;">
          <span style="background: {GREEN}; color: {WHITE}; font-size: 13px; font-weight: 600; padding: 7px 16px; border-radius: 4px;">Apply</span>
          <span style="font-size: 13px; color: {SOFT};">Drop an image to override</span>
        </div>
        <div style="display: flex; gap: 12px; padding-top: 6px;">{ICON_DOWNLOAD}{ICON_GEAR}</div>
        <div style="display: flex; flex-direction: column; gap: 5px; padding-top: 14px;">
          <div style="display: flex; justify-content: space-between;">
            <span style="font-size: 11px; color: {SOFT};">Requests today</span>
            <span style="font-size: 11px; color: {SOFT}; font-family: {MONO};">842 / 20000</span>
          </div>
          <div style="height: 3px; background: {BORDER}; border-radius: 2px; overflow: hidden;"><div style="height: 100%; width: 4%; background: {INK};"></div></div>
        </div>
      </div>
      <div style="height: 300px; background: {GREY}; border-radius: 4px; display: flex; align-items: center; justify-content: center;">
        <span style="font-size: 12px; color: {SOFT};">Preview</span>
      </div>
    </div>
"""


# --- the three panels --------------------------------------------------------------------
# One tab is open at a time, which is how a tabbed modal works. The set needs a board per tab
# regardless: the brief was that cheats is a device feature equal to saves, and a set that only
# ever draws Cover art cannot show whether a tab is enough room for the other two.
#
# Content lifted from mockups/RomsOptions.dc.html, where these sections are drawn today.


def _panel_cover():
    return PANEL_COVER


def _panel_saves():
    """Left is the slot picker and what it says; right is the preview, with its arrows.

    The preview keeps the 300px column the Cover art panel uses, so the modal's frame does not
    move between tabs. The arrows sit outside it, as they do today.
    """
    return f"""    <div style="padding: 24px 28px; display: grid; grid-template-columns: minmax(0, 1fr) 300px; gap: 36px; align-items: start;">
      <div style="display: flex; flex-direction: column; gap: 16px; min-width: 0;">
        <div style="display: flex; gap: 6px;">
          <span style="font-size: 12px; font-weight: 600; padding: 5px 11px; border-radius: 3px; background: {INK}; color: {WHITE};">SRAM</span>
          <span style="font-size: 12px; font-weight: 500; padding: 5px 11px; border-radius: 3px; color: {SOFT};">Slot 0</span>
          <span style="font-size: 12px; font-weight: 500; padding: 5px 11px; border-radius: 3px; color: {SOFT};">Slot 1</span>
        </div>
        <div style="display: flex; align-items: center; justify-content: space-between; gap: 12px; padding-top: 4px;">
          <span style="font-size: 13px; color: {SOFT};">Written</span>
          <span style="font-size: 13px; font-weight: 600;">2026-08-29 21:14</span>
        </div>
        <div style="display: flex; align-items: center; gap: 16px; padding-top: 4px;">
          <span style="background: {GREEN}; color: {WHITE}; font-size: 13px; font-weight: 600; padding: 7px 16px; border-radius: 4px;">Download save</span>
        </div>
      </div>
      <div style="display: flex; align-items: center; gap: 10px;">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="{DIM}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"></polyline></svg>
        <div style="flex-grow: 1; height: 300px; background: {GREY}; border-radius: 4px; display: flex; align-items: center; justify-content: center;"><span style="font-size: 12px; color: {SOFT};">Save preview</span></div>
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="{SOFT}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"></polyline></svg>
      </div>
    </div>
"""


def _panel_cheats():
    """Two equal columns, because there is nothing to preview.

    Cover art and Saves both have an image on the right, so they use `1fr 300px`. Cheats has no
    such thing, and stacking its four parts in one column would leave half the modal empty. Two
    equal columns is what the content wants: what is set on the left, what you can add on the
    right. That the modal's body grid is not the same on all three tabs is worth seeing, since
    the question asked of this board is whether a tab is enough room for cheats.
    """
    return f"""    <div style="padding: 24px 28px; display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 36px; align-items: start;">
      <div style="display: flex; flex-direction: column; gap: 16px; min-width: 0;">
        {field("Detected game", "Aerobiz Supersonic", width=220)}
        <div style="display: flex; flex-direction: column; gap: 10px; padding-top: 2px;">
          <span style="font-size: 11px; font-weight: 700; letter-spacing: 0.09em; color: {SOFT}; text-transform: uppercase;">Presets</span>
          {checkrow("Infinite funds", True)}
          {checkrow("All aircraft unlocked", True)}
          {checkrow("Fast turn processing", False)}
        </div>
      </div>
      <div style="display: flex; flex-direction: column; gap: 16px; min-width: 0;">
        <div style="display: flex; flex-direction: column; gap: 10px;">
          <span style="font-size: 11px; font-weight: 700; letter-spacing: 0.09em; color: {SOFT}; text-transform: uppercase;">Manual entry</span>
          <div style="display: flex; gap: 8px;">
            <span style="flex: 1; height: 32px; display: flex; align-items: center; padding: 0 10px; background: {WHITE}; border: 1px solid #dcdcdc; border-radius: 2px; font-size: 13px; color: {DIM}; font-family: {MONO};">Code</span>
            <span style="flex: 1; height: 32px; display: flex; align-items: center; padding: 0 10px; background: {WHITE}; border: 1px solid #dcdcdc; border-radius: 2px; font-size: 13px; color: {DIM};">Description</span>
            <span style="height: 32px; display: flex; align-items: center; padding: 0 14px; font-size: 13px; font-weight: 600; color: {GREEN};">Add</span>
          </div>
        </div>
        <div style="display: flex; justify-content: space-between; align-items: baseline; padding-top: 10px; border-top: 1px solid {BORDER};">
          <span style="font-size: 13px; color: {SOFT};">Configured</span>
          <span style="font-size: 13px; font-weight: 600;">2 codes</span>
        </div>
      </div>
    </div>
"""


PANELS = {"Cover art": _panel_cover, "Saves": _panel_saves, "Cheats": _panel_cheats}


def options_modal(active="Cover art"):
    return f"""  <div style="position: absolute; left: 0; right: 0; top: 0; bottom: 0; background: rgba(0,0,0,0.45); z-index: 10;"></div>
  <div style="position: absolute; left: 50%; top: 52%; transform: translate(-50%, -50%); width: 980px; background: {WHITE}; border-radius: 8px; box-shadow: 0 24px 60px rgba(0,0,0,0.35); z-index: 11; display: flex; flex-direction: column;">

    <div style="padding: 22px 28px 0; display: flex; align-items: baseline; justify-content: space-between; gap: 20px;">
      <div style="display: flex; align-items: baseline; gap: 14px;">
        <div style="{CAPS}">Additional options</div>
        <div style="font-size: 15px; font-weight: 600;">Aerobiz Supersonic</div>
      </div>
      <svg viewBox="0 0 24 24" width="16" height="16" stroke="{SOFT}" stroke-width="2" fill="none" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
    </div>

    <div style="padding: 18px 28px 0; display: flex; align-items: stretch; gap: 28px; border-bottom: 1px solid {BORDER};">
      {tab("Cover art", active=(active == "Cover art"))}
      {tab("Saves", active=(active == "Saves"))}
      {tab("Cheats", active=(active == "Cheats"))}
    </div>

{PANELS[active]()}
    <div style="padding: 0 28px 22px; display: flex; align-items: center; justify-content: flex-end;">
      <div style="font-size: 13px; font-weight: 600; color: {INK}; background: {WHITE}; border: 1px solid {BORDER}; border-radius: 5px; padding: 9px 20px;">Close</div>
    </div>

  </div>"""
