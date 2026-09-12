# Audit — real progress reporting on every write path

Scope: every code path in `apps/web` that writes to the device (SWD/flash) or to durable
storage (File System Access API, IndexedDB, downloads), plus the packages underneath them.
"REAL" = a bar driven by byte or step counts the operation actually emits, visible without
the user having to do anything. Every claim below cites `file:line`; nothing here is inferred
from code that was not read.

One code change was made as part of this audit — see "Change made" at the end.

## How progress reaches the screen

Three layers:

1. **Transport** — `packages/swd-transport/src/index.ts:102-120`: `readMemory`/`writeMemory`
   call `onProgress(off + n, len)` per sub-chunk. Real byte counts.
2. **Flasher** — `packages/gnw-flasher/src/index.ts:638-680` (`flash()`) maps each 256 KiB
   chunk's RAM-buffer transfer onto overall bytes (line 669) and re-reports the settled total
   at the chunk boundary (line 672). `readFlash` forwards the transport's counter directly
   (line 694).
3. **UI** — `installProgress.run({phases, exec})`
   (`apps/web/src/lib/installProgress.svelte.ts:122-165`), rendered by
   `apps/web/src/lib/ui/InstallProgressModal.svelte`.

### The rendering rule that determines every verdict below

`InstallProgressModal.svelte`:

- **Phase-level** progress (`report.progress(id, d, t)`, no `substepId`) is stored in
  `PhaseState.progress` (`installProgress.svelte.ts:244`) and rendered **unconditionally** at
  `InstallProgressModal.svelte:101-106`. Always visible.
- **Sub-step-level** progress (`report.progress(id, d, t, label, substepId)`) is stored in
  `substepProgress` (`installProgress.svelte.ts:243`) and rendered **only inside the
  `{#if s.substeps.length > 0 && s.expanded}` block** (`InstallProgressModal.svelte:107-127`),
  i.e. the bar at line 118 and the `[n/m]` counter at line 122 exist only while the phase is
  expanded. Phases start collapsed (`installProgress.svelte.ts:142`, `expanded: false`) and
  `finish()` forces them closed again (`installProgress.svelte.ts:216`). Nothing ever
  auto-expands.
- A sub-step id that is **not** in the phase's declared `substeps` array is unreachable in
  any state — the template iterates `s.substeps` (line 109), not `substepStatus`/
  `substepProgress`, so its data is stored and never drawn.

That is the dominant finding of this audit: several of the longest device writes report
genuinely real byte progress that the modal will not show unless the user clicks the phase
open.

## Table

