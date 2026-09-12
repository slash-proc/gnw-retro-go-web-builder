#!/usr/bin/env python3
"""The seven Library boards. Run: python3 boards-library.py

`build-library.py` is not an importable module name (the hyphen came from folding the
library/ and guided/ folders into this one), so it is loaded by path rather than imported.
"""
import importlib.util as _il
import os as _os

_spec = _il.spec_from_file_location(
    "build_library", _os.path.join(_os.path.dirname(_os.path.abspath(__file__)), "build-library.py")
)
_build = _il.module_from_spec(_spec)
_spec.loader.exec_module(_build)
globals().update({k: v for k, v in vars(_build).items() if not k.startswith("_")})


def carousel(selected_idx=None):
    """Cover strip. Selection is a green ring, not a caption."""
    tiles = []
    for i, (label, tint) in enumerate([("", "#3d5a8a"), ("", "#7a4a2a"), ("", "#2f5a3a"),
                                       ("", "#5a3a6a"), ("", "#8a6a2a")]):
        ring = f"box-shadow: 0 0 0 2px {GREEN};" if i == selected_idx else ""
        op = "1" if i == selected_idx or selected_idx is None else "0.55"
        tiles.append(f'<div style="width: 74px; height: 74px; flex-shrink: 0; background: {tint}; border-radius: 4px; opacity: {op}; {ring}"></div>')
    return f"""          <div style="display: flex; gap: 10px; overflow: hidden; padding: 2px;">
            {''.join(tiles)}
          </div>"""


def detail_section(heading, rows_html, action=None):
    act = f'<div style="font-size: 12px; font-weight: 600; color: {SOFT}; background: {WHITE}; border: 1px solid {BORDER}; border-radius: 4px; padding: 4px 12px;">{action}</div>' if action else ""
    return f"""            <div style="display: flex; flex-direction: column; gap: 10px;">
              <div style="display: flex; align-items: center; justify-content: space-between;">
                <div style="{CAPS}">{heading}</div>
                {act}
              </div>
              <div style="{CARD} padding: 2px 16px;">
{rows_html}
              </div>
            </div>"""


def kv(label, value, last=False, value_mono=False, dot=None):
    bb = "" if last else f" border-bottom: 1px solid {HAIR};"
    d = ""
    if dot:
        color = {"green": GREEN, "amber": AMBER}[dot]
        d = f'<span style="width: 7px; height: 7px; border-radius: 999px; background: {color}; flex-shrink: 0; margin-right: 10px;"></span>'
    mono = f"font-family: {MONO};" if value_mono else ""
    return f"""                <div style="display: flex; align-items: center; gap: 14px; padding: 11px 0;{bb}">
                  {d}<span style="font-size: 13px; flex-grow: 1; min-width: 0;">{label}</span>
                  <span style="font-size: 13px; color: {SOFT}; text-align: right; {mono}">{value}</span>
                </div>"""


LIST_HEADER = f"""          <div style="display: flex; align-items: center; justify-content: space-between; padding-bottom: 10px; border-bottom: 1px solid {BORDER};">
            <span style="{CAPS}">18 selected</span>
            <div style="display: flex; align-items: center; gap: 14px;">
              <span style="font-size: 13px; font-weight: 600; color: {GREEN};">Select all</span>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="{SOFT}" stroke-width="2"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path></svg>
            </div>
          </div>"""

ROWS = "\n".join([
    game_row("Link's Awakening DX", "GBC", "1.0 MB", ("installed", "installed"), True),
    game_row("Pokemon Crystal", "GBC", "2.0 MB", ("installed", "installed"), True),
    game_row("Super Mario Land 2", "GB", "512 KB", ("not installed", "idle"), False),
    game_row("Metroid II", "GB", "512 KB", ("installed", "installed"), True),
    game_row("The Ultimate Doom", "DOOM", "12.4 MB", ("installed", "installed"), True,
             sub="DOOM.WAD"),
    game_row("OpenLara", "HB", "42.9 MB", ("prepare", "caution"), False,
             sub="openlara.bin"),
    game_row("Castlevania", "NES", "128 KB", ("installed", "installed"), True),
    game_row("Mega Man 2", "NES", "256 KB", ("not installed", "idle"), False, last=True),
])


