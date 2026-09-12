# Design proposals

Work the owner has **not** accepted. `apps/web/test/artboard-index.mjs` scans
`docs/design/mockups/` only, so nothing here is indexed, counted or
conformance-surveyed. Accepting a proposal means `git mv`-ing its boards into
`mockups/` and adding them to that directory's README table and `canvas.json`.

Read a proposal's own README before its boards — each states what it was trying
to do and what it could not ground in real data.

## The Overview rework

Four attempts, in order. **`overview-v2/` is the live one**; the rest are kept
for the reasoning, not to build from.

| Directory | Standing |
|---|---|
| `overview/` | First attempt. Rejected outright — correctly-sourced fields in label/value tables that answered none of a person's actual questions. Kept as the example of what not to do. |
| `overview-v2/` | **Live.** Built from the owner's annotations on the two above. Its **Status** and **Activity** boards are approved outright; treat them as settled and make only surgical edits. |

## Guided Setup

| Directory | Standing |
|---|---|
| `guided-v2/` | **Picked and built.** Ten boards in three directions for the initial layout question (`directionA/` conservative, `directionB/` recomposed, `directionC/` varying the flow itself). The owner chose `directionC/ChooseAndSee` and approved the implementation on 2026-09-12. `chooseandsee/` is the one to read: it holds `LOGIC.md`, a **cited state matrix** whose rows are real device states and whose every gate names a file and line, plus a state-driven generator and one board per row. The app's `views/chooserPlan.ts` is that matrix in code and `test/chooserstates.mjs` pins it. |

## The Library

| Directory | Standing |
|---|---|
| `library-v3/` | **Partly promoted.** Fifteen boards exploring the Library. The composed set the owner picked (`LibraryComposed`, `LibraryComposedSummary`, `LibraryComposedOptions`, `LibraryComposedOptionsSaves`, `LibraryComposedOptionsCheats`) has been `git mv`-d into `mockups/` and is indexed there; the rest stay here as the alternatives that lost. |

## The SD card as a source

| Directory | Standing |
|---|---|
| `sd-source/` | **Picked and built.** Ten boards: the one-of rail entry, and one card page drawn in each state it can be in. The owner chose `CardSizeBar`. Its README carries three facts the boards cannot show and the implementer needs: five of the nine contents buckets did not exist when it was drawn, seven of nine are sub-pixel against a card-sized denominator (floored at 2px with the pixels taken from the free remainder, so the two large ones stay exactly to scale), and capacity is **stated by the user**, never detected, because no browser API reports a picked directory's volume. |

`beginner-audit.md` is a separate deliverable: an audit of the whole UI and
workflow from the perspective of someone with no mental model of the device,
ranked by how many people each defect stops.

## Standing constraints these were written under

- No narration or conversational asides; labels and values, with a sentence only
  where an action has a consequence.
- A heading names the content, not the virtue it serves; a value stands alone in
  its column.
- No `·` separators, no em-dashes.
- Colour carries state in preference to a count.
- Every field traces to data the app can really produce, cited in the board's
  header comment. Where a board draws something not yet built, its README says so.
