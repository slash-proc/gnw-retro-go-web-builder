# Guided Setup, Direction B: recompose the page

Four boards of the Guided Setup's initial question. Same flow, same step, same decision asked of
the user. Only the composition changes.

Direction A keeps the current structure and fixes its layout. Direction C proposes variations to
the flow itself. Nothing here changes what is asked or when.

Not registered on the main canvas: `apps/web/test/artboard-index.mjs` scans `docs/design/mockups/`
only, and this is a proposal.

Regenerate with `python3 build.py`. Chrome is lifted byte-identical from
`docs/design/mockups/GuidedLayout.dc.html` so the four differ in exactly one thing.

| Board | The one idea it tests | What it gives up |
|---|---|---|
| `ChooserRail` | The chooser drawn as step 1 of the spine the next page already uses | The choices stay boxed, so the page is a rail holding cards, which neither existing page is |
| `ChooserSpan` | The choice reads across instead of down | 900px measure. Step 1 and step 2 stop sharing a width |
| `ChooserWeighted` | The page has an opinion about which path to take | Which path is primary has to be computed per device, and means nothing when one option is left |
| `ChooserPlain` | Delete the card. The spine draws no boxes, so neither does this | A row that looks like a spine row but is clickable may not read as a control |

---

## What the steps pages do that the layout question does not

Read from `Guided.dc.html` against `GuidedLayout.dc.html` and `Wizard.svelte`. Six differences,
and they compound.

**1. The rail.** Every spine step sits in a `30px` marker column with an `18px` gutter and a 1px
connector running between markers. The chooser has nothing in that gutter, so its content starts
`48px` to the left of where the next page's content starts. The two pages do not share a left edge.

**2. Alignment.** The spine is uniformly flush left in one measure. The chooser runs three
alignments at once: title and rubric flush left across 470px, cards centred at 304px leaving 83px
dead on each side, and the label centred inside each card. Three logics on one page.

**3. Boxes.** The spine draws no card borders at all. It is a rail, text, and one button. The
chooser is three bordered boxes.

**4. Type anchor.** The spine's active step title is `21px` and its inactive ones `16px`. The
chooser's title is `28px`. Nothing on either page is the other's size.

**5. Unavailability has no vocabulary.** The spine says `Done` and `Optional` in 12px caps beside a
title, and dims a future step to `opacity: 0.5`. The chooser cannot say a path is unavailable, so
it removes the card and prints a sentence underneath instead.

**6. The measure is not filled.** Spine content spans the full 470px. The cards do not, so the
chooser has a ragged right edge the spine does not have.

## Two things the approved board no longer matches

Worth knowing before reading it as ground truth.

**The captions are gone.** `GuidedLayout.dc.html` still carries `Pick which one runs at power-on`,
`and leaves more space for games.` and `Erases Retro-Go`. All three were struck, and `UI_VOICE.md`
1 quotes the ruling. `wizard.ts` has no caption keys, only `dualBoot`, `onlyRetroGo` and
`returnToStock`. Every board here is captionless, which follows the code rather than the board.

**The title changed.** The board says `How Do You Want the Device Set Up?`. The string is
`What should this device run?`.

The icons also doubled since that board was drawn (`48px` and `22px`, from `24px` and `11px`), and
the marks moved from beside the label to above it. That single change is what the set is really
about.

## The number every board is an answer to

The Dual Boot marks row is the widest object on the page:

```
logo-gnw-badge.svg   149.36 x 119.06   at 48px tall  ->   60.22px
plus glyph                                                22.00px
logo-rgo.png         64 x 12           at 22px tall  ->  117.33px
two 10px gaps                                             20.00px
                                                      ----------
                                                         219.55px
```

`Wizard.svelte` puts it at 219.6px and it is why the live cards stack the marks above the label.
Computed here from the asset files rather than taken from the comment.

The constraint is the **card**, not the column. A 304px card has 264px inside it, so the marks fit
but a marks-plus-label row does not: that needs `219.55 + 18 + ~160 = ~398px` of content and a
438px card. In a 470px column that is very nearly edge to edge, which is what the code's comment
means. Give the card the measure and the horizontal arrangement comes back for free. `ChooserRail`
and `ChooserPlain` both take that route with a 224px well, so all three labels start at one x.

## The constraint that decided the set

**The chooser renders one, two or three cards, not always three.** `canDualBoot`, `canRetroGo` and
`!isStock` each gate one independently, and under 8 MB of external flash every card can vanish and
`floor-note` stands alone.

So a composition that only reads correctly at exactly three is disqualified. This is why the
vertical stack of fixed 304px cards degrades badly today: one surviving card becomes a single
narrow box floating centre-page under a left-aligned heading.

Each board's behaviour as options disappear:

- `ChooserRail`, `ChooserPlain`: rows are full-measure, so removing one shortens the page and
  changes nothing else. Best degradation in the set.
- `ChooserSpan`: cards keep their width and stay left-aligned rather than stretching or
  recentring, so two cards are the same two cards with the third absent.
- `ChooserWeighted`: degrades worst by design. With Dual Boot gated the primary slot has to be
  refilled or collapsed, and with one option left the hierarchy states nothing.

## Long strings and RTL

German is the long case. `Zurück zum Original` is 19 characters against `Return to Stock` at 15,
and the rubric runs 94 characters against 87.

| Board | Long German | RTL |
|---|---|---|
| `ChooserRail` | 180px of label beside a 224px well. `Zurück zum Original` needs about 156px, so it holds on one line | Rail, well and label are a flex row; mirrors as a unit. The connector is centred in its own column |
| `ChooserSpan` | Worst case in the set. 249px of card inside 289px, label centred under the marks, so a long label wraps to two lines and the grid's stretch keeps all three cards level | Mirrors cleanly, the row reverses |
| `ChooserWeighted` | Primary has the full measure. The compact pair is 230px each, where a long label wraps | Mirrors cleanly |
| `ChooserPlain` | Same 224px well and 180px label as `ChooserRail` | Same as `ChooserRail` |

None of the four uses a physical inline property, so nothing needs a `[dir]` override. Arabic
`استخدم تبويب الإعدادات المتقدمة` is the long escape action and sits on the same line at every
width drawn here.

## What is not decided

- **`ChooserWeighted` has no word for "recommended".** There is no such key in `wizard.ts` and
  inventing one is against `UI_VOICE.md` 4, so the weighting is carried by size and order alone
  (`UI_VOICE.md` 3). Whether it should be said out loud is a new string and his call.
- **The locked state is not drawn here.** `lockedTitle`, `lockedBody` and `lockedHow` replace the
  rubric and the cards entirely, and `GuidedLocked.dc.html` already covers it. Every composition
  above leaves that branch untouched, but none of them has been checked against it.
- **`floor-note` standing alone is not drawn either.** Under 8 MB with unpatched stock firmware,
  every card is gated and the note is the only content in the pane. `ChooserSpan` is the one most
  likely to look wrong there, since its 900px measure would hold a single sentence.
