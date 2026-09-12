# Code Audit Notes

Findings from a full audit (2026-07-02) covering apps/web's state/UI/engine layers (#1-#11)
plus a follow-up deep-dive into packages/ internals and the component/CSS layer beyond modals
(#12-#13), extended 2026-07-03 with owner-reported findings (#14-#19). The original batched
execution plan lived at `/home/doug/.claude/plans/jaunty-squishing-marble.md`.

## Re-verification pass (2026-09-07, statuses re-checked 2026-09-08)

**The pre-2026-09-07 header ("items #1-#4 are fixed; #5-#13 documented, not yet fixed") is no
longer accurate and has been replaced by this section.** The UI redesign landed in between
(notably `cd590c8`, "UX overhaul: ROMs/Overview/Firmware Setup redesign, connection
reliability, i18n") and deleted or rewrote several components this document audits by name:
`DeviceInfoTab.svelte` (-> `views/OverviewTab.svelte`), `ConnectAdapterModal.svelte` (->
`ui/ConnectGateModal.svelte`), `AccordionSection.svelte`, and `lib/idb.ts`. `RomManagementTab`
and `GameDetailsPanel` moved from `lib/advanced/` to `lib/views/`. **Every line number cited in
items #1-#13 below predates that move and is stale**; the per-item
`**Re-verified (2026-09-07):**` notes carry current `file:line` citations.

This pass changed no application code — only this document.

**On line numbers and counts (added 2026-09-08).** The `file:line` citations and the
"N sites / N writers" figures in the re-verified blocks below were accurate on the date next to
them and drift within days — `apps/web/src/lib/views/RomManagementTab.svelte` and
`device.svelte.ts` in particular move on almost every commit. Treat every one as a pointer, not
a fact: re-run the grep the surrounding text names. Several were found stale on 2026-09-08 and
either refreshed or replaced with the command that produces them; do the same rather than
copying a number out of here into a brief.

### Counts by status

| Status | Items |
|---|---|
| FIXED (verified still holding, or fixed since the original write-up) | #1, #2, #3, #4, #7, #8, #9, #10, #11, #13, #14, #15, #17, #18, #19 — 15 |
| PARTIALLY FIXED (a real remainder is still OPEN) | #5, #6, #12 — 3 |
| OPEN (essentially untouched) | none — 0 |
| OBSOLETE / superseded | #16 (its `firmware` half; the rest is still deferred) — 1 |
| WRONG (finding itself mistaken) | none newly found this pass — the two false positives inside #13 (Card.svelte, Button.svelte adoption) were already recorded as such in 2026-07 |

### OPEN work, in priority order

1. **#12 `packages/` duplication** — the least-touched area. Its *test-coverage* half is
   **DONE**: `swd-transport`, `gnw-flasher` and `builder-core` each have a `test/` directory
   and a passing suite (`eb26fd0` `packages/swd-transport/test/transport.mjs`, `72ec441`
   `packages/gnw-flasher/test/protocol.mjs`, `06b39d2`
   `packages/builder-core/test/resolveBuild.mjs`; all three are listed in CLAUDE.md's Build &
   test block and each prints its own pass count when run — read the count off the run, don't
   quote one from here). The *duplication* half is still open, verified 2026-09-08:
   `crc32`/`CRC_TABLE` still duplicated verbatim (line numbers re-derived 2026-09-10)
   (`packages/gnw-patch/src/superblock.ts:129,139` vs `packages/fs-builders/src/frogfs.ts:346,356`);
   `notImplemented` still triplicated (`gnw-flasher/src/index.ts:278`,
   `builder-core/src/index.ts:88`, `fs-builders/src/index.ts:111`).
   *Needs a decision*, not mechanical work: consolidating `crc32` requires either a new
   dependency edge between two deliberately-independent packages or a new shared workspace
   package (see #12's own deferral reasoning — unchanged and still correct).
   *Safe mechanical work within it*: none — the dedup is the decision, and the smoke tests
   this entry used to propose have since been written.
2. **#5/#16 `utilLoaded` / `installedGames` single-owner consolidation** — `firmware` is now
   solved (a pure derived getter off `deviceClass`), which removes the hardest third of the
   problem, but `utilLoaded` and `installedGames` are unchanged — each still written from
   several places in `device.svelte.ts` (enumerate with
   `grep -n 'this\.utilLoaded = \|this\.installedGames = ' apps/web/src/lib/device.svelte.ts`
   rather than trusting a count here; both counts quoted in this document have already drifted).
   *Needs the use-case-scoping session #16 describes* — still not mechanical.
   Still OPEN, re-verified 2026-09-08.
3. **#13 dead `ui/Badge.svelte` / `ui/InfoTip.svelte` — DONE (`ef34572`, 2026-09-07).** Both
   were deleted, along with `Badge`'s stale mention in `i18n/strings/shared.ts`'s component
   list. Adoption in `Wizard.svelte`'s `.step-num` was again rejected for the 2026-07 reason
   (3-state ancestor cascade), so deletion was the honest fix. A re-verification sweep
   (2026-09-08) confirmed both files are gone and that nothing references them: the only
   surviving `Badge` hits repo-wide were prose in `docs/audit-ui-conformance.md`
   (describing the pre-redesign `OfficialFirmwareSection`) and an unrelated colour note —
   all three since annotated or corrected in the dead-reference pass below; `InfoTip` has
   zero hits anywhere. The same sweep found **three** further zero-importer files under
   `apps/web/src/lib/**`: `ui/FilePick.svelte` was deleted (`863290c`, with its two
   `shared.filePick.*` keys removed from all seven locales); `ui/InstallGeometry.svelte` and
   `ui/Card.svelte` were deliberately kept — see #13's own status block for why.
4. **#8 remaining un-namespaced localStorage keys** — **DONE** (`463165e`, call-site guards
   added 2026-09-08). `theme` → `gnw:theme`, `locale` → `gnw:locale`, both via `persist.ts`'s
   `loadRawMigrated()`/`saveRaw()` with a one-time adopt-and-delete migration. See item #8.
5. **#6 `sdReady` adoption** — still OPEN, re-verified 2026-09-08. The getter exists on
   `DeviceStore` but is used at far fewer sites than the spelled-out
   `device.targetMedia === "sd"` (compare
   `grep -rn 'sdReady' apps/web/src` against `grep -rn 'targetMedia === "sd"' apps/web/src`).
   Most of the spelled-out sites are legitimate *mode* branches (not the "SD mode AND a handle
   is granted" compound gate), so this is **not** a blanket find-and-replace; it needs per-site
   judgement. Low value, low risk.
6. **#4 remaining `alert()` calls** — still OPEN, re-verified 2026-09-08, and one fewer than
   this list previously said: `advanced/FileBrowserSection.svelte`,
   `views/GameDetailsPanel.svelte` (×4). The `OverviewTab.svelte` `startFlashUtil` call this
   entry used to list is gone — `OverviewTab.svelte` has no `alert()` left. Enumerate the
   current set with `grep -rn 'alert(' apps/web/src --include=*.svelte` rather than quoting
   line numbers from here. The one the original audit actually named is gone with its file.
   *Safe mechanical work* if the owner wants the state-var/inline-error treatment extended;
   purely cosmetic otherwise.

### Not determined

- Whether the deliberate non-consolidations recorded in #1 (three remaining timeout shapes),
  #10 (`roms.svelte.ts` console logging) and #13 (`tokens.css` dark-theme blocks, Card/Button
  adoption) are still the *right* calls was not re-litigated — only that the code still matches
  what those notes describe. CLAUDE.md has since hardened the #1 area further (120s stall
  watchdog, poll-pause, auto-retry), which is consistent with leaving them separate.
- #14's own "not yet investigated" follow-up (GameDetailsPanel's per-game buttons and
  `ensureFolders`/`FolderGateModal` gating) was not examined in this pass either.
- No runtime or visual verification was performed (no device operations, no `vite build`);
  every status below rests on source reading and grep.

## 1. Timeout/retry sprawl (worst offender)

At least 5 independent implementations, all with different timeout values, retry semantics,
and error styles. This class of duplication is what caused the screenshot-reboot bug (a
watchdog silently queuing `transport.reset()` mid-screenshot).

| Implementation | Location |
|---|---|
| `withTimeoutAndRetry` (1s timeout, 2 retries, USB-reset between) | `apps/web/src/lib/engine/transport.ts:85` |
| `withTimeout` (progress-resetting timeout + AbortController) | `apps/web/src/lib/views/Wizard.svelte:129` |
| `flashImage` setInterval watchdog (15s stall detector) | `apps/web/src/lib/engine/flasher.ts` |
| `Promise.race` time-boxes in `stubAlive` (2.5s) / `pollTick` (300ms) | `apps/web/src/lib/device.svelte.ts:174,429` |
| `getContext` deadline loop (10s default, 10ms poll) | `packages/gnw-flasher/src/index.ts:390` |

**Direction:** one shared `withTimeout`/`withWatchdog` utility; consistent abort + error style.

**Status: reviewed, partially consolidated (2026-07-02).** Extracted `raceWithFallback` into
`apps/web/src/lib/engine/timeout.ts` and used it for the two implementations that were
IDENTICAL in shape (simple `Promise.race([op, timeout-resolving-to-false])`, no retry/abort):
`stubAlive` (still 2500ms) and `pollTick` (still 300ms) in `device.svelte.ts`. Timeout values
unchanged.

The other three were deliberately left alone — consolidating them would risk behavior change
on hardware-timing-sensitive code:
- `withTimeoutAndRetry` (transport.ts) — has retry-with-USB-reset-between semantics; no
  equivalent in the other implementations.
- `withTimeout` (Wizard.svelte) — resets a *progress* value on each retry and wires an
  `AbortController`; a "single race" helper can't express that without added complexity.
- `flashImage`'s watchdog (flasher.ts) — a repeating `setInterval` stall detector, not a
  single race; also the one CLAUDE.md explicitly warns not to auto-retry (screenshot-reboot bug).
- `getContext`'s deadline loop (packages/gnw-flasher) — polls repeatedly with a 10ms interval
  until a 10s deadline, not a single race.

**Re-verified (2026-09-07): FIXED as scoped — still accurate.** All five shapes still exist
exactly as the 2026-07 status describes, with the same two consolidated: `raceWithFallback`
(`apps/web/src/lib/engine/timeout.ts:14`) is now used at 4 sites
(`device.svelte.ts:311,331,659`, `Wizard.svelte:666`); `withTimeoutAndRetry`
(`apps/web/src/lib/engine/transport.ts:85`), `Wizard.svelte:323`'s `withTimeout`,
`flasher.ts:118`'s `setInterval` watchdog and `gnw-flasher`'s deadline loops
(`waitForIdle`, `packages/gnw-flasher/src/index.ts:309`) remain separate on purpose. The
timeout *values* moved as CLAUDE.md documents: the flash stall watchdog is 120 s
(`flasher.ts:119`) and Wizard's outer guards now match at three sites
(`Wizard.svelte:291,696,855`) — the "both must stay >=" invariant CLAUDE.md states is
actually **three** siblings now, not two.
## 2. Chunked-read pacing duplicated 3 ways

The ST-Link pacing policy lives in three places with contradictory strategies:

- `BaseTransport.readMemory` — internal 10ms delay per CHUNK when `len > CHUNK` (`packages/swd-transport/src/index.ts`)
- `screenshot.ts` — 64KiB chunks + 10ms between (`apps/web/src/lib/engine/screenshot.ts`)
- `lfsBrowser.ts` `readInChunks` — 1KiB chunks, no delay (`apps/web/src/lib/engine/lfsBrowser.ts`)

**Direction:** the pacing policy belongs in ONE place (the transport layer), with an explicit
knob for "hold the queue" vs "yield between chunks".

**Status: done (2026-07-02).** Extracted `lfsBrowser.ts`'s `readInChunks` into a shared
`readMemoryPaced(transport, addr, len, { chunkSize, delayMs })` helper in
`apps/web/src/lib/engine/chunkedRead.ts`; `lfsBrowser.ts` now calls it (still 1 KiB chunks,
no delay — unchanged behavior). `screenshot.ts` and `BaseTransport.readMemory`
(`packages/swd-transport/src/index.ts`) were left alone (their behavior is deliberately
tuned/different) and each now has a one-line comment explaining why it doesn't use the
shared helper: screenshot.ts needs large 64 KiB chunks to keep the serialTransport queue's
`busy()` window open across the pacing delay; `BaseTransport.readMemory` IS the underlying
primitive the other two are built on, not a duplicate of them.

**Re-verified (2026-09-07): FIXED — holds.** `apps/web/src/lib/engine/chunkedRead.ts` still
exports `readMemoryPaced`; `screenshot.ts` still uses its own 64 KiB path and
`BaseTransport.readMemory` is still the primitive, both as documented and as CLAUDE.md now
independently requires.
## 3. Untracked background work

