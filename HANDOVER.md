# UI overhaul — handover

Branch `feat/ui-redesign`. Read this before `STATUS.md` or any audit document.

**Writing or changing a user-visible string, or drawing a board? Read
[`docs/UI_VOICE.md`](./docs/UI_VOICE.md) first.** It is the rule set for what copy may say, every
line of it quoted from a correction made here. §2 and §3 below are the history; that file is the
standing rule.

---

## 1. The bar is the Advanced Firmware tab

The owner, 2026-09-07: *"god damn does the Advanced Firmware tab look beautiful. I feel that page
sets the bar for the whole UI. It just sits."*

That is the reference. When a screen is unclear, open `lib/advanced/**` — `FlashSection`,
`DumpSection`, `EraseSection`, `FileBrowserSection`, `FirmwareRail` — and match what it does:

- surfaces sit **bare on the page ground**; a white `--r-card` panel appears only where an
  artboard draws one
- section captions are uppercase 11px/700/`0.11em`, not `<h3>`s
- `--rule` divides rows *inside* a panel; `--hairline` divides structure
- technical values are mono; prose is not
- the primary action lives in an anchored 72px footer **outside** the capped body, quiet summary
  left, action hard right

His stated top priority, same message: *"the whole UI looking like the mockup in terms of the
overview, bottom bar on sources/library, status bar being adjusted."*

## 2. Where we clashed, and what it cost

Read this section before doing anything clever. Each of these was a real correction from the
owner, and each cost real work.

**Inventing UI.** An agent built a flash-layout questionnaire for Guided Setup from prose. His
reaction: *"who the fuck added this shit!? That wasn't in the mockup!"* Reverted in full
(`d24ab60`). **Every pixel and word comes from an artboard in `docs/design/mockups/`. If no
artboard shows it, report a gap — do not draw it.**

**Reporting a findings count as progress.** `docs/audit-ui-conformance.md` reached "38 of 46
closed" and that was presented as near-done. His reply: *"that's still too many questions… there's
a shit ton left to be done before the current state matches the mockups."* He was right. A closed
findings list is not conformance; the per-artboard surveys then found **279 real deltas**.
**Measure against the design, never against a list of findings.**

**Escalating a row count as a decision count.** "111 waiting on you" produced *"you gotta be
shitting me."* Also right: 111 rows collapsed to ~31 questions, then to seven policies.
**Consolidate before escalating. Never hand him a number you have not tried to reduce.**

**Asking abstractly.** Several questions came back *"I don't understand what you're asking"* and
*"what are you talking about?"* — because they were phrased in project jargon (generations,
policies) instead of concretely. **Ask with an example on screen: this string, this pixel, this
file.**

**Using the wrong instrument.** He said French terminology looked stale. It was — and the check
I had run ("is any translation identical to English?") could not possibly have detected it,
because the strings *were* translated, just from wording that no longer existed. I reported
"all locales current" on that basis. **Pick a measurement that can actually fail the way the
question implies.**

**Half-checking my own consolidation.** `DECISIONS.md` mapped 111 rows to 31 questions; a
verification pass found **48 of the 111 mapped to nothing** — decisions he would never have been
asked about. **Verify coverage in both directions.**

**Pushing work back onto him.** I wrote that he "owed a drawing" for the flashing-Cancel mockup.
He did not: *"I don't owe shit. Did you prepare a mockup or not?"* **Producing mockups is this
side's job.**

**Measuring against artboards that had gone stale.** The repo's `.dc.html` boards and the
published Claude Design canvas (URL in `docs/design/mockups/README.md`) drift silently — nothing
syncs them, and nobody noticed for days. 19 boards were a generation behind: their tab bar still
drew the retired three-tab `Overview / Firmware Setup / ROMs`, terminology gone from the app and
all seven locales weeks ago. Conformance passes had been measuring against dead drawings, and
in-code comments citing them had to be corrected. Resynced in `31cc2f7`; `GuidedFlashing` and the
three boards drawn from it were missed there and needed `e68d6f1` / `570a196`. **Read the
published canvas and diff before publishing** — publishing the repo copies blind would have
destroyed the owner's newer canvas edits — and re-check anything that cited a refreshed board.

