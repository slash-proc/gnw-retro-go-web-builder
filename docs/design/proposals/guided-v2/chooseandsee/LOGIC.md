# ChooseAndSee: the state matrix

Every claim here cites a line. Nothing is inferred from an approved board, because the approved
Guided boards are stale (see "Where the boards contradict the code" at the end).

Read with `docs/UI_VOICE.md` open. The chooser names controls; it does not narrate them.

---

## 1. What decides which options appear

Three independent gates. All three are evaluated for every device; they do not exclude one another.

| Gate | Definition | Source |
| --- | --- | --- |
| `canDualBoot` | `extMB === null \|\| extMB >= 16` | `Wizard.svelte:138` |
| `canRetroGo` | `extMB === null \|\| extMB >= 8` | `Wizard.svelte:137` |
| `isStock` | `device.deviceClass?.kind === "stock"` | `Wizard.svelte:113` |

### Which sizes are real

**`extMB` is always a power of two.** It is `externalFlashSizeBytes / (1 << 20)` read off the info
struct (`packages/gnw-flasher/src/index.ts:647`), so it is a chip capacity, not a free number. The
owner's correction:

> "The size example of 12MB is nonsensicle because the chip size is always N²"

The gates are ranges, but their realisable members are sparse, and a board must draw a size that
can exist:

| Band | Real members | Seen on |
| --- | --- | --- |
| `< 8` | 1, 2, 4 | stock Mario is 1 MB, stock Zelda is 4 MB (`engine/ofw.ts:147`) |
| `>= 8, < 16` | **8, and only 8** | the sole size that gates dual boot without gating Retro-Go |
| `>= 16` | 16, 32, 64 | modded chips |

So "8-15 MB" describes one size. `RetroGoSmall` drew 12 MB and now draws 8.

And the three cards:

| Card | Shown when | Source |
| --- | --- | --- |
| `Dual Boot` | `canDualBoot` | `Wizard.svelte:1090` |
| `Only Retro-Go` | `canRetroGo` | `Wizard.svelte:1103` |
| `Return to Stock` | `!isStock` | `Wizard.svelte:1114` |

`extMB` is `device.extSizeMB` (`Wizard.svelte:136`). **Unknown size is a third state, not a small
one**: `extMB === null` passes both size gates, and the comment at `Wizard.svelte:133-135` says why
in as many words -- hiding choices on "we have not looked yet" would be a worse lie than showing
one the device turns out not to support.

### The floor note

```
{#if extMB !== null && !canRetroGo}      chooser.tooSmallForRetroGo(extMB)
{:else if extMB !== null && !canDualBoot} chooser.tooSmallForDualBoot(extMB)
```
`Wizard.svelte:1124-1133`. Both branches require `extMB !== null`, so **an unknown-size device
draws no note at all**. At most one note is ever drawn; they are mutually exclusive.

---

## 2. What bank 1 actually decides

This is the part the owner called out, and the answer is that **only bank 1 is consulted, and only
for one question**.

```js
const bank1 = banks.find((b) => b.index === 1);
const isPristineStock = bank1?.ofw && !bank1.ofw.patched;
```
`engine/classify.ts:46-47`.

### Stock Zelda or Mario in bank 1

`kind: "stock"` (`classify.ts:49-60`), carrying `model: "zelda" | "mario"` and
`installBanks: [1, 2]`.

Consequence in the chooser: **`isStock` is true, so `Return to Stock` is not drawn.** The comment
at `Wizard.svelte:1112-1113` states the reason: there is nothing to return from. Zelda and Mario
differ only in `model`, which the chooser never reads. **The chooser cannot tell them apart and
does not need to** -- they produce the identical page.

### Retro-Go in bank 1

Not pristine stock, so classification falls through to `version || hasApp`
(`classify.ts:99-125`) and returns `retrogo-sd` or `retrogo-old`.

Consequence: **`isStock` is false, so all three cards are drawn** (subject to the size gates).

### The case that looks like a contradiction and is not

