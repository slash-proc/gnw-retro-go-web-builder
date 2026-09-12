#!/usr/bin/env python3
"""Emits the Library proposal boards.

A generator rather than four hand-copied files: the chrome, rail and dock are identical
across boards, and the four differ only in which rail item is active and what the body and
the dock hold. Hand-copying them is how a board set drifts.

Palette and metrics are lifted from overview-v2/Status.dc.html, not re-picked.
"""
import os

INK, SOFT, MUTE = "#1b1b1b", "#5c5c5c", "#6e6e6e"
WHITE, BORDER, HAIR, PAGE = "#ffffff", "#d8d8d8", "#ededed", "#f4f4f4"
GREEN, GREEN_B, AMBER, DANGER = "#3e9e4e", "#35873f", "#b07d1a", "#8a241b"
MONO = "ui-monospace, Menlo, monospace"

CAPS = f"font-size: 11px; font-weight: 700; letter-spacing: 0.11em; color: {SOFT}; text-transform: uppercase;"
CARD = f"background: {WHITE}; border: 1px solid {BORDER}; border-radius: 6px;"


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
    a {{ color: {GREEN}; }} a:hover {{ color: #2f7a3c; }}
  </style>
</helmet>

<!--
{note}
-->

<div style="width: 1440px; min-height: 1000px; background: {PAGE}; color: {INK}; font-family: 'Hanken Grotesk', ui-sans-serif, system-ui, sans-serif; font-size: 16px; line-height: 1.5; display: flex; flex-direction: column; position: relative;">
"""


def chrome():
    """Header band, gold lip, tab strip. Library is the active tab."""
    tabs = []
    for name in ("Overview", "Firmware", "Sources", "Library"):
        if name == "Library":
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
            <span style="position: absolute; right: -4px; bottom: -4px; background: #c9c9cd; border: 1px solid rgba(0,0,0,0.35); border-radius: 999px; padding: 2px; display: flex; box-shadow: 0 1px 2px rgba(0,0,0,0.2);">
              <svg viewBox="0 0 10 6" width="10" height="6"><path d="M0 0 L5 6 L10 0 Z" fill="#161616"></path></svg>
            </span>
          </span>
          <span style="font-size: 14px; font-weight: 600;">Connected</span>
        </div>
        <span style="width: 1px; height: 18px; background: {BORDER}; margin: 0 3px;"></span>
        <div style="display: flex; align-items: center; gap: 8px;">
          <img src="logo-gnw-badge.svg" alt="Game &amp; Watch" style="height: 27px; width: auto; display: block; flex-shrink: 0;">
          <span style="font-size: 14px; font-weight: 600;">Zelda (Patched)</span>
        </div>
        <span style="width: 1px; height: 18px; background: {BORDER}; margin: 0 3px;"></span>
        <div style="display: flex; align-items: center; gap: 8px;">
          <img src="logo-rgo.png" alt="Retro-Go" style="height: 14px; width: auto; display: block; flex-shrink: 0;">
          <span style="font-size: 13px; font-weight: 600; font-family: {MONO};">v1.4.1-44-g5dc98285</span>
        </div>
      </div>
      <div style="display: flex; align-items: center; gap: 18px;">
        <svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="{SOFT}" stroke-width="1.5" stroke-linecap="round"><path d="M4 5.5h12M4 10h12M4 14.5h7"></path></svg>
        <span style="font-size: 12px; font-weight: 500; color: {SOFT};">EN</span>
        <svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="{SOFT}" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round">
          <path d="M16 12.5A7 7 0 0 1 7.5 4a7 7 0 1 0 8.5 8.5z"></path>
        </svg>
      </div>
    </div>
    <div style="height: 3px; background: linear-gradient(180deg, #d9bc5e 0%, #c09a32 100%);"></div>
  </div>

  <div style="padding: 0 40px; background: {WHITE}; border-bottom: 1px solid {BORDER}; display: flex; align-items: stretch; gap: 34px;">
    {''.join(tabs)}
  </div>
"""


def rail(active):
    """LIBRARY holds the console filter; FILES holds what is not a game.

    The console filter used to be a horizontal chip strip above the list. As a rail it is the
    same single-select it always was, in the shape Sources, Firmware and Overview already use.
    """
    groups = [
        ("Library", [("All", "128"), ("Game Boy", "34"), ("Game Boy Color", "51"),
                     ("NES", "22"), ("Homebrew", "6")]),
        ("Files", [("BIOS", None), ("Covers", None), ("Saves", None), ("Cheats", None)]),
    ]
    out = [f'    <div style="border-right: 1px solid {BORDER}; padding: 32px 20px 40px 40px; display: flex; flex-direction: column; gap: 26px;">']
    for heading, items in groups:
        out.append('      <div style="display: flex; flex-direction: column; gap: 4px;">')
        out.append(f'        <div style="{CAPS} padding-bottom: 6px;">{heading}</div>')
        for label, count in items:
            cnt = f'<span style="font-size: 13px; color: {SOFT};">{count}</span>' if count else ''
            if label == active:
                out.append(f'        <div style="font-size: 14px; font-weight: 600; padding: 7px 0 7px 14px; margin-left: -14px; box-shadow: inset 2px 0 0 {GREEN}; display: flex; align-items: center; justify-content: space-between; gap: 10px;"><span>{label}</span>{cnt}</div>')
            else:
                out.append(f'        <div style="font-size: 14px; padding: 7px 0; display: flex; align-items: center; justify-content: space-between; gap: 10px;"><span style="color: {INK};">{label}</span>{cnt}</div>')
        out.append('      </div>')
    out.append('    </div>')
    return "\n".join(out)


def chip(text, kind):
    """Row action chip. `kind` picks paint only; the words are the shipped ones."""
    paint = {
        "installed": f"color: {WHITE}; background: {GREEN}; border: 1px solid {GREEN_B};",
        "idle": f"color: {SOFT}; background: {WHITE}; border: 1px solid {BORDER};",
        "caution": f"color: {AMBER}; background: {WHITE}; border: 1px solid {AMBER};",
        "danger": f"color: {DANGER}; background: {WHITE}; border: 1px solid {DANGER};",
    }[kind]
    return f'<span style="font-size: 12px; font-weight: 600; border-radius: 4px; padding: 3px 10px; white-space: nowrap; {paint}">{text}</span>'


def sysbadge(text):
    return f'<span style="font-size: 11px; font-weight: 700; letter-spacing: 0.04em; color: {SOFT}; background: {PAGE}; border: 1px solid {BORDER}; border-radius: 3px; padding: 2px 7px; white-space: nowrap;">{text}</span>'


def check(on):
    if on:
        return f'<span style="width: 16px; height: 16px; border-radius: 3px; background: {GREEN}; border: 1px solid {GREEN_B}; flex-shrink: 0; display: flex; align-items: center; justify-content: center;"><svg viewBox="0 0 12 12" width="9" height="9" fill="none" stroke="{WHITE}" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 6.3 L4.7 9 L10 3.2"></path></svg></span>'
    return f'<span style="width: 16px; height: 16px; border-radius: 3px; background: {WHITE}; border: 1px solid {BORDER}; flex-shrink: 0;"></span>'


def game_row(name, system, size, state, selected, last=False, sub=None):
    bb = "" if last else f" border-bottom: 1px solid {HAIR};"
    subline = f'<div style="font-size: 12px; color: {SOFT}; font-family: {MONO}; margin-top: 2px;">{sub}</div>' if sub else ""
    return f"""              <div style="display: flex; align-items: center; gap: 12px; padding: 11px 0;{bb}">
                {check(selected)}
                {sysbadge(system)}
                <div style="flex-grow: 1; min-width: 0;"><div style="font-size: 14px;">{name}</div>{subline}</div>
                <span style="font-size: 12px; color: {SOFT}; font-family: {MONO}; white-space: nowrap;">{size}</span>
                {chip(state[0], state[1])}
              </div>"""


def dock(budget, net, summary_open=False, summary_body="", meter_pct=(0, 0), over=False):
    """Full-bleed bottom dock: meter strip fused to the bar's top edge, then the bar."""
    inst, pend = meter_pct
    fill = DANGER if over else GREEN
    meter = f"""      <div style="height: 3px; background: {HAIR}; display: flex;" aria-hidden="true">
        <div style="width: {inst}%; background: {fill};"></div>
        <div style="width: {pend}%; background: {fill}; opacity: 0.45;"></div>
      </div>"""
    drawer = ""
    if summary_open:
        drawer = f"""      <div style="background: {WHITE}; border-top: 1px solid {BORDER};">
        <div style="max-width: 1160px; margin: 0 auto; padding: 20px 40px 24px;">
          <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 16px;">
            <span style="font-size: 14px; font-weight: 600;">Install summary</span>
            <svg viewBox="0 0 24 24" width="15" height="15" stroke="{SOFT}" stroke-width="2" fill="none"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
          </div>
{summary_body}
        </div>
      </div>"""
    tab = f"""      <div style="display: flex; justify-content: flex-start; padding: 0 40px;">
        <div style="background: {WHITE}; border: 1px solid {BORDER}; border-bottom: none; border-radius: 6px 6px 0 0; padding: 7px 16px; display: flex; align-items: center; gap: 8px; font-size: 13px; font-weight: 600;">
          <span>Summary</span>
          <svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="{'18 15 12 9 6 15' if summary_open else '6 9 12 15 18 9'}"></polyline></svg>
        </div>
      </div>"""
    return f"""
  <div style="margin-top: auto;">
{tab}
{drawer}
{meter}
    <div style="background: {WHITE}; border-top: 1px solid {BORDER}; min-height: 72px; box-sizing: border-box; padding: 0 40px; display: flex; align-items: center; justify-content: space-between; gap: 24px;">
      <div style="display: flex; align-items: baseline; gap: 14px;">
        <span style="font-size: 13px; color: {SOFT};">{budget}</span>
        <span style="font-size: 13px; font-weight: 600; color: {DANGER if over else INK};">{net}</span>
      </div>
      <div style="display: flex; align-items: center; gap: 12px;">
        <div style="font-size: 13px; font-weight: 600; color: {WHITE}; background: {GREEN}; border: 1px solid {GREEN_B}; border-radius: 5px; padding: 9px 20px;">Sync Library</div>
      </div>
    </div>
  </div>
"""


def tail():
    return """</div>
</x-dc>
</body>
</html>
"""


def grid_open(right_px=440):
    return f'  <div style="display: grid; grid-template-columns: 244px minmax(0, 1fr); flex-grow: 1;">'


def body_open():
    return '    <div style="display: flex; flex-direction: column; min-width: 0;">'


def page_title(title, right=""):
    return f"""        <div style="display: flex; align-items: baseline; justify-content: space-between; gap: 20px;">
          <div style="font-size: 24px; font-weight: 600; letter-spacing: -0.015em;">{title}</div>
          {right}
        </div>"""


def write(name, note, inner):
    path = os.path.join(os.path.dirname(os.path.abspath(__file__)), name)
    with open(path, "w") as f:
        f.write(head(note) + chrome() + inner + tail())
    print("wrote", name)