# ---------------------------------------------------------------------------------------
# 1. Library - the default view, All selected, nothing picked in the carousel.
# ---------------------------------------------------------------------------------------
note1 = """  LIBRARY - the default view.

  WHAT THIS PAGE ANSWERS: what is on this console, what am I about to change, and how much
  room is left.

  THE CONSOLE FILTER IS THE RAIL. It was a horizontal chip strip above the list; it is the
  same single-select it always was, now in the shape Sources, Firmware and Overview use. That
  buys the second group for free, which is where the things that are not games go.

  FILES holds BIOS, Covers and Saves. Today BIOS is a set of unselectable rows wedged above
  the games, inside a list whose header says "18 selected" and whose Select all must not see
  them (RomManagementTab.svelte:2314 says exactly that in a comment). A thing that has to be
  excluded from the list it is drawn in is not a list item.

  ADDITIONAL OPTIONS IS GONE AS A NAME. It held two unrelated sets: per-game cover/saves/
  cheats, and per-install lzma/core-version. The first is the right column when a game is
  selected. The second is the Install summary, where the rest of the install already is.

  THE DOCK KEEPS THE FOCUS. Budget and net change on the left, Sync Library on the right, the
  storage meter fused to its top edge as a 3px strip so it costs the bar no height. That is
  the shipped arrangement and it is not the part that was broken.

  Sources, per element:
    Rail counts        romSelection.systems[].count, homebrew.titles     RomManagementTab:2260-2270
    Rows               visibleGames                                       RomManagementTab:328-344
    Action chip        getActionState(g)                                  RomManagementTab:385
    Budget, net        budgetText, netChangeText                          RomManagementTab:1539
    Meter              meterInstalledPct, meterPendingPct, fitsGap        RomManagementTab:2552

  Numbers are plausible, not measured. No device was attached and no card was read.
"""

inner1 = (
    grid_open() + "\n" + rail("All") + "\n" + body_open() + f"""
      <div style="padding: 32px 40px 40px; display: flex; flex-direction: column; gap: 24px; flex-grow: 1;">
{page_title("All")}
        <div style="display: grid; grid-template-columns: minmax(0, 1fr) 400px; gap: 32px; align-items: start;">

          <div style="display: flex; flex-direction: column; gap: 4px;">
{LIST_HEADER}
{ROWS}
          </div>

          <div style="display: flex; flex-direction: column; gap: 20px;">
{carousel()}
            <div style="{CARD} padding: 28px 20px; display: flex; align-items: center; justify-content: center; min-height: 120px;">
              <span style="font-size: 13px; color: {SOFT};">Select a game to see details</span>
            </div>
          </div>

        </div>
      </div>
""" + dock("18.4 MB of 46.0 MB projected", "", meter_pct=(40, 0)) + "    </div>\n  </div>\n"
)

write("Library.dc.html", note1, inner1)


# ---------------------------------------------------------------------------------------
# 2. LibraryGame - a game selected. Cover / Saves / Cheats in the right column.
# ---------------------------------------------------------------------------------------
note2 = """  LIBRARY - a game selected.

  THIS IS WHERE "ADDITIONAL OPTIONS" WENT. GameDetailsPanel's three sections (cover art,
  saves, cheats - GameDetailsPanel.svelte:893,1056,1128) are the right column now, under the
  carousel that selected the game. They were a drawer rising from the bottom bar, sharing one
  slot with the install summary, so opening one closed the other and neither was where the
  thing it acted on was drawn.

  THE ROW AND THE PANEL DO NOT BOTH CARRY THE ACTION. Today the row has an action chip and
  the info pane under the carousel draws the same chip again (RomManagementTab.svelte:2414).
  The row keeps it. The panel is settings for a game, not a second place to install it.

  WHAT IS PER-GAME AND WHAT IS NOT. Cover source, variant and the scraper budget are global
  and belong to FILES > Covers; only the override and the preview are per-game. Same split
  for saves: the util prompt is global, the download and the slot list are this game's.

  Sources, per element:
    Cover, override      GameDetailsPanel.svelte:893-1047
    Saves                GameDetailsPanel.svelte:1056-1120
    Cheats               GameDetailsPanel.svelte:1128+, configuredCheats
    Pretty name, origin  gameRows.ts; prettyName over originFilename
"""

