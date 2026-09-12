#!/usr/bin/env python3
"""Four Library boards, varying one thing: WHERE THE ADDITIONAL OPTIONS LIVE.

Run: python3 build-options.py

`shell.py` holds the chrome, console filter, list, coverflow and dock. Everything except the
options placement is identical across the four, on purpose: the owner is distilling, and a
comparison is only worth making when one variable moves.

The owner's constraints, all four boards honour them:
  - the carousel survives in some form                    ("the carousel is nice")
  - console filtering stays                               ("Obviously filtering by console must stay")
  - the summary survives                                  ("good enough to keep")
  - additional options stays a whole, and gets extendable ("I expect to add more to it")
  - cheats is a device feature equal to saves             (so it keeps presets AND manual entry)
"""
import importlib.util as _il
import os as _os

_spec = _il.spec_from_file_location(
    "shell", _os.path.join(_os.path.dirname(_os.path.abspath(__file__)), "shell.py")
)
_shell = _il.module_from_spec(_spec)
_spec.loader.exec_module(_shell)
globals().update({k: v for k, v in vars(_shell).items() if not k.startswith("_")})

_mspec = _il.spec_from_file_location(
    "modal", _os.path.join(_os.path.dirname(_os.path.abspath(__file__)), "modal.py")
)
_modal = _il.module_from_spec(_mspec)
_mspec.loader.exec_module(_modal)
options_modal = _modal.options_modal


# =======================================================================================
# 1. OptionsRail - a persistent inspector column, always showing the selected game.
# =======================================================================================
note1 = """  LIBRARY - options as a persistent inspector rail.

  THE THESIS: the options stop being a thing you open. They are a third column that is always
  there, showing whatever the carousel has selected. Nothing is behind a disclosure, so
  nothing is forgotten, and a fourth section arrives by appending to the column.

  WHAT IT COSTS, DRAWN HONESTLY: three sections at full strength are about 1110px of column
  against roughly 1015px of page, so the rail scrolls and the third section is cut by the
  page edge. That is the real trade and it is drawn rather than hidden by shrinking the
  sections until they fit. A fifth section makes it worse, not better.

  THE DOCK LOSES ITS DISCLOSURE. If the options are not in the dock, the dock does not get a
  control that opens nothing. Summary and Sync Library are what is left, which is the pair
  that was never the problem.

  THE CAROUSEL GETS THE ROOM IT WANTED. Moving the options out of the right column frees the
  full 948px for the coverflow at its shipped geometry, so no card is clipped at the edges.

  Fixtures lifted from mockups/Roms.dc.html and RomsOptions.dc.html. Numbers are plausible,
  not measured. No device was attached.
"""

rail_column = f"""      <div style="display: flex; flex-direction: column; gap: 20px; height: 1015px; overflow: hidden; position: relative;">
        {options_title()}
        <div style="background: {WHITE}; border-radius: 6px; padding: 20px; display: flex; flex-direction: column; gap: 22px;">
          {cover_section(preview_h=138)}
        </div>
        <div style="background: {WHITE}; border-radius: 6px; padding: 20px; display: flex; flex-direction: column; gap: 22px;">
          {saves_section(preview_h=132, divider=False)}
        </div>
        <div style="background: {WHITE}; border-radius: 6px; padding: 20px; display: flex; flex-direction: column; gap: 22px;">
          {cheats_section(divider=False)}
        </div>
        <div style="position: absolute; left: 0; right: 0; bottom: 0; height: 90px; background: linear-gradient(180deg, rgba(244,244,244,0) 0%, {PAGE} 82%); pointer-events: none;"></div>
      </div>"""

inner1 = console_chips() + f"""
  <div style="padding: 22px 40px 32px; display: grid; grid-template-columns: minmax(0, 1fr) 380px; gap: 32px; align-items: start; flex: 1 1 auto; min-height: 0;">

    <div style="display: flex; flex-direction: column; gap: 20px; min-width: 0;">
{coverflow()}
{coverflow_scrubber()}
{coverflow_caption()}
{games_list(selected_idx=0, limit=10)}
    </div>

{rail_column}

  </div>
""" + dock(options_label=None)

write("OptionsRail.dc.html", note1, inner1, min_height=1240)