| Operation | Entry point | Progress UI today | Verdict | To make it real |
|---|---|---|---|---|
| Retro-Go base install — flash regions (Wizard step 2) | `views/Wizard.svelte:654-679` → `engine/flashInstall.ts:296` | `report.progress("flash", d, t, label, phase)` at `Wizard.svelte:677` — sub-step-scoped. Sub-steps declared only for frogfs/littlefs (`Wizard.svelte:506`), so **intflash has no declared sub-step at all**; frogfs/littlefs bars exist but only while expanded | **HIDDEN (real data, not shown)** for frogfs/littlefs; **NONE** for the intflash write | Also report phase-level (`report.progress("flash", d, t)`) so `InstallProgressModal.svelte:101` draws it, or auto-expand the active phase. UI decision — no new copy needed for the phase-level route |
| ROM install → FrogFS region (ROMs tab) | `views/RomManagementTab.svelte:1875-1895` → `engine/flashInstall.ts:231-254` | Was reported into sub-step `"frogfs"`, which `flashPhases` (`RomManagementTab.svelte:782-788`) deliberately does not declare → **rendered nowhere, in any state** | Was **NONE**; **fixed** → now phase-level (`RomManagementTab.svelte:1889`), REAL | Done (see "Change made") |
| Retro-Go install — flash regions (Advanced ▸ RomSection) | `advanced/RomSection.svelte:647-666` | `report.progress("flash", d, t, label, phase)` at line 655; sub-steps declared per region (`RomSection.svelte:101`) | **HIDDEN (real data, not shown)** | Same as Wizard step 2 |
| OFW patch + flash (Wizard step 1) | `views/Wizard.svelte:275-310` → `engine/ofw.ts:125-205` | Phase-level `report.progress("flash-internal"/"flash-external", sub.value, sub.max, sub.label)` at `Wizard.svelte:300,307`, fed by `ofw.ts:184-204` | **REAL** | — |
| OFW patch + flash (Advanced ▸ Official Firmware) | `advanced/OfficialFirmwareSection.svelte:283-309` | Phase-level at lines 297, 304 | **REAL** | — |
| OFW patching itself (LZMA/CPU) | `engine/ofw.ts:145` (`patchModel`) | The `"patch"` phase (`Wizard.svelte:165`, `OfficialFirmwareSection.svelte:269`) shows a spinning icon only; `ofw.ts:123` documents this ("Patching itself is CPU-only (no progress)") | **INDETERMINATE** | `patchModel` would have to emit step callbacks; genuinely absent upstream today |
| Restore to stock | `views/Wizard.svelte:813-841` → `engine/ofw.ts:354-395` | Phase-level at `Wizard.svelte:831,838` | **REAL** | — |
| OFW backup dump (Wizard step 1) | `views/Wizard.svelte:230-236` → `engine/ofw.ts:99-112` | Phase-level `report.progress("read-device", d, t, …)` at `Wizard.svelte:234` | **REAL** (read, but the flow's longest phase) | — |
| OFW backup dump (Advanced) | `advanced/OfficialFirmwareSection.svelte:236-240` | Hand-rolled bar at `OfficialFirmwareSection.svelte:439-442` driven by `backupDone`/`backupTotal` — bypasses `installProgress`/`Progress.svelte` | **REAL** (bespoke) | Optional consolidation onto `ui/Progress.svelte`; behaviour is already correct |
| Backup file write to disk | `engine/ofw.ts:317-326` (`writeBackup`), called `Wizard.svelte:245`, `OfficialFirmwareSection.svelte:245` | A single log line (`Wizard.svelte:244`); no counter | **NONE** | Two `createWritable` writes of up to ~4 MB; would need a 2-step counter. Low value |
| Raw image flash (Advanced ▸ Flash) | `advanced/FlashSection.svelte:63-71` | Phase-level `report.progress("flash", d, t)` at line 68 | **REAL** | — |
| Erase partitions (Advanced ▸ Erase) | `advanced/EraseSection.svelte:88-101` | Sub-step-scoped at lines 91, 98; sub-steps declared (`EraseSection.svelte:50-57`) | **HIDDEN (real data, not shown)** | Same as Wizard step 2 |
| Flash dump to file (Advanced ▸ Dump) | `advanced/DumpSection.svelte:85-90` | `<Progress>` at `DumpSection.svelte:173`, driven by `dumpRegion`'s byte callback | **REAL** | — |
| Screenshot capture (halt/read/resume) | `views/OverviewTab.svelte:315-322` | Phase-level at line 318 | **REAL** | — |
| SD sync — games / covers / cheats / removals | `views/RomManagementTab.svelte:1645-1726` | Sub-step-scoped file counters (lines 1658, 1674, 1690, 1710), pre-seeded to `[0/N]` (lines 1640-1643) | **HIDDEN (real step data, not shown)** — and file counts, not bytes | Expose at phase level, or auto-expand the active phase |
| SD sync — cores/bios/fonts bundle | `views/RomManagementTab.svelte:1730-1742` | Sub-step goes active, per-file log lines only. **No `report.progress` call at all**, unlike its four siblings — and the comment at `RomManagementTab.svelte:1619-1620` calls this "the bulk of the sync's data" | **NONE** | Add the same `done/total` loop counter the sibling loops use (lines 1652-1659). No new copy needed — the `[n/m]` counter is rendered by the modal, not by a string |
| SD sync — `update_bank2.bin` | `views/RomManagementTab.svelte:1745-1756` | Log line only | **NONE** (single file; a counter would be `[0/1]`) | Not worth it |
| SD sync — Firefox ZIP fallback | `views/RomManagementTab.svelte:1757-1768` | Log line, then `zip.generateAsync` and a download | **NONE** | JSZip's `generateAsync` accepts an `onUpdate` callback; would be a real percent |
| SD cores sync after install (Wizard step 2) | `views/Wizard.svelte:696-704` | Sub-step-less phase → `report.progress("sd-sync", doneFiles, totalFiles, …)` at line 703 is **phase-level** (no `substepId`) | **REAL** (per file, not per byte) | — |
| SD cores sync after install (Advanced ▸ RomSection) | `advanced/RomSection.svelte:683-691` | Phase-level at line 690 | **REAL** | — |
| Wizard step 2 ZIP fallback | `views/Wizard.svelte:705-713` | Log line + `zip.generateAsync` | **NONE** | Same as the ROMs-tab fallback |
| RAM stub load (`startStub`) | `packages/gnw-flasher/src/index.ts:259-297`, via `engine/flasher.ts:19-23` and `device.svelte.ts:383-388` | `StubLoadModal.svelte` is a **confirm gate only** — no progress element anywhere in the file (`ui/StubLoadModal.svelte:10-29`). The write is `writeVerified(FW_LOAD_ADDR, fw, true, …)` (`index.ts:276`) with a full read-back verify (`index.ts:529-560`) | **NONE** | `startStub` already accepts a `log`; it would need an `onProgress` threaded into its `writeVerified` call (the parameter exists, `index.ts:535`) and a bar in `StubLoadModal`. Would need a label → new copy → out of scope per the artboard rule; the bar itself needs none |
| Migrate: read installed games off the device (Wizard step 2) | `views/Wizard.svelte:579-584`, `read` defined at line 542 | `dumpRegion(flasher, 0, off, len)` — `onProgress` argument **omitted**; only a summary log line at 584 | **NONE** | Pass a callback and report `report.progress("migrate-scan", …, "games-migrate")`. Can be many MB of reads |
| Migrate: read installed games (ROMs-tab install) | `views/RomManagementTab.svelte:1811,1817-1819,1830` | Same — `dumpRegion` called with no `onProgress`; only `report.log` at 1832 | **NONE** | Same |
| Firmware bundle download | `artifacts.ts:112-115` (`res.arrayBuffer()`), called from `Wizard.svelte:595`, `RomManagementTab.svelte:605/1632/1843`, `RomSection.svelte:461` | Log line after the fact (`Wizard.svelte:597`) | **NONE** | `res.body.getReader()` + `Content-Length` would give a real percent. Multi-MB over the network |
| FrogFS/LittleFS image build | `engine/flashInstall.ts:90-181` | `onStep` fires only after each of frogfs/littlefs/superblock completes (`flashInstall.ts:141,166,178`) → three checklist ticks, no intra-step motion | **INDETERMINATE** (by construction) | The builders (`@gnw/fs-builders`) emit nothing today; genuinely absent upstream |
| Bundle zip → IndexedDB | `sources/store.svelte.ts:371` → `sources/bundleStore.ts:114` | None; `store.svelte.ts:367-370` explicitly documents the write as deliberately unsurfaced | **NONE (intentional)** | Leave |
| Cover art written to the ROM folder | `views/GameDetailsPanel.svelte:506` (single apply) and `:655` (bulk import) | Single apply: none. Bulk import: `importProgress.current/total` rendered at `GameDetailsPanel.svelte:1441-1444`, fed by the scraper's `onProgress` at line 585 | Single: **NONE** (one small file). Bulk: **REAL** (per file) | Single-file case not worth a bar |
| LittleFS file download (Advanced ▸ Files) | `advanced/FileBrowserSection.svelte:103-111` | An hourglass glyph per row (line 158) | **INDETERMINATE** | `readLfsFile` would need a byte callback; small files |
| LittleFS tree read | `advanced/FileBrowserSection.svelte:88` | Percent text at line 190, from `ensureLfsTree`'s `(done,total)` callback | **REAL** (text, not a bar) | — |

## Prioritized gaps

1. **Sub-step progress is invisible by default.** The single highest-impact item. Every
   long device write in the two primary install flows (Wizard step 2 flash, Advanced
   RomSection flash, Erase, SD sync's four per-file loops) emits real progress that
   `InstallProgressModal.svelte:107` will not render because the phase is collapsed
   (`installProgress.svelte.ts:142,216`). One of two fixes, both structural rather than
   copy-adding: auto-expand the active phase, or mirror the active sub-step's counter to
   the phase-level `progress` slot that line 101 always draws. This is a UI-shape decision
   and is deliberately left to the owner.
2. **The intflash write in Wizard step 2 has no progress row at all.** `Wizard.svelte:506`
   filters `intflash` out of the declared sub-steps, and line 677 reports progress keyed by
   region — so the intflash bytes go to an undeclared sub-step id. On a base install this is
   the first and one of the longest writes.
3. **SD sync's cores/bios/fonts loop has no counter** (`RomManagementTab.svelte:1730-1742`)
   while its four siblings do. Called "the bulk of the sync's data" in the file's own comment.
   A four-line fix matching lines 1652-1659, needing no new strings.
4. **The RAM stub load is completely unreported** (`StubLoadModal.svelte`, whole file). It is
   a device write with a full read-back verify (`gnw-flasher/src/index.ts:276,529-560`) that
   happens before nearly every other operation. A bar needs no new copy; a label would.
5. **Game-migration device reads pass no `onProgress`** (`Wizard.svelte:542`,
   `RomManagementTab.svelte:1811`). Reads, not writes, but they sit inside write flows as
   silent multi-MB phases.
6. **Firmware bundle download is unreported** (`artifacts.ts:113-115`). Network, not device,
   but it is a visible multi-second "nothing is happening" window in every install flow.
7. **ZIP fallback generation is unreported** in both SD paths (`RomManagementTab.svelte:1766`,
   `Wizard.svelte:711`). JSZip's `generateAsync` already offers `onUpdate`.

## Caveat on what "real" means for a flash bar

Even where the bar is REAL and visible, it is **bursty, not linear**.
`packages/gnw-flasher/src/index.ts:662-672` advances progress while the host pushes a chunk
into the device's RAM context buffer, then holds completely still through
`waitForContextComplete` (`index.ts:500`) and `waitForIdle` (`index.ts:520`) — the device-side
erase/program/hash-verify, which is where much of the wall time goes. That is honest
reporting of host-side bytes, not a defect, but it does mean a correct bar can sit motionless
for seconds at a chunk boundary. The 120 s no-progress watchdog in `engine/flasher.ts:117-124`
is sized for exactly this.

## Change made

`apps/web/src/lib/views/RomManagementTab.svelte:1889` — the ROM-install FrogFS flash reported
its byte progress into sub-step `"frogfs"`, but the `"flash"` phase in `flashPhases`
(`RomManagementTab.svelte:782-788`) deliberately declares no sub-steps, so the data was stored
in `substepProgress` and rendered by nothing (the modal iterates the declared `substeps` array,
`InstallProgressModal.svelte:109`). The call is now phase-level, which
`InstallProgressModal.svelte:101-106` renders unconditionally. The hardcoded English label
`"Games, BIOS, languages → ext"` that the old call passed was dropped rather than promoted:
at phase level it would be drawn, and that would introduce untranslated user-facing copy. No
strings were added or changed.


---

## Status update — 2026-09-07

Gaps 1-2 of the prioritized list were closed by `0e3f1bc` / `224736f` (the artboard progress
checklist; intflash reported at phase level, since `GuidedFlashing.dc.html` shows only two
children under "Flashing Retro-Go" and the owner's own instruction was "no 3rd intflash line").

The five **copy-free** gaps were closed by `2eba7bc`:

| Gap | Where the number now comes from |
|---|---|
| SD sync cores/bios/fonts | the sibling `done/total` loop shape, into the declared `cores` sub-step |
| Migrate read, Wizard step 2 | `dumpRegion`'s `onProgress`, into the declared `games-migrate` sub-step |
| Migrate read, ROMs-tab install | same, into the declared `retain` sub-step |
| Firmware bundle download | new `readBodyWithProgress()`; `fetchBundle(tag, onProgress?)`, reported at PHASE level |
| Both ZIP fallbacks | JSZip `generateAsync`'s `onUpdate`, phase level, clamped 0..100 |

Covered by `apps/web/test/downloadprogress.mjs` (13 checks, wired into `check` and `build`),
proven non-vacuous against four mutations: dropping the final progress pin, corrupting the
reassembly offset, dropping the `Math.min` clamp, and removing the no-`Content-Length` guard.

**Still open, and each needs a LABEL — i.e. new copy, i.e. an artboard:** the RAM stub load bar
(`StubLoadModal` is a confirm gate with no progress element), the backup file write, and
`fetchBundle`'s three other call sites. That last one is worth stating precisely: two of them
(`RomManagementTab.svelte:1632` and `~:1855`) DO sit inside a declared phase, but each has
substantial work after the download — writing files, packing FrogFS — so a phase-level bar would
fill to 100% and sit pinned while the real work continued. That reads as a lie. An honest bar
there needs its own declared sub-step, which needs a label.

Judged not worth a bar and deliberately left: `update_bank2.bin` (a counter would read `[0/1]`),
the single-file cover write, and the bundle-zip IndexedDB write, which `store.svelte.ts:367-370`
documents as intentionally unsurfaced.