A dual-boot device has **patched** stock in bank 1 and Retro-Go in bank 2 (`installBanks: [1, 2]`,
"stock present -> bank2 (keep stock) is possible", `classify.ts:58`). `bank1.ofw.patched` is then
true, so `isPristineStock` is false and the device classifies as `retrogo-sd`, exactly like a
Retro-Go-only device whose bank 1 holds the app itself.

**So `retrogo-sd` covers two physically different devices and the chooser draws one page for
both.** That is correct for the chooser -- both can return to stock, both can reinstall -- but it
means the chooser alone never tells you whether the original firmware is still on the device. The
comment at `Wizard.svelte:109-112` says this is deliberate: anything other than pristine stock in
bank 1 is "treat the user as returning".

### Everything else in bank 1

`classify.ts` returns `unknown` for a patched OFW with no app (`:130`) and for anything
unrecognised (`:133`). Both have `isStock === false`, so both draw all three cards. An empty,
unreadable or foreign bank 1 lands here too.

---

## 3. Locked is not a state this page has

**Owner's ruling, and it overrides the live component:**

> "LockedDevice is entirely wrong - WE DON'T CARE! We unlock the device if it is locked! The user
> is not explicitly prompted. Unlocking is an inherent part of the Backup phase. The Backup phase
> succeeding is incredibly important for that reason."

**A locked device draws the same chooser as any other device.** There is no locked page, no locked
card region, and no prompt. `Wizard.svelte:322` already calls `await device.ensureUnlocked()`
inside the backup run, and the comment at `:771` already states the rule the chooser contradicts:
"a locked device is unlocked before this write, never after it".

So unlocking is a step of Backup, not a question put to the user. The `isLocked` branch at
`Wizard.svelte:115-125` and `:1073-1084` -- which swaps the whole card region for
`chooser.lockedTitle` / `lockedBody` / `lockedHow` -- **is what the implementation must remove.**

### Why this raises the stakes on Backup

Unlocking erases both flashes. It is the one irreversible act in the flow, it happens inside
Backup, and nothing after it can recover the original firmware if Backup does not complete. That
is the reason the owner calls the Backup phase "incredibly important": it is not merely the first
step, it is the step that spends the device's only unrecoverable asset.

**Consequence for the implementation:** a locked device reaching the chooser is normal, and every
path that starts with Backup is still offered to it. `isLocked` stops gating the page; whether it
still has a job anywhere else is a question for the implementer, not an assumption to carry over.

### Three strings this retires

`chooser.lockedTitle`, `chooser.lockedBody` and `chooser.lockedHow` lose their only reader. Per
`UI_VOICE.md`'s Mechanics, deleting a string is a **15-file edit** and `test/firstrun.mjs`'s orphan
check must stay green with an empty allow-list, so they cannot simply be abandoned in the tables.
`GuidedLocked.dc.html`, an approved board, draws this state and is now superseded; it is under the
`artboard-index` guard and was not ours to touch.

---

## 4. The matrix

`ext` is external flash. Cards are listed in draw order. No row has a preselected card: the live
chooser has no selection state at all, and `path` is `null` until a card is clicked
(`Wizard.svelte:1037-1044`). **A ChooseAndSee board that preselects one is inventing a state**;
draw the plan for a hovered or provisional choice instead, and say which.

| # | Bank 1 | ext | Cards drawn | Floor note | Source |
| --- | --- | --- | --- | --- | --- |
| 1 | stock Zelda/Mario | 16 MB + | Dual Boot, Only Retro-Go | none | `:1090`,`:1103`,`:1114` |
| 2 | stock Zelda/Mario | 8 MB | Only Retro-Go | `tooSmallForDualBoot` | `:1131` |
| 3 | stock Zelda/Mario | 1, 2 or 4 MB | **none** | `tooSmallForRetroGo` | `:1124` |
| 4 | stock Zelda/Mario | unknown | Dual Boot, Only Retro-Go | none | `:137`,`:138` |
| 5 | Retro-Go | 16 MB + | Dual Boot, Only Retro-Go, Return to Stock | none | `:1114` |
| 6 | Retro-Go | 8 MB | Only Retro-Go, Return to Stock | `tooSmallForDualBoot` | `:1131` |
| 7 | Retro-Go | 1, 2 or 4 MB | Return to Stock | `tooSmallForRetroGo` | `:1124` |
| 8 | Retro-Go | unknown | Dual Boot, Only Retro-Go, Return to Stock | none | `:137`,`:138` |
| 9 | patched OFW, no app | any | as rows 5-8 (`unknown` kind, `isStock` false) | per size | `classify.ts:130` |
| 10 | locked | any | **as rows 1-8.** Locked is not a state this page has: see section 3 | per size | `:322`, `:771` |

