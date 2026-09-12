# Open decisions — the consolidated list

> **SUPERSEDED, 2026-09-08 — read [`docs/BLOCKED-AUDIT.md`](./BLOCKED-AUDIT.md) instead.**
>
> The 111-row / 68-question framing below was built on a BLOCKED count that had drifted from the
> surveys' own rows. Every BLOCKED row in both surveys was re-opened on 2026-09-08 and read
> against current code and its artboard. The real count was **71**, of which **20 were already
> built**, **25 were settled by a standing ruling**, **4 were duplicates**, and **22 are
> genuinely blocked — consolidating to 18 questions**, each with a recommendation attached.
>
> Nothing in this document should be put to the owner without checking it against that audit
> first: a large share of the entries below name rows that are now closed in code.
>
> **Second pass, 2026-09-08 — what survives supersession is three entries, and one of them is
> reframed.** Every entry below that the audit does not carry was re-read against current code and
> the current boards. The result:
>
> | | status |
> |---|---|
> | **1, 8, 11, 27, 31, 33, 34, 36** | **Answered by you** — see HANDOVER §4 (MB over MiB; the segment labels; `Close` over `Done`; drop the privacy note; drop the `new` badge; Overview's three Device rows; `Restart flash utility` removed; the free-of-total headline). |
> | **13, 14, 15** | **Closed by work** — already struck through in section C. |
> | **28** | **Moot.** `31cc2f7`'s re-synced `Landing2` deletes the `Modded with … / Change` recall row outright; `Landing.svelte:58-59` records that the `← Back` line is now the only way back. There is nothing left to rule on. |
> | **29** | **Closed.** The mockups exist: `FlashingCancel`, `FlashingCancelConfirm` and `FlashFailure` (`70c35f7` / `3847935` / `00e65d5`). This entry described them as *"your own queued item"*; HANDOVER §2 is explicit that producing mockups is this side's job, and it was done. What is left is the *behaviour* gap those boards expose — a `Cancel` affordance over an operation `installProgress.svelte.ts:119-120` says is not cancellable — which is tracked in BLOCKED-AUDIT's backlog item 6, not as a decision. |
> | **30** | **Not a question.** The `Overwrites` row is built (`0bfd2db`; rows W-3/W-11 are FIXED). The remaining states — disconnected / unscanned / unsupported-browser, the Boot Image modal — need boards **drawn**, which is our job, not a ruling. Moved to the backlog. |
> | **32** | **Closed by work.** `--fs-display-lg` **is** 34px (`tokens.css:96`), minted in `19f818c` alongside the 15px rubric and 18px card title. The entry recommended amending the artboard to 32px; the opposite happened and the boards won. |
> | **51** | **Closed — both halves.** The `RomsSdNoCard` meter and Summary notch are settled by CLAUDE.md's SD-vs-Flash budget rule (BLOCKED-AUDIT re-statused B319/B320/B798/B799 CONFIRMED on that basis); the `HeaderBusy` static `EN` label is settled by `9e0f750`. Its two live remainders are already BLOCKED-AUDIT **Q10** (the SD primary action) and **Q17** (the dimming caption). |
> | **65** | **Answered by you** (HANDOVER §4: *sanity check, retry twice, then a real error naming the affected blocks*) and built in `1fb5469`. `engine/flasher.ts:83` still carries the 3 attempts. |
> | **68** | Never a question — a record that the i18n waiver has been used once. |
> | **every other entry, 2–64** | Folded into BLOCKED-AUDIT's re-walk. Answer them there. |
>
> **Still genuinely yours, and not in BLOCKED-AUDIT: 19, and 66 (with 67 folded into it).**
> Both are corrected in place below.

The two artboard surveys carry **111 BLOCKED rows** (54 in survey A, 57 in survey B — the
counts reconcile with `docs/CONFORMANCE.md` as of 2026-09-07). That is a row count, not a
decision count: many rows point at the same ruling. Consolidated, it is **68 questions**, and a
third of those are one word.

**Read this first: a question count is not a work count, and a third of this list cannot be
answered from a chair.** The first draft said "36 further rows are not on this list at all —
they need a screen looked at". That number was wrong and the framing was misleading, so both are
corrected here:

- **Every one of the 111 BLOCKED rows now maps to a question below.** Verified row by row on
  2026-09-07. None are held back.
- **The 36 is the surveys' OPEN column, not a hidden bucket of blocked rows.** Those 36 are
  actionable today and waiting on nobody — see `docs/CONFORMANCE.md`.
- **But roughly a third of the 111 still needs a screen looked at or an artboard drawn, not a
  ruling.** All of section E, all of section F, and about half of section H are of that kind:
  answering "keep it" or "draw it" is the whole answer, and the work still has to be looked at
  afterwards.

**The dark theme is the single largest of those, and no one has ever seen it.** All 42 artboards
are light-only; the dark tokens were signed off by reasoning about `tokens.css`, never by
looking. An hour in a browser, in both themes, closes more of the backlog than any answer below.
That hour is not on this list, because it is not a question.

Answer inline, or just number your replies. Each entry names the rows it unblocks.

**On the numbering.** Entries 1–31 are the original consolidation. **32–64 were added on
2026-09-07** by a coverage pass that walked every BLOCKED row in both surveys and checked it
mapped to a question: **48 of the 111 mapped to nothing**, meaning you would never have been
asked about them. They are in section H, in the same style. **65–68** (section J) are decisions
taken since the first draft that were recorded only in commit messages and agent reports.

---

## A. One-word rulings

**1. MB or MiB?** Product-wide.
*Unblocks: LibrarySummary footer unit, dock caption, and every byte figure in the app.*
→ *No recommendation — this is taste. Worth knowing: the unit now lives inside the string, so it is one line per locale either way.*

**2. Empty bank: show `Empty` / `—`, or show nothing?**
Right now it renders nothing, so an empty card is barer than the artboard's.
*Unblocks: A50 (the only BLOCKED one), and with it the three rows that read only "as A48–A50" — A54, A57, A63, which are OPEN and waiting on it.*
→ *Recommend `Empty` / `—`: an empty card with no words reads as broken rather than empty.*

**3. Does an empty bank 2 offer an action?** `NoStockBank1` says no, `NoStockBank2` says yes.
*Unblocks: A53.*

**4. `Verify after write` — default on or off?** Code says on, the artboard draws it off.
*Unblocks: W-8.*
→ *Recommend leaving it ON. The artboard is a drawing; this one costs the user data if wrong.*

**5. Is the acknowledgement checkbox bank-1-only, or always shown?** Code gates it on bank 1; the artboard implies unconditional.
*Unblocks: W-13.*

**6. Filled or stroked device glyphs?** `FlashChipIcon`/`SdCardIcon` are filled silhouettes; every artboard draws them stroked. This is why Landing2 currently shows a filled chip beside a stroked gamepad.
*Unblocks: A4, A43, and the Landing2 icon mismatch.*

**7. Activate / Deactivate and the Sources footer primary: filled or outline?** The app uses an ink outline app-wide; the artboards fill them.
*Unblocks: `ReposDetail` footer rows 435 (`Activate`) and 457 (`Deactivate`). Pairs with the same question on install-confirm, already resolved to "fill". The Repos header's `Add` affordance is a different question — see 56.*

---

## B. Naming and vocabulary

**8. `Games` / `Cores & Saves` / `Free Space`, or `FrogFS` / `LittleFS` / `Free`?**
*(Ruled: the friendly names. Ruled as `Emulators & Saves`; the middle word became `Cores & Saves`
when the core rename landed. The substance of the ruling, friendly names over filesystem names,
is unchanged.)*
The single most-referenced decision in the surveys. Note the friendly names become **false** in some states — the collision warning fires for LittleFS and FAT too, not just FrogFS.
*Unblocks: X-4, A36, A35, A37, BackupPatch #7, and the LibrarySummary `Games`/`Total` rows — 6+ rows across three screens.*

**9. "source" or "repository"?** `ReposAdd` alone says *Add a repository* / *← Repositories*; its three sibling artboards, the whole app and `UX_DESIGN.md` say *source*.
*Unblocks: 2 rows.*
→ *Recommend keeping "source" and treating that artboard as stale.*

**10. `Migrate games` or the artboard's `Keep installed games`?** A meaning change, not just wording.
*Unblocks: F7.*

**11. `Done` or `Close` on the Add Sources footer?** The artboard says `Done`; the app reuses the shared `close` key.
*Unblocks: 2 rows. Needs its own key either way.*

**12. `8 optional files` or the artboard's `8 more optional files`?** The in-code rationale actively contradicts the artboard, so one of them is wrong.
*Unblocks: 1 row.*

---

## C. Tokens that do not exist

**13, 14 and 15 are closed — they were answered by work, not by a reply.** Every token they
asked about now exists (`--fs-title`, `--fs-lede`, `--fs-badge`, `--chip-fill`) or was
deliberately not minted (`#e0e0e0`), and `--fs-lg`, the 20px token three of them named, has been
deleted. Only **16** and **17** are still live in this section.

**~~13. Add an 18px type token?~~ CLOSED — done in code, do not answer.** Asked as: *every panel
and modal title is 18px in the artboards; `--fs-lg` is 20px, so all nine modals are 2px too
large*. `--fs-title: 18px` was minted (`tokens.css:167`) and every modal title moved onto it;
`--fs-lg` was then **retired and deleted** in `51ac881`, its last two consumers (the
`GameDetailsPanel` import-modal title and `RomManagementTab`'s space-alert dialog title) being
modal titles themselves. There is no 20px token left to be 2px too large.
*Unblocked: the six survey-B title rows, all now FIXED.*

**~~14. Add 15px and 10px?~~ CLOSED — done in code, do not answer.** `--fs-lede: 15px` (Landing
rubric, Repos row name) and `--fs-badge: 10px` (required/optional badges) are both minted
(`tokens.css:168-169`) and in use in `Landing`, `Sources`, `StatusChip`, `AdditionalFiles` and
`FilePromptModal`.
*Unblocked: A7, the badge row.*

**~~15. The three off-ramp greys~~ CLOSED (`852df8d`) — do not answer.** Asked as: *`#e0e0e0`
(header underline) and `#f0f0f0` (optional badge, chips, disabled submit) each sit between
`--rule` and `--surface-sunk` — new token, or snap?* It split two ways rather than one.
`#f0f0f0` was **minted** as `--chip-fill` (dark `#2e2e2e`): one value in one role, 13 times
across six boards, always a badge/chip `background`. `#e0e0e0` was **snapped by role** and got
no token: a divider (`--rule`) in one place, a disabled fill (`--surface-sunk`) in the other.
Rationale is on the record in `tokens.css:105-126`.
*Unblocked: 4 rows.*

**16. `.frogfs` is `#c0392b`** — a red in no artboard and no token, and it blocks the ext-flash legend, since a legend must match the bar it describes.
*Unblocks: X-5, and A35 behind it.*

**17. An on-fill ink token?** White text on saturated fills is a literal in several components. Every current use is correct in both themes, so this is not urgent — but it is the reason a few rows stay literal.

---

## D. Artboard versus artboard

**18. `GeometryBar` height: 34px or 10px?** Write/Dump/Erase/FileBrowser say 34px/3px radius; `Main` says 10px/5px. One component, **eight call sites**, two of which (`InstallGeometry`, `RomSection`) have no artboard at all. Needs a size variant *and* a ruling for the unbacked callers.
*Unblocks: X-1, A34.*

**19. Chooser heading — reframed 2026-09-08, and it is a three-way, not a two-way.**
The entry said the app currently ships `What Do You Want on the Device?`. **It does not.**
`wizard.ts:99` ships a third wording, `What should this device run?`, which no board draws. So the
candidates are:

- `How Do You Want the Device Set Up?` — `GuidedLayout.dc.html:76`
- `What Do You Want on the Device?` — `GuidedLayoutStock.dc.html:76`
- `What should this device run?` — shipped (`wizard.ts:99`)

**And the two boards are not two drafts of one screen.** `GuidedLayout` draws **three** cards
(`Dual Boot` / `Only Retro-Go` / `Return to Stock`); `GuidedLayoutStock` draws **two** — no
`Return to Stock`, because a stock device is already there. They are two device states. So
"pick the better artboard" does not obviously apply: it is legitimate for one heading to serve
both, or for neither board's wording to win.
*Unblocks: GL1, GL3.* Seven-file edit whichever wins.

**20. Can the collision aside and the cross-model note appear together?** The app allows it; no artboard draws that state, so the stacking order is undefined.
*Unblocks: BackupPatch #19, #18.*

**21. The bank picker in the Install pane** is drawn horizontally in `Firmware.dc.html` (34×84 bar, name and subtitle beside it) but inherits Overview's vertical card. Second `BankCard` variant, or its own component?
*Unblocks: F10, F12.*

---

## E. Things the app has that no artboard shows — keep or cut

Each of these works and is deliberate; the artboards simply never considered them.
→ *Recommend keeping all of them unless you disagree, and recording that they are intentional.*

**22. The `Enter Recovery Mode` gate** that replaces five separate panes when the stub is not loaded. No artboard anywhere.
*Unblocks: FB-12, W-16, D-11, E-13, BackupPatch #6 — 5 rows. (D-10 was listed here in the first draft and does not belong: it is the Dump pane's Progress/Cancel state, not a gate. It is now under 29.)*

**23. Library rows with no artboard**: BIOS/emulator rows, unknown-homebrew rows and their `remove` chip, the download-covers row, the now-playing status pill.
*Unblocks: survey B rows 218 (BIOS/emulator), 219 (unknown homebrew + `remove` chip), 225 (now-playing pill), 296 (download covers) — 4 rows, all inheriting S6.1.*

**24. Header extras**: the amber halo on the one control that can end a session mid-write, and the media-type glyph that carries flash-vs-SD information the artboard's fixed glyph does not.
*Unblocks: survey B rows 756 and 770. (The first draft also claimed lost-link precedence and the scanning pulse; both are **OPEN**, not BLOCKED — rows 752 and 757 — so they were never waiting on you. Row 771, which *is* BLOCKED, was missing from this entry and is now 62.)*

**25. Sources extras**: the `Remove` escape hatch, the `urlHint` line, the explanatory subheading, `Reconnect last folder`.
*Unblocks: 4 rows.*

**26. The chip-as-remove-button** in the file prompt — there is no other way to undo a pick.

---

## F. Needs an artboard drawn

**27. The privacy note** `Runs in your browser. Your ROM never leaves your computer.` appears in two Repos artboards and **exists nowhere in the code**. Ship it, or drop it from the design?

**28. `Landing2`'s "Modded with / Flash memory / Change" row** — drawn, unimplemented, and implies a behaviour (returning to step 1 with context kept).

**29. The flashing screen's Cancel control and the confirmation over it** — your own queued item, still needs the mockups.
*Unblocks: D-10 (the Dump pane's inline Progress/Cancel footer swap, same missing mockup as S8.13).*

**30. Disconnected / unscanned / unsupported-browser states**, the Boot Image modal, and the Write pane's `Overwrites` row — all real states with no artboard. The `Overwrites` row is the README's *"say what you are about to lose"* rule, unbuilt, on the most destructive control in the app.

---

## G. Needs a spec, not a drawing

**31. The `RomsNewSystem` "NEW" badge** needs persisted previously-seen-systems state. What counts as "seen", and when does it reset?

---

## H. Added 2026-09-07 — rows that mapped to no question

Every one of these was already BLOCKED in a survey. None of them appeared anywhere in entries
1–31, so none of them would have been put to you. Nothing here is new work invented by the
coverage pass; each entry names the rows it came from.

**32. A 34px display token?** Landing's title is `34px` in the artboard; `--fs-display-lg` is 32px (`Landing.svelte:147`). Same family as 13/14 — mint it, or amend the artboard to 32.
*Unblocks: A5.*
→ *Recommend amending the artboard. 32px is already a token and 2px at display size is invisible; 13's 18px is the one worth minting.*

**33. Overview's Device section: three rows or five?** The artboard draws `Running` / `External flash` / `Read protection`; the app renders five (`OverviewTab.svelte:394-414`). Dropping two removes the only in-body statement of what is installed.
*Unblocks: A15.*

**34. `Restart flash utility`, or `Start Flash Util` / `Restart Flash Util`?** The app has a not-loaded variant the artboard never drew (`overview.ts:30-31`).
*Unblocks: A21.* Two questions in one: the wording, and whether the not-loaded state exists.

**35. The screenshot capture area: black, or the artboard's grey?** Artboard is `232px`, fluid, `#e8e8e8`; the app is a fixed `320×240` on `#000` (`OverviewTab.svelte:953-960`) and the code argues for the black ground.
*Unblocks: A24.*
→ *Recommend keeping black: a screenshot frame on a light grey ground misreads as an empty panel.*

**36. External-flash headline: total, or `free of total`?** The artboard states free space first (`46.58 MB free of 50.00 MB`); the app prints total only (`OverviewTab.svelte:561`). New copy either way.
*Unblocks: A33, and the shape half of A37 behind it (whether the footer panel collapses to one row depends on where `Free` lives).*

**37. Does the External Flash panel get a box?** `.ext-card` draws border/radius/surface (`OverviewTab.svelte:877-881`); the artboard puts the section on the bare ground, per `docs/design/mockups/README.md`'s "a container earns a border".
*Unblocks: A38.*

**38. The dimmed slot's `patchMissing` value** — no artboard covers it.
*Unblocks: A47.*

**39. The progress modal's lip and its `Working.` line.** The artboard gives the modal the header's 5px hazard crawl; `ModalShell` always renders the static 3px gold lip. The artboard's copy is `Working. **do not unplug your device**.` with the bold run in caution ink; the app's differs and `.muted strong` inherits `--ink-soft`.
*Unblocks: GF5, GF6. Collides with 8.9 (the busy lip height) — answer them together.*

**40. Do pending Guided steps render their controls?** The artboards draw steps 2–4 as title-only at `opacity: 0.5`; the app keeps live controls (`Wizard.svelte:1071`, `:1074`).
*Unblocks: GR9, and GS6 which points at it.* Behaviour, not paint.

**41. `Restore` needs its own key.** Step 2's button currently repeats the whole step title, *"Restore Original Firmware"* (`wizard.ts:119`); the artboard says `Restore`.
*Unblocks: GSO2. Seven-file edit either way.*

**42. Three Firmware-pane copy calls, all seven-file:** the mode switch is `Guided Setup` vs the artboard's `Guided` / `Advanced` (`firmwareSetup.ts:19`); the version field is `Install version` vs `Version` (`:171`); and there is no `Target` label above the bank cards at all (`RomSection.svelte:851`).
*Unblocks: F1, F5, F9.*

**43. The Install pane's three extras — keep or cut.** The artboard's pane is head / Version / two checkboxes / Target / footer, and nothing else. The app also ships the `.well` dump, `Start bank N`, and the superblock-debug link (`RomSection.svelte:967`, `:982`, `:991`).
*Unblocks: F17.*
→ *Recommend keeping, and moving the superblock-debug link behind Advanced — it is a developer affordance in a user pane.*

**44. `Re-read partition`** — a footer action drawn in `FileBrowser.dc.html:72`, never implemented; needs a new device-touching handler.
*Unblocks: FB-10.*

**45. The file-picker field shape** (survey B's "3.12"). The artboard draws a 40px bordered field showing the filename in mono; a native file input cannot become that without a wrapper. The same shape question is the Bundle-zip tab body in two Repos artboards.
*Unblocks: W-3, 408, 479 — 3 rows, one ruling.*

**46. Two Dump-pane nits.** The artboard draws its own chevron on the unit picker, which means suppressing the native `<select>` arrow (`RangeField.svelte:123-137`); and the range caption's `matches LittleFS` clause is deliberately omitted.
*Unblocks: D-4, D-5.*

**47. The internal-flash bar: two segments or four?** The artboard shows one per bank; `classify.ts:210-212` emits up to four, adding the used/free split inside each bank. Conforming drops information.
*Unblocks: X-3.*
→ *Recommend keeping four. The artboard's two segments cannot answer "will it fit".*

**48. The hover-detail strip under `GeometryBar`.** No artboard draws it; removing it removes click-to-pin address detail from all eight call sites (`GeometryBar.svelte:85-87`, `:152-155`).
*Unblocks: X-7.* Behaviour, not conformance.
→ *Recommend keeping and recording it as intentional, as with section E.*

**49. The two intro paragraphs above the folder line** in Backup & patch step 1 — the artboard goes straight from heading to folder row; both paragraphs render unconditionally (`OfficialFirmwareSection.svelte:382-387`).
*Unblocks: BackupPatch #1.*

**50. The Library's system tag, and the filtered list.** The tag renders only when `consoleFilter === "all"`, and no artboard draws a filtered list at all.
*Unblocks: survey B row 211.*

**51. Confirm these two artboards are stale.** Both are recorded below under "probably wrong", but they are BLOCKED rows and need your word before anyone implements or deletes them: `RomsSdNoCard`'s primary action, meter and Summary notch in the no-card state (rows 249/250/251), and `HeaderBusy`'s static `EN` label (row 772).
*Unblocks: 4 rows.*
→ *Recommend confirming both stale. The SD meter is forbidden by CLAUDE.md's SD-vs-Flash rule; `EN` predates the seven-locale switcher.*

**52. The options drawer: docked, or in page flow?** The older artboard puts the panel in flow; the code docks it, and no newer artboard draws the drawer. The drawer also carries content the artboard does not (S6.11).
*Unblocks: 284, 341.*

**53. Cover art: do the scraper-only affordances render unconditionally?** Five rows, one ruling. The artboard draws the import/gear glyphs, the Variant row, the preview box and the save-preview arrows as always present — but in file mode there is no scraper behind any of them, so conforming means either permanently inert controls or new plumbing. The `Source` control's options are `File`/`Scraper` where the artboard says `ScreenScraper`.
*Unblocks: 289, 290, 292, 293, 298.*

**54. `Apply` beside the drop hint, or exclusive branches?** The artboard fuses them into one row; the code shows one or the other.
*Unblocks: 294.*

**55. The `Written` row.** A label/timestamp row in the artboard; no row, no key, and the mtime is not plumbed.
*Unblocks: 299.*

**56. The cheats footer.** The artboard closes with a `Configured` / `2 codes` summary row; the app renders an editable list. Different objects, not a restyle.
*Unblocks: 304.*

**57. Mono-setting only the filename in the BIOS-missing aside** means splitting `missingDetail` (`sources.ts:123`) into fragments the template interleaves around a `<code>` — exactly the Pre/Post fragment pattern CLAUDE.md warns produces broken sentences in six other locales.
*Unblocks: 338.*
→ *Recommend not splitting. The cost is a seven-locale grammar hazard for one mono run.*

**58. Repos' `Add` affordance: a green plus-and-text link, or the bordered `ink` button?** (`Sources.svelte:459`.) Related to 7 but a different shape, not a different fill.
*Unblocks: 369.*

**59. The satisfied optional-file row** shows the accepted variant name in the artboard; that needs plumbing to the row.
*Unblocks: 453.*

**60. The URL field placeholder:** the artboard's short one, or the app's accepted-forms hint?
*Unblocks: 477 (its other half, height/radius, is OPEN and actionable today).*

**61. `Choose…` or `Change…` on an already-satisfied ROM row?** The artboard keeps `Choose…`; `FolderGateModal.svelte:56` swaps it.
*Unblocks: 565.*

**62. The `Added` chips group** sits inside `<section class="input">` (`FilePromptModal.svelte:436`); the artboard puts it after the last row's rule, as a separate block.
*Unblocks: 649.*

**63. Does the SD dock show a projected total and a net change at all?** The SD artboard asks for `3.54 MB of 50 MB projected` and `+0.12 MB net change` — figures SD mode structurally cannot compute under the SD-vs-Flash rule.
*Unblocks: 729, 730.* Related to 1 (the unit) but a separate call: whether the caption exists.

**64. Does the busy header disable destructive controls?** No board draws a disabled state; `disconnectDevice` stays clickable under `Writing flash. Do not disconnect` (`DeviceControls.svelte`).
*Unblocks: 771.* Pairs with 24's amber halo — the halo warns about exactly the control this would disable.

---

## J. Decisions taken since this list was written

Recorded here because they currently live only in commit messages and agent reports.

**65. Should a real `BAD_HASH_FLASH` be retried at all?** `06d76a5` fixed a signed-mask bug — `(status & 0xffff0000)` coerces to signed int32, so the comparison against `0xbad00000` was always false and **no device error status was ever detected**. A genuine device error used to burn `flashImage`'s full 120s stall watchdog per attempt; it now fails in milliseconds. Same policy, very different pace: the existing 3-attempt auto-retry (`engine/flasher.ts:83`) now reboots the RAM stub twice in a couple of seconds instead of over roughly six minutes.
*This is a change to a considered decision:* CLAUDE.md documents the auto-retry as deliberately reintroduced (2026-07-03) once flashing began pausing the liveness poll, because the race it was papering over had been closed.
→ *Recommend keeping the 3 attempts for transport-shaped failures but treating `BAD_HASH_FLASH` and `BAD_SEGFAULT` as terminal — a flash that verified wrong will verify wrong again, and two silent instant retries turn one legible failure into three.* Your call on whether that distinction is worth the branch.

**66. Nothing in the app can draw a failure.** Verified across all 57 artboards: the header status line only ever *draws* `Connected (Recovery Mode)` (51 boards), `Writing flash. Do not disconnect` (4) and `Finishing up. Do not disconnect` (1). **Corrected 2026-09-08 — the count of values this entry rested on was wrong twice over.** `statusText` (`DeviceHeader.svelte:130-145`) has **eight** outcomes, not five: the two above plus connection-lost, no-connection, settling, and three `Connected …` wordings no board draws. Those three are BLOCKED-AUDIT's **Q24**; this entry is unaffected in substance — no board draws a *failure* either way — but its inventory was three strings short. There is no banner, toast or error modal anywhere in the design. So `device.error` — assigned in five places — has **nowhere to go**: no `.svelte` file reads it (`DeviceControls.svelte:46-49` records this). A failed Recovery Mode boot currently **changes no pixel at all**; the status LED for that site stays green, because the link is fine and only the boot failed.
*The question: draw a failure treatment for the header status line, or accept that failures show only as a status colour?*

**Narrowed 2026-09-08.** HANDOVER §2 is explicit that *producing mockups is this side's job*, so
the **drawing** is not yours to supply — if the answer is "draw one", we draw it. Re-verified the
same day against all 57 boards and recorded in `DeviceControls.svelte:51-61`: `FlashFailure`
draws the header chrome **idle** (white band, green chip, static gold lip) and puts the failure in
a *modal*, specific to a flash-install result — so it is not a general `device.error` renderer and
must not be read as one. What is actually yours is the direction plus the two sub-questions below.
→ *No recommendation on the visual — that is yours. Two sub-questions that are not taste and need answering either way:* does the failure auto-clear or must it be dismissed, and does a raw WebUSB exception message belong in a single-line 40px band at all (it is the only text we have, and it is not written for a user).

**67. `handleLost`'s `device.error` assignment: keep or remove?** *(folded into 66 — it survives
66's answer either way, so it is not a separate question.)* `device.svelte.ts:954` (**corrected
2026-09-08 from `:898`**) writes `"Connection lost — the adapter was unplugged. Reconnecting…"`, which duplicates approved copy `statusText` already renders from `deviceHeader.connectionLost` (`DeviceHeader.svelte:130-132` — **corrected 2026-09-08 from `:48-52`**). It is the one `device.error` site that is unambiguously dead weight rather than a missing renderer.
→ *Recommend removing it. Unlike the other four sites it carries nothing the user cannot already see, so it survives 66's answer either way.*

**68. The i18n drift guard's waiver has been used once, deliberately** — noted so you know the escape hatch is in service. `8f828dd` carries `i18n-locale-drift: ok` for two English-only edits: `variantBoxart` `Boxart` → `Box art` (an English word split; es/fr/ja/ko already carry real translations and German's `Boxart` is correct German, so no locale's value changed) and a typographic apostrophe in `connectGateModal.subtitle`. No question attached — just the record.

---

## Two places the artboard is probably wrong

Recorded so they are not silently "fixed" into defects. **Question 51 is now CLOSED — see the
banner at the top.** Both boards are confirmed stale on the halves this section names; what is
left of them is BLOCKED-AUDIT's Q10 and Q17.

- **`RomsSdNoCard`** draws a meter and Summary notch whose value the SD-vs-Flash rule forbids computing. The code is right.
- **`HeaderBusy`** shows a static `EN` label predating the seven-locale switcher, and its caption says the install slots dim during a write while its own markup renders them identical to idle.
