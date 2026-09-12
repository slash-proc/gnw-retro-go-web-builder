# The application map — what the seven policies would do to the 68 questions

> **Reference only, 2026-09-08. Do not read a question count off this document.** It is built on
> `DECISIONS.md`'s 68-question framing, which is superseded: the live list is
> [`docs/BLOCKED-AUDIT.md`](./BLOCKED-AUDIT.md), where **20 questions actually need the owner**.
> Two of the seven policies below — **P1** (artboard wins on pure paint) and **P2** (keep what no
> artboard shows, and record it) — **have since been adopted** (HANDOVER §4) and are no longer
> hypothetical. The per-row outcomes here remain useful as a dispatch plan; the *status* of any
> row must be taken from BLOCKED-AUDIT, not from here.

**Status: nothing here is decided.** The owner has been offered seven policies and has not
answered. This document exists so that the moment he does, the work is a mechanical dispatch
rather than another derivation pass. Every row says *what would happen if that policy were
adopted*, not what has been agreed.

**No application code was changed by this document.** The gate at the foot proves it.

## The policies, as offered

| | Policy |
|---|---|
| **P1** | Where the artboard and the app disagree on pure paint (size, colour, weight, spacing, radius), the artboard wins. |
| **P2** | Where the app has a feature no artboard shows, keep it and record it as intentional. |
| **P3** | Never change behaviour to match a drawing; a drawing that implies behaviour becomes artboard debt, not a code change. |
| **P4** | Safety and honesty beat fidelity. |
| **P5** | The app's established vocabulary beats a single divergent artboard; the artboard wins where the app never made a considered choice. |
| **P6** | Tokens: snap to the nearest existing token unless the artboard uses the value three or more times, in which case mint it. |
| **P7** | Generation conflicts: newer artboard wins; where only the older exists it governs; where two boards of the same generation conflict on a shared component, the component gets a variant rather than a compromise. |

**Effort buckets.** *trivial* — a token or a single value. *contained* — one component.
*involved* — a shared component, a seven-file i18n edit, or a structural change.