**Row 3 is the degenerate page**: every card hidden, the floor note standing alone above the escape
line. The comment at `Wizard.svelte:1121-1123` names this case explicitly. No approved board draws
it.

---

## 5. The spine each choice produces

```js
path === "stock"
  ? ["select-backup", "restore", "remove-rgo"]
  : [...(showBackupStep ? ["backup"] : []), "install", "sources", "roms"]
```
`Wizard.svelte:1012-1017`.

| Path | Spine | Note |
| --- | --- | --- |
| `dual` | backup, install, sources, roms | `showBackupStep` is always true for `dual` (`:182`) |
| `rgo` + backup needed | backup, install, sources, roms | backup step titled differently, below |
| `rgo` + backup not needed | install, sources, roms | three steps, not four |
| `stock` | select-backup, restore, remove-rgo | |

### Whether the Retro-Go path shows a backup step

```js
rgoNeedsBackup = p === "rgo" && isStock && !backupTaken;   // Wizard.svelte:1043
const showBackupStep = path === "dual" || (path === "rgo" && rgoNeedsBackup);  // :182
```

**Latched at the moment of choosing, not derived live.** The comment at `Wizard.svelte:174-180`
gives the reason: taking the backup flips `backupTaken`, and a live derivation would delete the
step the user is standing on and renumber the spine underneath them.

So for a ChooseAndSee board, the plan shown beside `Only Retro-Go` is **four steps on a pristine
stock device with no recorded backup, and three steps otherwise**. That is the single most
consequential thing the right-hand column can show that today's chooser cannot.

The dual-boot path can never drop its backup step: the patch is computed from the dumped image
(`Wizard.svelte:168-172`, and again at `:185-187`).

### Step titles

| Id | Title | Source |
| --- | --- | --- |
| `backup` (dual) | `Backup & Patch Original Firmware` | `spine.backupAndPatchOriginal` |
| `backup` (rgo) | `Back Up the Original Firmware` | `spine.backUpOriginal` |
| `install` | `Install Retro-Go` | `spine.installRetroGo` |
| `sources` | `Add Software Sources` | `spine.addSources` |
| `roms` | `Add to Library` | `spine.addRoms` |
| `select-backup` | `Select Backup of Original Firmware` | `spine.selectBackup` |
| `restore` | `Restore Original Firmware` | `spine.restoreOriginal` |
| `remove-rgo` | `Remove Retro-Go` | `spine.removeRetroGo` |

`Wizard.svelte:1019-1035`, strings in `i18n/strings/wizard.ts:114-128`.

---

## 6. The state of each step

Three visual states, and they are exclusive in this order: done, active, dim.

```js
stepDone = (id === "backup" && step1Done) || (id === "install" && step2Done)
        || (id === "restore" && restoreDone) || (id === "sources" && curatedReady)

stepActive = !stepDone && ( (id === "backup" && step1Active)
        || (id === "install" && step2Active) || (id === "roms" && step3Active)
        || id === "sources"
        || (id === "select-backup" && !restoreDone)
        || (id === "restore" && restoreValid && !restoreDone) )

stepOptional = id === "sources" || id === "remove-rgo"
```
`Wizard.svelte:1144-1155`.