# =======================================================================================
# 2. OptionsSheet - a full-height sheet with its own section rail.
# =======================================================================================
note2 = """  LIBRARY - options as a sheet with its own section rail.

  THE THESIS: the one shape that still works at ten sections. A vertical rail lists them and
  one is open at a time, so the page height stops being the limit on how many there can be.
  Adding a section costs one rail row, not another 350px of column.

  FOUR ITEMS, NOT THREE. `Save states` is drawn beside `Saves` because the owner named them
  as separate features of the device ("Cheats are a genuine feature of the device just like
  saves/savestates"), and today they share one section where SRAM and the numbered slots sit
  behind the same tabs. It is marked as not built: NO ARTBOARD DRAWS IT and no code ships it.
  That marker is the point of including it, and it is the only speculative item on any of
  these four boards.

  WHAT IT COSTS: the sheet replaces the list while it is open, so you cannot see what you
  selected while you are configuring it. The carousel stays at the top of the sheet, which
  is what keeps a sense of which game is being edited, but the list is gone until you close.

  THE DOCK KEEPS ITS DISCLOSURE, because this sheet is still a thing you open from it.

  Fixtures lifted from mockups/Roms.dc.html and RomsOptions.dc.html.
"""


def sheet_rail_item(label, active=False, unbuilt=False):
    if active:
        return f"""          <div style="font-size: 14px; font-weight: 600; padding: 9px 0 9px 14px; margin-left: -14px; box-shadow: inset 2px 0 0 {GREEN}; color: {INK};">{label}</div>"""
    if unbuilt:
        return f"""          <div style="display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 9px 0;">
            <span style="font-size: 14px; color: {DIM};">{label}</span>
            <span style="font-size: 10px; font-weight: 700; letter-spacing: 0.07em; text-transform: uppercase; color: {DIM}; border: 1px dashed {BORDER}; border-radius: 3px; padding: 2px 6px;">not built</span>
          </div>"""
    return f"""          <div style="font-size: 14px; color: {INK}; padding: 9px 0;">{label}</div>"""


sheet = f"""      <div style="background: {WHITE}; border-radius: 6px; display: grid; grid-template-columns: 220px minmax(0, 1fr); min-height: 700px;">

        <div style="border-right: 1px solid {HAIR}; padding: 24px 20px 24px 24px; display: flex; flex-direction: column; gap: 2px;">
          <div style="{CAPS} padding-bottom: 10px;">Additional options</div>
{sheet_rail_item("Cover art", active=True)}
{sheet_rail_item("Saves")}
{sheet_rail_item("Save states", unbuilt=True)}
{sheet_rail_item("Cheats")}
          <div style="margin-top: auto; padding-top: 24px; border-top: 1px solid {HAIR};">
            <div style="font-size: 13px; font-weight: 600;">Aerobiz Supersonic</div>
            <div style="font-size: 12px; color: {SOFT}; font-family: {MONO}; margin-top: 2px;">Genesis / Mega Drive</div>
          </div>
        </div>

        <div style="padding: 24px 28px; display: grid; grid-template-columns: minmax(0, 1fr) 320px; gap: 40px; align-items: start;">
          <div style="display: flex; flex-direction: column; gap: 18px; min-width: 0;">
            {section_head("Cover art", ICON_DOWNLOAD + ICON_GEAR)}
            {field("Source", "ScreenScraper", width=220)}
            {field("Variant", "Box art", width=220)}
            <div style="display: flex; align-items: center; gap: 16px; padding-top: 4px;">
              <span style="background: {GREEN}; color: {WHITE}; font-size: 13px; font-weight: 600; padding: 7px 16px; border-radius: 4px;">Apply</span>
              <span style="font-size: 13px; color: {SOFT};">Drop an image to override</span>
            </div>
            <div style="display: flex; flex-direction: column; gap: 5px; padding-top: 10px;">
              <div style="display: flex; justify-content: space-between;">
                <span style="font-size: 11px; color: {SOFT};">Requests today</span>
                <span style="font-size: 11px; color: {SOFT}; font-family: {MONO};">842 / 20000</span>
              </div>
              <div style="height: 3px; background: {BORDER}; border-radius: 2px; overflow: hidden;"><div style="height: 100%; width: 4%; background: {INK};"></div></div>
            </div>
          </div>
          <div style="height: 420px; background: {GREY}; border-radius: 4px; display: flex; align-items: center; justify-content: center;">
            <span style="font-size: 12px; color: {SOFT};">Preview</span>
          </div>
        </div>

      </div>"""