detail_cover = detail_section(
    "Cover art",
    kv("Source", "Scraper", value_mono=False) + "\n" + kv("Variant", "Box art", last=True),
    action="Override",
)
detail_saves = detail_section(
    "Saves",
    kv("On device", "2 slots", dot="green") + "\n" + kv("Last written", "12 Jun 2026", last=True),
    action="Download",
)
detail_cheats = detail_section(
    "Cheats",
    kv("Configured", "3 of 41", last=True, dot="green"),
    action="Edit",
)

inner2 = (
    grid_open() + "\n" + rail("Game Boy Color") + "\n" + body_open() + f"""
      <div style="padding: 32px 40px 40px; display: flex; flex-direction: column; gap: 24px; flex-grow: 1;">
{page_title("Game Boy Color")}
        <div style="display: grid; grid-template-columns: minmax(0, 1fr) 400px; gap: 32px; align-items: start;">

          <div style="display: flex; flex-direction: column; gap: 4px;">
{LIST_HEADER}
{ROWS}
          </div>

          <div style="display: flex; flex-direction: column; gap: 20px;">
{carousel(selected_idx=0)}
            <div style="display: flex; flex-direction: column; gap: 6px;">
              <div style="font-size: 18px; font-weight: 600; letter-spacing: -0.01em;">Link's Awakening DX</div>
              <div style="font-size: 12px; color: {SOFT}; font-family: {MONO};">Zelda - Link's Awakening DX.gbc</div>
            </div>
{detail_cover}
{detail_saves}
{detail_cheats}
          </div>

        </div>
      </div>
""" + dock("18.4 MB of 46.0 MB projected", "", meter_pct=(40, 0)) + "    </div>\n  </div>\n"
)

write("LibraryGame.dc.html", note2, inner2)


# ---------------------------------------------------------------------------------------
# 3. LibraryBios - the BIOS pane. Shows what you have AND takes a file.
# ---------------------------------------------------------------------------------------
note3 = """  LIBRARY - BIOS.

  BOTH HALVES IN ONE PLACE. The owner asked for a BIOS section that shows what you have and
  lets you add. Today the showing is a row above the games and the adding is a chip on that
  row that opens FilePromptModal (RomManagementTab.svelte:2317, biosChipState:1265); the
  count also appears as a summary line. Three places, one fact.

  ONE ROW PER DECLARED SLOT, from biosState.installable, which respects the medium by
  construction: Flash drops a system with no games for it, SD keeps every active source's
  slot. Sorted wrong-first (biosState.sorted).

  THE CHIP IS THE ACTION AND THE STATE. `Found` is settled, `needs a file` is amber and
  opens the picker, `Optional` is neither. Those are the shipped strings (sources.bios.label,
  sources.bios.needsAFile, sources.filePrompt.found, sources.bios.optional) and they already
  carry the three-way reading, so nothing new is written here.

  NO PROSE ABOUT WHY A BIOS IS NEEDED. The system name and the filename are the whole answer.

  Sources:
    Rows              biosState.installable, biosState.sorted   sources/biosState.svelte.ts
    Chip              biosChipState(b)                          RomManagementTab.svelte:1265
    Add               FilePromptModal, biosTool                 RomManagementTab.svelte:2630
"""


def bios_row(system, filename, state, last=False):
    bb = "" if last else f" border-bottom: 1px solid {HAIR};"
    return f"""                <div style="display: flex; align-items: center; gap: 12px; padding: 12px 0;{bb}">
                  {sysbadge(system)}
                  <span style="font-size: 13px; flex-grow: 1; min-width: 0; font-family: {MONO};">{filename}</span>
                  {chip(state[0], state[1])}
                </div>"""


bios_rows = "\n".join([
    bios_row("GBA", "gba_bios.bin", ("needs a file", "caution")),
    bios_row("NES", "disksys.rom", ("Found", "installed")),
    bios_row("MSX", "MSX2P.ROM", ("Found", "installed")),
    bios_row("MSX", "MSX2PEXT.ROM", ("Optional", "idle")),
    bios_row("PCE", "syscard3.pce", ("Optional", "idle"), last=True),
])

