# Overview, v2

**This directory is the live canvas, and it is no longer only Overview.** The Guided Firmware
chooser and the Library tab were drawn in the same language and folded in here, because the
published canvas is one canvas and splitting the files across sibling folders meant the new
boards never reached it. Their own write-ups are `README-guided.md` and `README-library.md`;
`build-guided.py` and `build-library.py` regenerate their boards. The layout of all sixteen is
`canvas.json`.

Published canvas: <https://claude.ai/code/artifact/751e59e3-7ea8-496c-a1e7-b61a2fd3cf05>

A third pass, built from the owner's annotations on two earlier research passes (a player's
perspective and a tinkerer's), both deleted once this superseded them.
Not registered on the main canvas: `apps/web/test/artboard-index.mjs` scans `docs/design/mockups/`
only, so nothing here is indexed until it is chosen.

## What this pass is fixing

The first two proposals were correct about the data and wrong about the writing. Both published
fields the reader had to synthesise, and both let the author's own vocabulary reach the screen.
The annotations that shaped this pass, and what each one changed:

**Copy is labels and values.** A sentence appears only when an action has a consequence that has
to be stated. "Room for plenty more" captions a bar that already shows free space; "Your save
states have never been backed up. They only exist on the console." explains an implication the
reader did not ask for. Neither has a replacement here, because neither had a job.

**A heading names the content, not the virtue.** `Safety` became the rows themselves, under no
heading at all. `Evidence` is `Details`, because nobody opening a console manager is looking for
evidence.

**A value stands alone in its column.** A firmware backup is a file that exists or does not, so
the value is the date it was saved, or `None`. It was `Taken`, then `Not taken`, both of which
read like a photograph and made the reader supply the verb. Read the value column of any grid on
these boards without its labels and every entry still means something.

**Internals stay out.** No `/data/INSTALL`, no CRC, no `Pinned`, no superblock flags. The version
the marker carries appears as `Installed firmware`; the file it came from is how we know, not
something to read.

**Never `·`, never an em-dash.** Two facts on one line get a grid row each.

**The page does not restructure when something needs doing.** `StatusAttention` used to promote a
panel above the table repeating Storage and Firmware backup, with an `Open SD card` button beside
them. Both rows already existed below it, and the button had no job: choosing a card folder is
something you do when you go to use the card, and when none is chosen the row's own value says so.
The panel is gone. What is left is the same table with different values, and `Back up now` as a
quiet button at the right edge of the row it belongs to. A row that can be acted on carries its
action; it does not get promoted into a second copy of itself.

**Colour instead of counting.** `8/8` is a score for a checklist that is not a checklist. Status
rows carry a coloured dot and nothing else; the rail shows a red dot beside Activity only when an
error is waiting. The one number that survives is `2 need attention`, because a count of things
wanting action is different from a score.

## Two corrections that changed the structure

**External flash is not a health item.** There is no healthy or unhealthy flash chip. It is
present and it has a size, which is a capacity question, so it belongs to Storage and is drawn as
a bar. It is off the Status list entirely.

**A failed write is not discovered here.** A flash that fails is reported while it is failing, in
the progress modal the user is watching. Repeating it on Overview would be stale by the time
anyone arrived and would teach people to look for failures in the wrong place. There is no
broken-flash board in this set; `StatusAttention` covers work that is *waiting*, which is a
different thing.

## Structure

```
CONSOLE          LOGS
  Status           Activity
  Details          Device log
```

**Status** answers what this console is set up as, and whether anything is waiting. The headline
is the **layout** — dual boot, only Retro-Go, only stock, other — because that is the fact that
changes what you can do next, and it is derived from both banks rather than exposing them. Below
it, the five preconditions a person can act on: debug probe, read protection, firmware backup,
storage, installed firmware. Bank contents and flash geometry are not here; they are detail.

**Details** is the same console with the working shown, visualised rather than tabulated: both
banks as `BankCard` segment bars, storage and the flash chip as `GeometryBar`s, adapter and app
state as `StatPanel` grids.

**Activity** is this session's record, with four severities and source chips, and both Copy and
Save beside the count of what is showing.

**Device log** is what the firmware printed, output first, with Copy and Save on the output and
`Read device log` left in the footer as the device operation it is.

**Log actions sit with the log, not in the page footer.** Both panes had Copy and Save in the
footer band, in the same button as `Rescan` on Status, and both read as page chrome: on a long
page the eye goes title, filters, list, and never comes back to the bottom. They are now beside
the line that says what they would act on, which on Activity is the filtered set rather than the
whole record.

**No terminal black.** The device log's output panel was a dark slab, the one place this design
broke its own language. It is the page ground inside the standard border now, so it still recedes
from the white panels around it and still reads as machine output, and the fault lines use the
same red as every other error rather than a second palette invented for a console.

**The screen is docked right**, a third column beside the rail rather than a block at the top of
the body. It is ambient, and it sits in gutter the page already had, outside the 720px content
column and outside `--maxw`. Below roughly 1200px it drops out. Its capture action sits with it,
not in the page footer.

## Boards

| Board | Shows |
|---|---|
| `Status` | Everything in order, one upgrade available |
| `StatusAttention` | The same table, two rows amber, `Back up now` in its row |
| `StatusNoDevice` | Rows present but unread; Activity stays live in the rail |
| `Details` | Banks, storage, flash chip, adapter, app state |
| `Activity` | Severity segment, debug toggle, source chips, filter, Copy and Save |
| `Notifications` | The header bell opened over Status, each entry dismissable, with the nothing-waiting variant below it |
| `DeviceLog` | Output with Copy and Save, then Debug: the fault resolved through the build's symbols |