inner2 = console_chips() + f"""
  <div style="padding: 22px 40px 32px; display: flex; flex-direction: column; gap: 22px; flex: 1 1 auto; min-height: 0;">
{coverflow(scale=0.56, height=190)}
{sheet}
  </div>
""" + dock(options_open=True)

write("OptionsSheet.dc.html", note2, inner2, min_height=1180)


# =======================================================================================
# 3. OptionsInline - the row opens where it is. No drawer anywhere.
# =======================================================================================
note3 = """  LIBRARY - options inline, in the row.

  THE THESIS: there is no drawer, no rail and no modal. A row opens where it is and its
  options are underneath it, so the thing being configured and the thing doing the
  configuring are never in different parts of the screen. That is the complaint the drawer
  earned: it rose from the bottom bar, on the opposite edge from the row it acted on.

  THE CAROUSEL MOVES UP AND GOES WIDE, because the right column is gone. It runs the full
  page width above the list, still selecting, still the thing you flick through.

  WHAT IT COSTS: the list stops being a list while a row is open. Scanning twelve games and
  configuring one are the same surface, so the games below the open row are pushed down by
  about 420px and the shape of the page changes under you every time you open one. Only one
  row can be open before this becomes unusable.

  EXTENDING IT IS THE WEAK POINT. A fourth section makes every expansion taller, and there
  is no rail to hang it on. Three columns is roughly the ceiling at 1440.

  Fixtures lifted from mockups/Roms.dc.html and RomsOptions.dc.html.
"""

inline_panel = f"""        <div style="border-bottom: 1px solid {HAIR}; padding: 4px 0 22px; background: {PAGE}; margin: 0 -16px; padding-left: 16px; padding-right: 16px;">
          <div style="background: {WHITE}; border: 1px solid {BORDER}; border-radius: 6px; padding: 20px 24px; display: flex; flex-direction: column; gap: 18px;">
            {options_title()}
            <div style="display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 28px; align-items: stretch;">
              {cover_section(preview_h=130)}
              {saves_section(preview_h=130)}
              {cheats_section()}
            </div>
          </div>
        </div>"""

inner3 = console_chips() + f"""
  <div style="padding: 22px 40px 32px; display: flex; flex-direction: column; gap: 18px; flex: 1 1 auto; min-height: 0;">
{coverflow(scale=0.68, height=228)}
{coverflow_scrubber()}
{games_list(selected_idx=0, limit=8, compact=True, expanded_html=inline_panel)}
  </div>
""" + dock(options_label=None)

write("OptionsInline.dc.html", note3, inner3, min_height=1420)


# =======================================================================================
# 4. OptionsModal - the drawer promoted to a modal, tabs across the top.
# =======================================================================================
note4 = """  LIBRARY - options as a focused modal.

  THE THESIS: the drawer was right about being one place for all of this and wrong about
  being a drawer. A drawer shares the bottom edge with the summary, so opening one closes the
  other, and it is half a screen tall while the thing it configures is at the top. A modal
  takes the whole attention instead of half the page, and tabs across its top are the cheapest
  extension point there is: a fifth section is a fifth tab.

  THE LIBRARY IS STILL THERE BEHIND IT, dimmed, so the selection you made is not thrown away
  by opening the thing that acts on it. The carousel and the list are where they were.

  WHAT IT COSTS: it is a modal. You cannot flick the carousel to the next game while it is
  open, so configuring five games is five open-and-close cycles. The drawer at least stayed
  out of the way of the list.

  TABS RUN OUT SOONER THAN A RAIL DOES. Four fits comfortably at this width, six starts to
  crowd, and there is no obvious answer at ten. If the options really do keep growing, the
  sheet's vertical rail is the shape that does not run out.

  Fixtures lifted from mockups/Roms.dc.html and RomsOptions.dc.html.
"""


inner4 = console_chips() + f"""
  <div style="padding: 22px 40px 32px; display: grid; grid-template-columns: minmax(0, 1fr) 560px; gap: 32px; align-items: start; flex: 1 1 auto; min-height: 0;">
{games_list(selected_idx=0, limit=10)}
    <div style="display: flex; flex-direction: column; gap: 18px; min-width: 0;">
{coverflow(scale=0.66, height=242)}
{coverflow_scrubber()}
{coverflow_caption()}
    </div>
  </div>
""" + dock(options_open=True) + options_modal()

write("OptionsModal.dc.html", note4, inner4, min_height=1080)