| Predicate | Definition | Source |
| --- | --- | --- |
| `step1Done` | `step1Skipped \|\| (path === "rgo" ? backupTaken : ofw.patched && backupTaken)` | `:165-167` |
| `step1Active` | `!step1Done` | `:168` |
| `step2Done` | `isInstalled` | `:451` |
| `step2Active` | `step1Done && !isInstalled` | `:450` |
| `step3Active` | `isInstalled` | `:853` |
| `isInstalled` | `kind === "retrogo-sd" \|\| kind === "retrogo-old"` | `:97-101` |
| `curatedReady` | a curated source list arrived, non-empty | `:65-70` |
| `restoreDone` | set true by the restore run | `:865`, `:936` |
| `restoreValid` | `restoreVerdict.valid` | `:914` |

Note `roms` and `remove-rgo` have **no done state at all** -- neither appears in `stepDone`. They
can only be active or dim. And `sources` is unconditionally active when not done, so on the install
paths steps 3 and 4 are never both dim once the install lands.

### How each state is drawn

| State | Marker | Title | Row |
| --- | --- | --- | --- |
| done | green circle, white check, **no number** | 16px | `opacity: 1` |
| active | filled ink circle, white number | **21px** | `opacity: 1` |
| dim | outlined circle, number | 16px | `opacity: 0.5` |

`Wizard.svelte:1158-1166` (marker), `:1465-1474` (base `opacity: 0.5`, lifted by `.active`/`.done`),
`:1505-1514` (marker fills), `:1539-1541` (active title 21px).

**There is no `Done` chip.** The comment at `Wizard.svelte:1172-1174` rules it out by name: the
green check already says it, and a word repeating it is filler. Only `Optional`
(`spine.chipOptional`) is drawn, and only while the step is not done (`:1176`).

---

## 7. The install control: one control, four faces

The owner's correction:

> "The Reinstall buttons are super wide. They should be smaller and to the right, they should have
> a version drop down so the user could install a lower version. The Upgrade path needs to be
> similarly structured with a version selection drop down that triggers the UI showing Reinstall.
> One final step further would be to make Upgrade/Reinstall/Downgrade all potential options that
> share the same UI elements and background but just display differently essentially."

### "Super wide" is half a board bug and half a real request

**The width was a board defect, not a design proposal.** The generator drew a bare `div` in the
spine's content cell, which is a flex COLUMN, so `align-items: stretch` grew it to the full 470px.
The live app never had that: every control sits in `<div class="row">`, `display: flex`
(`Wizard.svelte:1610-1614`), where a child is sized by its content. The boards were showing him a
button the app does not have. Fixed in `parts.py`'s `button()` with `display: inline-flex`.

**The alignment is a real change.** `.row` has no `justify-content`, so it defaults to
`flex-start` and every control in the spine is left-aligned today. The install control is now
`flex-end`. Nothing else moved: Backup, Skip and Restore stay left-aligned, because they were not
what he was looking at.

### The faces are already computed, for one candidate only

`versionRelation(installed, target, orderedGitTags)` (`firmwareDist/compare.ts:163`) already
returns **four** values, and the app already maps them:

| Relation | Face | Today |
| --- | --- | --- |
| nothing installed | `Install` | `installTitleState` returns `"install"` on falsy `installed` (`compare.ts:224`) |
| `newer` | `Upgrade` | `hasUpdate` (`Wizard.svelte:505`), drawn `variant="action"` |
| `same` | `Reinstall` | the `{:else}` at `Wizard.svelte:1219`, `variant="quiet"` |
| `older` | **`Downgrade`** | folded into Reinstall today |
| `unknown` | `Reinstall` | deliberate, and it must stay: "an upgrade we cannot demonstrate must not be promised" (`compare.ts:212-214`) |

**So a downgrade needs no new comparison logic, which is what the owner said it should cost.** The
one change is *which* version the question is asked about. Today every call site passes
`versions[0]`, the newest (`Wizard.svelte:504`); with a picker it passes the selected release.
`versionRelation` answers for any candidate already.

Note the face count is **four inputs to three verbs plus Install**: `unknown` renders as Reinstall
and must not be given a face of its own, or the app starts claiming a relation it could not
establish.