## Reused, not reinvented

`ui/BankCard.svelte` (bank bars, `OverviewTab.svelte:461`), `ui/GeometryBar.svelte` +
`ui/StatPanel.svelte`'s `panel-footer` (the flash visual, `OverviewTab.svelte:554,580`),
`StatPanel` grids, `SourcesCache.dc.html`'s cache figure (summarised in `This app`, not
re-listed), `installProgress`'s log row treatment (Activity), and the existing screenshot capture
(`engine/screenshot.ts`, `OverviewTab.svelte:420-450`), auto-taken once on connect without
blocking the page. Chrome, nav, rail and footer are lifted from `Firmware.dc.html` /
`SourcesRail.dc.html`.

## Where each field comes from

| Field | Source |
|---|---|
| Layout, bank contents, used bytes | `IntflashBank.type/.base/.dataSize`, `engine/intflashscan.ts:23-29` |
| Read protection, chip, minimum erase | `DeviceInfo`, `packages/gnw-flasher/src/index.ts:133-140` |
| Partitions | `ExtPartition.offset/.size/.type/.fs`, `engine/fsscan.ts:21-31` |
| Storage target, card folder | `device.targetMedia`, `device.sdHandle`, `device.svelte.ts:45,52` |
| Firmware backup | per-unit fact keyed by `deviceUid`, `device.svelte.ts:70` |
| Probe, device UID | `device.svelte.ts:38,65` |
| Installed firmware, upgrade | `gitTag` + `installTitleState()`, `firmwareDist/compare.ts` |
| Activity entries | `auditLog.svelte.ts` (`{id, time, severity, source, subject, message, seen}`) |
| Device log output | `engine/devicelog.ts:15-17` (ring at `0x20000008`, index at `0x20000004`) |

## Not grounded

- **Numbers are plausible, not measured.** No device was attached. Chip size, bank byte counts,
  card capacity, the UID and the log text are real *shapes* with invented values. Firmware
  versions are the owner's real ones.
- **Symbolication is drawn, not built.** Nothing in `apps/web` parses an ELF. The chain that
  makes it possible without asking for a file does exist: the installed `gitTag` names the
  release, and the release publishes `symbols[]` (`ALL-CORES-MANIFESTS.md`; that archive is never
  installed).
- **Four severities are a store change.** `auditLog.svelte.ts:41` ships two (`note`, `error`)
  with a written argument against adding a third. Four levels reverses that: every emit site
  needs a level and `AuditEntry.severity` widens.
- **Auto-capture on connect** is new behaviour, not just a new button.
- **Dismissal is a store change.** `auditLog.svelte.ts` tracks `seen` per entry and exposes
  `unattended` (:120,124), but has no dismiss-one or dismiss-all. Both controls act on `seen`,
  so Activity keeps the full record either way.

## Strings

No rename is needed: **`Device log` is already the shipped string** (`overview.log.heading`).
Both earlier proposals proposed renaming it to `Retro-Go log`; that was unnecessary.

The notification panel's empty line is **not** `shared.auditLog.empty` ("Nothing to report yet."),
which stays as it is for the Activity modal. The two surfaces hold different sets, so one string
cannot serve both: Activity holds the whole session, the bell holds only what is unattended. The
panel gets its own line, `No activity yet`.

**Flagged:** that line is the owner's wording and it is drawn as asked, but it is not strictly true
of what the bell holds. The bell lists unattended errors, so a session with forty successful
conversions and no failures opens to `No activity yet` while Activity is full. If the line has to be
true of its own list it is about attention, not activity.

From `i18n/strings/overview.ts`: `waitingForConnection`, `info.readProtection`,
`info.lockUnlocked`, `controls.captureScreenshot`, `banks.heading`, `extFlash.usedLabel`,
`log.heading`, `log.readLog`, `log.download`. `Upgrade Retro-Go` exists as
`firmwareSetup.upgradeRetroGoTitle`.

New, each a seven-file i18n edit if this is chosen:

- Rail and headings: `Console`, `Status`, `Details`, `Logs`, `Activity`, `Layout`, `Output`,
  `Crash`, `Adapter`, `Storage`, `This app`, `Upgrade available`, `Notifications`, `Screen`,
  `Clear`, `No activity yet`
- Status rows: `Debug probe`, `Firmware backup`, `Installed firmware`, `None`,
  `No card selected`, `2 need attention` (count interpolated), `SD card`
- Details labels: `Bank 1`, `Bank 2`, `Contents`, `Capacity`, `Minimum erase`, `Probe`,
  `Device UID`, `Sources`, `Browser cache`, `App version`, `Games`, `Covers`, `Saves`,
  `Zelda assets`, `Latest`, `Published`
- Activity: `All`, `Info`, `Warning`, `Error`, `Debug`, `Converter`, `Device`, `Filter`,
  `Showing N of M` (interpolated), `Copy`, `Save`
- Debug: `Address`, `Function`, `Build`
- Actions: `Rescan`, `Back up now`, `Copy details`, `Open Activity`, `Connect`

Runtime values (versions, sizes, dates, filenames, log text) are data, not copy.