inner3 = (
    grid_open() + "\n" + rail("BIOS") + "\n" + body_open() + f"""
      <div style="padding: 32px 40px 40px; display: flex; flex-direction: column; gap: 24px; flex-grow: 1;">
{page_title("BIOS", right=f'<span style="font-size: 13px; color: {AMBER};">1 needs a file</span>')}
        <div style="max-width: 720px; display: flex; flex-direction: column; gap: 24px;">
          <div style="{CARD} padding: 2px 18px;">
{bios_rows}
          </div>
        </div>
      </div>
""" + dock("18.4 MB of 46.0 MB projected", "", meter_pct=(40, 0)) + "    </div>\n  </div>\n"
)

write("LibraryBios.dc.html", note3, inner3)


# ---------------------------------------------------------------------------------------
# 4. LibrarySummary - the summary drawer open, install options inside it.
# ---------------------------------------------------------------------------------------
note4 = """  LIBRARY - the install summary, open.

  THE SUMMARY DRAWER NOW HOLDS THE INSTALL OPTIONS. `Compress ROMs` and, in SD mode, the core
  bundle and its version, used to sit in the Additional options drawer beside a game's cover
  art (RomManagementTab.svelte:2508-2545). They are properties of the write, not of a game,
  so they belong to the thing that describes the write.

  THE TABLE IS THE SHIPPED ONE. StatPanel variant="grid", three columns, `Total` as a
  trailing aggregate rather than a peer row (StatPanel.svelte's `total` flag). Rows come from
  composeSummaryRows (sources/summaryRows.ts): games, homebrew, cores, bios, covers, cheats,
  total. Nothing is added and nothing is renamed.

  NET CHANGE IS RED WHEN IT DOES NOT FIT, and the meter's overflow segment is red with it.
  That pairing is the whole warning; there is no sentence explaining it.

  Sources:
    Rows        composeSummaryRows(flags, rows)      sources/summaryRows.ts:85
    Bios line   biosSummaryDecision                  sources/summaryRows.ts
    Net change  roms.summary.netChange               RomManagementTab.svelte:1539
"""


def srow(label, after, change, last=False, total=False, warn=False):
    bb = "" if last else f" border-bottom: 1px solid {HAIR};"
    top = f" border-top: 1px solid {BORDER};" if total else ""
    weight = "600" if total else "400"
    ch = f'<span style="font-size: 13px; color: {DANGER if warn else SOFT}; text-align: right; font-family: {MONO};">{change}</span>'
    return f"""            <div style="display: grid; grid-template-columns: minmax(0, 1fr) 120px 120px; gap: 20px; align-items: baseline; padding: 10px 0;{bb}{top}">
              <span style="font-size: 13px; font-weight: {weight};">{label}</span>
              <span style="font-size: 13px; font-weight: {weight}; text-align: right; font-family: {MONO};">{after}</span>
              {ch}
            </div>"""


summary_body = f"""          <div style="display: grid; grid-template-columns: minmax(0, 1fr) 120px 120px; gap: 20px; padding-bottom: 8px; border-bottom: 1px solid {BORDER};">
            <span></span>
            <span style="{CAPS} text-align: right;">After</span>
            <span style="{CAPS} text-align: right;">Change</span>
          </div>
{srow("Games", "18", "+2")}
{srow("Homebrew", "2", "+1")}
{srow("Cores", "6", "")}
{srow("BIOS", "3", "")}
{srow("Cover art", "18", "+2")}
{srow("Cheats", "3 configured", "", last=True)}
{srow("Total", "61.3 MB", "+42.9 MB", last=True, total=True, warn=True)}
          <div style="display: flex; align-items: center; gap: 10px; margin-top: 16px;">
            <span style="width: 15px; height: 15px; border-radius: 3px; background: {WHITE}; border: 1px solid {BORDER}; flex-shrink: 0;"></span>
            <span style="font-size: 13px; color: {SOFT};">Compress ROMs</span>
          </div>
          <div style="display: flex; align-items: center; gap: 10px; margin-top: 10px;">
            {check(True)}
            <span style="font-size: 13px;">Update Retro-Go and cores</span>
            <span style="font-size: 13px; color: {SOFT}; font-family: {MONO}; border: 1px solid {BORDER}; border-radius: 4px; padding: 2px 9px;">v2.0.0-rc1</span>
          </div>"""

