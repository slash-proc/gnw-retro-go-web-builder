# Pick up here — 2026-09-08, end of day

Saved at your request. Nothing below needs doing tonight.

> **A full day of work landed on 2026-09-09 after this was written**, so treat the
> two middle sections as a snapshot rather than the current queue. The
> **"Settled"** section below is still binding. What shipped since: the firmware
> distribution cutover, the Sources-driven Library (core registry, one row per
> game, prepare-then-install), the global activity log, the `/wip/` Pages deploy
> with isolated storage, a real stacking scale, and `docs/ELECTRON.md`. See
> `STATUS.md`, and re-read `docs/BLOCKED-AUDIT.md` itself rather than the count
> quoted here.

---

## Settled — nobody will ask you again

MB over MiB. Drop the privacy note. Overview's Device panel = the mockup's three rows.
`Restart flash utility` removed. Free-of-total headline. Segment labels
`Games & Homebrew` / `Cores & Saves` / `Free Space`. Drop the `new` system badge.
`Close` over `Done`. Artboard wins on pure paint. Nothing is cut for not appearing in a mockup.
No filler. `BAD_HASH_FLASH`: sanity check, retry twice, then a real error naming the blocks —
built.

**The dark theme is settled** (*"looks good, don't sweat it"*) and **everything that needs real
hardware is yours, off our plate** — including restore-to-stock. Both are struck from every list
in this repo; if either turns up in front of you again, that is a bug in our bookkeeping.

The full set, with the wording you used, is HANDOVER §3 and §4.

---

## What actually needs you

[`docs/BLOCKED-AUDIT.md`](./BLOCKED-AUDIT.md) is the live list and states its own count at the
top. **All 25 were checked against the current code on 2026-09-08** — premise, every citation,
options and recommendation. 14 citations were wrong (two pointed at unrelated code) and two
premises were false; all corrected, none closed. The list is trustworthy now in a way it was
not this morning.

It is not a pile of questions: every one carries a recommendation, so **"all as recommended" is
a complete reply**. Most are one word — a label, a lip height, on-or-off. The questions start at
line 190; Q20 (line 506) is the flash Cancel and by far the largest.

Two of them are bigger than the rest and are worth reading before the others:

- **Does a running flash get a user-facing Cancel?** The engine half already exists; nothing in
  the app builds a control for it. Three boards now draw one over an operation the code says
  cannot be stopped once started. This is the largest single thing on the list.
- **What the app does when something fails.** Today a failed Recovery Mode boot changes no pixel.
  You settled the retry policy; what is left is the direction for showing an error, plus two
  sub-questions that are not taste. `docs/DECISIONS.md` #66.

Also still yours there: the Guided chooser heading — the app ships a third wording neither board
draws, so it is a three-way, and the two boards are two device states rather than two drafts.

---

## Fixed since you last looked

You found two defects in the top status bar — centred instead of left-aligned, and short of the
right edge. Both are fixed, and hunting their siblings found six more of the same kind:

- the header band now sits hard left, as `Main.dc.html:22` draws it
- a `scrollbar-gutter` reserving ~15px for a scrollbar that could never exist is gone, so
  everything full-bleed reaches the right edge
- the **Library dock and Sources bar** were stopping 280px short each side above a 1440px
  window — invisible below that, which is why nobody caught it
- the language menu lists endonyms (`Deutsch`, `日本語`) with the code still on the indicator,
  and is readable in dark
- the device-actions menu had a border tracking the text colour and a divider that **never
  painted at all**, in either theme
- four more one-theme failures: the KB/MB unit dropdown on Write/Dump (2.6:1 in dark, the same
  bug as your language picker), the Sources version picker (1.1:1), Library's silver action
  button, and a cheats hover that did not exist in dark

Worth a look in dark theme specifically: the unit dropdown, the version picker, the silver
button, and the cheats ×.

---

## Waiting on us, not you

- **Nobody has opened a browser.** Every real-width measurement, and looking at the built app
  end to end, is still undone. It is the highest-value hour left on our side — and the two
  defects above are what that gap costs: six passes closed 216 rows without seeing either.
- **States with no board at all**: disconnected, unscanned, and the unsupported-browser
  Landing. Drawing those is our job, not a ruling.

Three things this list carried earlier today are done and are struck: the Boot Image modal has a
board after all (`ModalConfirm` and its four phase siblings), the two Cancel boards and the
failure board have been surveyed, and the re-walk of rows judged against since-corrected boards
is finished — `docs/CONFORMANCE.md` records it.

---

## Where the work stands

[`docs/CONFORMANCE.md`](./CONFORMANCE.md) is the scoreboard. Read the numbers there rather than
anywhere else — it states how it derives them, and every copy of them made elsewhere has rotted.
The short version has not changed: a large share of rows are closed, the closed ones are the
cheap ones, and whole screens are still unbuilt. Treat the percentage as a ceiling.
