# The beginner's audit

A walk through the whole UI as someone who has never done this before, diagnosed by
someone who has. The beginner supplies the feeling; the designer supplies the cause and
the fix.

The user I am imagining is real and common: they bought or were given a modded Game &
Watch, or they are following a YouTube tutorial. They are not stupid. They are *careful* —
which makes them slower and more easily stopped than a confident user, because every
unexplained word is a reason to stop and worry rather than click. When they get stuck they
assume they misunderstood something, and they quietly close the tab. They do not file
issues.

Everything below is grounded in the code as it stands on this branch. No production code
was changed.

---

## 1. The first ten minutes

**Landing, step 1.** `How is your device modded?` with two cards — *Flash Memory: Games
live on the internal flash chip.* / *SD Card: Games live on an SD Card mod.*
(`i18n/strings/landing.ts:9-13`).

> I don't know. Somebody else modded it. Or I followed a video and I don't remember which
> one this is. There is no third option and no ← anything, so I have to guess.

They guess. There is no "I'm not sure — help me check" and no statement of what happens if
they choose wrong. This is the first screen of the product and it opens with a question a
beginner frequently cannot answer.

**Landing, step 2.** `What would you like to do?` — *Manage Device: Backup, patch, install
firmware. Requires an adapter.* / *Manage Library: Build and install your ROM collection.*
(`landing.ts:17-20`).

> "Requires an adapter." An adapter for what? Is that the USB-C cable? I have a cable.

First mention of the single hardware prerequisite for the entire device half of the app,
in three words, undefined. If they are on Firefox or Safari the card also carries
`(Unsupported Browser)` (`landing.ts:21`) — which does not say *which* browser to use.

**They click it anyway.** `Landing.svelte:66` sets `class:disabled={!webusb}` but there is
no `disabled` attribute and the CSS is `opacity: 0.5; cursor: not-allowed`
(`Landing.svelte:205-208`) — no `pointer-events: none`. The click fires,
`handleNavigate('device')` runs, `App.svelte:88` calls `device.connectSilent()`, which
cannot work.

**Overview.** They land on a tab whose entire no-device state is one grey line:
`Waiting for a device connection…` (`OverviewTab.svelte:388-389`,
`i18n/strings/overview.ts:8`).

> Waiting. So it's doing something? I'll wait.

It is not doing anything. It will say this forever. There is no explanation, no next step,
and on an unsupported browser no possible resolution. **This is where the largest number
of people leave.**

**If they do have a probe and a Chromium browser**, they press Connect, meet the browser's
own device-picker chooser, and — assuming they picked the right one — get a scan. Then
Guided Setup opens.

**Guided Setup, the chooser.** `What should this device run?` with three bare cards:
`Dual Boot` / `Only Retro-Go` / `Return to Stock` (`i18n/strings/wizard.ts:120-124`).

> What is Retro-Go? What is dual boot dual-booting *between*?

The landing cards each carry a description line. **These do not.** There is no `Desc`
string for any of the three. The most consequential decision in the product is offered
with less explanation than the first screen's.

**If their device is locked** — i.e. any device that has not already been unlocked — the
Wizard offers all three options anyway. `classifyDevice` returns
`kind: "locked", installBanks: []` (`engine/classify.ts:43-44`), but `Wizard.svelte` never
tests for it: `isStock`, `isPatched`, `isBroken` and `isInstalled` are all false, and the
size floors do not gate because `extMB` is `null` for a device that cannot be read
(`Wizard.svelte:68-99`). So the beginner picks a path, starts a backup, and it fails
somewhere inside `dumpBackup`/`patchAndFlash` with a raw transport error. The one message
that would explain it — `Device is locked (RDP read-protection). Check "Unlock device" to
remove it before backing up.` (`i18n/strings/firmwareSetup.ts:99`) — is thrown only from
`advanced/OfficialFirmwareSection.svelte:238`, in a different tab, and names a checkbox
that is not on their screen.

**Library.** If they went the other way from the landing: `Set up your ROM folder to manage
games.` + `Set up folders…` (`i18n/strings/roms.ts:18-19`).

> I don't have ROMs. Where do ROMs come from?

The product is silent here, and that silence is deliberate and correct. But silence and
*nothing at all* are different things — see §4.

---

## 2. Vocabulary audit

Counting only user-facing chrome, not the deliberately technical log lines.