**Claiming a divergence was cosmetic from one sample.** `31cc2f7`'s own message says "the pane
bodies were byte-identical in every case". They were not: `Roms.dc.html` changed 89 lines,
`RomsOptions.dc.html` 106, `Guided.dc.html` 67 — only ~10 of each are the tab bar. The rest are
structural: a `height: 100vh; overflow: hidden` frame replacing `min-height`, and a vertically
centred Guided pane replacing the 64px top pad. **Diff every file, not one.**

**Stating hardware facts from memory.** Bank sizes were given as 128 KiB/256 KiB total; they are
**256 KiB per bank, 512 KiB total**. **Look it up.**

**Reading CSS is not looking at the app — and this is the big one.** On 2026-09-08 the owner
opened the running app and found, in the top status bar alone, that it was **centred instead of
left-aligned** and **stopped ~15px short of the right edge**. Six conformance passes had closed
216 rows without seeing either. Both were plainly findable in the CSS: two `flex: 1` spacers
around a fixed middle so `space-between` had no slack, and a `scrollbar-gutter: stable` reserving
room for a scrollbar that `overflow: hidden` guarantees can never exist.

Every audit in this repo states that it read markup and CSS and rendered nothing. **Nobody has
ever opened a browser on this app.** Treat survey coverage of anything that only resolves at a
real viewport width, in a real theme, or through a browser-painted control as **near zero**,
whatever the row counts say. When the owner reports a visual defect, the correct response is to
hunt its siblings in the CSS immediately — that sweep found the footer bars capped 280px short
above 1440px, and four more one-theme failures — not to widen the static audit.

**Chasing the wrong signal.** Told there were 118 hardcoded hex colours "none of which flip with
the theme", a sweep found **105 of them are prose inside comments** and all 12 real declarations
were legitimate. The defect class is not raw values; it is **pairs** — a themed foreground with an
unthemed background, which is what made a `<select>` popup 2.6:1 in dark. Search for the
mechanism, not the symptom.

**Escalating a row count as a decision count.** "16 of your 20 questions are the Cancel decision"
was wrong: 16 was a count of *survey rows* on three boards, 20 a count of *questions*, and Cancel
was not among the questions at all — it was misfiled in a backlog. Same error shape as the "111
waiting on you" episode. **Rows and questions are different units; never mix them.**

**Inventing commit shas.** `72d05b7` and `96b2c4d` were both cited confidently and neither
exists. The first propagated into three source comments before an agent ran `git cat-file` and
caught it. **Verify a sha before quoting it, especially into a brief.**

**Relaying agent findings without checking.** Several claims passed to the owner were wrong: a
"bare Cancel vs bordered pill" delta that had been fixed hours earlier, a `lip="danger"` prop
reported as having no caller when `InstallProgressModal.svelte` drives it, and a board declared
"wrong" that was correct because stock firmware only boots from bank 1. **An agent's report is
evidence, not fact.**

**Dispatching against stale bookkeeping.** Two agents were sent after items in `AUDIT_NOTES.md`'s
own priority list that had been finished a day earlier. **Verify an item is genuinely open before
spending a slot on it** — and both agents were right to check rather than redo.

## 3. Standing instructions

- **Hardware is off your plate.** Verbatim: *"all of these questions dependent on running against
  real hardware — don't worry about that. it's on my list. I want you to focus on the UI overhaul
  exclusively."* Restore-to-stock verification and every device-confirmation item are **his**. Do
  not re-raise them.
- **The dark theme is settled** — *"looks good, don't sweat it."* Stop listing it.
- **No filler, ever.** *"We don't need any filler. It detracts more than it's helpful."* And
  *"I'd rather lose text than have too much of it."* If a string is padded, propose the shorter
  version; do not preserve it out of caution. This and every other copy rule now live together in
  [`docs/UI_VOICE.md`](./docs/UI_VOICE.md), which is the file to read before writing a string.
- **Nothing is cut for not appearing in a mockup.** The working site is the baseline; the
  mockups are a design pass over it, not a specification of the whole app.
- **Do not stockpile blockers. Build the visuals.** Verbatim, 2026-09-07: *"You need to not allow
  for so many blocks... you need to just get the visuals of the mockup done... don't fuck up the
  codebase. You can get 95% of the visuals done without handling these blockers. Changing
  something after-the-fact is already a fact of life. The more you put it off, the longer it
  takes to get to the point."*

  In practice: if an artboard shows it, **build it**. Missing token? Mint it. Colour between two
  tokens? Take the nearest and note it. Two artboards disagree? Pick the better one and note it.
  Record the call in the commit so it can be changed later — a wrong shade that ships is cheaper
  than a right shade that waits. **This does not license inventing UI** (see §2) and it does not
  extend to behaviour, safety logic, or anything that could break the codebase; those still get
  the careful treatment. It applies to paint, type, spacing, copy and layout.