note4_inner = (
    grid_open() + "\n" + rail("All") + "\n" + body_open() + f"""
      <div style="padding: 32px 40px 40px; display: flex; flex-direction: column; gap: 24px; flex-grow: 1;">
{page_title("All")}
        <div style="display: grid; grid-template-columns: minmax(0, 1fr) 400px; gap: 32px; align-items: start;">

          <div style="display: flex; flex-direction: column; gap: 4px;">
{LIST_HEADER}
{ROWS}
          </div>

          <div style="display: flex; flex-direction: column; gap: 20px;">
{carousel()}
            <div style="{CARD} padding: 28px 20px; display: flex; align-items: center; justify-content: center; min-height: 120px;">
              <span style="font-size: 13px; color: {SOFT};">Select a game to see details</span>
            </div>
          </div>

        </div>
      </div>
""" + dock("61.3 MB of 46.0 MB projected", "+42.9 MB net change",
           summary_open=True, summary_body=summary_body,
           meter_pct=(40, 60), over=True) + "    </div>\n  </div>\n"
)

write("LibrarySummary.dc.html", note4, note4_inner)


# =======================================================================================
# FILES > Covers, Saves, Cheats.
#
# The first pass named these in the rail and drew none of them, on the argument that each
# was a straight lift of the global half of GameDetailsPanel and raised no layout question.
# That was right about Covers and wrong about Saves: the saves section is per-game all the
# way down (views/GameDetailsPanel.svelte:1056-1125 is slot tabs, a preview and one
# download), so there is no global half to lift. Cheats was not in the rail at all.
# =======================================================================================


def pane_body(cards):
    return f"""        <div style="max-width: 720px; display: flex; flex-direction: column; gap: 24px;">
{cards}
        </div>"""


def pane_card(rows_html, heading=None):
    head_html = f'          <div style="{CAPS}">{heading}</div>\n' if heading else ""
    return f"""        <div style="display: flex; flex-direction: column; gap: 10px;">
{head_html}          <div style="{CARD} padding: 2px 18px;">
{rows_html}
          </div>
        </div>"""


def btn(text, primary=False):
    paint = (f"color: {WHITE}; background: {GREEN}; border: 1px solid {GREEN_B};" if primary
             else f"color: {INK}; background: {WHITE}; border: 1px solid {BORDER};")
    return f'<div style="font-size: 13px; font-weight: 600; border-radius: 5px; padding: 9px 16px; white-space: nowrap; {paint}">{text}</div>'


def head_action(text):
    return f'<div style="font-size: 12px; font-weight: 600; color: {SOFT}; background: {WHITE}; border: 1px solid {BORDER}; border-radius: 4px; padding: 4px 12px;">{text}</div>'


def btn_row(*buttons):
    return f"""        <div style="display: flex; align-items: center; gap: 10px; flex-wrap: wrap;">
          {''.join(buttons)}
        </div>"""


# ---------------------------------------------------------------------------------------
# 5. LibraryCovers - the global half of the cover section.
# ---------------------------------------------------------------------------------------
note5 = """  LIBRARY - Covers.

  THE GLOBAL HALF, AND ONLY THAT. GameDetailsPanel's cover section mixes two scopes: the
  override drop area and the preview are this game's, while Source, Variant, the scraper
  budget and the two downloads are the whole library's. The per-game half stays in the right
  column under the carousel (LibraryGame); this pane is the rest.

  IMPORT AND SETTINGS ARE HEADER ACTIONS because that is where they already are: two icon
  buttons on the section head (GameDetailsPanel.svelte:904,912), opening the import modal and
  the ScreenScraper credentials modal. Neither is expanded here; a modal drawn inline would
  be a different surface, not this one.

  THE BUDGET IS THE SHIPPED BAR. Label, `used / total`, and a track (:994-1002). It appears
  only once a ScreenScraper username is set, which is why it is a row rather than a headline.

  Sources:
    Source, Variant        coverSource, coverVariant        GameDetailsPanel.svelte:923,936
    Requests today         ssRequestsUsed / ssRequestsTotal  GameDetailsPanel.svelte:994
    Download converted     downloadConvertedCovers          GameDetailsPanel.svelte:1024
    Download scraped       downloadScrapedCovers            GameDetailsPanel.svelte:1047
    Cover store            screenscraper/coverStore.ts

  Numbers are plausible, not measured.
"""

