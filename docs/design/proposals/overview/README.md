# Overview rework — proposal (2026-09-09)

**Not part of the main canvas, and deliberately not in `docs/design/mockups/`.**
`apps/web/test/artboard-index.mjs` scans that directory only (`DIR`, line 31), so nothing
here is indexed, counted or conformance-surveyed. It stays separate until the owner has
aligned on it; approving it means `git mv`-ing these boards into `docs/design/mockups/`
and adding them to that directory's README table and `canvas.json`.

Asset references (`icon-console.svg`, `logo-gnw-badge.svg`, `logo-rgo.png`, `./support.js`)
are bare filenames, exactly as every board in `docs/design/mockups/` writes them — those
resolve on the canvas, not on disk, so these files render the same way their siblings do
and move without edits.

## What this proposes

Overview adopts the **rail** the Advanced Firmware and Sources tabs use: a 244px left rail
of panes, a 720px-capped body, a footer action bar. No new visual language — the chrome,
nav, rail item treatment, section labels, panels, rows, pills and buttons are lifted from
`SourcesRail.dc.html`, `Firmware.dc.html` and `SourcesCache.dc.html`.

| Board | Pane | Shows |
|---|---|---|
| `OverviewSummary` | Status / Summary | Firmware + upgrade state, storage target, games, safety facts |
| `OverviewDetails` | Status / Details | Banks, external flash + partitions, `/data/INSTALL`, adapter |
| `OverviewRetroGoLog` | Logs / Retro-Go log | The device's own printf ring buffer |
| `OverviewAuditLog` | Logs / Audit log | This session's global activity |
| `OverviewNoDevice` | Status / Summary | The empty state most people see first |

Rail:

```
STATUS          LOGS
  Summary         Retro-Go log
  Details         Audit log
```

## The split, and why

**Summary** answers *what do I have, is it healthy, what next* for someone who does not know
the hardware. It carries only facts that change a decision: which firmware and bank, whether
a newer release exists, where installs go, how many games are on the device, whether a stock
backup exists, whether the part is read-protected.

**Details** is the technical truth for someone diagnosing. Deliberately kept out of Summary:
bank base addresses, partition offsets, ABI version/size, core-metadata version, layout
superblock flags, minimum erase size, probe name, device UID and the `/data/INSTALL` record.

Every field on both boards is annotated in the board's own header comment with the file and
line it comes from. Two are worth calling out:

- **`/data/INSTALL` is parsed today and surfaced by no UI at all** (`firmwareDist/installMarker.ts`).
  Details is the first place it would appear.
- **The Retro-Go log source is real**, not a wish: `engine/devicelog.ts` reads retro-go's
  persistent printf ring (`logbuf[4096]` at `0x20000008`, index at `0x20000004`) over SWD
  without booting the stub. It is a **ring** — the pane says so, because "wrapped" means the
  top of the text is not the beginning — and it survives a reset while the device keeps power,
  which is what makes it useful after a crash.

The four panes do not degrade alike, which is what `OverviewNoDevice` exists to show: Summary,
Details and the Retro-Go log all need a device; the Audit log does not, and is the one pane
worth opening with nothing plugged in.