- **Flag clumsy copy** rather than shipping it: *"strings that're weird, redundant, or poorly
  formulated should be brought up."*
- Two agents at a time, isolated in worktrees, disjoint file ownership, verified before merge.
  **Never dispatch work that is blocked on his decision, and never invent work to keep a slot
  warm** — that is how the questionnaire happened.

## 4. Where the work stands

`docs/CONFORMANCE.md` is the live scoreboard; `docs/DECISIONS.md` holds the open questions and
`docs/DECISIONS-MAP.md` what each proposed policy would decide. All three carry statuses per row.

Answered so far: **MB** over MiB; drop the privacy note; Overview Device panel = the mockup's
three rows; `Restart flash utility` removed; free-of-total headline; segment labels
**`Games & Homebrew` / `Cores & Saves` / `Free Space`** (ruled as `Emulators & Saves`, then
superseded by his later instruction to say *core* everywhere a user can see; the ruling on
friendly-names-over-filesystem-names is untouched, only the middle word moved); drop the `new`
system badge; `Close`
over `Done`; artboard wins on pure paint; nothing cut for absence from a mockup; and a spec for
`BAD_HASH_FLASH` — sanity check, retry twice, then a real error naming the affected blocks.

Still his: the chooser heading (a candidate is proposed), the ~11 behaviour-implied items, and
whether to mint the missing 18/15/10px type tokens.

**Overview is now the `overview-v2` rail, not a stack of accordions.** `views/OverviewRail.svelte`
draws the two groups the proposal's README specifies (CONSOLE: Status, Details / LOGS: Activity,
Device log), mounting exactly one pane at a time. It reuses `advanced/FirmwareRail.svelte`'s grid,
its `PaneFooter` slot and its pane-head shape on purpose, because the owner asked for the
Firmware/Sources rail pattern by name: **do not invent a third rail idiom.** Panes are deep-linked
as `#info/<pane>` (`Advanced.svelte:152-155`) and pushed, so Back walks them; an unrecognised
segment falls back to Status rather than stranding the pane. `OverviewTab.svelte` is down to 320
lines and is now a host for the disconnected states and the screen dock. The panes themselves are
`ui/StatusPane.svelte`, `ui/DetailsPane.svelte` and `ui/DeviceLogPane.svelte`, and the rail's own
copy is a ninth i18n area, `overviewRail`.

**Three values the Details board draws resolved as two impossibilities and one measurement.** The
reasoning is the deliverable here, because each is a thing someone will otherwise try again:

- **The external-flash chip name** (`MX25U51245G` on the board) cannot be read. The gnwmanager
  *firmware* does read it: `references/gnwmanager/Core/Src/flash.c:860` issues `CMD_RDID`
  (`0x9F`) and matches it against `jedec_map[]`, 19 entries mapping an id to a part name. But
  the mailbox struct it publishes to the host carries only `flash_size` and `min_erase_size`
  (`Core/Src/gnwmanager.c:134,137`). `flash.jedec_id` and `flash.name` never leave the device;
  there is even an `OSPI_GetFlashName()` getter at `flash.c:834` with **no callers anywhere**.
  Nor can size stand in for the name: **eight** rows in that table are 64 MB, carrying **six**
  distinct part names (MX25U51245G, MX25L51245G, MX25U51245G-54, S25FS512S, W25Q512NW-Q/N,
  W25Q512NW-M), so the mapping is not reversible. Unblocking this is upstream firmware work.
- **SD card capacity** cannot be read in a browser. A `FileSystemDirectoryHandle` exposes a name
  and its entries, not the volume it came from. The trap worth naming is
  `navigator.storage.estimate()`: it looks like the answer and is not, reporting **this origin's**
  sandboxed quota, a real number about the browser profile with no relationship to the card.
  Printing it
  beside "SD card" would be a fabrication wearing the costume of a measurement, and worse than an
  absent row because a reader cannot tell it is absent.