`_doScan` (`device.svelte.ts:~329`) fires FS-stat reads (`readFatUsedSpace`, `getLfsUsedSpace`)
fire-and-forget: no busy flag, no abort, races freely with user-initiated ops (flash,
screenshot). Errors go to `console.error` only.

**Direction:** track background reads (a task registry or at minimum an in-flight flag +
abort on disconnect/flash-start).

**Re-verified (2026-09-07): FIXED (since the original write-up; not previously recorded
here).** `_doScan`'s successor `runScan()` now takes a generation stamp
(`apps/web/src/lib/device.svelte.ts:435` — `const gen = ++this._gen;`) and every background
read checks it before writing back (`device.svelte.ts:508,514,526`, and `:539` for the SD
path). `_gen` is bumped on disconnect (`:377`), teardown (`:773`) and on each new scan, so an
in-flight FS-stat read for a stale device is a no-op instead of a race. Errors are no longer
bare `console.error` either — they route through `dbg()` (`:509,515`). The `scanning` flag
(`:101`) plus the new `busy` getter (`:199`) provide the in-flight signal the item asked for.
## 4. Error-handling style mix

- `alert()` — DeviceInfoTab screenshot failure
- state variables (`error`, `logErr`, `scanError`, `sdPickerErr`) — most components
- `console.error` — background FS reads, SD scan
- silently swallowed catches — `connectSilent`, `dispose` paths

**Direction:** pick one user-facing error surface (state + toast/banner); reserve swallowing
for genuinely-expected failures with a comment.

**Status: done (2026-07-02).** The screenshot-failure `alert()` in
`apps/web/src/lib/advanced/DeviceInfoTab.svelte`'s `triggerScreenshot()` was replaced with a
`screenshotErr` state variable, cleared at the start of each capture and displayed inline
(`<p class="err">{screenshotErr}</p>`) next to the Capture Screenshot button, mirroring the
existing `logErr` pattern in the same file.

Note: `startFlashUtil()` in the same file still uses `alert()` for its failure path — out of
scope for this pass (only the screenshot-failure `alert()` was named in the audit); worth a
follow-up if the same alert()→state-var treatment is wanted there too.

`console.error`/swallowed catches in background/best-effort paths (SD scan, `connectSilent`,
dispose paths) were reviewed and left alone on purpose — those are intentionally "best
effort, don't interrupt the user" paths (e.g. `connectSilent`'s auto-reconnect attempt on
startup, or a background FS-stat read that shouldn't block/alarm the user over a transient
read failure); converting them to a visible error surface would be a UX regression, not a fix.

**Re-verified (2026-09-07): FIXED as scoped; the named site is OBSOLETE.**
`advanced/DeviceInfoTab.svelte` no longer exists (redesign, `cd590c8`); its screenshot flow
now lives in `apps/web/src/lib/views/OverviewTab.svelte`. The specific `alert()` the audit
named is gone with the file. The broader direction is still only partly met: `alert()`
calls remain in `advanced/FileBrowserSection.svelte` and `views/GameDetailsPanel.svelte` (×4).
Listed as low-priority OPEN work above. (Corrected 2026-09-08: this paragraph also listed
`OverviewTab.svelte:301`, the `startFlashUtil` case — that call no longer exists;
`OverviewTab.svelte` has no `alert()`. Enumerate with
`grep -rn 'alert(' apps/web/src --include=*.svelte`.)
## 5. State layer

`DeviceStore` (`apps/web/src/lib/device.svelte.ts`) and `RomStore`
(`apps/web/src/lib/roms.svelte.ts`) both hold plain `$state` fields set from multiple call
sites, plus one genuinely dead field.

**Vestigial `wantsConnection`** — `device.svelte.ts:47`, declared `@deprecated` already:
```
wantsConnection = $state<boolean>(true);
```
Confirmed dead: `grep -rn "wantsConnection" apps/web/src` returns only that one declaration
line. Never assigned after init, never read by any component or the class itself. Safe to
delete outright.

**Fields set from many inconsistent places** (grepped every assignment site):

| Field | Assignment sites | Notes |
|---|---|---|
| `firmware` | `device.svelte.ts:250,253,299,301,455,473` (6 sites: `applyInfo`, `_doScan`, `pollTick`, `clearInfo`) | Set from 3 different signals: `info.detectedStockFirmware` (applyInfo), `deviceClass.kind` (_doScan), and a live retro-go log probe (pollTick) — three independent codepaths can each set it, with no single source of truth. `pollTick`'s write is gated on `firmware === "unknown"` so it never fights the others, but it's still a third writer. |
| `utilLoaded` | `device.svelte.ts:136,140,212,223,448,505,529,561` (8 sites) | Mirrors `flasher !== null` in most places but not enforced structurally — e.g. line 211-212 nulls `flasher` and separately sets `utilLoaded = false` right next to each other; easy for a future edit to update one and not the other. |
| `installedGames` | `device.svelte.ts:316,319,322,354,382,384,388,479` (8 sites across `_doScan`, `scanSdCardGames`, `clearInfo`) | Two independent scan paths (`_doScan`'s FrogFS read vs `scanSdCardGames`'s SD directory walk) both own this field depending on `targetMedia`; nothing prevents both from firing into it in one code path. |
| `scanning` | `device.svelte.ts:277,328,357,390,506,532,562` (7 sites: `_doScan`, `scanSdCardGames`, `handleLost`, `disconnect`, `resetDevice`) plus `roms.svelte.ts:73` — a **separate, same-named field** on `RomStore` for folder scans. Two unrelated `scanning` booleans exist in the codebase; components must know which store's `scanning` they mean. |
| `connection` | `device.svelte.ts:21,116,142,507,533,567,575` (7 sites) | Reasonably centralized (all within `DeviceStore` methods), but `isConnected` (`:93-95`) duplicates the "connected or attention" check inline everywhere else that doesn't use the getter — see #6. |

**Derivable-but-stored state:** `isConnected` (`:93`) and `accent` (`:89`) are already proper
`$derived`-style getters (correctly not raw `$state`) — no issue there. `extFlashBytes` (`:98`)
and `fitsExtFlash` (`:105`) likewise. No additional derivable-but-stored duplication found in
`DeviceStore` beyond what's already a getter.

**Dead-ish state check:** `everConnected` (`device.svelte.ts:34`) is set once (`:143`) and read
in exactly one place, `apps/web/src/lib/ui/DeviceHeader.svelte:68,76` — alive, not dead.
`accent` (`:89`) is read once, `App.svelte:68` — alive. `roms.svelte.ts`'s `folderGatePrompt`,
`pendingHandle`, `dirtyFiles` all have live readers in `FolderGateModal.svelte` /
`RomManagementTab.svelte` (not enumerated line-by-line here; spot-checked via grep, all have
≥1 external reader).

**Direction:** pick one owner per field. `firmware`/`installedGames` in particular need a
single "classify on scan" codepath instead of 3 independent writers each guarded by ad hoc
`if` conditions; rename `RomStore.scanning` to something folder-specific (`folderScanning`) to
stop the name collision with `DeviceStore.scanning`; delete `wantsConnection`.

**Status: documented, not yet fixed (2026-07-02). `wantsConnection` deleted and `RomStore.scanning`
renamed to `folderScanning` (Batches 1-2). `firmware`/`utilLoaded`/`installedGames`
consolidation attempt started 2026-07-03, deferred — see item #16.**

**Re-verified (2026-09-07): PARTIALLY FIXED — most of it is done, including the hardest part.**
- `wantsConnection`: **FIXED** — deleted; `grep -rn wantsConnection apps/web/src` returns
  nothing. Removed in `cd590c8`.
- `RomStore.scanning` name collision: **FIXED** — renamed to `folderScanning`
  (`apps/web/src/lib/roms.svelte.ts:73,91,107,112,120,127,146,157`, read at
  `lib/ui/FolderGateModal.svelte:55`). `DeviceStore.scanning` (`device.svelte.ts:101`) is now
  unambiguous.
