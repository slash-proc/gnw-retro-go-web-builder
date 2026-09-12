# Guided Firmware, the chooser

Five boards for one screen: "What should this device run?" and the four states the device's
own facts produce. Not registered on the main canvas: `apps/web/test/artboard-index.mjs`
scans `docs/design/mockups/` only, so nothing here is indexed until it is chosen.

## What this pass is fixing

The chooser had three names with a line of explanation under each. The owner struck all
three by quoting them back:

> "Pick which one runs at power-on" "[...] and leaves more space for games." "Erases
> Retro-Go" are unnecessary strings. You're adding text to shit I never told you to touch
> and you're making them in this weird narration style instead of focusing on good UI
> design.

**A chooser button is a name.** The card is the answer to the question in the title, and a
name answers it. A consequence that genuinely has to be stated belongs where the user is
about to cause it, which is the confirm modal on the far side of the flow, not a caption
under a button they have not pressed yet.

That is also why the three descriptions were not replaced with shorter ones. `overview-v2`'s
rule holds here: a sentence appears only when an action has a consequence that has to be
stated, and three cards that differ by name do not need a paragraph each to be told apart.

**One sentence survives, and it is not a caption.** `whatIsRetroGo` sits under the title as a
rubric. Retro-Go is the one word this screen assumes and never defines, and the beginner
audit was right about that half. The owner quoted the three captions and not the rubric.

## What changed in the code, and why the card changed shape

The icons doubled, on instruction: the badge 24 to 48px, the wordmark 11 to 22px, the plus
between them 11 to 22px.

That does not fit the old card. The marks sat in a **fixed 120px well beside** the label, and
that well was sized to the exact width of the widest row, badge + plus + wordmark, which
measured 119.8px. At double the size the same row needs **219.6px**, and a card wide enough
to hold it beside a label comes out at 460px against a wizard column of 470px. It would have
run edge to edge.

So the marks **stack above** the label. The row now only has to fit the card's own 264px of
content width, the card stays at 304px, and the labels still line up because they are centred
in cards of equal width. The fixed well was only ever doing that alignment job, so it is gone.

`test/firstrun.mjs` derives the row width from the assets' own aspect ratios and fails if it
stops fitting, rather than trusting the comment that says it does.

## The five states

| Board | The device fact that produces it |
|---|---|
| `GuidedChooser` | A patched device with room for anything. Three cards. |
| `GuidedChooserStock` | Untouched. Nothing to return **from**, so `Return to Stock` is absent. |
| `GuidedChooserSmallFlash` | 8 to 15 MB. Dual boot needs 16, so its card is absent and a floor note names the number missed. |
| `GuidedChooserTinyFlash` | Under 8 MB. Every card that installs anything is gone; the note is the only thing left. |
| `GuidedChooserLocked` | RDP. Internal flash cannot be read, so there is no backup to build on. No cards. |

Two rules the states share:

**An option that cannot apply is absent, not disabled.** A greyed card invites a click and
then explains itself, which is a description by another route.

**The floor note is grey, not red.** The chip is the size it is. That is a fact about the
hardware, not a failure the user caused or can fix.

`GuidedChooserTinyFlash` is the state worth checking first: it is the one where the note is
carrying the screen alone, which is what stops the note being written as a footnote to cards
that may not be there.

## Copy

Every string on these boards is the shipped English value from `i18n/strings/wizard.ts`. The
two floor notes are its interpolated templates with a real number substituted. Nothing here
was written for the board.

## Not drawn

**The spine** (step 2, the numbered steps after a path is chosen). The owner's complaint was
the chooser, and two of its steps are separately queued for change: "Add Software Sources"
should go green on its own when the curated list pulls, and "Select Backup of Original
Firmware" should read the backup folder. Drawing them now would draw states that are about to
move.

**The mockups this replaces.** `docs/design/mockups/GuidedLayout.dc.html` and
`GuidedLayoutStock.dc.html` still draw the struck descriptions and the old beside-the-label
card. They are now behind the code rather than ahead of it. Redrawing an approved mockup is
the owner's call, so `firstrun.mjs` records the divergence and fails only if the **code** is
dragged back to match them.