### What the control is

A version picker and a verb, in that order, right-aligned. Drawn on both branches of the install
step, which collapses a split the live component still has: done draws a verb with no version,
not-done draws a `v1.4.1 (latest)` *string* beside Install (`Wizard.svelte:1211-1233`). The picker
replaces that string, so the two branches stop being different shapes.

The picker follows `advanced/RomSection.svelte:969-981` -- a mono `select` listing every published
tag, `(pre)` suffixed on a prerelease -- because that is the app's existing version picker and a
second idiom for one question is what `CLAUDE.md` warns about for rails.

**Tone.** Upgrade and Downgrade are `action`, Reinstall is `quiet`, which extends the live split
(`Wizard.svelte:1213-1220`) by its own rule: a change to what is installed is an action, a repair
of what is already there is not. If "share the same ... background" was meant literally as one
tone for all three, that is a one-line change in the generator and his call to make.

### Why the version is not repeated in the label

`upgradeButtonLabel` is `(tag) => \`Upgrade to ${tag}\`` (`wizard.ts:86`). Beside a picker that
already shows the tag, the label would state it twice, which is the filler `UI_VOICE.md` §2 rules
out and the "state lives in structure" rule of §3: the picker carries which version, the button
carries what will happen to it.

---

## 8. Strings

Every string the boards draw exists and is verified present, **except the two below**.

- card labels, title, rubric, both floor notes, the escape pair: `wizard.ts:96-111`
- all eight spine titles and `Optional`: `wizard.ts:114-128`
- the picker needs no visible label; `romSection.installVersionLabel` ("Version",
  `firmwareSetup.ts:171`) already exists and serves as its accessible name, and
  `romSection.refreshVersions` (`:172`) is already rendered beside it by
  `Wizard.svelte:1049-1056`

**Missing, and each one is a 15-file edit with real translations:**

| Key | Value | Why |
| --- | --- | --- |
| `wizard.step2.downgradeButtonLabel` | `Downgrade` | no downgrade string exists anywhere |
| `wizard.step2.upgradeButtonLabel` | `Upgrade` | **changes shape**, from `(tag) => string` to a plain string, per section 7 |

Changing `upgradeButtonLabel` from a function to a plain string is a type change across all 15
siblings, so it will surface as a compile error in every one at once. `step2.bodyUpgrade(tag)`
(`Wizard.svelte:531`) is a different key on the confirmation modal and keeps its tag.

**A selection state on the cards would need one**, if selection were ever drawn with a word. It
must not be: `PlanFirst` established that selection is carried by an outline, not a label.

---

## 9. Where the approved boards contradict the code

Trust the code. Every item below was verified against the live string table.

| Approved board | Draws | Live | Source |
| --- | --- | --- | --- |
| `GuidedLayout` | `How Do You Want the Device Set Up?` | `What should this device run?` | `wizard.ts:97` |
| `GuidedLayout` | `Pick which one runs at power-on` | no such key | `UI_VOICE.md` §1, struck |
| `GuidedLayout` | `and leaves more space for games.` | no such key | `UI_VOICE.md` §1, struck |
| `GuidedLayout` | `Erases Retro-Go` | no such key | `UI_VOICE.md` §1, struck |
| `Guided` | `Add ROMs and Homebrew` | `Add to Library` | `wizard.ts:120` |
| `GuidedLocked` | a locked device gets its own page | it gets the ordinary chooser | section 3 |

`Add ROMs and Homebrew` is worse than stale: `apps/web/test/core-vocabulary.mjs` fails the build on
`ROMs` for the Library, so that board's copy could not ship today.

`GuidedLocked` is a different kind of stale: the live component agrees with it today, and both are
wrong against the owner's ruling in section 3. It is superseded rather than out of date, and it
sits under the `artboard-index` guard, so retiring it is a separate job from this one.

Two live states no approved board draws at all:

- **row 3**, under 8 MB with pristine stock, where every card is hidden and the floor note is the
  whole page;
- **unknown size**, where both gates pass and no note is drawn.