**Line numbers were re-verified against the working tree on 2026-09-07**, not copied from the
surveys; several had moved (e.g. `Landing.svelte`'s title is now `:149`, not `:127`;
`overview.ts`'s legend label is `:66`, not `:64`).

---

## A. One-word rulings (1–7)

| # | Question | Policy → concrete outcome | Rows closed | Files / lines | Effort |
|---|---|---|---|---|---|
| 1 | MB or MiB | **none.** No policy touches unit taste. **Individual.** | 231, 729 | `lib/views/RomManagementTab.svelte:179`, `:1334`, `:1344`, `:1464`; `lib/i18n/strings/roms.ts` + 6 siblings | involved (7-file) |
| 2 | Empty bank shows `Empty` / `—` | **P5 (limb 2)** → the app has no string at all, so no considered choice exists: add `Empty` + `—` below the bar. | A50 (unblocks A54, A57, A63) | `lib/ui/BankCard.svelte:46`, `:65`, `:246`; new keys in `lib/i18n/strings/overview.ts` + 6 siblings | involved (7-file) |
| 3 | Empty bank 2 offers an action | **P3** → the app's offer is behaviour; keep it, log `NoStockBank1` as debt. **P7** would instead demand a BankCard state variant. *See conflicts.* | A53 | `lib/views/OverviewTab.svelte:121-158` (`bankPrompt`) | contained (if P7) / none (if P3) |
| 4 | `Verify after write` default | **P4** → stays ON. Artboard amended. | W-8 | `lib/advanced/FlashSection.svelte:26` | trivial (no change) |
| 5 | Ack checkbox bank-1-only or always | **P3** → keep the bank-1 gate. **P4** → show it always (a bank-2 write is also destructive). *Conflict; P4 should win.* | W-13 | `lib/advanced/FlashSection.svelte:49-50`, `:211` | contained |
| 6 | Filled or stroked device glyphs | **P1** → restroke both icons to `stroke="currentColor" stroke-width≈1.2`, `fill="none"`. | A4, A43, Landing2 mismatch | `lib/ui/FlashChipIcon.svelte:11-27`, `lib/ui/SdCardIcon.svelte`; call sites `lib/ui/DeviceHeader.svelte:118`, `lib/views/Landing.svelte` | contained |
| 7 | Activate/Deactivate + Sources footer primary fill | **P1** → fill them. **P5** → the app's `ink` outline is app-wide vocabulary and the two artboards disagree with *each other* (filled dark vs plain red text), so P5 keeps the outline. *Conflict; P5 should win.* | ReposDetail 435, 457 | `lib/views/Sources.svelte:514`, `:528-533`; `lib/ui/Button.svelte:38-52` | contained |

## B. Naming and vocabulary (8–12)

| # | Question | Policy → concrete outcome | Rows closed | Files / lines | Effort |
|---|---|---|---|---|---|
| 8 | `Games`/`Cores & Saves`/`Free Space` vs `FrogFS`/`LittleFS`/`Free` (ruled as `Emulators & Saves`; middle word moved with the core rename) | **P5** → friendly names are a deliberate, documented product choice; they stay. **P4** carves out the warning path: where the collision warning fires for LittleFS/FAT, it may not say "games". Split outcome. | X-4, A36, A35, A37, BackupPatch #7, LibrarySummary 332/333 | `lib/i18n/strings/shared.ts:79-91`; `lib/engine/classify.ts:171-181`; `lib/i18n/strings/overview.ts:66`; `lib/i18n/strings/firmwareSetup.ts` overlap keys | involved (7-file) |
| 9 | "source" or "repository" | **P5 + P7** → `source` stays; `ReposAdd` is stale. | 397, 398 | `lib/i18n/strings/sources.ts:19`, `:58`; `lib/views/Sources.svelte:273`, `:429`, `:437` | trivial (doc only) |
| 10 | `Migrate games` vs `Keep installed games` | **P4 + P5** → the checkbox migrates; `Migrate` is the honest verb. Artboard debt. | F7 | `lib/i18n/strings/firmwareSetup.ts:172-173`; `lib/advanced/RomSection.svelte` checkbox block | trivial (no change) |
| 11 | `Done` or `Close` on Add Sources footer | **P5 (limb 2)** → reusing `shared.common.close` was convenience, not a choice: mint `done`. | 486, 502 | `lib/ui/AddSourcesModal.svelte:170`; `lib/i18n/strings/shared.ts:11` + 6 siblings | involved (7-file) |
| 12 | `8 optional files` vs `8 more optional files` | **P5** → an in-code rationale is a considered choice; app wins. | 600 | `lib/i18n/strings/sources.ts:99`; `lib/ui/FilePromptModal.svelte:344` | trivial (no change) |

## C. Tokens that do not exist (13–17)

| # | Question | Policy → concrete outcome | Rows closed | Files / lines | Effort |
|---|---|---|---|---|---|
| 13 | 18px type token | **DONE, not hypothetical (2026-09-08).** `--fs-title: 18px` was minted at `src/styles/tokens.css:174` and `--fs-lg` retired outright in `51ac881`; the file/line list below is the *original* proposal and its line numbers have moved. Original: **P6** → used on ~10 titles, far past three: **mint** (e.g. `--fs-title: 1.125rem`) and repoint every `--fs-lg` title. | A6, 475, 532, 560, 590, 692 (+GDP, RMT) | mint at `src/styles/tokens.css:63`; repoint `lib/ui/FolderGateModal.svelte:101`, `InstallProgressModal.svelte:171`, `StubLoadModal.svelte:33`, `FilePromptModal.svelte:479`, `ConfirmModal.svelte:110`, `ConnectGateModal.svelte:105`, `AddSourcesModal.svelte:183`, `lib/views/RomManagementTab.svelte:2370`, `Landing.svelte:215`, `GameDetailsPanel.svelte:2128` | involved (shared token) |
| 14 | 15px and 10px | **P6** splits them: 10px appears on `required`, `optional` and `StatusChip.svelte:104` → **mint**. 15px has two uses → **snap to `--fs-caption` 14px**, amend the artboards. | A7, 594 | `src/styles/tokens.css:111`; `lib/ui/FilePromptModal.svelte:523`, `:621`, `:629`, `:674`; `lib/ui/StatusChip.svelte:104`; `lib/views/Landing.svelte:158` | contained |
| 15 | The off-ramp greys `#e0e0e0` / `#f0f0f0` | **P6, read literally, MINTS both** — `#f0f0f0` recurs on the optional badge, the Convert chips and the Added chips. That is the wrong answer. *See "where a policy is daft".* | 210, 595, 603, 650 | `src/styles/tokens.css:9`, `:73`; `lib/views/RomManagementTab.svelte:2499`, `:2692`; `lib/ui/FilePromptModal.svelte:636`; `lib/ui/Button.svelte:42-48` | contained |
| 16 | `.frogfs` is `#c0392b` | **P1** → a red in no artboard is not a choice: repaint `.frogfs` to the artboard's `#3e9e4e`, `.littlefs` to `#9a9aa0`, which also unblocks the legend. | X-5, A35 | `lib/ui/GeometryBar.svelte:184`, `:191`, `:201`, `:207` | contained |
| 17 | On-fill ink token | **P6** → three-plus literal white-on-fill uses: **mint** `--ink-on-fill`. | (no BLOCKED row of its own; unblocks literals cited in X-5, 435) | `src/styles/tokens.css`; `lib/ui/GeometryBar.svelte`, `lib/ui/Button.svelte` | trivial |

## D. Artboard versus artboard (18–21)

| # | Question | Policy → concrete outcome | Rows closed | Files / lines | Effort |
|---|---|---|---|---|---|
| 18 | `GeometryBar` 34px or 10px | **P7** → same component, two boards: give it a **size variant** (`bar` 34/3px, `strip` 10/5px) rather than a compromise. **The two unbacked callers are not decided by any policy** — `InstallGeometry` and `RomSection` still need an individual call on which variant they take. | X-1, A34 | `lib/ui/GeometryBar.svelte:125-135`; 8 call sites: `lib/ui/StatPanel.svelte`, `lib/ui/InstallGeometry.svelte`, `lib/views/OverviewTab.svelte:568`, `lib/advanced/{FileBrowser,Dump,Erase,Rom,Flash}Section.svelte` | involved (shared) |
| 19 | Chooser heading wording | **none decides it.** P7 would, but the two chooser boards are the same generation and neither is a shared component. **Individual.** | GL1, GL3 | `lib/i18n/strings/wizard.ts:98` + 6 siblings; `lib/views/Wizard.svelte:927`, `:1220` | involved (7-file) |
| 20 | Collision aside + cross-model note together | **P3** → the app allows both; keep. Stacking order becomes artboard debt (a drawing is owed). | BackupPatch #18, #19 | `lib/advanced/OfficialFirmwareSection.svelte:545-570` | none (debt) |
| 21 | Bank picker in the Install pane | **P7** → two boards, one component: second `BankCard` variant (horizontal 34×84, caption beside). | F10, F12 | `lib/ui/BankCard.svelte`; `lib/advanced/RomSection.svelte:851-857`; caption `lib/i18n/strings/firmwareSetup.ts:174` | involved (shared + 7-file) |

## E. App features no artboard shows (22–26)

All five are **P2 → keep, record as intentional.** No code changes; the work is a note per row.

| # | Question | Rows closed | Files / lines | Effort |
|---|---|---|---|---|
| 22 | `Enter Recovery Mode` gate | FB-12, W-16, D-11, E-13, BackupPatch #6 | `lib/advanced/FirmwareRail.svelte:121-124`, `FlashSection.svelte:125`, `DumpSection.svelte:70`/`:196`, `EraseSection.svelte:187-188`, `OfficialFirmwareSection.svelte:581-586` | trivial (doc) |
| 23 | Library rows with no artboard | 218, 219, 225, 296 | `lib/views/RomManagementTab.svelte:1066-1069` (bios rows), the unknown-homebrew rows + `roms.ts:26`, the now-playing `StatusChip`, `lib/views/GameDetailsPanel.svelte:991-1010` | trivial (doc) |
| 24 | Header extras (amber halo, media glyph) | 756, 770 | `lib/ui/DeviceControls.svelte:79`, `:158-176`; `lib/ui/DeviceHeader.svelte:114-120` | trivial (doc) |
| 25 | Sources extras | 368, 403, 436, 568 | `lib/views/Sources.svelte:419-420`, `:452`; `lib/ui/AddSource.svelte:209`; `lib/ui/FolderGateModal.svelte:52-53` | trivial (doc) |
| 26 | Chip-as-remove-button | 651 | `lib/ui/FilePromptModal.svelte:436-457`, `:636` | trivial (doc) |

## F. Needs an artboard drawn (27–30)

| # | Question | Policy → concrete outcome | Rows closed | Files / lines | Effort |
|---|---|---|---|---|---|
| 27 | The privacy note | **none.** P2 runs the other way (the artboard has it, the app does not) and no policy adopts unbacked copy. **Individual.** | 431 | new key in `lib/i18n/strings/sources.ts` + 6 siblings; `lib/ui/AddSource.svelte` | involved (7-file) if shipped |
| 28 | Landing2's `Modded with / Change` row | **P3** → it implies returning to step 1 with context kept: artboard debt, no code. | A9 (tracked 8.6) | `lib/views/Landing.svelte` | none (debt) |
| 29 | Flashing Cancel + its confirmation | **none** — it needs mockups. **Individual.** | D-10 (and S8.13) | `lib/advanced/DumpSection.svelte:190-203`; `lib/engine/flasher.ts` abort path | involved |
| 30 | Disconnected / unscanned / unsupported / Boot Image / `Overwrites` | **Split.** The four existing states are **P2 → keep** (A13, A40, A41). The `Overwrites` row is the opposite case and **P4 → build it**: the destination's current occupant must be named before it is overwritten. | A13, A40, A41, W-10, W-11 | keep: `lib/views/Landing.svelte:68-70`, `OverviewTab.svelte:584-596`, `overview.ts:74-77`. Build: `lib/advanced/FlashSection.svelte:190-191` + new key in `firmwareSetup.ts` + 6 siblings | involved |

## G. Needs a spec (31)

| # | Question | Policy → concrete outcome | Rows closed | Files / lines | Effort |
|---|---|---|---|---|---|
| 31 | `RomsNewSystem` "NEW" badge | **none.** Needs persisted seen-systems state and a reset rule — a spec, not a ruling. **Individual.** | 201 | `lib/views/RomManagementTab.svelte:1989-2001` region (console filter chips) + new persisted store | involved |

## H. The coverage-pass questions (32–64)

| # | Question | Policy → concrete outcome | Rows closed | Files / lines | Effort |
|---|---|---|---|---|---|
| 32 | 34px display token | **P6** → one use only → **snap**; keep `--fs-display-lg` 32px and amend the artboard. | A5 | `lib/views/Landing.svelte:148-149`; `src/styles/tokens.css:65` | trivial (no change) |
| 33 | Overview Device section: 3 rows or 5 | **P4** → the two extra rows are the only in-body statement of what is installed; keep five. Artboard debt. *(Listed among the nine, but P4 does reach it.)* | A15 | `lib/views/OverviewTab.svelte:392-416`; `lib/i18n/strings/overview.ts:11-15` | none (debt) |
| 34 | `Restart flash utility` wording + the not-loaded state | **Split.** The not-loaded state is **P2 → keep**. The wording is **individual** — `Restart Flash Util` is an abbreviation the app chose deliberately, so P5 leans app, but no artboard covers "Start". | A21 | `lib/i18n/strings/overview.ts:29-30` + 6 siblings; `lib/views/OverviewTab.svelte:489` | involved (7-file) if changed |
| 35 | Screenshot area black or grey | **P5** → the code argues the black ground is the device's own screen: considered choice, app wins. | A24 | `lib/views/OverviewTab.svelte:985-995` | none (debt) |
| 36 | Ext-flash headline: total, or `free of total` | **P4 (+P1)** → free-first is the more useful and more honest statement; adopt it. Note this also settles the shape half of A37. | A33, A37 (shape) | `lib/views/OverviewTab.svelte:566`, `:935-939`; `lib/i18n/strings/overview.ts:23` + 6 siblings | involved (7-file) |
| 37 | Does the External Flash panel get a box | **P1** → drop the box. **P5** → the code's rationale ("the chip is a real object") *is* the mockups README's own rule, so P5 keeps it. *Conflict; P5 should win.* | A38 | `lib/views/OverviewTab.svelte:565`, `:922-934` | contained |
| 38 | Dimmed slot `patchMissing` | **P2** → keep, record intentional. | A47 | `lib/ui/DeviceHeader.svelte:84-97` | trivial (doc) |
| 39 | Progress modal lip + `Working.` line | **Split.** Lip: **P7** → a busy variant on `ModalShell`, not a compromise with the deliberate 3px. Copy: **P1** → adopt `Working.` + the caution ink for the bold run. | GF5, GF6 (collides with 8.9) | `lib/ui/ModalShell.svelte:44-46`, `:71-74`; `lib/ui/InstallProgressModal.svelte:104`; `lib/i18n/strings/shared.ts:14-16` + 6 siblings | involved (shared + 7-file) |
| 40 | Do pending Guided steps render controls | **P3** → behaviour; keep the live controls, artboard debt. | GR9, GS6 | `lib/views/Wizard.svelte:1061-1066` | none (debt) |
| 41 | `Restore` needs its own key | **P5 (limb 2)** → repeating the step title was reuse, not a choice: mint `restore`. | GSO2 | `lib/i18n/strings/wizard.ts:119` + 6 siblings; `lib/views/Wizard.svelte:1099` | involved (7-file) |
| 42 | Three Firmware copy calls | **P7 + P5 (limb 2)** → `Guided` (five newer boards agree), `Version`, and a new `Target` label above the bank cards. | F1, F5, F9 | `lib/i18n/strings/firmwareSetup.ts:19`, `:171` + new key, ×7; `lib/views/Advanced.svelte:236-241`; `lib/advanced/RomSection.svelte:821`, `:851` | involved (7-file) |
| 43 | Install pane's three extras | **P2** → keep all three. Moving the superblock-debug link behind Advanced is a *recommendation*, not a policy outcome. | F17 | `lib/advanced/RomSection.svelte:858-872`, `:966-974`, `:978-992` | trivial (doc) |
| 44 | `Re-read partition` | **P3** → the drawing implies new device-touching behaviour: artboard debt, do not build. | FB-10 | `lib/advanced/FileBrowserSection.svelte` footer | none (debt) |
| 45 | File-picker field shape | **PARTLY DONE (2026-09-08).** `FlashSection` got the artboard's 40px `.filefield` in `0bfd2db` (`:199-206`, styled `:413-427`), and `lib/ui/FilePick.svelte` no longer exists — deleted unreferenced in `863290c`, so that leg of the ruling is moot. Still open: `AddSource.svelte:222` and `AddSourcesModal.svelte:127` remain bare native inputs. Original: **P1** → pure paint; wrap the native input in the artboard's 40px bordered mono field. One ruling, three rows. | W-3, 408, 479 | ~~`lib/ui/FilePick.svelte:40-56`~~ (deleted); `lib/advanced/FlashSection.svelte` (done); `lib/ui/AddSource.svelte:219-231`; `lib/ui/AddSourcesModal.svelte:123-134` | involved (shared) |
| 46 | Two Dump nits | **Split.** Chevron: **P1** → suppress the UA arrow, draw the artboard glyph. `matches LittleFS`: **P5** → deliberate omission, app wins. | D-4, D-5 | `lib/advanced/RangeField.svelte:80-84`, `:123-134`; `lib/advanced/DumpSection.svelte` caption | contained |
| 47 | Internal bar: two segments or four | **P4** → two segments cannot answer "will it fit"; keep four. | X-3 | `lib/engine/classify.ts:196-213` | none (debt) |
| 48 | Hover-detail strip | **P2** → keep, record intentional (removing it costs click-to-pin on eight call sites). | X-7 | `lib/ui/GeometryBar.svelte:89`, `:246-260` | trivial (doc) |
| 49 | Two intro paragraphs in Backup step 1 | **P2** → keep. *(This is P2 at its weakest — see the daft section.)* | BackupPatch #1 | `lib/advanced/OfficialFirmwareSection.svelte:385-390` | trivial (doc) |
| 50 | System tag + the filtered list | **P3** (the tag's conditionality is behaviour) **+ P2** (no board draws a filtered list) → keep both. | 211 | `lib/views/RomManagementTab.svelte:294`, tag render ~`:2060-2070`; `lib/ui/StatusChip.svelte:99-111` | trivial (doc) |
| 51 | Confirm the two stale artboards | **P4** → the SD meter's value is forbidden by the SD-vs-Flash rule (drawing it means inventing a number). **P2** → the locale switcher is a real feature the `EN` label predates. Both confirmed stale. | 249, 250, 251, 772 | `lib/views/RomManagementTab.svelte:1439`, meter guard `~:2261`; `lib/ui/DeviceHeader.svelte:149`, `:328` | trivial (doc) |
| 52 | Options drawer: docked or in flow | **P7, read literally** → only the older board exists, so it governs → undock the drawer. That is the wrong answer. *See the daft section.* Content half is **P2 → keep**. | 284, 341 | `lib/views/RomManagementTab.svelte:52-54`, `.drawer` ~`:2748-2754`, `:2220-2251` | involved (structural) |
| 53 | Cover-art scraper-only affordances | **P3** → conforming means inert controls or new plumbing; keep the conditionals, artboard debt. Two paint fragments survive: **P1** drops the trailing colon on `Source:` and renames the option to `ScreenScraper`. | 289, 290, 292, 293, 298 | `lib/views/GameDetailsPanel.svelte:881`, `:921`, `:937`, `:991`, `:1071-1101`; `lib/i18n/strings/roms.ts:167` + 6 siblings | involved (7-file) |
| 54 | `Apply` beside the drop hint | **P3** → the fused row implies a mode the code does not have; keep the exclusive branches. | 294 | `lib/views/GameDetailsPanel.svelte:937-975`; `lib/i18n/strings/roms.ts:179` | none (debt) |
| 55 | The `Written` row | **P3** → needs the mtime plumbed: artboard debt. | 299 | `lib/views/GameDetailsPanel.svelte:1101-1109` | none (debt) |
| 56 | The cheats footer | **P3** → a summary aggregate and an editable list are different objects; keep the editor. | 304 | `lib/views/GameDetailsPanel.svelte:1214`; `lib/i18n/strings/roms.ts:228` | none (debt) |
| 57 | Mono-setting the filename in the BIOS aside | **P1** → split the string. **P4** → splitting is the documented Pre/Post fragment hazard across six locales. *Conflict; P4 should win — do not split.* | 338 | `lib/i18n/strings/sources.ts:124`; `lib/views/RomManagementTab.svelte:2396` region | none (if P4) |
| 58 | Repos `Add`: green plus-link or `ink` button | **P1** → the plus-link. **P5** → the app's button vocabulary. *Same conflict as 7; answer them together.* | 369 | `lib/views/Sources.svelte:459`; `lib/ui/Button.svelte` | contained |
| 59 | Satisfied optional-file row shows the variant name | **P3 in part** — the accepted variant's name must reach the row. If it is already in scope at the call site this collapses to **P5 limb 2** (a bare `Found` is not a considered choice) and becomes contained. | 453 | `lib/ui/AdditionalFiles.svelte:211-212`; `lib/i18n/strings/sources.ts` filePrompt block | contained–involved |
| 60 | URL field placeholder | **P5** → the accepted-forms hint is a considered choice; app wins. | 477 | `lib/ui/AddSourcesModal.svelte:112-118` | none (debt) |
| 61 | `Choose…` or `Change…` on a satisfied row | **P5 + P4** → the swap is deliberate and more honest once a folder is picked; app wins. | 565 | `lib/ui/FolderGateModal.svelte:56`, `:78`; `lib/i18n/strings/shared.ts:18` | none (debt) |
| 62 | The `Added` chips group placement | **P1** → structural paint; move the block out of `<section class="input">`, after the last row's rule. | 649 | `lib/ui/FilePromptModal.svelte:371`, `:436`, `:636` | contained |
| 63 | Does the SD dock show a projected total / net change | **P4** → SD mode structurally cannot compute either figure; the caption does not exist. Artboards stale. | 729, 730 | `lib/views/RomManagementTab.svelte:1462-1480` | none (debt) |
| 64 | Does the busy header disable destructive controls | **P4** → yes: gate `disconnectDevice` and `restartRecoveryMode` while writing. No policy opposes it (no board draws the state, so P3 is not engaged). Pairs with 24's halo. | 771 | `lib/ui/DeviceControls.svelte:57-71`, `:96`, `:102` | contained |

## J. Decisions taken since the list was written (65–68)

| # | Question | Policy → concrete outcome | Rows closed | Files / lines | Effort |
|---|---|---|---|---|---|
| 65 | Retry a real `BAD_HASH_FLASH`? | **P4** → treat `BAD_HASH_FLASH` and `BAD_SEGFAULT` as terminal; keep the 3 attempts for transport-shaped failures only. Two silent instant retries turn one legible failure into three. | — (no survey row) | `lib/engine/flasher.ts:83-95` | contained |
| 66 | Nothing in the app can draw a failure | **P4** → a failure must reach a pixel; `device.error` needs a renderer. **The treatment itself is individual**, as are the two sub-questions (auto-clear vs dismiss; whether a raw WebUSB exception belongs in a 40px band). | — | `lib/device.svelte.ts:39`, `:300`, `:898`; `lib/ui/DeviceControls.svelte:46-58`; `lib/ui/DeviceHeader.svelte:48-50`, `:124` | involved |
| 67 | `handleLost`'s `device.error` assignment | **P4** → remove it; it duplicates approved copy `statusText` already renders, and it is untranslated English besides. Survives 66 either way. | — | `lib/device.svelte.ts:898`; `lib/ui/DeviceHeader.svelte:48-52` | trivial |
| 68 | The i18n drift-guard waiver | **N/A** — a record, not a question. | — | — | — |

## The arithmetic

| | count |
|---|---:|
| P1 decides outright | 6 (6, 16, 32-by-snap, 45, 62, and 46's chevron half) |
| P2 decides outright | 12 (22, 23, 24, 25, 26, 38, 43, 48, 49, 50, plus the keep-halves of 30, 34, 51, 52) |
| P3 decides outright | 11 (3, 20, 28, 40, 44, 50, 54, 55, 56, and the main halves of 53, 59) |
| P4 decides outright | 13 (4, 30's `Overwrites`, 33, 36, 47, 51, 57, 63, 64, 65, 66-in-part, 67, plus 5 if it beats P3) |
| P5 decides outright | 14 (2, 8-in-part, 9, 10, 11, 12, 35, 37, 41, 42, 46-in-part, 60, 61, and 7/58 if it beats P1) |
| P6 decides outright | 5 (13, 14, 15, 17, 32) |
| P7 decides outright | 4 (18-in-part, 21, 39's lip, 52 — the last one wrongly) |
| **Total reached by at least one policy** | **≈57 of 68** |
| **Left individual after all seven** | **11** — 1, 19, 27, 29, 31, plus the residues of 18 (the two unbacked callers), 34 (wording), 39 (its collision with 8.9), 53 (the `ScreenScraper` rename), 66 (the visual), and 68 (not a question) |

Cross-check against the nine flagged as needing a real answer regardless — **1, 8, 19, 27, 29,
31, 33, 36, 66**: five of them (1, 19, 27, 29, 31) survive all seven policies untouched, which
is the right result. Four (8, 33, 36, 66) *are* reached — 8 by P5 with a P4 carve-out, 33 and 36
by P4, 66 by P4 for the existence of a renderer but not its shape. Each of those four still
leaves a genuine residue, so the flag was not wrong; it was just partly absorbed.

---

# The dispatch plan

Two concurrent agents, four rounds. **No two agents in the same round share a file** — the same
discipline the conformance passes used. Rounds are ordered so token minting lands before anything
that consumes a token, and so the i18n area files are never open twice at once.

| Round | Agent A | Agent B |
|---|---|---|
| **1 — paint that owns its files** | **Tokens & type scale** (13, 14, 15, 17, 32, 62). `src/styles/tokens.css`; the seven modal titles (`FolderGateModal`, `InstallProgressModal`, `StubLoadModal`, `FilePromptModal`, `ConfirmModal`, `ConnectGateModal`, `AddSourcesModal`); `Landing.svelte`, `RomManagementTab.svelte:2370`, `GameDetailsPanel.svelte:2128`, `StatusChip.svelte`. **Large** — one shared token file plus ten consumers. | **Bars & glyphs** (6, 16, 18, 47). `GeometryBar.svelte`, `classify.ts`, `FlashChipIcon.svelte`, `SdCardIcon.svelte`, `DeviceHeader.svelte:118`. **Medium** — one shared component gets a size variant, plus two icons. |
| **2 — copy (never two area files at once)** | **shared / wizard copy** (11, 39, 41). `i18n/strings/shared.ts` + 6 siblings, `wizard.ts` + 6 siblings; `ModalShell.svelte`, `InstallProgressModal.svelte`, `AddSourcesModal.svelte`, `Wizard.svelte`. **Large** — two seven-file edits plus a shared-shell variant. | **overview / firmwareSetup copy + Overview shape** (2, 21, 33-record, 36, 37, 42). `i18n/strings/overview.ts` + 6, `firmwareSetup.ts` + 6; `OverviewTab.svelte`, `BankCard.svelte`, `RomSection.svelte`, `Advanced.svelte`. **Large** — two seven-file edits plus a BankCard variant. |
| **3 — panes** | **Sources & pickers** (7, 25-record, 45, 58, 59, 60-record). `Sources.svelte`, `AddSource.svelte`, `AddSourcesModal.svelte`, `AdditionalFiles.svelte`, `i18n/strings/sources.ts` + 6. **Medium.** (`FilePick.svelte` was listed here until 2026-09-08; it was deleted unreferenced in `863290c`, so the batch is one file smaller.) | **Advanced panes & safety** (4-record, 5, 30's `Overwrites`, 46, 64, 65, 67). `FlashSection.svelte`, `RangeField.svelte`, `DumpSection.svelte`, `DeviceControls.svelte`, `device.svelte.ts`, `engine/flasher.ts`. **Medium — but it is the only batch that touches the write path; review it alone.** |
| **4 — record and render** | **The debt ledger** (3, 10, 12, 20, 22, 23, 24, 26, 28, 35, 38, 40, 43, 44, 48, 49, 50, 51, 52-content, 53, 54, 55, 56, 61, 63). Docs only: `docs/AUDIT_NOTES.md` and status cells in both surveys. **Medium, zero code.** | **The failure renderer** (66). `DeviceHeader.svelte`, `device.svelte.ts`, plus whatever key the chosen treatment needs ×7. **Involved** — and it cannot start until 66's visual is answered. |

**Held back from every round:** 1, 19, 27, 29, 31, and 18's two unbacked call sites. They are not
dispatchable — no policy reaches them.

**Round 3B and round 4B both touch `device.svelte.ts`.** They are in different rounds, so this is
safe; if the rounds are ever collapsed, 67 must move into 4B rather than run beside it.

---

# Conflicts between policies

| Question | The clash | Which should win, and why |
|---|---|---|
| **4** — verify default | **P1** (artboard draws it off) vs **P4** | **P4.** P1 alone would switch off a data-integrity control because a drawing showed an unchecked box. |
| **5** — ack visibility | **P3** (keep the bank-1 gate) vs **P4** (a bank-2 write is destructive too) | **P4.** P3's purpose is to stop drawings inventing behaviour; here the drawing happens to describe the safer behaviour, and P4 is explicitly senior. |
| **7 / 58** — Activate/Deactivate fill, Repos `Add` | **P1** vs **P5** | **P5.** The two artboards disagree with each other (filled dark vs plain red text), so there is no single artboard position for P1 to defer to, and the app's `ink` outline is genuine app-wide vocabulary. |
| **8** — friendly partition names | **P5** (deliberate product choice) vs **P4** (the names become false when the warning fires for LittleFS/FAT) | **Both, carved.** P5 keeps the names in the bar and legend; P4 governs the warning path, which may not say "games" about a LittleFS collision. |
| **35** — screenshot ground | **P1** (grey) vs **P5** (documented rationale) | **P5**, but see the daft section: "there is a comment" is a very cheap way to win under P5. |
| **37** — ext-flash box | **P1** (no box) vs **P5** (the code cites the mockups README's own "a container earns a border" rule) | **P5.** P1 would here contradict the design system's stated rule in the name of following the design. |
| **57** — mono filename | **P1** (split the string) vs **P4** (the documented six-locale fragment hazard) | **P4.** One mono run is not worth a grammar bug in six languages. |
| **3** — empty bank 2's action | **P3** (behaviour, keep it) vs **P7** (same-generation conflict → give the component a variant) | **P3.** P7 should be read as governing a component's *paint* variants, not its state machine; otherwise every behavioural disagreement between two boards becomes a new code path. |
| **15 / 32** — token values | **P6** (snap unless used 3+ times) vs **P1** (the artboard's exact value wins) | **P6**, as the more specific rule. State this explicitly or P1 mints a token every time a value differs by 2px. |
| **24 / 23 / 48** — unbacked features whose paint also diverges | **P2** (keep and record) vs **P1** (repaint) | **Compatible, but only if P2 is read narrowly**: P2 preserves the *feature*, not its paint. Read broadly, P2 freezes the paint of everything it covers and silently overrides P1 on the header glyph, the hover strip and the Library rows. Say which. |
| **52** — the options drawer | **P7** (only the older board exists → it governs → undock) vs **P2** (the drawer carries content that board never drew → keep it) | **Neither, as written.** See below. |

---

# Where a policy produces a daft result

These are the cases to look at before agreeing to anything. They are not softened.

**1. P6 mints a third grey nobody asked for (Q15).** `#f0f0f0` appears on the optional badge, the
Convert chips and the Added chips — three uses, so P6 says mint. The result is a token sitting
between `--rule` `#ededed` and `--surface-sunk` `#e8e8e8`, a five-unit span, in a palette where no
human will ever tell them apart. A use-count threshold is a reasonable rule for *type sizes*, where
2px is visible; for colours it is nonsense. **Fix: apply the three-use rule to type only, and for
colours mint only when no existing token is within roughly 8 sRGB units.**

**2. P7 would undock a working drawer on the authority of a superseded board (Q52).** "Where only
the older exists it governs" was written for screens the newer generation never redrew. Here the
newer generation redrew the *screen* and simply didn't draw the drawer at all — which is silence,
not endorsement of the old free-standing panel. Applied literally, P7 restructures a shipped,
working component to match a board the project has otherwise retired, and then P2 immediately adds
back content that board never had. You end up with something that is neither the drawing nor the
app. **Fix: P7's "older governs" clause needs the qualifier "where the newer generation does not
redraw the surrounding screen".**

**3. P3, applied to every MISSING row, closes the backlog without building anything (Q44, 53, 54,
55, 56, and most of section F).** P3 is right that a drawing must not dictate behaviour. But a
large share of the remaining deltas are *unbuilt design*, not divergent implementation — the
`Overwrites` row, `Re-read partition`, the `Written` row, the fused Apply row, the cheats summary.
Mechanically, P3 reclassifies all of them as "artboard debt", the survey rows go from BLOCKED to
CLOSED, and the app is exactly as far from the design as it was that morning. **This is the single
biggest risk in the seven policies: it makes the conformance number improve while conformance does
not.** If P3 is adopted, "artboard debt" needs to be a tracked queue with its own count, not a
closing status.

**4. P2 preserves clutter permanently, because "no artboard shows it" is equally true of good
extras and cruft (Q49, Q43).** Two unconditional intro paragraphs above a folder row, and a
`Read back superblock (debug)` link sitting in a user-facing install pane, are both kept and
*recorded as intentional* — which is the exact wording that stops anyone cutting them later. P2 was
written to protect features like the recovery gate and the hover-detail strip; it cannot tell those
apart from a leftover. **Fix: P2 should say "keep, and record that no artboard backs it" — not
"record it as intentional".** The second phrasing launders an accident into a decision.

**5. P5 makes any code comment an unappealable veto (Q12, Q35).** Both survive on the strength of
"there is a rationale in the code". Under P5 as written, an agent can immunise any divergence from
the design by writing a paragraph next to it — and several of the rationales in this codebase were
written by agents, not by the owner. **Fix: P5's "considered choice" should mean a choice the owner
made or ratified, not one a comment asserts.**

**6. P1 calls things "pure paint" that cost a component (Q45).** The file-picker field is listed as
size/colour/border — squarely inside P1's definition — but a native `<input type=file>` cannot
become a 40px bordered mono field without a wrapper component, in three places. P1 gives no signal
that this row is an order of magnitude more expensive than the 2px title fix sitting beside it in
the same category. **Fix: P1 needs "unless conforming requires new markup", or the estimates will
be wrong every time.**

**7. P4 is the only policy with no upper bound (Q64, Q66).** It licenses behaviour changes that no
artboard requested and no survey row demanded — disabling controls during a write, building a
failure renderer that does not exist anywhere in 42 boards. Both are almost certainly right. But P4
is the policy that can grow the backlog rather than shrink it, and it is worth knowing that before
adopting it as the trump card. It should be, and this document assumes it is; just do not expect it
to reduce the work.

**8. The seven policies decide ~57 of 68 questions, but far less than 57/68 of the work.** Roughly
half of what they decide resolves to "write a sentence in a document" (all of P2, most of P3). The
code work concentrates in P1, P5 and P6 — the token sweep, the two seven-file copy batches, the
GeometryBar variant, the BankCard variant. **A ruling on all seven policies tomorrow morning does
not shorten the build; it shortens the argument.** The hour in a browser, in both themes, that
`docs/DECISIONS.md` asks for is still the highest-value thing on this list, and no policy touches
it.