| Term | Where | Verdict |
|---|---|---|
| **adapter** / **ST-Link** / **programmer** | `landing.ts:18`, `shared.ts:60`, `shared.ts:110` | **Three names for one object.** Pick one. `shared.ts:110` says "the programmer wiring"; `shared.ts:60` says "An ST-Link v2 (or compatible) adapter"; the landing says "an adapter". Standardise on **adapter**, with ST-Link named once as an example. |
| **Retro-Go** | everywhere | Never defined. The product is *for* installing it and never says what it is. One sentence, once, at the chooser. |
| **Dual Boot** | `wizard.ts:121` | Necessary concept, zero explanation. Needs a description line: keeps the original game *and* Retro-Go, choose at power-on. |
| **Recovery Mode** | `shared.ts:45,48`, `overview.ts:60` | Our invention for "load the RAM debug stub". Clearer than "stub", but reads as *something is wrong*. The body copy (`shared.ts:46-51`) is genuinely good; the *name* alarms. Consider "Service Mode" or keep and reassure in the title. |
| **stub** | `firmwareSetup.ts:210` | Leaks into a user-facing sentence. Replace with the same words as the modal. |
| **RDP** | `firmwareSetup.ts:59,99` | Datasheet vocabulary. "read protection" alone is enough; keep RDP only in the log. |
| **prepare** | `roms.ts:35`, and every core's row | An invented verb for "convert this file into the form the device needs". A beginner cannot guess it. Needs a one-line explanation at first sight. |
| **ROM** | `shared.ts:69`, `roms.ts:18` | Assumed known. Probably safe for this audience, but see §4. |
| **homebrew** / **HB** | `roms.ts:31-33`, `sources.ts:8` | `sources.ts:17` defines it well ("Custom games/applications for the Game & Watch."); the Library shows a bare `HB` chip. Reuse the definition as a tooltip. |
| **core** (← emulator) | queued rename | **The queued rename makes this worse for beginners, not better.** "Emulator" is guessable; "core" is libretro jargon. The rename is right for accuracy — pair it with a definition somewhere, or beginners lose a word they understood. |
| **bank** | `overview.ts:47`, bank cards | Necessary (the hardware has two). Needs one explanatory line in Overview, not per-instance. |
| **FrogFS** / **LittleFS** | `firmwareSetup.ts:325,328` | **Already handled correctly** — "Games, homebrew (FrogFS)". Plain first, jargon in parentheses. This is the pattern the rest of the app should copy. |
| **superblock**, **ABI**, **offset** | `firmwareSetup.ts:*`, `sources.ts:156,188` | Appropriate in Advanced. **Except** `wizard.ts:57` `Patch superblock` and `wizard.ts:53` `Set SD cache reserved-offset boundary`, which appear in the progress checklist a beginner watches during their first install. |
| **bundle** / **Pages mirror** | `sources.ts:36`, `sources.ts:26` | "The project must publish a GitHub Pages mirror of its releases" is unactionable for a beginner. It is a constraint on *authors*, shown to *users*. |

Any change here is a seven-file i18n edit (`strings/<area>.ts` + `.de .es .fr .ja .ko .pl`).
I have made none.

---

## 3. Findings, ranked by how many people they stop

### F1 — The unsupported-browser card is clickable, and leads nowhere
**Beginner:** clicks a greyed-out card, lands on a page that says "Waiting for a device
connection…", waits, leaves.
**Defect:** disabled in appearance only. `Landing.svelte:66` has no `disabled` attribute;
`.choice.disabled` (`:205-208`) sets `opacity` and `cursor` but not `pointer-events`.
**Fix:** add the `disabled` attribute. Replace `(Unsupported Browser)` with the browsers
that work — the Library already does this well: *"To save covers directly, use Chromium,
Chrome, or Edge."* (`roms.ts:15`). Reuse that list.

### F2 — Overview's no-device state teaches nothing and offers nothing
**Beginner:** one grey sentence on an otherwise empty screen, indefinitely.
**Defect:** `OverviewTab.svelte:388-389` renders a bare placeholder. No statement of the
prerequisite, no action, no exit. It is the default tab for "Manage Device".
**Fix:** make it the one place that explains the prerequisite — you need an adapter, this
is what one is, here is Connect. This single screen would absorb most of F1's damage too.

### F3 — A locked device is offered a flow that cannot succeed
**Beginner:** picks Dual Boot, starts, gets a raw failure, has no idea their device needed
unlocking first.
**Defect:** `Wizard.svelte:68-99` never tests `deviceClass.kind === "locked"`, though
`classify.ts:43-44` produces it. The explanatory error exists only in the Advanced tab
(`OfficialFirmwareSection.svelte:238`) and names a control on a different screen.
**Fix:** gate the chooser on `locked` and say what it means in plain words, with the
unlock action reachable from there. Note the *procedure* is irreducibly physical (§4) —
this is about naming the wall, not removing it.