- **Per-category SD bytes are measured**, by `lib/sdStorage.svelte.ts`. Buckets come from
  `deviceInstallPaths()`, the same `InstallPaths` roles `sdDestPath()` writes to, so what counts
  as Covers is by construction where the sync puts covers, and Saves is the `data` role because
  retro-go's `ODROID_BASE_PATH_SAVES` is `ODROID_BASE_PATH "/data"`
  (`retro-go-stm32/components/odroid/config.h:57`). It deliberately does **not** reuse
  `romScan.ts`'s walk, which does `new Uint8Array(await file.arrayBuffer())` at `romScan.ts:116`
  and would try to load a 32 GB card into RAM; this walk reads `File.size` and nothing else.

Because capacity is unknown, the bar can only show proportions **of what is on the card**, which is
a different claim from the board's and needs words the owner has not written. That copy, and
whether the Storage block is a bar at all, is still his.

## 4b. The bookkeeping is now guarded, not spot-checked

Two claims that had rotted repeatedly — each time found by a human re-count, never automatically —
now have guards in `npm run check` / `npm run build` for `@gnw/web`:

- `apps/web/test/conformance-counts.mjs` re-derives the per-status counts of both artboard surveys
  by the rule `docs/CONFORMANCE.md` states, and diffs them against that file's scoreboard table
  (per survey, the totals row, and each row's own arithmetic). The two parser traps that produced
  five conflicting answers — the empty leading cell of a `|`-prefixed markdown row, and the
  trailing full stop on three `**BLOCKED**.` cells — are implemented explicitly, with the reason
  in the header comment. It covers the live scoreboard **only**; the dated prose figures elsewhere
  in these documents are a historical narrative and are deliberately not policed.
- `apps/web/test/artboard-index.mjs` asserts every `docs/design/mockups/*.dc.html` appears in the
  README index table **and** in `canvas.json`, and that neither names a board that does not exist.
  This is the §2 lesson applied: a nine-name spot check once declared the index complete while 23
  of 57 boards were missing from it.

Both refuse to pass vacuously — a missing file, an unparseable table or a zero-row parse exits
non-zero with a reason, never a cheerful green line. Both cost under 0.1s.

If one of these fails, the **header** is what is wrong. Do not edit a survey status cell to make a
count come out.

## 5. Gates — all three, every time

```
docker compose exec dev npx tsc -b
docker compose exec dev sh -c 'cd apps/web && npm run check'
docker compose exec dev sh -c 'cd apps/web && npx vite build'
docker compose exec dev sh -c 'cd apps/web && node src/lib/sources/test/validate.mjs'
```

**Do not record the gate counts here** — not the per-suite numbers, not the `.svelte` file
count, not `svelte-check 0/0`. They have gone stale four times in two days —
`recovery.mjs` sat at 10 after going to 13 and five agents were dispatched against the wrong
number; `addr` 9, `gnw-flasher` 103 and `storage-migration` 6 each went stale within a day of
being corrected. A number in this file is a number nobody re-checks.

Instead, **run the gates once on the main clone and read the counts off that run** before quoting
a baseline into any brief, and tell the agent to do the same from its own first run. What matters
is not the value but that it does not *move*: a suite whose count drops has lost coverage, and one
that rises should be because the agent added a test and said so.

`svelte-check` alone is **not** enough — it stayed green through a blank page caused by the TS
transform leaving an optional-parameter `?` behind (`d3493c5`). Only `vite build` catches that.

`apps/web/test/i18n-locale-drift.mjs` fails when an English string changes without its six
siblings. **It now runs inside a container worktree too** (fixed 2026-09-08, `6fbdef0`): a
worktree's `.git` file records the HOST gitdir path, which the dev container cannot follow, so
the guard used to print SKIP — inert — in the only environment agents work in. It now derives
the container-side gitdir (walk up for a main clone whose `.git/worktrees/<name>/gitdir`
back-reference has the matching relative tail; nothing is hard-coded to `/app`) and exports
`GIT_DIR`. On a normal clone the derivation is a no-op and behaviour is byte-identical. It still
SKIPs loudly when it genuinely cannot run — **a SKIP is a broken worktree, never a pass**.
Verified by inducing a real one-locale drift commit in a worktree and watching it FAIL with the
six stale translations listed. Whitespace-only
and casing-only edits are exempt; punctuation is not. Its commit-message waiver has been used
exactly once, deliberately, and should stay rare.

## 5b. What the 2026-09-11 hardware session established

Read `STATUS.md`'s session block for the list. The lessons that will cost the next session time
if they are not carried:

- **A `.replace()` without an assertion is how a fix silently does nothing.** Twice in one night I
  edited a helper that a revert had already deleted, reported the fix as done, and let the owner
  test a no-op. Both times the tell was available and ignored. Assert on every source edit, and
  when a guard can read the CALL SITE rather than the default, make it: `program()` passing an
  explicit `120000` silently defeated a 20 s budget at the only call site that mattered, and the
  test that reads the call site is what found it.
- **Reason from the device log, not from a model of the device.** Three times a confident
  diagnosis from reading code was wrong, and each time the log settled it in one line: a scan is
  `#1 connect: 6536 ms, 1394 reads` (one scan, not many); a stall is `status: IDLE` while a
  context is held (a counter desync, not a dead device); a flash dying at chunk two is a genuine
  USB drop. Get the number first. And do not retcon the owner's report to fit a later finding:
  he said a scan branch was "both" slower AND visually noisy, the lip explained only the noise,
  and summarising that as "reverted on a symptom" quietly discarded the half of his evidence
  that was never accounted for.
- **The stub can already do more than we ask it.** `GNWMANAGER_ACTION_HASH` hashes external flash
  on-device in 256 KiB chunks and our port had `Action.HASH` enumerated and never called. Before
  designing a host-side scan or diff, check what `references/gnwmanager`'s C and `gnw.py` already
  expose; the reference host has usually solved it.
- **Read the spec that is on disk.** `gwrg-dist-spec` lives in `~/Nerd/git/gwrg-ng/`, and
  `docs/MAPPED_ARTIFACTS.md` claimed it was unreachable rather than checking. Its worked example
  was the exact answer being re-derived from bytes.
- **An agent cannot read `$HOME`.** Every brief that needs the owner's ROMs, manifests, the spec
  or the firmware repo must carry the facts inlined, measured first. When a brief says "assume
  X because the source is out of reach", that is the moment to go and read the source.

## 6. Traps that have already cost time

- **The repo's artboards can fall a generation behind the published canvas.** The mockups live
  both in `docs/design/mockups/` and in a published Claude Design canvas the owner edits and
  saves from the browser. Nothing syncs them. 19 boards drifted, and code was built to text the
  canvas had since deleted (a `4.00 MB` row size, a FileBrowser caption). **Before publishing,
  read the live artifact back and diff every board** — publishing the repo copies blind would
  have destroyed his newer edits. And a re-sync shifts every line number below the change: one
  sweep found 40 stale citations in code comments from a single added line.
- **A store whose `refresh()` sets state before its first `await` will loop forever from a
  tracked `$effect`.** The call reads and writes the in-flight flag synchronously, so an effect
  that calls it depends on what the call sets and re-runs without end, re-probing a folder or
  re-walking a card in a tight loop. **No node test in this repo can catch it**: every suite
  stubs the runes as identity functions, so reactivity is never exercised. It has to be right by
  construction. Both stores that hit this keep the flag as a plain private field, deliberately
  **not** `$state`: `backupPresence.svelte.ts:64` and `sdStorage.svelte.ts:184`, each with the
  reason written beside it. Neither uses `untrack()`; the fix is that the flag is not reactive at
  all, which is the cheaper and more durable answer.
- **A check can pass its own mutation for a reason that looks sound.** Five separate cases in one
  day, each of which briefly read as "the code is fine": a grep whose corpus included the guard's
  own explanatory comment, so it vouched for the very keys it was meant to catch; a grep that
  matched the import specifier `"../appVersion.js"` rather than the row it guarded; a slice taken
  *after* the branch condition it meant to inspect, so gating that branch left it green; a ring
  flooded to 400 entries under a 500-entry cap, so nothing ever evicted and the survivor survived
  for the wrong reason; and a "shim" mutation that rewrote the check to read the same value by
  another route, making it a no-op. The rule that falls out: **a mutation must break the thing
  itself, not a spelling of it**, and a guard that greps source must strip comments and imports
  from its corpus before matching, or it is reading its own homework.
- **An undefined custom property is invisible.** `var(--border)` was used twice in
  `DeviceControls.svelte` and defined nowhere; the border fell back to `currentColor` and the
  divider **never painted at all**, in either theme. It compiles, builds and type-checks
  perfectly. A sweep comparing every `var(--x)` used against every `--x` defined is cheap — that
  one was the only offender, but nothing else would ever have found it.
- **`<style>` written inside a `//` comment in a `.svelte` `<script>`** makes `svelte-check` fail
  with a misleading "script was left open" at EOF plus a bogus "has no default export" in the
  importer. `svelte/compiler`'s own `parse()` accepts the same file. Cost an agent a bisect.
- **Agents can commit worktree symlinks.** One did; merging it replaced the real
  `apps/web/node_modules` with a self-referential link and broke every esbuild suite. Root cause:
  `.gitignore` had `node_modules/` with a trailing slash, which matches directories only. Fixed
  in `fcc95f9` — but **always stage explicit paths in a worktree**, never `git add -A`.
- **`.tabpane` is the app's only scroll container, and no gate can tell you if you break it.**
  `32089be` / `f6e1fd5` made the frame a fixed viewport: `.app` is `height: 100vh; overflow:
  hidden` (`App.svelte:129`), and `.tabpane` carries `min-height: 0; overflow-y: auto` on its
  **base** rule (`Advanced.svelte:324`) so `.library` / `.guided` / `.bleed` only override
  padding. `App.svelte`'s `.page-body.landing` is not a `.tabpane` and has its own copy
  (`:182`). Adding `overflow: hidden` to `.tabpane`, `.shell` or `.page` turns every tab from
  scrollable to clipped with no way to reach the content — and svelte-check, `vite build` and
  every suite pass on a clipped page. Fallout already found: `SplitButton`'s `position: fixed`
  menu read its trigger's rect once; its scroll listener must be **capture phase**
  (`SplitButton.svelte:75`) because `scroll` does not bubble and the emitter is `.tabpane`, not
  the document.
- **A worktree used to test against the MAIN clone's `dist/` — FIXED 2026-09-08, in git.**
  We symlink a worktree's `node_modules` to the main clone's, and its `@gnw/*` entries point
  back into `/app/packages/*`. So a worktree's `apps/web` suites, `svelte-check` and
  `vite build` all ran against a *different checkout's* build output — green gates that proved
  nothing. Nothing resolves `@gnw/*` through that symlink any more:
  - the six esbuild suites keep `@gnw/*` external and rewrite the specifier
    (`apps/web/test/gnwResolve.mjs`'s plugin);
  - a suite's **own** top-level `import("@gnw/…")` goes through *node*, not esbuild, so it needs
    `gnwImport(import.meta.url, pkg)` from the same file. Missing this is why `flashretry` still
    failed 2/5 after the plugin landed: the bundle and the suite held two different
    `FlashVerifyError` classes and `instanceof` was silently false;
  - `svelte-check` and `vite build` are fixed by a `@gnw/*` alias in `apps/web/vite.config.ts`
    and a matching `paths` entry in `apps/web/tsconfig.json`, both relative to the config file
    and therefore worktree-local. An earlier pass concluded this needed a real `node_modules`
    directory and could not go in git. That was wrong; it is in git.

  If you add a new suite, use `gnwResolveFor` **and** `gnwImport` — never a bare
  `import("@gnw/…")`.
- **Create worktrees with `scripts/worktree-setup.sh <name>`**, from the main clone. It does the
  worktree add, both `node_modules` symlinks, the `frontend/vendor/webstlink` submodule and
  `tsc -b` in the dev container. Idempotent; re-run it to repair an existing worktree. A fresh
  worktree set up this way runs the whole gate set green — verified end to end.
- **A fresh worktree can have stale `packages/*/dist`.** Run `npx tsc -b` inside it before
  trusting a failure.
- **The commit hook rejects any command whose text contains "claude"** — including `CLAUDE.md` as
  a pathspec alongside other files. Stage it alone, or edit via the editor tool.
- **`test/ref/` is gitignored**, so a fresh clone cannot run the patch oracle until it is
  regenerated — which needs `references/gnwmanager` on `remove-keystone-engine`. It is currently
  checked out on `autodetect-lfs-partition-geometry`.
- Two agents were killed by session rate limits in one day, both with uncommitted work.
  **Commit per unit, not at the end.**