- `firmware`: **FIXED, and more thoroughly than the Direction asked for** — it is no longer
  `$state` at all. It is a derived getter over `deviceClass`
  (`apps/web/src/lib/device.svelte.ts:167-173`) carrying an explicit comment ("`deviceClass`
  … is the sole source of firmware classification. There is no independent 'firmware' fact to
  race"). The three-writer problem is structurally gone; `pollTick`'s log-sniffing guess was
  removed outright (`device.svelte.ts:694`).
- `utilLoaded`: **OPEN** — still assigned from several sites in `device.svelte.ts`, same shape
  as before. (The 2026-09-07 line numbers here were already stale by 2026-09-08; enumerate with
  `grep -n 'this\.utilLoaded = ' apps/web/src/lib/device.svelte.ts` instead.)
- `installedGames`: **OPEN** — still assigned from several sites, still split across the
  flash-scan and SD-scan paths. (Same caveat; use
  `grep -n 'this\.installedGames = ' apps/web/src/lib/device.svelte.ts`.)
See #16 for why the remaining two are deferred rather than mechanical.
## 6. Gating patterns

Every tab/view re-derives its own version of "connected" / "stub loaded" / "folder selected" /
"SD mode" gates instead of sharing one predicate per concept.

**"Connected" gate** — every call site uses the `device.isConnected` getter (good — no raw
`connection === "connected"` re-implementations found in components), but the *combinations*
built on top of it diverge:

| File:line | Gate expression |
|---|---|
| `DeviceInfoTab.svelte:202` | `{#if !device.isConnected}` |
| `DeviceHeader.svelte:22` | `!device.isConnected ? "red" : device.utilLoaded ? "green" : "yellow"` (3-way LED state, connected+util combined ad hoc) |
| `DeviceHeader.svelte:62` | `device.isConnected && !device.scanning` |
| `RomManagementTab.svelte:116` | `device.isConnected && baseInstalled` (`canInstallRoms` derived — combines connected with a locally-computed `baseInstalled`) |
| `RomManagementTab.svelte:1058` | plain `!device.isConnected` |
| `RetroGoTab.svelte:292,313` | `!device.isConnected` inline inside handlers, returning a string status (`"Connect first."`) instead of disabling via a derived |
| `RetroGoTab.svelte:472,516` | `!device.isConnected` combined ad hoc with local `preparing`/`flashing`/`starting` flags, one boolean expression per button, not shared |
| `Wizard.svelte:203` | `!device.isConnected` (same gate, 4th independent copy of the base condition) |

None of these are wrong individually, but the "connected AND not mid-operation" compound gate
(`RomManagementTab:116`, `RetroGoTab:472/516`, `DeviceHeader:62`) is hand-rolled per file with
different locally-named "busy" flags (`baseInstalled`, `preparing`/`flashing`/`starting`,
`scanning`) rather than one `busy` concept exposed by the store.

**"Stub loaded" gate** — `device.utilLoaded` is checked directly in `RetroGoTab.svelte:46,75,113`
(three separate `{#if !device.utilLoaded}` blocks in one file, not hoisted to one derived) and
combined into the LED tri-state in `DeviceHeader.svelte:22`. No file uses a different
spelling for this one (e.g. no stray `flasher !== null` check in a component) — this gate is
comparatively consistent.

**"SD mode" gate** — `device.targetMedia === "sd"` is repeated verbatim at
`RomManagementTab.svelte:33,445,558,1008`, `Wizard.svelte:232,252`, with each site separately
also null-checking `device.sdHandle` (`RomManagementTab.svelte:445,1034,665-685`,
`Wizard.svelte:257,265`) — i.e. the real gate is "`targetMedia === 'sd' && sdHandle`" but it's
re-spelled at each call site rather than exposed as a single `device.sdReady` (or similar)
getter.

**"Folder selected" gate** — `roms.selected` (a getter on `RomStore`, `roms.svelte.ts:85-87`)
is used consistently at `RomManagementTab.svelte:793`; `roms.ensureFolders(...)` (the
promise-gate, see #7) is the other path used at `RomManagementTab.svelte:33,796`. These two
don't conflict, but note `ensureFolders` at line 172 re-checks `this.selected && (!sd ||
!!device.sdHandle)` — i.e. it duplicates the SD-handle-null-check pattern from the previous
paragraph a third time, inside the store this time instead of a component.

**Direction:** add derived getters to the stores for the compound gates actually used
(`device.busy` / `device.readyToOperate`, `device.sdReady`), and use them everywhere instead of
re-deriving the AND-combination locally per component.

**Status: documented, not yet fixed (2026-07-02).**

**Re-verified (2026-09-07): PARTIALLY FIXED — the getters the Direction asked for now exist;
adoption is incomplete.** `DeviceStore` gained exactly the compound gates this item proposed:
`busy` (`apps/web/src/lib/device.svelte.ts:199`), `readyToOperate` (`:204`) and `sdReady`
(`:210`), alongside the pre-existing `isConnected` (`:191`). Every file:line in the table above
is stale — `DeviceInfoTab.svelte`, `RetroGoTab.svelte`'s audited blocks and
`advanced/RomManagementTab.svelte` were all rewritten or moved by the redesign.
Remaining gap: `device.targetMedia === "sd"` is still spelled out at many more sites across
`apps/web/src/lib` than `sdReady` is used at (compare
`grep -rn 'targetMedia === "sd"' apps/web/src` with `grep -rn 'sdReady' apps/web/src`; the
ratio was 36:6 on 2026-09-07 and unchanged on 2026-09-08). Most of the spelled-out sites are genuine *mode*
branches rather than the "SD mode AND handle granted" compound gate (e.g.
`views/RomManagementTab.svelte:130,224,657,680`), so this is a per-site judgement call, not a
mechanical replace. `device.utilLoaded` is still read directly in a dozen-plus components — consistently spelled,
as before, just not hoisted. (The 2026-09-07 file list here was partial and its line numbers
have since moved; use `grep -rn 'device.utilLoaded' apps/web/src`.)
## 7. Modal implementations

Five distinct modal markups exist, none sharing a common shell component, with the exact same
~20-line `.backdrop`/`.modal` CSS block (`position: fixed; inset: 0; z-index: 100; background:
rgba(0,0,0,0.5); …` plus `.modal { background: var(--surface); border: 2px solid
var(--model-accent); border-radius: var(--r-card); box-shadow: 0 8px 30px rgba(0,0,0,0.3); …
}`) copy-pasted verbatim into each `<style>` block:

| File | Gate mechanism | Backdrop/escape markup |
|---|---|---|
| `apps/web/src/lib/ui/StubLoadModal.svelte:8-14` | promise-gate (`device.stubPrompt = {resolve, reject}`, set by `ensureStub()`) | own copy of backdrop/modal CSS (`:32-51`) |
| `apps/web/src/lib/ui/FolderGateModal.svelte:32-38` | promise-gate (`roms.folderGatePrompt = {sd, resolve, reject}`, set by `ensureFolders()`) | own copy of backdrop/modal CSS (`:101-123`), near-identical structure to StubLoadModal |
| `apps/web/src/lib/ui/ConnectAdapterModal.svelte:25-29` | plain open-flag — rendered unconditionally by the parent (no internal `{#if}`), shown/hidden by the caller mounting/unmounting it (no `open` prop; parent controls via `{#if}` at the call site) | own copy of backdrop/modal CSS (`:50-71`) |
| `apps/web/src/lib/ui/ConfirmModal.svelte:71-77` | simple `open` boolean prop + internal `phase` state machine (`confirm`/`running`/`done`/`error`) — the one modal that also manages its own async run+progress lifecycle | own copy of backdrop/modal CSS (`:112-131`), plus its own `phase`-specific styling |
| `apps/web/src/lib/advanced/RomManagementTab.svelte:1149-1159` | plain open-flag (`spaceAlertMessage` string, truthy = shown) — a 5th, ad hoc inline modal not extracted to its own component at all | yet another copy of backdrop/modal CSS (`:1162-1174`), using inline `style="..."` attributes for text color/layout instead of the shared CSS custom properties used elsewhere |

Two different gating idioms in use: **promise-gate** (`StubLoadModal`, `FolderGateModal` — the
store holds `{resolve, reject}` and the modal calls them directly) vs **open-flag** (
`ConnectAdapterModal`, `ConfirmModal`, the inline `RomManagementTab` alert — a boolean/string
prop or truthy value controls visibility, and confirmation is handled via an `onClose`/inline
callback instead of promise resolution). Both are workable patterns but nothing unifies them
under one `<Modal>` shell, so the backdrop-click-to-cancel / Escape-to-cancel logic
(`onclick={(e) => e.target === e.currentTarget && cancel()}`, `onkeydown={(e) => e.key ===
"Escape" && cancel()}`) is retyped, with copy-paste risk, in all five places.

**Direction:** extract a shared `ModalShell.svelte` (backdrop + escape/click-outside handling +
CSS) that all five wrap; keep the promise-gate vs open-flag distinction where it's genuinely
useful (blocking device operations vs simple info dialogs) but stop re-typing the shell markup.

**Status: fixed (2026-07-03).** Created `apps/web/src/lib/ui/ModalShell.svelte` (backdrop +
click-outside/Escape handling + the shared CSS, with `onDismiss`/`borderColor`/`maxWidth`/
`zIndex` props). All 5 modals now wrap it: `StubLoadModal`/`FolderGateModal` (promise-gate,
unchanged), `ConnectAdapterModal`/`ConfirmModal` (open-flag, unchanged — `ConfirmModal` passes
`onDismiss={null}` during its in-flight "running" phase to keep the existing non-dismissible
behavior), and `RomManagementTab`'s inline space-alert (now passes `borderColor="var(--danger,
#d32f2f)"` and `zIndex={200}` to preserve its distinct styling/stacking). The gating idiom
split (promise-gate vs open-flag) was deliberately left alone per the Direction above — only
the shell markup/CSS was unified. Bonus: this incidentally fixed the one pre-existing
`svelte-check` warning (`aria-modal` was on a `role="presentation"` element; `ModalShell` now
correctly places it on the inner `role="dialog"` element). Verified via `svelte-check`
(0 errors, 0 warnings — down from 1 warning). **Needs real-browser visual verification**: all
5 modals' appearance, backdrop-click-to-cancel, and Escape-to-cancel.

**Re-verified (2026-09-07): FIXED — holds, and the pattern propagated.** `.backdrop` CSS is
now defined in exactly one file (`apps/web/src/lib/ui/ModalShell.svelte`); a repo-wide grep
for a second `.backdrop` style block returns nothing. Eight consumers now wrap it — the
original five plus three that did not exist at audit time: `InstallProgressModal.svelte`,
`AddSourcesModal.svelte`, `FilePromptModal.svelte`. Note `ConnectAdapterModal.svelte` was
renamed to `ui/ConnectGateModal.svelte` in the redesign, and `RomManagementTab.svelte`'s
inline space-alert moved to `lib/views/` but still uses `ModalShell`.
## 8. localStorage/IndexedDB usage

**`localStorage` keys** (`grep -rn "localStorage\." apps/web/src`):

| Key | File:line | Naming style |
|---|---|---|
| ~~`theme`~~ → `gnw:theme`, ~~`locale`~~ → `gnw:locale` | `apps/web/src/lib/theme.svelte.ts`, `apps/web/src/lib/i18n/locale.svelte.ts` | **FIXED** — now on `gnw:` via `loadRawMigrated`/`saveRaw` (see below) |
| `gnw:<key>` (namespaced via `persist.ts`'s `saveSel`/`loadSel`, `NS = "gnw:"`) | `apps/web/src/lib/persist.ts:8,13,23` — actual per-key names chosen by callers, e.g. `"ofwBootloader"` (`OfficialFirmwareSection.svelte:66`), `"installMode"` (`RetroGoTab.svelte:37`) | `gnw:` prefix + camelCase key |
| `gnw-target-media` | `apps/web/src/lib/device.svelte.ts:38,43` | kebab-case, own `gnw-` prefix (different from `persist.ts`'s `gnw:` prefix) |
| `gnw_skip_screenshot_confirm` | `apps/web/src/lib/advanced/DeviceInfoTab.svelte:165,370` | snake_case, no `gnw` prefix separator consistency (underscore instead of colon or dash) |
| `coverstudio.systems` | `apps/web/src/lib/screenscraper/run.js:14,215,221` | dot-namespaced, unrelated `coverstudio` product name (vendored screenscraper module) |
| `coverstudio.lang` | `apps/web/src/lib/screenscraper/i18n.js:299,305,323` | same dot-namespace as above |
| `ssUsername`, `ssPassword`, `ssRemember`, `ssPreferLocal`, `ssSaveLocal` | `apps/web/src/lib/advanced/GameDetailsPanel.svelte:237,439-443,628-637` | bare camelCase, no namespace prefix at all — 5 keys living directly in the global localStorage namespace, easy to collide with anything else |

Four distinct prefixing conventions in active (non-vendored) app code: no-prefix (`theme`),
`gnw:` (persist.ts helper), `gnw-` (device store), `gnw_` (DeviceInfoTab), plus bare unprefixed
(`ssUsername` etc.) and a third-party dotted convention (`coverstudio.*`, presumably inherited
from the vendored screenscraper code, out of scope to rename).

### RESOLUTION — the two bare keys (`463165e`, guards extended 2026-09-08)

`theme` → `gnw:theme` and `locale` → `gnw:locale`, and the `ss*` credential keys are on `gnw:`
too. The rename is a **migration, not a rename**: `persist.ts`'s `loadRawMigrated(key, legacyKey)`
returns the namespaced value if present (sweeping away any stale legacy leftover), otherwise
adopts the legacy value, writes it forward under `gnw:` and deletes the old key — so an existing
user keeps their theme and language, and once the namespaced key exists the fallback branch is
unreachable. `saveRaw()` is the matching writer (raw string, no JSON — unlike `loadSel`/`saveSel`,
these two values are bare strings). Neither key is a credential, so `localCrypt.ts`'s obfuscation
deliberately does **not** apply; it stays reserved for `gnw:ssPassword`.

There is no other reader of either bare key: `apps/web/index.html` has no inline pre-paint/FOUC
script at all (the theme is stamped on `<html>` by `theme.svelte.ts` at module load), and the
throwaway `frontend/`/`backend/` harnesses never touch them.

`apps/web/test/storage-migration.mjs` now runs **10** checks. 1-5 are the helper contract (legacy
only / new only / neither / `saveRaw` encoding / a throwing private-mode `localStorage`). 6-10 are
**call-site guards**, added because the helpers being correct buys nothing if a consumer stops
using them — and a direct `localStorage.getItem("theme")` type-checks perfectly, so no other gate
in this repo can see it. They assert on source (the two consumers are `.svelte.ts` rune modules,
not bundleable here) that each routes through `loadRawMigrated`/`saveRaw` with the right
key/legacy-key pair and touches no `localStorage` directly, that no file anywhere under
`apps/web` reads or writes a bare `theme`/`locale` key, and that `index.html` grows no inline
storage-reading pre-paint guard. All five were mutation-tested (dropped write-forward; legacy
preferred over namespaced; a bypassed consumer; an added FOUC guard) — every mutation failed at
least two checks.

**Security note (adjacent, worth flagging):** `GameDetailsPanel.svelte:634`
(`localStorage.setItem('ssPassword', ssPassword)`) stores a ScreenScraper account password in
plaintext in `localStorage` when "remember" is checked (`:628-637`). Not a duplication finding
per se, but worth a follow-up ticket since this is a real credential, not a UI preference.

**IndexedDB usage** (`grep -rn "indexedDB\|idb" apps/web/src`) — three independent open()
calls, three separate databases, no naming collision but no consolidation either:

| DB name | File:line | Purpose |
|---|---|---|
| `gnw-web-builder` | `apps/web/src/lib/idb.ts:3` | generic key/value store |
| `gnw-handles` | `apps/web/src/lib/persist.ts:33,38` | **also** directory-handle persistence (`saveDir`/`loadDir`), but a DIFFERENT database from `idb.ts`'s `gnw-web-builder` |
| `cover-scraper-cache` | `apps/web/src/lib/screenscraper/cache.js:6,14` | screenscraper image/API cache (vendored module, reasonable to keep separate) |

`idb.ts` (`gnw-web-builder` DB) and `persist.ts` (`gnw-handles` DB) look like they may be
solving the same problem (generic small-value + FileSystemHandle persistence) in two separate
IndexedDB databases — worth checking whether `idb.ts` is actually used anywhere or if it's
dead scaffolding superseded by `persist.ts` (see #9, dead code).

**Duplicated save/load helpers:** none found beyond the naming above — `saveSel`/`loadSel`
(persist.ts) is already the single shared wrapper used by both `OfficialFirmwareSection.svelte`
and `RetroGoTab.svelte`; no copy-pasted reimplementation of it exists elsewhere.

**Direction:** pick one prefix convention (`gnw:` matches the existing `persist.ts` helper) and
migrate `gnw-target-media`, `gnw_skip_screenshot_confirm`, and the bare `ss*` keys onto it;
confirm whether `idb.ts`'s `gnw-web-builder` DB is dead and can be deleted in favor of
`persist.ts`'s `gnw-handles`; separately flag the plaintext password storage.

**Status: documented, not yet fixed (2026-07-02).**

**Re-verified (2026-09-07): PARTIALLY FIXED — the two things actually worth fixing are done.**
- The five bare `ss*` keys are now namespaced: `gnw:ssUsername` / `gnw:ssPassword` /
  `gnw:ssRemember` / `gnw:ssPreferLocal` / `gnw:ssSaveLocal`
  (`apps/web/src/lib/views/GameDetailsPanel.svelte`; note the file moved from `advanced/`).
- The **plaintext-password security note is addressed**: the stored value now goes through
  `apps/web/src/lib/localCrypt.ts` (`obfuscate`/`deobfuscate`, AES-GCM with a bundle-embedded
  key). Per CLAUDE.md this is obfuscation, not real security — a deliberate, documented choice
  for a credential that must stay recoverable to be re-sent.
- `gnw-target-media` and `gnw_skip_screenshot_confirm` are both **gone** (the latter with
  `DeviceInfoTab.svelte`).
- Still OPEN: `theme` (`lib/theme.svelte.ts:6,17`) and `locale`
  (`lib/i18n/locale.svelte.ts`) remain bare, unprefixed keys — `locale` is new since the
  audit, i.e. the un-namespaced habit reappeared once. Renaming needs a read-old-key migration.
- IndexedDB: `idb.ts`'s `gnw-web-builder` DB is **deleted** (see #9), so the duplication this
  item flagged is resolved. Three DBs remain, but different ones: `gnw-handles`
  (`lib/persist.ts:33,38`), `gnw-bundles` (`lib/sources/bundleStore.ts:34,53` — new since the
  audit, a genuinely separate concern: cached firmware-bundle blobs), and the vendored
  `cover-scraper-cache` (`lib/screenscraper/cache.js`). No consolidation needed.
## 9. Dead code

**`apps/web/src/lib/idb.ts` is entirely dead** — 4 exports (`getDb`, `saveHandle`, `loadHandle`,
`verifyPermission`), zero importers anywhere in `apps/web/src` (`grep -rn "from \"\./idb"
apps/web/src` and `grep -rn "idb.js"` both return nothing). It duplicates functionality that
now lives in `apps/web/src/lib/persist.ts` (`saveDir`/`loadDir`/`handlePermission`, using a
different DB name `gnw-handles` vs this file's `gnw-web-builder` — see #8). Reads as an earlier
version of the directory-handle persistence that was superseded by `persist.ts` but never
deleted.

**`@deprecated`/"remove" markers:** only one hit for `grep -rln "@deprecated\|TODO: remove\|
FIXME" apps/web/src` — `device.svelte.ts:46` (`wantsConnection`, already covered in #5). No
other deprecation markers exist in the codebase.

**Commented-out code blocks:** none found. Searched for large trailing-comment blocks and
commented-out markup/script fragments (`^\s*//.*<Component`, `^\s*// <script`, multi-line `/*
*/` blocks outside of normal doc comments) — nothing resembling a stale disabled code block
turned up; the codebase does not appear to have a commented-out-code hygiene problem.

**Spot-checked exports for unused status** (not exhaustive): `apps/web/src/lib/util.ts`'s
`download()` and `kb()` — both actively used (`DumpSection.svelte:4,96` for `download`; `kb` is
used across several components for byte-count formatting). No dead exports found here. Note
`apps/web/src/lib/screenscraper/util.js:23` implements its own separate `a.download =
filename` blob-download helper — a second, independent implementation of the same pattern as
`util.ts`'s `download()` (see #11).

**Direction:** delete `apps/web/src/lib/idb.ts` outright (confirm with a repo-wide grep first
in case a build script or the throwaway `frontend/` harness references it, but nothing in
`apps/web/src` does); remove the vestigial `wantsConnection` field alongside it (#5).

**Status: documented, not yet fixed (2026-07-02).**

**Re-verified (2026-09-07): FIXED — both named items are gone.** `apps/web/src/lib/idb.ts` no
longer exists (deleted in `cd590c8`, confirmed via
`git log --diff-filter=D -- '*lib/idb.ts'`), and `wantsConnection` returns zero grep hits.
`lib/persist.ts` is the sole handle-persistence path.

**New dead code found this pass (was not dead in 2026-07):** `apps/web/src/lib/ui/Badge.svelte`
and `apps/web/src/lib/ui/InfoTip.svelte` each have **zero** importers anywhere in
`apps/web/src` (checked every `lib/ui/*.svelte` against the whole tree, `.svelte` + `.ts`).
`Badge.svelte` was extracted in 2026-07 for `OfficialFirmwareSection`'s `.num`, which the
redesign rewrote — the extraction outlived its only consumer. **Both were deleted in `ef34572`**
(2026-09-07). (`ui/InstallGeometry.svelte` also has no live call site but is **deliberately parked**
pending the redesign's free-space visual — do not delete that one.)
## 10. Engine layer inconsistencies

**Address constant re-declaration.** `0x90000000` (extflash memory-map base) and
`0x08000000`/`0x08100000` (intflash bank0/bank1) are each re-declared as local constants in at
least 7 separate files instead of importing one shared constant:

| Constant | File:line |
|---|---|
| `EXTBASE = 0x90000000` | `apps/web/src/lib/ui/InstallGeometry.svelte:36` |
| `EXTBASE = 0x90000000` | `apps/web/src/lib/engine/classify.ts:111` |
| `EXTBASE = 0x90000000` | `apps/web/src/lib/advanced/RomManagementTab.svelte:73` |
| `EXTBASE = 0x90000000` | `apps/web/src/lib/advanced/EraseSection.svelte:23` |
| `EXTBASE = 0x90000000` | `apps/web/src/lib/advanced/RomSection.svelte:94` |
| `0x90000000` (inline, no named const) | `apps/web/src/lib/engine/lfsBrowser.ts:28,66` |
| `BANK_BASE = {0: 0x90000000, 1: 0x08000000, 2: 0x08100000}` | `apps/web/src/lib/advanced/addr.ts:39` (this one at least centralizes all 3 bases together, but nothing else imports it) |
| `INT_BANK_BASES = [0x08000000, 0x08100000]` | `apps/web/src/lib/engine/intflashscan.ts:12` |
| `INTFLASH_BANK1_ADDRESS = 0x08000000` | `packages/builder-core/src/index.ts:15` |
| `EXTFLASH_ADDRESS = 0x90000000` | `packages/builder-core/src/index.ts:17` |
| `INTFLASH_BANK1_ADDR = 0x08000000` | `packages/gnw-flasher/src/index.ts:23` |
| `{0: 0x90000000, 1: 0x08000000}` (unnamed inline object) | `packages/gnw-flasher/src/index.ts:27-28` |
| `FLASH_BASE: 0x08000000` | `packages/gnw-patch/src/mario.ts:8`, `packages/gnw-patch/src/zelda.ts:7` (separately, per-device-config object — arguably legitimate since Mario/Zelda configs are supposed to be independent tables, but the value itself is the same literal repeated) |

Five components (`InstallGeometry.svelte`, `classify.ts`, `RomManagementTab.svelte`,
`EraseSection.svelte`, `RomSection.svelte`) each locally name the identical constant `EXTBASE`
— an obvious candidate for one shared export (e.g. from `apps/web/src/lib/advanced/addr.ts`,
which already has `BANK_BASE` but isn't imported by any of them). No LTDC-register constant
duplication was found (screenshot.ts appears to be the only file touching LTDC).

**Read-fn closure signature adapters.** Two *identically-shaped but separately declared* types:

- `ExtReadFn = (offset: number, len: number) => Promise<Uint8Array>` — declared independently
  at both `apps/web/src/lib/engine/fsscan.ts:35` and `apps/web/src/lib/engine/frogfsDevice.ts:11`
  (verbatim duplicate type, not imported from one place).
- `IntReadFn = (addr: number, len: number) => Promise<Uint8Array>` — `apps/web/src/lib/engine/intflashscan.ts:10` (same shape as `ExtReadFn`, just a different parameter name — could be the same type).

The same `(off, len) => dumpRegion(flasher, 0, off, len)` adapter-closure pattern is
reconstructed ad hoc at each call site instead of being built once: `device.svelte.ts:285,314,
338`, and again inline wherever `readInstalledFrogfs`/`readFatUsedSpace`/`getLfsUsedSpace` are
invoked.

**Progress-callback signature variants** — at least 4 distinct shapes in use:

| Shape | Example |
|---|---|
| `(done: number, total: number) => void` — the `ProgressFn` type from `@gnw/gnw-flasher`, used consistently through `flasher.ts:72,90,100,129`, `flashInstall.ts:189,220` | shared, well-behaved |
| `(phase: FlashRegion, done: number, total: number) => void` — a 3-arg variant layering a `phase` discriminator on top of `ProgressFn` | `apps/web/src/lib/engine/flashInstall.ts:214,243` |
| `(done: number, total: number) => void` inline (not imported `ProgressFn`, a structurally-identical but separately-typed inline callback) | `apps/web/src/lib/engine/screenshot.ts:22,66`, `apps/web/src/lib/engine/fsscan.ts:70,104` |
| `(p: number) => void` — **0..1 fraction**, the odd one out | `apps/web/src/lib/engine/lfsBrowser.ts:12,33,37` |
| `(done, total, sub?: {value,total,label}) => void` — object-augmented "report" callback, its own thing | `apps/web/src/lib/ui/ConfirmModal.svelte:27-29` (the `run` prop's `report` callback) |

`lfsBrowser.ts`'s 0..1 fraction is the true outlier — every other progress callback in the
engine layer is `(done, total)` absolute counts; a caller wiring `ensureLfsTree`'s progress into
a `ConfirmModal`/other absolute-count progress bar has to know to multiply by a total itself.

**Logging approaches mixed within the same file** — `apps/web/src/lib/device.svelte.ts` uses
`dbg()` for most background/debug logging (`:207,210,217,225,340,346`) but drops to a bare
`console.error("SD scan failed", e)` at `:387` for the SD-scan catch — the one spot in that
file that doesn't go through `dbg`/`dbgLog`. `apps/web/src/lib/roms.svelte.ts` uses raw
`console.warn`/`console.error` exclusively (`:58,118`) and never imports `dbg`/`dbgLog` at all
— a second, entirely separate logging style living in a sibling store to `device.svelte.ts`.
`LogFn` (from `@gnw/gnw-flasher`, `packages/gnw-flasher/src/index.ts:168`) is the one
consistently-shared type, used correctly across `flasher.ts`/`flashInstall.ts`/the package
itself — no divergence found there.

**Direction:** hoist `EXTBASE`/intflash bank bases into one exported module (a natural home is
`apps/web/src/lib/advanced/addr.ts`'s existing `BANK_BASE`) and import it everywhere; merge
`ExtReadFn`/`IntReadFn` into one shared `MemReadFn` type; convert `lfsBrowser.ts`'s progress to
`(done, total)` to match every other engine function; replace `roms.svelte.ts`'s raw
`console.*` calls with `dbg`/`dbgLog` (or a documented reason why ROM-store logging is
deliberately console-only) and fix the one stray `console.error` in `device.svelte.ts:387`.

**Status: fixed (2026-07-03).** Created `apps/web/src/lib/engine/addr.ts` as the canonical
home for `EXTBASE`/`BANK_BASE` (engine layer, not `advanced/addr.ts` — engine/ never imported
from advanced/ before this, and address constants are device-level truths, not a UI concern).
`advanced/addr.ts` now re-exports `EXTBASE`/`BANK_BASE` from there so its existing consumers
(UI-layer parsing/formatting helpers) are unaffected. All 7 local `EXTBASE`/inline-literal
sites (`InstallGeometry.svelte`, `classify.ts`, `RomManagementTab.svelte`, `EraseSection.svelte`
— simplified its hand-rolled bank-base ternary to `BANK_BASE[s.bank ?? 0]` while there,
`RomSection.svelte`, `lfsBrowser.ts` ×2, `intflashscan.ts`'s `INT_BANK_BASES`) now import
instead of redeclaring. `ExtReadFn`/`IntReadFn` merged into one `MemReadFn` type (also in
`engine/addr.ts`), re-exported under their original names from `fsscan.ts`/`frogfsDevice.ts`/
`intflashscan.ts` so no caller needed updating. `lfsBrowser.ts`'s `ensureLfsTree` progress
callback converted from a 0..1 fraction to `(done, total)` — LittleFS doesn't expose a real
block count up front, so this remains an estimate, but is now reported as `(pct, 100)` instead
of `(pct/100)`, preserving the exact same displayed percentage at its one real caller
(`FileBrowserSection.svelte`). Fixed the stray `console.error` in
`device.svelte.ts`'s `scanSdCardGames` catch → routed through `dbg()`.

`roms.svelte.ts`'s `console.warn`/`console.error` deliberately left as-is (not converted to
`dbg`/`dbgLog`): `dbg()` always logs at `console.debug` severity (hidden by many devtools
default filters) and fire-and-forget POSTs to a throwaway dev-only endpoint
(`/api/debug` → `/tmp/gnw-debug.log`) — downgrading these two real failure paths (cover
conversion, saves-folder pick) to debug severity plus an irrelevant network call would reduce
visibility into genuine problems, not improve consistency.

Not attempted this pass (per plan, deferred as separate/larger efforts): consolidating
`notImplemented()`/LE-codec helpers across `packages/`, unifying error-handling conventions,
adding oracle/unit test coverage for `swd-transport`/`gnw-flasher`/`builder-core` (since done —
`eb26fd0`/`72ec441`/`06b39d2`).

**Re-verified (2026-09-07): FIXED — holds.** `apps/web/src/lib/engine/addr.ts` still exports
`EXTBASE`/`BANK_BASE`/`MemReadFn` and is still the single home CLAUDE.md advertises as a
reusable primitive. No re-introduced local `EXTBASE` declarations were found. The stray
`console.error` in `device.svelte.ts` is still routed through `dbg()`; `roms.svelte.ts` still
uses `console.warn`/`console.error` deliberately, as the 2026-07 note explains.
## 11. Download-blob helper duplication

`grep -rn "createObjectURL" apps/web/src` finds 12 call sites. One is already a shared helper
(`apps/web/src/lib/util.ts:1-7`'s `download(name, data)`, used by `DumpSection.svelte`, see
#9), but every other Blob→objectURL→`<a>`.click() download is a hand-copied inline
reimplementation of the exact same 6-line pattern:

| File:line | Purpose | Notes |
|---|---|---|
| `apps/web/src/lib/util.ts:1-7` | shared `download()` helper | the one that should be reused |
| `apps/web/src/lib/romScan.ts:369-374` (fallback path when FSAA writable isn't available) | download a single file | inline `createElement("a")` + `appendChild`/`removeChild`/`click`/no explicit revoke timing shown around append |
| `apps/web/src/lib/advanced/DeviceInfoTab.svelte:97-101` (`downloadLog`) | download a text log | inline, `revokeObjectURL` called synchronously right after `a.click()` |
| `apps/web/src/lib/advanced/GameDetailsPanel.svelte:768-772` (`downloadSaveFile`) | download a save-file blob | inline, identical shape to DeviceInfoTab's |
| `apps/web/src/lib/advanced/GameDetailsPanel.svelte:922-926` | download a covers-.img zip | inline, identical shape |
| `apps/web/src/lib/advanced/GameDetailsPanel.svelte:951-955` | download a full-size-covers zip | inline, identical shape |
| `apps/web/src/lib/advanced/GameDetailsPanel.svelte:1104-1108` | download a cheats zip | inline, identical shape |
| `apps/web/src/lib/views/Wizard.svelte:277-281` (ZIP-fallback SD cores) | download a ZIP | inline, identical shape |
| `apps/web/src/lib/advanced/RomManagementTab.svelte:697-703` (SD-card ZIP) | download a ZIP | inline, but appends/removes the `<a>` from `document.body` (the only one of these that does — most others skip the append/remove and just call `.click()` on a detached element) |
| `apps/web/src/lib/screenscraper/util.js:22-25` (vendored screenscraper module) | download a blob | separate, pre-existing vendored implementation — reasonable to leave alone since it's a third-party-derived module |

Two call sites are **not** duplicates of the download pattern — they create an object URL for
in-page display, not a download, and shouldn't be folded into a "download" helper:
`apps/web/src/lib/advanced/GameDetailsPanel.svelte:254` (cover preview `<img>` src, revoked via
an `$effect` cleanup) and `apps/web/src/lib/advanced/RomManagementTab.svelte:265` (carousel
cover art `<img>` src, cached in a `coverUrls` Map, not revoked/downloaded at all — a separate,
smaller potential leak worth a footnote but out of scope for this duplication finding).

Confirmed: 7 of the 9 true "download" call sites (all except `util.ts`'s helper itself and the
vendored `screenscraper/util.js`) are copy-pasted reimplementations of the identical
create-blob → object-URL → temporary `<a download>` → click → revoke sequence, with minor
inconsistencies in whether the `<a>` is appended to `document.body` first (only
`romScan.ts:369-374` and `RomManagementTab.svelte:697-703` do this; the rest click a detached
element, which works in Chromium but is less broadly spec-compliant).

**Direction:** route all 7 duplicate download sites through `apps/web/src/lib/util.ts`'s
existing `download(name, data)` (extend its signature to accept a `Blob` directly, not just
`Uint8Array`, since several callers already have a `Blob` in hand from `JSZip.generateAsync`).

**Status: fixed (2026-07-03).** `util.ts`'s `download()` now accepts `Uint8Array | Blob` and
standardizes on appending the `<a>` to `document.body` before `.click()` (more broadly
spec-compliant — matches what only 2 of the 7 sites previously did) then removes it
immediately after. All 7 duplicate sites (`romScan.ts`, `DeviceInfoTab.svelte`'s `downloadLog`,
`GameDetailsPanel.svelte` ×4, `Wizard.svelte`'s SD-cores ZIP fallback,
`RomManagementTab.svelte`'s SD-card ZIP) now call the shared helper. Left alone as planned:
the vendored `screenscraper/util.js`, and the two non-download object-URL sites
(`GameDetailsPanel.svelte:254` cover preview, `RomManagementTab.svelte:265` carousel cache).
Also found and deliberately left out of scope: `DeviceInfoTab.svelte`'s `downloadScreenshot`
uses `canvas.toDataURL()` (a data URI), not `createObjectURL`/Blob — a different mechanism
that wasn't one of the 7 originally-flagged sites; not folded in to avoid scope-creeping the
helper's signature. Verified via `tsc -b` (full workspace, clean) and `svelte-check` (0 errors).

**Re-verified (2026-09-07): FIXED — holds.** `grep -rn createObjectURL apps/web/src` now
returns 8 hits and **none** is a duplicated download: `lib/util.ts:7` (the shared helper,
`download(name, data: Uint8Array | Blob)` at `:5`), `lib/sources/bundle.ts:69` (in-page URL
for a cached bundle, not a download), the two known in-page display sites
(`views/GameDetailsPanel.svelte:314`, `views/RomManagementTab.svelte:439`), the vendored
`lib/screenscraper/util.js:22`, and three in a Node test stub
(`lib/sources/test/validate.mjs`). The seven hand-rolled copies are gone. One `a.download`
remains outside the helper — `views/OverviewTab.svelte:378`, the canvas `toDataURL()`
screenshot save, which is the different mechanism the 2026-07 note deliberately excluded.
## 12. packages/ layer internal audit

**Cross-package duplicated logic:**
- `crc32`/`CRC_TABLE` (byte-identical IEEE reflected CRC-32 implementation, same
  comment "matching Python zlib.crc32"/"crc32_le(0,...)") independently implemented in
  `packages/gnw-patch/src/superblock.ts:70-86` and `packages/fs-builders/src/frogfs.ts:345-360`.
- `ProgressFn = (done: number, total: number) => void` independently redeclared
  (not imported) in `packages/swd-transport/src/index.ts:20`, `packages/gnw-flasher/src/index.ts:165`,
  `packages/fs-builders/src/index.ts:75`, `packages/builder-core/src/index.ts:12` — all four
  packages already type-import from each other (builder-core imports SwdTransport,
  fs-builders types) so nothing prevents consolidating into one shared type.
- `notImplemented(what): never => throw new Error(...)` scaffold helper duplicated
  verbatim in `packages/gnw-flasher/src/index.ts:179`, `packages/builder-core/src/index.ts:88`,
  `packages/fs-builders/src/index.ts:102`.
- Padding helpers reimplemented per package: `padBytes`/`pad4` in
  `packages/gnw-flasher/src/index.ts:151,194`, `pad()` in `packages/fs-builders/src/frogfs.ts:35`
  (different alignment semantics/fill byte per call site, but same shape).
- LE u32 read/write via `DataView.getUint32/setUint32(..., true)` scattered ad hoc in
  `packages/fs-builders/src/frogfsParse.ts`, `frogfs.ts`, `romLzma.ts`, `packages/gnw-patch/src/superblock.ts`,
  `packages/swd-transport/src/index.ts` (`u8ToU32LE`/`u32ToU8LE`) — no shared LE-codec helper.

**Inconsistent error-handling convention across packages:**
- `packages/swd-transport/src/index.ts` and `packages/gnw-flasher/src/index.ts` throw plain
  `new Error("[pkg-name] message")` — no typed error classes.
- `packages/gnw-patch/src/firmware.ts:15-19` defines a typed hierarchy
  (`PatchError`/`NotEnoughSpaceError`/`InvalidStockRomError`/`MissingSymbolError`/`ParsingError`);
  `packages/gnw-patch/src/superblock.ts:36` adds a separate `SuperblockError`.
  `packages/thumb-asm/src/index.ts:30` has its own `ThumbAssemblyError`.
  `packages/fs-builders/src/littlefs.ts:12` has `LittleFsError`; `frogfs.ts:88` has
  `FrogFsError`; `frogfsParse.ts:28` has `FrogFsParseError` — three separate error
  classes within one package, none sharing a common base.
  builder-core (`notImplemented`) and gnw-flasher/swd-transport never throw typed
  errors at all — a caller catching errors from these packages can't `instanceof`-narrow
  the way they can with gnw-patch/fs-builders.

**Public API shape divergence:** swd-transport exports two classes
(`DapjsTransport`/`WebStlinkTransport`) implementing an interface; gnw-flasher exports
one class `GnwFlasher`; gnw-patch/fs-builders/builder-core/thumb-asm export plain
functions (`patchFirmware`, `buildSdLayout`/`buildFilesystem`, `resolveBuild`/`fetchManifest`,
`assemble`) plus loose types/classes for narrower concerns (`FrogFsImage` is a class
inside the otherwise-functional fs-builders package). This roughly tracks the L1
(stateful transport) vs L2 (stateful device session) vs L3/patch/fs (pure/stateless
transform) layering CLAUDE.md describes, so likely intentional — worth noting as
"consistent with layering, not drift" rather than a defect.

**builder-core stub state — confirmed, NOT stale:** `resolveBuild` (index.ts:46) is a
real pure function; `fetchManifest`/`fetchArtifacts`/`buildFilesystem`/`flash`/`pullSaves`/
`pushSaves` (index.ts:92-134) all still call the local `notImplemented()` stub exactly as
CLAUDE.md's codebase map describes — no drift since CLAUDE.md was last updated.

**Oracle/test coverage gaps** — *as of 2026-07-02; the swd-transport/gnw-flasher/builder-core
half of this is **no longer true**, see the 2026-09-08 correction in the re-verified block at
the end of this item.* `packages/swd-transport`, `packages/gnw-flasher`, and
`packages/builder-core` had **no `test/` directory at all** — confirmed at the time via
`find packages -maxdepth 2 -name test`. This is non-trivial, hardware-protocol code
(mailbox protocol, context handshake, chunk-retry logic in gnw-flasher; halt/resume/reset
register sequences in swd-transport) with zero oracle/unit coverage, unlike gnw-patch/
thumb-asm/fs-builders which each have oracle scripts cited in CLAUDE.md. (All three gaps
have since been filled; CLAUDE.md now lists a suite for every package.) Within gnw-patch,
`device.ts` and `aes.ts`/`lz77.ts` are not directly referenced by name in any test/*.mjs
(only indirectly exercised via `engine.mjs`/`superblock.mjs` calling `patchFirmware`).

**Direction:** hoist one shared `ProgressFn` type (e.g. into swd-transport, imported by
the other three); consolidate `crc32` into one module (fs-builders and gnw-patch already
have no circular dependency risk — fs-builders could export it and gnw-patch import it,
or vice versa, or both import from a new tiny shared internal module if the "no
cross-package runtime deps without DI" rule is read strictly); pick one error convention
(typed error classes, matching gnw-patch/fs-builders/thumb-asm) and adopt it in
swd-transport/gnw-flasher/builder-core; add at least a minimal oracle/smoke test for
gnw-flasher's mailbox/context protocol and swd-transport's register mapping, given
CLAUDE.md's "byte-exactness is verified, not assumed" rule had no enforcement
mechanism for these two packages. **This direction was carried out** — see the correction in
the re-verified block below.

**Status: partially fixed (2026-07-03).** Hoisted `ProgressFn` to `packages/swd-transport/src/index.ts`
(its canonical home — the L1 base layer both `gnw-flasher` and `builder-core` already
depend on for `SwdTransport`); both now `import type { ProgressFn } from "@gnw/swd-transport"`
and re-export it, so `import { ProgressFn } from "@gnw/gnw-flasher"` (apps/web's existing
usage) is unaffected. Verified via `tsc -b` (clean) and `gnw-patch`'s byte-exact `engine.mjs`
oracle (still passes).

`fs-builders`' separate `ProgressFn` was deliberately left alone: it has **zero** declared
dependency on `swd-transport` (unlike gnw-flasher/builder-core), so importing it would add a
new cross-package dependency edge purely for a type alias — not a mechanical dedup, a real
architecture change, for a package CLAUDE.md explicitly wants dependency-free.

**`crc32` deferred, not consolidated.** Same reasoning, more pronounced: `gnw-patch` and
`fs-builders` have **no existing dependency relationship in either direction** (gnw-patch →
thumb-asm only; fs-builders → nothing). Forcing one to import the other, or standing up a new
shared package for one 15-line function, is a real design decision (new dependency edge, or a
new workspace package with its own tsconfig/build target) — left for a deliberate follow-up
decision rather than folded into this mechanical-dedup batch.

Not attempted this pass (per plan, larger/separate efforts): unifying the error-handling
convention across packages, adding oracle/unit test coverage for
swd-transport/gnw-flasher/builder-core (since done — `eb26fd0`/`72ec441`/`06b39d2`),
consolidating `notImplemented()`/LE-codec helpers.

**Re-verified (2026-09-07): OPEN — the most intact item in this document.** *(Superseded
2026-09-08: PARTIALLY FIXED — the test-coverage bullet below was wrong; see the correction
there and the status line that follows the list.)* `packages/`
barely moved during the redesign and nearly every finding still stands verbatim:
- `crc32`/`CRC_TABLE`: **still duplicated** — `packages/gnw-patch/src/superblock.ts:129,139` and
  `packages/fs-builders/src/frogfs.ts:346,356` (superblock's pair re-derived 2026-09-10; the
  2026-07 finding body above still quotes its original `:71,81`, which is the historical record). Still blocked on the dependency-edge decision
  the 2026-07 deferral describes.
- `ProgressFn`: **partial fix holds** — down to two declarations
  (`packages/swd-transport/src/index.ts:20`, `packages/fs-builders/src/index.ts:75`);
  `builder-core` imports and re-exports it from swd-transport
  (`packages/builder-core/src/index.ts:9,12`), as does `gnw-flasher`. `fs-builders` remains
  deliberately independent.
- `notImplemented`: **still triplicated** verbatim (line numbers re-derived 2026-09-10) — `packages/gnw-flasher/src/index.ts:278`,
  `packages/builder-core/src/index.ts:88`, `packages/fs-builders/src/index.ts:111`. Note this is
  about the *helper* being copied three times, not about what still calls it: `gnw-flasher`'s
  `unlock()` is now a real port and no longer among its callers, while `lock()` deliberately is.
- Error-convention split: **unchanged** — typed classes in gnw-patch (`firmware.ts:15`,
  `superblock.ts:36`), fs-builders (`frogfs.ts:88`, `littlefs.ts:12`, `frogfsParse.ts:28`) and
  thumb-asm (`index.ts:30`); plain `Error` in swd-transport, gnw-flasher and builder-core.
- builder-core stub state: **still accurate** — `notImplemented` at
  `builder-core/src/index.ts:93,105,114,122,126,133`, matching CLAUDE.md's map.
- Test-coverage gap: **~~unchanged~~ — CLOSED, and this bullet was wrong.** It claimed (as did
  the priority list above, and the 2026-07 finding body) that `find packages -maxdepth 2 -name
  test` returns only `thumb-asm`, `gnw-patch`, `fs-builders`. **Corrected 2026-09-08:** that
  same command now returns all six packages. `packages/swd-transport/test/transport.mjs`
  (`eb26fd0`, halt/resume/reset register sequences incl. the watchdog freeze bits),
  `packages/gnw-flasher/test/protocol.mjs` (`72ec441`, the mailbox/context protocol against a
  simulated RAM stub — `waitForIdle` ordering, verify defaults) and
  `packages/builder-core/test/resolveBuild.mjs` (`06b39d2`, layout logic + scaffold-stub
  guards) all exist and all pass. Run them the way CLAUDE.md lists them:
  `docker compose exec dev node packages/<pkg>/test/<file>.mjs` — each prints its own pass
  count, which is why no count is written down here.

**Status (2026-09-08): PARTIALLY FIXED, not OPEN.** The test-coverage half of this item is
done; the `crc32`/`notImplemented` duplication and the error-convention split are what remain,
and they remain because they need a package-boundary *decision*, not because nobody has got to
them.
## 13. Component/CSS layer beyond modals

**Status-LED/badge color duplication (hardcoded hex, not tokens):** the exact same
three hex values (`#c0392b` red / `#d4a000` yellow / `#2e9e44` green) are hardcoded
independently in `apps/web/src/lib/ui/DeviceHeader.svelte:237-245` (`.dot.red/.yellow/.green`)
and `apps/web/src/lib/ui/DeviceControls.svelte:99-102` (`.indicator.red/.yellow/.green`,
plus a 4th `.gray: #7f8c8d`) — two separate LED-badge implementations, neither reading
from a shared `--status-red`/`--status-yellow`/`--status-green` custom property (no such
tokens exist in `apps/web/src/styles/tokens.css`). A third "dot" style,
`apps/web/src/lib/advanced/AccordionSection.svelte:102-107` (since the firmware rail landed, used only by the Library tab's `RomSection.svelte`), uses a differently-styled
pulsing dot (`background: var(--model-accent)`) — not a duplicate of the red/yellow/green
LED but the same `.dot` class name reused for an unrelated visual, a naming collision risk.

**Circular badge/number-chip pattern duplicated 2 ways:** `apps/web/src/lib/views/Wizard.svelte:397-407`
(`.step-num`, circular step counter) and `apps/web/src/lib/advanced/OfficialFirmwareSection.svelte:420-429`
(`.num`, circular numbered badge) are near-identical `border-radius: 50%` + flex-center
circular badges with different background/sizing, each defined locally instead of a
shared `Badge`/`StepNumber` component.

**`var(--r-card)` used directly in 9 component `<style>` blocks** instead of routing through
`ui/Card.svelte` (grep for `var(--r-card)`): `AccordionSection.svelte`, `DeviceInfoTab.svelte`,
`Landing.svelte`, `Wizard.svelte`, `EraseSection.svelte`, `FileBrowserSection.svelte`,
`RetroGoTab.svelte`, `GameDetailsPanel.svelte`, `RomManagementTab.svelte` — `ui/Card.svelte`
is imported in exactly one place (`Landing.svelte`), meaning nearly every advanced/* tab
re-implements its own card-like surface with the shared radius token but not the shared
component/CSS block.

**`ui/Button.svelte` usage is inconsistent:** imported/used in `DumpSection.svelte`,
`EraseSection.svelte`, `FlashSection.svelte`, `OfficialFirmwareSection.svelte`,
`RetroGoTab.svelte`, `RomSection.svelte`, `ConfirmModal.svelte`, `ConnectAdapterModal.svelte`,
`DeviceHeader.svelte`, `FolderGateModal.svelte`, `StubLoadModal.svelte`, `Wizard.svelte` (12
files) — but `DeviceInfoTab.svelte` and `GameDetailsPanel.svelte` roll their own
`class="btn"`-style buttons with locally-scoped CSS instead of using the shared component,
per grep for `class="btn` outside `ui/Button.svelte`.

**Svelte 5 migration is clean — no inconsistency found:** repo-wide grep for legacy
`export let ` prop syntax across all `apps/web/src/lib/**/*.svelte` returns zero hits, and
for `on:click`/`on:keydown`/`on:submit` (Svelte 4 event-directive syntax) also returns zero
hits — the component layer is fully migrated to `$props()`/`onclick={}` runes conventions;
no mixed-syntax problem exists here (contrary to what the audit was tasked to check for).

**Global CSS token file has a literal duplicate block:** `apps/web/src/styles/tokens.css`
defines the dark theme's custom-property overrides TWICE with identical values — once
inside `@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) { ... } }`
(lines 50-71) and again verbatim under `:root[data-theme="dark"] { ... }` (lines 74-95).
Every property (`--bg`, `--surface`, `--gold`, `--action-red`, `--mario-red`, etc.) is
repeated with the same value in both blocks — a maintenance hazard where updating one
copy and forgetting the other silently reintroduces a light/dark mismatch depending on
whether the user has an explicit `data-theme` attribute set vs relying on
`prefers-color-scheme`.

**Direction:** add `--status-red`/`--status-yellow`/`--status-green`/`--status-gray`
tokens to `tokens.css` and point `DeviceHeader.svelte`'s `.dot.*` and
`DeviceControls.svelte`'s `.indicator.*` at them instead of duplicated hex; extract a
shared circular-badge component for the `.step-num`/`.num` pattern; either make
`ui/Card.svelte` actually used by the 9 components currently hand-rolling
`var(--r-card)` surfaces, or (if Card.svelte's fixed padding doesn't fit some of them)
extract the shared border/radius/shadow rule into a CSS utility class importable by all;
route `DeviceInfoTab.svelte`/`GameDetailsPanel.svelte`'s inline buttons through
`ui/Button.svelte`; de-duplicate `tokens.css`'s dark-theme block into a single shared
selector list (e.g. `:root[data-theme="dark"], :root:not([data-theme="light"]) { ... }`
using CSS's native multi-selector grouping instead of copy-pasting the property list).

**Status: partially fixed (2026-07-03).**
- **LED/badge colors**: added `--status-red`/`--status-yellow`/`--status-green`/`--status-gray`
  to `tokens.css`; `DeviceHeader.svelte`'s `.dot.*` and `DeviceControls.svelte`'s `.indicator.*`
  now reference them instead of duplicated hex literals.
- **Circular badge**: extracted `apps/web/src/lib/ui/Badge.svelte` for the static case
  (`OfficialFirmwareSection.svelte`'s `.num`). `Wizard.svelte`'s `.step-num` deliberately left
  alone — its styling is driven by ancestor `.wizard-step.active`/`.done` classes (a 3-state
  cascade), a materially different pattern from a static badge; forcing both through one
  component would need a prop-driven variant system for two call sites, not a mechanical
  extraction.
- **`tokens.css` dark-theme "duplicate"**: investigated and found NOT to be a safe
  consolidation — the two blocks have genuinely different trigger conditions (one is an
  unconditional `data-theme="dark"` override, the other an OS-`prefers-color-scheme` fallback
  that avoids a first-paint flash before `theme.svelte.ts`'s JS sets the attribute). A first
  attempt at merging them via combined selectors + nested `@media` broke the explicit
  override (it would've become gated behind the OS preference too). Reverted; left as two
  correctly-scoped blocks with a comment explaining why, instead of a real duplication bug.
- **`ui/Card.svelte` adoption**: investigated and found to be a **false positive**. The 9
  `var(--r-card)` sites are each a different-looking box by design (different border colors —
  `--hairline`, `--caution`, others — and different paddings, e.g. a warning box vs a neutral
  panel) that merely share one border-radius *token* — exactly what a design token is for, not
  duplicated *component* structure. Forcing all 9 through `<Card>` (fixed model-accent border +
  fixed padding) would have broken their distinct visual identities. No changes made.
- **`ui/Button.svelte` adoption**: also a **false positive** on closer inspection.
  `DeviceInfoTab.svelte`'s and `GameDetailsPanel.svelte`'s local `.btn` rules have materially
  different specs (smaller font-size, different padding/border/radius) from `ui/Button.svelte`
  — deliberately more compact styles for their dense, inline contexts, not a copy-paste of the
  shared component. `ui/Button.svelte` has no "compact" variant today; routing these through it
  would either regress their density or require adding a new variant (out of scope for this
  pass). No changes made.

Verified via `svelte-check` (0 errors, 0 warnings). The LED-token and Badge changes are
UI-visible and **need real-browser visual verification**.

**Re-verified (2026-09-07): PARTIALLY FIXED; several audited files no longer exist.**
- **LED colours: FIXED.** `--status-red/-yellow/-green/-gray` exist
  (`apps/web/src/styles/tokens.css`, the `--status-*` block) and no LED reads the hex literals
  any more — `DeviceControls.svelte` uses the tokens and `DeviceHeader.svelte`'s dot was
  rewritten by the redesign to key off `device.connection`. (2026-09-08: the note that
  `ui/GeometryBar.svelte`'s over-capacity fill was the last raw `#c0392b` is no longer true —
  that literal is gone; `grep -rn '#c0392b' apps/web/src` now finds only the token declaration
  itself and two prose comments.)
- **`AccordionSection.svelte`'s `.dot` naming collision: OBSOLETE** — that file no longer
  exists (redesign).
- **Circular badge: OBSOLETE, and regressed into dead code.** `ui/Badge.svelte` exists but has
  zero importers (see #9's new finding); `OfficialFirmwareSection`'s `.num` was rewritten.
  `Wizard.svelte`'s `.step-num` (`:992`, styled at `:1270`) is unchanged and still the 3-state
  ancestor-cascade case deliberately left alone.
- **`tokens.css` dark-theme "duplicate": still WRONG as a finding, and now documented in
  place** — the two blocks remain (`styles/tokens.css:164` and `:203`) with an explanatory
  comment at `:154-158` recording exactly why they cannot merge. No action.
- **`ui/Card.svelte` adoption: still a false positive**, and the count grew — 17 files now use
  `var(--r-card)` directly, and `Card.svelte` has no importers at all. Same reasoning as
  2026-07: a shared radius *token* is not duplicated component structure. If `Card.svelte` is
  genuinely never going to be adopted it is a deletion candidate, but that is an owner
  decision about intent, not cleanup — see the 2026-09-08 sweep below.
- **`ui/Button.svelte` adoption: still a false positive**; the hold-outs are now
  `views/OverviewTab.svelte` and `views/GameDetailsPanel.svelte` (successors of the
  originally-named files), still with deliberately denser local `.btn` specs.
- **Svelte 5 migration: still clean** — no `export let` / `on:click` hits.

**Dead-component sweep (2026-09-08).** `Badge.svelte` and `InfoTip.svelte` were deleted in
`ef34572`; a full re-sweep of `apps/web/src/lib/**` was run to find anything else with zero
importers. Method: for every `.svelte`/`.ts` file under `lib/`, grep `apps/web/src`,
`apps/web/test`, `frontend/` and `backend/` for an import specifier ending in that file's
stem, then confirm each candidate by hand with a tag/import grep
(`</?Name[ />]|import +Name |ui/Name`). Dynamic reachability was checked separately: `lib/`
has no `<svelte:component>`, no `<svelte:element>`, and every `await import(...)` resolves to
a `.ts` module (`device.svelte.ts:595,601,613,631`, `romScan.ts:351`,
`sources/biosState.svelte.ts:215`) — no component is reached by a path a static grep misses.

Three files have zero importers. **None were deleted**; each is deliberate or ambiguous, and
the bar here is proof of deadness, not absence of a caller:

| File | Evidence | Why it stays |
|---|---|---|
| `ui/InstallGeometry.svelte` | no `<InstallGeometry` / `import InstallGeometry` hit anywhere | **Parked, not dead** — held through the redesign for the free-space visual's reintroduction. Explicitly protected. |
| `ui/Card.svelte` | no `<Card` / `import Card` hit anywhere (`Landing.svelte`, its last importer, was rewritten) | An **active design-system primitive**, restyled to the approved mockups in the redesign-foundation commit `f46b12a` and still the intended surface for the 17 `var(--r-card)` sites. Deleting it would fight the redesign in progress. Owner call, not cleanup. |
| `ui/FilePick.svelte` | no `<FilePick` / `import FilePick` hit anywhere; no `<svelte:component>` or `{#snippet}` indirection under `lib/`; the only surviving mentions were a comment in `FilePromptModal.svelte:693` saying it is *not* reused there and the components list in `i18n/strings/shared.ts:5` | **DELETED 2026-09-08.** The blocker was that removing it orphans `shared.filePick.defaultLabel` / `.noFileChosen`, a seven-locale edit `i18n-locale-drift.mjs` could not check from a worktree — fixed in `6fbdef0`, so the guard now genuinely runs there. Component removed, both keys removed from all seven `strings/shared*.ts`, and the components comment corrected. Nothing else read either key. |

Nothing else under `lib/` is unreferenced. `lib/engine/vendor.d.ts` shows as importer-less by
construction (an ambient declaration file consumed by `tsc`, never imported) and is not a
finding.
## 14. SD-mode ROM management leaked device-flash budget checks

Found via targeted analysis (2026-07-03, owner-reported symptom), not the original 3-agent
sweep. `RomManagementTab.svelte`'s shared game-selection UI (rendered above the
`{#if device.targetMedia === "sd"}` split, so common to both Flash and SD modes) is gated by a
budget-check subsystem that was built for Flash's real constraint (new FrogFS must fit between
its offset and LittleFS on the device chip) and was never taught about `targetMedia`:

- `frogfsOffset`/`ceilingOffset`/`reservedEnd`/`eraseBlock` (lines ~104-116) are `$derived`
  purely from `device.partitions`/`device.info` — whatever device happens to be connected,
  unconditionally.
- The `previewWanted` `$effect` (~line 329) fired `buildPreview()` — a bundle fetch + full
  FrogFS image build from the current ROM selection — whenever `device.isConnected &&
  baseInstalled`, with **no `targetMedia` check**.
- `fitsGap` (~line 415) compared that build's size against the connected device's flash gap.
- `validateFit()` (~line 436), called directly from the shared Select-All/per-game toggle
  buttons, only treated the device-flash constraint as "no limit" when `ceilingOffset`/
  `frogfsOffset` were `null` — i.e. only when no device happened to be connected.

**Impact:** latent in the common case (SD-only user, no device connected — those values stay
`null` and everything no-ops), but surfaces exactly as reported: SD mode selected *and* a
device also connected (and already base-installed with Retro-Go). Selecting/deselecting ROMs
in the shared table then ran a real, wasted FrogFS preview build against a firmware bundle
fetch, and could throw a literal `"Not enough space on device!"` alert computed from the
connected device's flash-chip gap — a constraint with nothing to do with the SD card actually
being written to (SD capacity is separately tracked via `sdUsedBytes`/`sdScanBusy`).

Confirmed NOT affected: the actual write paths (`runInstall` vs `doSdSync`) are properly
separated and gated on `targetMedia`; `getActionState` (per-game install/uninstall label) is
media-agnostic by design (driven off `device.installedGames`, itself correctly sourced per
media by `_doScan`/`scanSdCardGames`); the change-summary generator also branches correctly.

**Status: fixed (2026-07-03).** Added a `device.targetMedia === "sd"` early-out to all three
leak points: the `previewWanted` effect (skips the preview build entirely in SD mode), `fitsGap`
(always `true` in SD mode), and `validateFit` (always `true` in SD mode, before the existing
null-check). Verified via `svelte-check` (0 errors). **Needs real-browser visual verification**
(per CLAUDE.md's Agent Rules) with a device connected while in SD mode: selecting a batch of
ROMs should no longer trigger a false space alert or a background bundle fetch.

Not yet investigated (flagged, out of scope for this fix): whether `GameDetailsPanel`'s
per-game action buttons (rendered from the same shared table) have the same `validateFit`
exposure, and whether `roms.ensureFolders`/`FolderGateModal`'s gating has a comparable leak.

**Re-verified (2026-09-07, re-checked 2026-09-08): FIXED — holds through the redesign.** The
file moved to `apps/web/src/lib/views/RomManagementTab.svelte` and all three early-outs
survived the rewrite: the preview effect (`if (device.targetMedia === "sd" ||
!device.isConnected || !baseInstalled) return;`), `fitsGap` and `validateFit`, with the
`validateFit` call sites in the shared selection table still routing through it. Line numbers
in this file move on almost every redesign commit — locate them with
`grep -n 'fitsGap\|validateFit\|previewWanted' apps/web/src/lib/views/RomManagementTab.svelte`. The follow-up this item flagged as "not yet investigated" (GameDetailsPanel's per-game
buttons, `ensureFolders` gating) was **not** re-examined in this pass — still an open
question.
## 15. SD sync blanket-rewrote everything on every click (owner-reported regression)

`RomManagementTab.svelte`'s `doSdSync()` unconditionally re-fetched the firmware bundle and
rewrote ALL `sdContent` (cores/bios/fonts — the bulk of the sync's data) plus ALL selected
ROM/cover/cheat files to the SD card on every single "Sync SD Card" click, regardless of
whether anything had changed since the last sync. Owner reports this used to diff (only
add/remove what changed); no prior committed version of this logic was found in git history
to recover from (`doSdSync`/`toSdPath` have no history — this file's SD-sync code was written
fresh, uncommitted, as part of this session's/branch's work), so the fix was designed fresh
against the owner's description of correct behavior and the diffing primitives already used
elsewhere in the codebase.

**Fix (2026-07-03):**
- **Cores/bios/fonts (`bundle.sdContent`)**: now gated behind a new, OFF-by-default
  "Sync cores / system files" checkbox (`syncCores`, mirroring the existing
  `includeFirmwareUpdate` checkbox's pattern) — only fetched/written when the user explicitly
  opts in to preparing the SD card for a firmware/cores update, never on a routine ROM sync.
  The bundle itself is now only fetched at all when `syncCores || includeFirmwareUpdate`
  (previously fetched unconditionally every sync even if neither was needed).
- **ROMs/covers/cheats**: new `changedSdUserRoms()` filters the full selection down to what
  actually needs (re)writing: files belonging to newly-added games (`romSelection.additions`,
  the same additions/removals diff Flash mode already uses), files marked dirty
  (`roms.dirtyFiles` — already set by `GameDetailsPanel` on cover/cheat edits, but previously
  never consulted by SD sync), and — only on a first-time/empty SD target
  (`device.installedGames.length === 0`) — bios assets too. Cheats (`injectCheats`'s output)
  and extracted homebrew assets are still always (re)written: both are cheap, synthesized
  fresh each sync from current state, so filtering them added complexity without a real cost
  win. `roms.clearDirty()` is called after a successful sync so re-clicking with no further
  edits does nothing.
- Removals are still NOT auto-deleted from the SD card (pre-existing, intentional —
  the change-summary already documented this as "delete manually from SD"); this fix doesn't
  change that.
- Added a matching "Cores / system files" line to the SD-mode change summary so the user can
  see whether cores will be included before syncing.

Verified via `svelte-check` (0 errors). **Needs real-browser visual verification**: pick a ROM
folder + SD folder, sync once, then sync again with no changes — the second sync should write
~nothing (only cheats/homebrew, if any) and skip cores entirely unless the checkbox is
checked; edit a cover or cheat and re-sync — only that file should be rewritten.

**Re-verified (2026-09-07): FIXED — holds, and evolved.** `changedSdUserRoms`, `syncCores`
and `roms.dirtyFiles`/`clearDirty` are all still present in
`apps/web/src/lib/views/RomManagementTab.svelte` (re-confirmed 2026-09-08; locate with
`grep -n 'changedSdUserRoms\|syncCores\|dirtyFiles' apps/web/src/lib/views/RomManagementTab.svelte`
— the 2026-09-07 line numbers have all moved). The `syncCores` checkbox has since grown a
version selector ("Upgrade Retro-Go and Emulators") and a bundle preview — i.e. the opt-in
model held and was built on, not reverted.
## 16. `firmware`/`utilLoaded`/`installedGames` consolidation (item #5 continued) — attempted, deferred

Batch 9 of the cleanup plan (`.claude/plans/jaunty-squishing-marble.md`) set out to give
`firmware`, `utilLoaded`, and `installedGames` in `device.svelte.ts` a single owning writer
each, replacing their current multiple-call-site assignment pattern (see item #5's table).
Attempted 2026-07-03 in conversation with the owner; **deferred** — not because the idea is
wrong, but because a first-pass explanation of the current logic wasn't enough for the owner
to confidently sign off on a redesign, and the owner correctly flagged that the right way to
attack this is **use-case-centric** (walk concrete device-state scenarios end-to-end) rather
than field-by-field. Owner's read: "a more aggressive refactor will most likely be most
prudent" — lean toward a fuller rework, not a minimal guardrail patch, once it's properly
scoped.

**What was learned tracing the current code (starting point for the real design session):**

- **`firmware`** (`"stock-ofw" | "retro-go" | "unknown"`) has 4 writers with an *undeclared,
  order-dependent* priority, not a genuine conflict — but the ordering is nowhere written down,
  so it only "works" because of *when* each writer happens to run today:
  1. `clearInfo()` — resets to `"unknown"` on every fresh connect/disconnect.
  2. `applyInfo()` — right after the RAM stub boots/attaches, reads an internal-flash header.
     Can positively identify stock Mario/Zelda; anything else (including retro-go) reads back
     `"unknown"` from this source alone.
  3. `_doScan()` (via `classifyDevice()`) — the deep partition-geometry scan; the only source
     that can positively identify retro-go. Only writes when it found a definitive answer,
     otherwise leaves the field untouched.
  4. `pollTick()` — live fallback, greps on-device logs for retro-go's signature. Only writes
     `"retro-go"` if `firmware` is still `"unknown"` at poll time — this one write IS already
     guarded against fighting the others.
  Implicit real hierarchy: scan-result > stub-header-read > log-guess-fallback, reset on
  disconnect. Fragile because nothing enforces that scan/poll actually run in this relative
  order — a future change to when either fires could silently break classification with no
  compiler error to catch it.
- **`utilLoaded`** (is the temporary RAM flash-stub currently booted/alive) — traced all 8
  sites; each represents a genuinely distinct, non-overlapping real-world transition (stub
  boot succeeded, poll detected the stub died, one of 3 teardown paths ran). Initial read: this
  one may not need the same kind of fix as `firmware` — there's no priority conflict, just
  several legitimate "this really did happen" writers. Owner has not yet weighed in on whether
  to fold this in anyway for consistency; revisit during the use-case session rather than
  assuming.
- **`installedGames`** — split cleanly by `targetMedia`: `_doScan()`'s FrogFS read owns flash
  mode, `scanSdCardGames()` owns SD mode, `clearInfo()` resets. Mutually exclusive by mode, not
  actually competing writers. Same caveat as `utilLoaded` — worth re-examining case-by-case
  rather than assuming it's fine.

**Direction for the follow-up session:** don't start from "which field has how many writers."
Start by enumerating the actual device-state scenarios the app has to handle end-to-end (fresh
connect to stock firmware, fresh connect to retro-go, connect while util already alive from a
prior session, stub boot triggered mid-session by `ensureStub`, poll detecting a dead stub,
poll detecting retro-go's log while classification is still unknown, USB yank mid-scan,
SD-mode connect, disconnect/reconnect cycles) and, for each, write out what `firmware`/
`utilLoaded`/`installedGames` *should* read at each step. Only then design the consolidation
(likely a single gatekeeper/classification method per field, or a small state machine) against
that scenario table — not against the current code's incidental structure. This needs its own
dedicated session with the owner driving the scenario list; real-hardware regression testing
across as many of those scenarios as practical afterward (owner has confirmed a device will be
available to test with once implemented).

**Status: deferred, needs a dedicated use-case-scoping session before implementation (2026-07-03).**

**Re-verified (2026-09-07): PARTLY OBSOLETE — `firmware` was solved by a different route; the
rest is still deferred.** The four-writer priority hazard this item painstakingly traces for
`firmware` no longer exists: `firmware` is not stored state at all now, it is a derived getter
over the scan's `deviceClass` (`apps/web/src/lib/device.svelte.ts:167-173`), and `pollTick`'s
log-sniffing fallback — writer #4 in the analysis above — was deleted outright
(`device.svelte.ts:694`). That happened as part of the redesign's connection-reliability work,
not as an execution of this item's plan, so the "use-case-scoping session" it calls for never
took place. `utilLoaded` and `installedGames` are unchanged (writer counts deliberately not
recorded here — they have already drifted once; grep `device.svelte.ts`), and the
scenario-table approach the owner asked for still applies to them. **Status remains: deferred,
needs a dedicated scoping session — but the scope is now two fields, not three.**
## 17. Install-progress modal was component-local state — vanished mid-flash on any unmount

`RomSection.svelte`'s "Flash install…" (and equivalently `Wizard.svelte`'s steps and
`RomManagementTab.svelte`'s Flash/SD flows) opened a progress modal whose `open`/phase state
was plain component-local `$state`. Booting the RAM stub (`device.ensureStub()` → `bootStub()`)
performs a genuine SWD target reset — an expected side effect already documented in
`device.svelte.ts`'s own comments ("device resets mid-flash → ST-Link USB briefly drops →
probe re-enumerates"). That reset fires a real WebUSB disconnect event, which
`onUsbDisconnect` → `handleLost()` responds to **unconditionally** (unlike the idle liveness
poll, which explicitly skips while `transport.busy()`), setting `connection = "lost"`.
`Advanced.svelte`'s `{#if !device.isConnected}` gate then unmounted the entire Firmware Setup
subtree — destroying the modal's component-local state. The modal didn't hide, it was
**destroyed**, while the flash write itself (a plain floating JS promise holding its own
captured transport/flasher references) kept running for real on the hardware with zero UI
feedback — matching an owner report of the modal vanishing and the device visibly still
working with no explanation.

**Root defect:** this deviated from the codebase's own established pattern for "must never be
arbitrarily unmounted" modals — `StubLoadModal`/`ConnectGateModal`/`FolderGateModal` are all
driven by store-level prompt state and rendered unconditionally at `App.svelte`'s root
specifically so no inner component-tree change can ever touch them.

**Fix (2026-07-03):** new singleton store `apps/web/src/lib/installProgress.svelte.ts`
(`installProgress`) owns all progress-modal state; `InstallProgressModal.svelte` is now a pure
view over it (no props), rendered exactly once at `App.svelte`'s root alongside the other
three store-backed modals. All four call sites now call `installProgress.run({...})` instead
of rendering `<InstallProgressModal>` locally. Structurally, no `{#if}`-driven unmount anywhere
in the app can destroy this modal mid-operation anymore. Secondary hardening:
`device.svelte.ts`'s `handleLost()` now logs a line into the active phase
("Link dropped (expected during Recovery Mode boot), reconnecting…") so an expected mid-op USB
blip is visibly explained instead of passing silently.

**Status: fixed (2026-07-03), pending real-hardware repro of the original failure scenario.**

**Re-verified (2026-09-07): FIXED — holds, and has become the codebase-wide pattern.**
`apps/web/src/lib/installProgress.svelte.ts` still owns the state,
`ui/InstallProgressModal.svelte` is still rendered exactly once at `App.svelte:82`, and
`installProgress.run({...})` has grown well past the original 4 call sites and keeps growing —
enumerate with `grep -rn 'installProgress.run' apps/web/src` rather than trusting a count here
(the 2026-09-07 figure of 10 was already low by 2026-09-08). No component renders the modal
locally.
## 18. `program()` never actually waited for the flash operation to finish

A real, reproducible flash-stall ("Flash stalled for 15 seconds without progress (WebUSB
lockup).") traced to a genuine firmware-protocol mismatch, not just watchdog tuning. Compared
`packages/gnw-flasher/src/index.ts` against the actual firmware C source in
`references/gnwmanager/Core/Src/gnwmanager.c`: the firmware's `release_context()` clears a
context's `ready` flag immediately after the RAM buffer transfer/decompression step — **well
before** `erase_intflash()`, `HAL_FLASH_Program()`, or hash-verify even run. The reference
Python host tool knows this and always follows a completed context with a separate wait for
the global `status` register to reach `STATUS_IDLE` (`wait_for_all_contexts_complete()` →
`wait_for_idle()`). Our TS port's `waitForContextComplete()` only polled `Ctx.READY` and
returned as soon as it cleared — `program()` was resolving (and `flash()` was writing the
on-device progress byte) while the device was still mid-erase/program/verify. This explained
both symptoms at once: the on-device progress bar failing to clear reliably, and downstream
code proceeding onto a still-busy device link, eventually blocking somewhere else with no
obvious explanation ("stall").

**Fix (2026-07-03):** `program()` now calls the already-existing (but previously never
invoked) `waitForIdle()` after `waitForContextComplete()` resolves — matching the reference
tool's actual wait sequence. Internal-flash erase timing itself was confirmed to be a genuine,
targeted (not mass) sector erase identical to the reference implementation — not a bug.

**Status: fixed (2026-07-03), pending real-hardware confirmation of actual flash timing.**

**Re-verified (2026-09-07, line numbers refreshed 2026-09-08): FIXED — holds.** `waitForIdle`
is still defined (`packages/gnw-flasher/src/index.ts:397`) and still actually invoked after a
context completes (`:381`, and again at `:671`). Its default budget is 120 s of *no progress* —
the deadline resets on every status change — matching the reference tool and CLAUDE.md's 120 s
stall-watchdog note. This is now also covered by a suite:
`packages/gnw-flasher/test/protocol.mjs` (`72ec441`) asserts the `waitForIdle`-after-`READY`
ordering directly.
## 19. Flash auto-retry reintroduced with a closed race, phase/audit-log UI redesigned

Auto-retry-on-stall (reboot the RAM stub + retry) had been deliberately removed per CLAUDE.md,
citing a race between a silent `bootStub`-triggered reset and a concurrent background poll
(the same class of race `captureScreenshot()` already guards against by pausing the poll).
Investigation confirmed the old retry logic (3 attempts total, force-reboot on retries) was
fully recoverable from git history and the `flasherOrGetter` plumbing to support it already
existed end-to-end — the actual gap was that flashing never paused the liveness poll the way
screenshots do.

**Fix (2026-07-03):** reintroduced the 3-attempt retry loop in `flasher.ts`'s `flashImage()`
(respects `abortSignal`, wasn't present in the original pre-removal code); added public
`device.suspendPoll()`/`resumePoll()`, wrapped around all three flash-writing call sites
(`RomSection.svelte`, `Wizard.svelte` step 2, `RomManagementTab.svelte`'s `runInstall()`) in
`try/finally`. Separately found and fixed a real regression this introduced: the
flasher-getters passed into `flashInstallToDevice`/`patchAndFlash` used `flashImage`'s
per-attempt retry flag to decide `forceReboot`, meaning the FIRST attempt of any individual
chunk's `flashImage()` call always passed `force=false` — if the stub had gone stale between
chunks, this silently re-surfaced the `StubLoadModal` Recovery Mode confirmation mid-flash, even
though the user had already granted consent once via that flow's own earlier explicit
`ensureStub()` call. Fixed by making every getter passed below that initial consent-granting
call always force silently (`() => device.ensureStub(undefined, true)`).

On top of this, the progress modal went through several UX iterations (see STATUS.md's
"Install/Flash Progress UI" section for the final shape): phases gained real named, collapsed-
by-default sub-steps (auto-collapsing on completion) instead of raw free-text; a single shared,
timestamped, collapsible audit log (persisted open/closed choice) replaced per-phase log boxes;
FrogFS/LittleFS were relabeled "Games, BIOS, Languages"/"Cores, Saves" in user-facing text;
the flash phase's region writes (intflash/frogfs/littlefs) became named sub-steps matching the
build phase's pattern, with intflash's sub-step entry omitted where a phase's own label already
names it (e.g. Wizard step 2's "Flashing Retro-Go").

**Status: fixed (2026-07-03), pending full real-hardware verification pass (see STATUS.md).**

**Re-verified (2026-09-07): FIXED — holds.** The 3-attempt retry loop is still in
`apps/web/src/lib/engine/flasher.ts` (`maxAttempts = 3` at `:83`, abort-aware at `:146`), the
stall watchdog is still 120 s (`:119`), and `device.suspendPoll()`/`resumePoll()` still exist
(`apps/web/src/lib/device.svelte.ts:709,716`).

**Corrected 2026-09-08 — the consent fix took a different final shape than described above.**
This paragraph used to say the call sites "ignore [the retry flag] and force silently". They do
not, and must not: every flasher-getter below an already-confirmed `ensureStub()` is now
`(force) => device.ensureStub(undefined, force, true)` — the retry flag from
`flasherOrGetter(attempt > 1)` (`flasher.ts:87`) is *forwarded* as `force`, and it is the third
argument (`silent`) that stops `StubLoadModal` re-asking for consent already given.
Hardcoding `force = true`, as the 2026-09-07 wording implied, would reset the device on every
per-chunk call instead of reusing the live cached stub. Enumerate the call sites with
`grep -rn 'ensureStub(undefined' apps/web/src`; CLAUDE.md's Screenshot/flash section states the
same rule. The standing footgun the 2026-09-07 note flagged is still real: the protection lives
in every caller rather than in the signature.

## 20. Design-token duplication pass (2026-09-08) — one token retired, three pairs documented

A specimen board (`docs/design/mockups/Specimen.dc.html`) rendered every type and grey token at
real size and surfaced four candidates. Each was re-counted with grep across `apps/web/src`
before acting, and the pass was deliberately confined to `apps/web/src/styles/tokens.css` — a
token that cannot be retired without editing components is a handoff, not a cleanup.

**Retired: `--neutral-edge`.** Declared in all three theme blocks, and its only consumer in the
entire codebase was `tokens.css` itself — the `--model-accent: var(--neutral-edge)` fallback for
a device with no `[data-model]` on the root. Zero component references. Inlined as
`--model-accent: #9a9a9e` (light) / `#565656` (both dark blocks) and the token removed. The
literal is repeated per block rather than written once on purpose: the retired token was
theme-flipped, and the fallback has to keep flipping identically. Zero visual change, provable.

**Not merged: `--ink-dim` (#9a9a9a) and `--silver-edge` (#9a9aa0).** Six values out of 255 apart
in light theme and visually one colour, but both are live — `--ink-dim` at 18 references,
`--silver-edge` at 14 (including `--seg-saves`). They carry different meanings: `--silver-edge`
is a device-face value (the silver button-cap edge, and by extension every neutral fill/border
in that family — BankCard's occupant segments and empty-bank name, Progress/SplitButton/Carousel
edges; the list said FilePick until that component was deleted in `863290c`), `--ink-dim` is a
text value on the ink ramp. They already diverge in dark theme (#6b6b71
vs #767676). Merging them would destroy that distinction and would require component edits.
Instead each now carries a comment naming the other and stating what separates them, so the
duplication is not "fixed" by accident later.

**Not merged: `--fs-chip` and `--fs-micro`, both 12px.** Both live (14 and ~60 references). The
split is weight, not size: `--fs-chip` is the 600-weight chip/pill/tag face (StatusChip,
Sources' `.pill`), `--fs-micro` the 400-weight quiet-caption face (GeometryBar notes, StatPanel
rows). Two names mean either can move without dragging the other. Documented at both
declarations rather than collapsed.

**Queued — now CLOSED (`51ac881`, 2026-09-08): `--fs-lg` (20px) had no design role left**
since `--fs-title` (18px) took the modal/dialog titles. Exactly two consumers remain, both stray
`h3`s: `apps/web/src/lib/views/GameDetailsPanel.svelte:2172` and
`apps/web/src/lib/views/RomManagementTab.svelte:2370`. Moving both to `--fs-title` retires the
token; a note to that effect sits at its declaration. Not acted on *in this pass* — component
files were out of scope and the 20px→18px change is a real (if small) visual change.
**Done in `51ac881`:** both consumers were moved to `--fs-title` and `--fs-lg` was removed from
all three theme blocks. The only surviving mention is the explanatory line in the type-scale
comment (`styles/tokens.css:166`), which records that `--fs-title` replaced it.

**Queued (deliberately not folded in): `RomManagementTab.svelte`'s local `size()`** (~line 179)
is a near-duplicate of `formatSize()` in `apps/web/src/lib/util.ts`, differing only in dropping
to zero decimals below 1 MB, with five call sites around 2068-2162. Folding it into the shared
helper would change the values rendered in the game table, so it stays until someone decides
which formatting the table should show. This is a formatting decision, not a cleanup.
