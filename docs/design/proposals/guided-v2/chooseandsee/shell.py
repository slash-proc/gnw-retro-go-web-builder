"""Guided Setup chrome, lifted verbatim from docs/design/mockups/Guided*.dc.html.

Every approved Guided board draws the same header band, gold rule and nav row, and the
body is centred in a fixed 1440x920 page. Direction C changes what sits in the body and
nothing else, so the chrome is held constant here rather than retyped per board.

Tokens are the real ones from apps/web/src/styles/tokens.css:
  --bg #f4f4f4  --surface #ffffff  --ink #1b1b1b  --ink-soft #5c5c5c
  --hairline #d8d8d8  --rule #ededed  --zelda-green #3e9e4e
  --action-red #c8372b  --action-red-deep #9e2a20  --ink-faint #c0c0c0
  --status-green #2e9e44  --silver #c9c9cd  --caution #b8860b
"""

INK = "#1b1b1b"
INK_SOFT = "#5c5c5c"
INK_FAINT = "#c0c0c0"
MUTED = "#6e6e6e"
QUIET = "#9a9a9a"
HAIRLINE = "#d8d8d8"
RULE = "#ededed"
SURFACE = "#ffffff"
BG = "#f4f4f4"
GREEN = "#3e9e4e"
RED = "#c8372b"
RED_DEEP = "#9e2a20"
CAUTION = "#b8860b"

HEAD = """<!doctype html>
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
    body { margin: 0; }
    a { color: #3e9e4e; } a:hover { color: #2f7a3c; }
  </style>
</helmet>
"""

TAIL = """</div>
</x-dc>
</body>
</html>
"""


def chrome(firmware_state="Patched", rgo="Not installed", rgo_dim=True):
    """The header band and nav row. `firmware_state` is deviceHeader.patched / .stock."""
    rgo_style = "opacity: 0.42;" if rgo_dim else ""
    return f"""
  <div style="display: flex; flex-direction: column;">
    <div style="height: 56px; background: {SURFACE}; display: flex; align-items: center; justify-content: space-between; padding: 0 40px;">
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
          <span style="font-size: 14px; font-weight: 600;">Connected (Recovery Mode)</span>
        </div>

        <span style="width: 1px; height: 18px; background: {HAIRLINE}; margin: 0 3px;"></span>

        <div style="display: flex; align-items: center; gap: 8px;">
          <img src="logo-gnw-badge.svg" alt="Game &amp; Watch" style="height: 27px; width: auto; display: block; flex-shrink: 0;">
          <span style="font-size: 14px; font-weight: 600;">Zelda ({firmware_state})</span>
        </div>

        <span style="width: 1px; height: 18px; background: {HAIRLINE}; margin: 0 3px;"></span>

        <div style="display: flex; align-items: center; gap: 8px; {rgo_style}">
          <img src="logo-rgo.png" alt="Retro-Go" style="height: 14px; width: auto; display: block; flex-shrink: 0;">
          <span style="font-size: 14px; font-weight: 600;">{rgo}</span>
        </div>
      </div>

      <div style="display: flex; align-items: center; gap: 18px;">
        <span style="font-size: 12px; font-weight: 500; color: {INK_SOFT};">EN</span>
        <svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="{INK_SOFT}" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round">
          <path d="M16 12.5A7 7 0 0 1 7.5 4a7 7 0 1 0 8.5 8.5z"></path>
        </svg>
      </div>
    </div>
    <div style="height: 3px; background: linear-gradient(180deg, #d9bc5e 0%, #c09a32 100%);"></div>
  </div>

  <div style="padding: 0 40px; background: {SURFACE}; border-bottom: 1px solid {HAIRLINE}; display: flex; align-items: stretch; justify-content: space-between;">
    <div style="display: flex; align-items: stretch; gap: 34px;">
      <div style="display: flex; align-items: center; height: 46px; padding: 0 2px; font-size: 14px; font-weight: 600; letter-spacing: 0.02em; color: {MUTED}; box-shadow: inset 0 -3px 0 transparent;">Overview</div>
      <div style="display: flex; align-items: center; height: 46px; padding: 0 2px; font-size: 14px; font-weight: 700; letter-spacing: 0.02em; color: {INK}; box-shadow: inset 0 -3px 0 {GREEN};">Firmware</div>
      <div style="display: flex; align-items: center; height: 46px; padding: 0 2px; font-size: 14px; font-weight: 600; letter-spacing: 0.02em; color: {MUTED}; box-shadow: inset 0 -3px 0 transparent;">Sources</div>
      <div style="display: flex; align-items: center; height: 46px; padding: 0 2px; font-size: 14px; font-weight: 600; letter-spacing: 0.02em; color: {MUTED}; box-shadow: inset 0 -3px 0 transparent;">Library</div>
    </div>
    <div style="display: flex; align-items: center; gap: 18px;">
      <span style="font-size: 13px; font-weight: 600; box-shadow: inset 0 -2px 0 {GREEN}; padding: 4px 0;">Guided</span>
      <span style="font-size: 13px; font-weight: 500; color: {INK_SOFT};">Advanced</span>
    </div>
  </div>"""


def page(body, height=920):
    """Wrap chrome+body in the fixed artboard frame every Guided board uses."""
    return (
        HEAD
        + f'\n<div style="width: 1440px; min-height: {height}px; background: {BG}; color: {INK}; '
        "font-family: 'Hanken Grotesk', ui-sans-serif, system-ui, sans-serif; font-size: 16px; "
        'line-height: 1.5; display: flex; flex-direction: column;">\n'
        + body
        + "\n"
        + TAIL
    )


def escape_line():
    """chooser.escapePrompt + chooser.escapeAction, drawn as on every approved board."""
    return (
        f'<span style="font-size: 13px; color: {QUIET};">Something else? '
        f'<span style="font-weight: 600; color: {MUTED};">Use the Advanced tab</span></span>'
    )