requests_row = f"""                <div style="display: flex; flex-direction: column; gap: 7px; padding: 13px 0;">
                  <div style="display: flex; align-items: center; justify-content: space-between;">
                    <span style="font-size: 13px;">Requests today</span>
                    <span style="font-size: 13px; color: {SOFT}; font-family: {MONO};">412 / 20000</span>
                  </div>
                  <div style="height: 4px; border-radius: 2px; background: {HAIR}; overflow: hidden;">
                    <div style="width: 2%; height: 100%; background: {GREEN};"></div>
                  </div>
                </div>"""

inner5 = (
    grid_open() + "\n" + rail("Covers") + "\n" + body_open() + f"""
      <div style="padding: 32px 40px 40px; display: flex; flex-direction: column; gap: 24px; flex-grow: 1;">
{page_title("Covers", right=f'<div style="display: flex; align-items: center; gap: 8px;">{head_action("Import")}{head_action("Settings")}</div>')}
{pane_body(chr(10).join([
    pane_card(kv("Source", "Scraper") + chr(10) + kv("Variant", "Box art") + chr(10) + requests_row),
    btn_row(btn("Download converted covers (.img)"), btn("Download scraped covers (images)")),
]))}
      </div>
""" + dock("18.4 MB of 46.0 MB projected", "", meter_pct=(40, 0)) + "    </div>\n  </div>\n"
)

write("LibraryCovers.dc.html", note5, inner5)


# ---------------------------------------------------------------------------------------
# 6. LibrarySaves - what is on the device, across games.
# ---------------------------------------------------------------------------------------
note6 = """  LIBRARY - Saves.

  THERE IS NO GLOBAL HALF TO LIFT. The previous pass deferred this pane as "a straight lift
  of the global half of GameDetailsPanel"; there isn't one. views/GameDetailsPanel.svelte:
  1056-1125 is slot tabs, a screenshot preview and one download, all for the selected game.
  The only non-per-game thing in it is the util gate.

  SO THE PANE IS THE DEVICE'S SAVES, ACROSS GAMES, which is what a person opening `Saves`
  is looking for and what the per-game section cannot answer. Every string here ships:
  `SRAM` and `Slot n` are the slot tab labels (:1077), `Download save` is the button
  (:1121), `No saves found` is the empty line (:1082).

  THE GATE IS NOT DRAWN. Without the RAM flasher util loaded and outside SD mode, the whole
  section is replaced by `Run the RAM Flasher Util to view saves.` and `Connect` (:1061).
  That is a second state of this same pane, not a second pane.

  NOTHING IS PER-SLOT HERE. The preview and the arrows belong to a selected game; this list
  says which games have saves and how many slots. Picking one is the per-game view.

  Sources:
    Slots, SRAM       gameSaves, slot.slot            GameDetailsPanel.svelte:1073-1081
    Download          downloadSaveFile                GameDetailsPanel.svelte:1119
    Gate              device.utilLoaded, targetMedia  GameDetailsPanel.svelte:1059
    Save formats      memory retrogo-save-formats

  Numbers are plausible, not measured. No device was attached.
"""


def save_row(system, name, slots, last=False):
    bb = "" if last else f" border-bottom: 1px solid {HAIR};"
    return f"""                <div style="display: flex; align-items: center; gap: 12px; padding: 12px 0;{bb}">
                  {sysbadge(system)}
                  <span style="font-size: 13px; flex-grow: 1; min-width: 0;">{name}</span>
                  <span style="font-size: 12px; color: {SOFT}; font-family: {MONO}; white-space: nowrap;">{slots}</span>
                  {chip("Download save", "idle")}
                </div>"""