### F4 — The chooser asks the biggest question with no explanation
**WITHDRAWN by the owner**, after the fix shipped and he read it back:

> "Pick which one runs at power-on" "[...] and leaves more space for games." "Erases
> Retro-Go" are unnecessary strings. You're adding text to shit I never told you to touch
> and you're making them in this weird narration style instead of focusing on good UI
> design.

The reasoning above held that the landing cards carry descriptions, so the chooser should
too. The owner's ruling is that a chooser button is a name. The three `Desc` keys are
deleted in all seven locales and `test/firstrun.mjs` now fails if they return.

**What survives:** the second half of the fix. `whatIsRetroGo` stays as a rubric under the
title, because it defines the one word the screen assumes and it is not a button caption.

### F5 — Converter failures show raw error codes
**Beginner:** `Couldn't prepare: unknown-output`. Nothing to do with it.
**Defect:** `roms.ts:41` interpolates an untranslated kebab-case `ConverterError` code; the
comment at `:40` acknowledges it is diagnostic text. In German this reads *"Konnte nicht
vorbereitet werden: malformed"* — half-translated, wholly opaque.
**Fix:** map the code set to plain sentences; `sources/errorText.ts` already has the
grouping pattern for exactly this. Keep the raw code in the activity log.

### F6 — "adapter", "ST-Link" and "programmer" are the same object
**Beginner:** believes these are three different things they may or may not own.
**Defect:** `landing.ts:18`, `shared.ts:60`, `shared.ts:110`.
**Fix:** one word everywhere.

### F7 — Developer phase labels in the beginner's progress modal
**Beginner:** watches `Patch superblock` and `Set SD cache reserved-offset boundary` scroll
past during their first-ever flash, understands nothing, worries.
**Defect:** `wizard.ts:53,57`.
**Fix:** these are real steps and should not be cut (HANDOVER §4). Reword to what they
achieve, and keep the precise names in the log.

---

## 4. Irreducible difficulty — what the UI should teach, not hide

Some of this cannot be designed away, and pretending otherwise would be worse.

- **You must open the device and attach a debug probe.** Nothing in software changes this.
  The app should state it *before* the user commits, not imply it with three words on a
  card.
- **Unlocking is a physical dance.** `references/gnwmanager/tutorials/unlock.md`: flash a
  payload, fully remove power, re-apply, press power, wait for the screen to turn **blue**,
  confirm. A web UI cannot shorten it. It can *narrate* it — and the existing
  `stubLoadModal` copy (`shared.ts:46-51`, "Hold down the device's power button while it
  connects, then set the device down and don't touch it") proves this product already
  knows how to write hardware instructions well.
- **Backups cannot be re-obtained.** `wizard.ts:31` says it perfectly: *"Keep these files
  safe — you cannot download them again."* Necessary weight, correctly applied.
- **Where ROMs come from is deliberately unaddressed**, and should stay that way. But the
  Library's empty state can still say what shape of thing it wants — a folder containing
  console subfolders — without sourcing advice. Right now it says neither.
- **Two banks, two firmwares.** Genuinely how the hardware works. Teach it once in
  Overview rather than assuming it everywhere.

---

## 5. What is already good — do not lose this

- **`stubLoadModal`** (`shared.ts:44-52`). Explains *why*, then gives a physical
  instruction with a reason. Best copy in the product.
- **`wizard.ts:31` `bodyBackupOnly`** — states the stake in one clause and does not
  moralise.
- **`restore.modalBody`** (`wizard.ts:132`) — enumerates exactly what is destroyed. No
  hedging.
- **`spine.skipCaution`** (`wizard.ts:128`) — legally and practically honest without
  lecturing.
- **The Firefox warning** (`roms.ts:12-15`) — names the exact limitation, the workaround,
  *and* the browsers that work. The template for F1.
- **`firmwareSetup.ts:325,328`** — "Games, homebrew (FrogFS)". Plain-first, jargon-in-parens.
  The template for the whole vocabulary problem.
- **Per-bank contextual prompts** (`overview.ts:44-49`) — each bank offers the step that
  fits its own state, and shows nothing when the state is unclear rather than inventing a
  prompt. Exactly right.
- **`sources.ts:75-76`** — "Not active. Activating adds it to the Library tab." States the
  consequence of the action. More of this.
- **`needsUserFiles: "Needs a file you supply"`** (`sources.ts:87`) — plain language for a
  technical condition.

---

## Note

The queued **Emulator → Core** rename is right for accuracy and costs beginners a word
they could guess. Land it with a definition, not on its own.