saves_rows = "\n".join([
    save_row("GBC", "Link's Awakening DX", "SRAM, Slot 1"),
    save_row("GBC", "Pokemon Crystal", "SRAM, Slot 1, Slot 2"),
    save_row("GB", "Metroid II", "SRAM"),
    save_row("NES", "Castlevania", "Slot 1"),
    save_row("DOOM", "The Ultimate Doom", "Slot 1, Slot 2", last=True),
])

inner6 = (
    grid_open() + "\n" + rail("Saves") + "\n" + body_open() + f"""
      <div style="padding: 32px 40px 40px; display: flex; flex-direction: column; gap: 24px; flex-grow: 1;">
{page_title("Saves")}
{pane_body(pane_card(saves_rows))}
      </div>
""" + dock("18.4 MB of 46.0 MB projected", "", meter_pct=(40, 0)) + "    </div>\n  </div>\n"
)

write("LibrarySaves.dc.html", note6, inner6)


# ---------------------------------------------------------------------------------------
# 7. LibraryCheats - configured across the library, and the built-in library.
# ---------------------------------------------------------------------------------------
note7 = """  LIBRARY - Cheats.

  CHEATS WAS NOT IN THE RAIL AT ALL. The first pass drew per-game cheats in LibraryGame's
  right column and left the group with BIOS, Covers and Saves, so the global half had
  nowhere to go. It is a Files item now.

  TWO FACTS, TWO CARDS. What is configured across the library, and what the built-in library
  can supply. The first is the only thing the per-game section cannot show you: it knows
  about one game at a time (configuredCheats[gameKey]).

  THE BUILT-IN LIBRARY IS REAL DATA, NOT AN ILLUSTRATION. cheats/mcfManifest.json holds 945
  whole-file MCF entries (msx 903, sega 28, svi 8, coleco 6) and the per-system preset lists
  are gb 757, nes 721, snes 314, genesis 283, gamegear 122. Those counts are derived from
  the checked-in files, not invented.

  `Built-in Cheat File` is the shipped heading (cheats.builtInCheatFileHeading) and
  `Download Retro-Go Cheats Files` is the shipped action (:1282), which zips
  cheats/<system>/<name>.mcf. Nothing here is new copy.

  Sources:
    Configured        configuredCheats[gameKey]        GameDetailsPanel.svelte:1227
    Built-in MCF      cheats/mcfManifest.json
    Presets           cheats/<system>.json
    Download          downloadCheatsFiles              GameDetailsPanel.svelte:1282
    Model             memory cheats-system-rework
"""


def cheat_row(system, name, count, last=False):
    bb = "" if last else f" border-bottom: 1px solid {HAIR};"
    return f"""                <div style="display: flex; align-items: center; gap: 12px; padding: 12px 0;{bb}">
                  {sysbadge(system)}
                  <span style="font-size: 13px; flex-grow: 1; min-width: 0;">{name}</span>
                  <span style="font-size: 12px; color: {SOFT}; font-family: {MONO}; white-space: nowrap;">{count}</span>
                </div>"""


cheats_rows = "\n".join([
    cheat_row("GBC", "Link's Awakening DX", "3"),
    cheat_row("NES", "Castlevania", "5"),
    cheat_row("GB", "Metroid II", "2", last=True),
])

builtin_rows = "\n".join([
    kv("MSX", "903"),
    kv("Sega", "28"),
    kv("SVI", "8"),
    kv("Coleco", "6", last=True),
])

inner7 = (
    grid_open() + "\n" + rail("Cheats") + "\n" + body_open() + f"""
      <div style="padding: 32px 40px 40px; display: flex; flex-direction: column; gap: 24px; flex-grow: 1;">
{page_title("Cheats")}
{pane_body(chr(10).join([
    pane_card(cheats_rows, heading="Configured"),
    pane_card(builtin_rows, heading="Built-in Cheat File"),
    btn_row(btn("Download Retro-Go Cheats Files")),
]))}
      </div>
""" + dock("18.4 MB of 46.0 MB projected", "", meter_pct=(40, 0)) + "    </div>\n  </div>\n"
)

write("LibraryCheats.dc.html", note7, inner7)
