# UI voice: what to write, and what never to

**Read this before writing or changing any user-visible string, and before drawing any board.**

Every rule below is a correction the owner actually made, quoted. They are here because each one
was fought over at least once. `docs/design/proposals/overview-v2/README.md` is the worked example
of this voice applied to one surface, and it is the standard he accepted; this file is the general
rule it came from.

---

## Never

1. **Never narrate.** No sentence that explains, reassures, orients or teaches.
2. **Never add copy to something you were not asked to touch.**
3. **Never signal state through wording.** No pluralised label, no `n added`, no tally.
4. **Never invent a word.** Not a heading, not a section name, not a category.
5. **Never invent a state.** If no artboard draws it, report the gap.
6. **Never use `·` or an em-dash.**
7. **Never say "emulator" for a core, or "ROMs" for the Library.**

If you are unsure: **draw less, write nothing, and report the gap.** Silence is always recoverable.
A sentence nobody asked for costs a round trip and his patience.

---

## 1. No narration

> "Don't try to be 'helpful' and chat to the user informing them about shit they don't care about."

The Guided chooser had three captions under its buttons. All three were struck:

| Struck | Why |
| --- | --- |
| `Pick which one runs at power-on` | Instructions for a choice the three buttons already are |
| `and leaves more space for games.` | A benefit nobody asked to have argued |
| `Erases Retro-Go` | A consequence, on a caption, where it is not actionable |

> "You're adding text to shit I never told you to touch and you're making them in this weird
> narration style instead of focusing on good UI design."

**The rule:** a sentence exists only when an action has a consequence that must be stated *at the
moment of acting*. A chooser button is a name. If the consequence is genuinely irreversible, it
belongs in the confirmation, not the caption.

**The boundary, from the same ruling.** `whatIsRetroGo` survived on that screen: it defines the one
word the page assumes, and it is a rubric under the title rather than a button caption. So the rule
is not "never explain". It is that a control is named, not narrated, and that defining a term the
screen cannot function without is a different job from selling a choice.

Note this reversed an earlier decision: those three strings were added deliberately to answer
beginner-audit finding F4 ("the chooser has no explanations"). He overruled it. **F4 is withdrawn**
(see `docs/design/proposals/beginner-audit.md`). Do not re-derive it from the audit.

## 2. No filler

> "We don't need *any* filler."

And, earlier: *"I'd rather lose text than have too much of it."*

Two examples deleted with no replacement, because neither had a job:

- `Room for plenty more`, captioning a bar that already showed free space.
- `Your save states have never been backed up. They only exist on the console.`, an implication
  the reader did not ask for.

**The rule:** if a string is padded, propose the shorter version. Do not preserve it out of caution.

## 3. State lives in structure, not in wording

> "'choose files' vs 'choose file' is an antipattern the user will not immediately notice."

> "what does remove do? there are 2 files there. What files are there? each should be its own row
> with its own remove button ffs."

Two instances of one mistake, on the same surface, one pass apart:

| Before | After |
| --- | --- |
| `Choose file` / `Choose files`, swapped by `allowMultiple` | One label. Whether another fits is the control being **present or absent** |
| `2 added`, with one `Remove` that dropped both | **One row per file**, each with its own remove |

**The rule:** a fact about *how many* or *which ones* is carried by the shape. One row per item,
each with its own action. Never a count, a plural, or any caption that changes with state.

Two i18n keys differing only in plurality are a smell. `chooseFile`/`chooseFiles` was exactly that,
and `chooseFiles` is deleted.

This is recorded as the memory `state-in-structure-not-wording`; this section is its home in the
repo.

## 4. Use his vocabulary, not yours

> "what the hell is 'Evidence' ???"

A section was named `Evidence` while claiming to follow his copy rules. It is `Details`, because
nobody opening a console manager is looking for evidence.

**The rule:** a heading names the content, not the virtue. `Safety` became the rows themselves,
under no heading at all.

**Enforced:** `core` not emulator, `Library` not ROMs. `apps/web/test/core-vocabulary.mjs` fails
the build on either, in copy *and* in code.

## 5. A value stands alone

`Taken`, then `Not taken`, for a firmware backup. Both read like a photograph and made the reader
supply the verb. A backup is a file that exists or does not, so the value is the date, or `None`.

**The rule:** read the value column of any grid without its labels. Every entry must still mean
something.

**Corollary, internals stay out.** No `/data/INSTALL`, no CRC, no `Pinned`, no superblock flags.
The version a marker carries is `Installed firmware`; the file it came from is *how we know*, not
something to read.

## 6. Colour instead of counting

`8/8` is a score for a checklist that is not a checklist. Status rows carry a coloured dot and
nothing else.

The one number that survives is `2 need attention`, because a count of things wanting action is
different from a score.

## 7. The page does not restructure when something needs doing

`StatusAttention` promoted a panel above the table repeating two rows that already existed below
it. The panel is gone; what is left is the same table with different values.

**The rule:** a row that can be acted on **carries its own action**. It does not get promoted into
a second copy of itself.

## 8. Typography

Never `·`, never an em-dash. Two facts on one line get a grid row each.

**Enforced:** `apps/web/test/copy-dashes.mjs` scans every string table *and* component markup.
Producing an interpunct is a failure; splitting on one is parsing, not copy, and the guard knows
the difference.

Two tables of debt sit in that file. `KNOWN_OPEN` (em-dashes in string tables) is **empty**; keep
it that way. `KNOWN_OPEN_DOTS` still pins one interpunct each in `DumpSection.svelte` and
`FlashSection.svelte`; those are real debt, and a pin going stale fails the guard, so clear a line
rather than lowering a number.

## 9. Do not invent states

> "who the fuck added this shit!? That wasn't in the mockup!"

Said of a flash-layout questionnaire built from prose. Reverted in full.

**The rule:** match the approved artboards. Where a board does not cover a state you need, **say so
in your report** rather than filling it in.

This does not mean cutting working UI for lacking a mockup. See `HANDOVER.md` §3, "Nothing is cut
for not appearing in a mockup". The boards are a design pass over a working site, not a
specification of the whole app. Invent nothing; delete nothing on those grounds either.

---

## Before you write anything: know who is looking

The first Overview rework was rejected outright.

> "wow that is pretty worthless."

> "I really wish you understood the perspective of a human user. All the facts around the device
> are just random tokens to you."

The second attempt was rejected too (*"even your 'concrete' response is mostly thin air"*), and
what finally worked was neither a better sentence nor a better palette. It was **research first**:
separate passes written from the goals of a person who wants to play games, a person who flashes
and recovers, and a beginner with no model of the device; then the reasoning written down; then
pixels.

**The rule:** before writing a word, state who is looking at this surface and what they came to do.
If you cannot, you are not ready to write copy. Facts about the device are not the subject; what
the reader intends to do with them is.

The three research passes were deleted once `overview-v2` superseded them. Do not resurrect them;
read `overview-v2/README.md` for what survived.

---

## Mechanics

- Every user-visible string is a **seven-file edit**: `strings/<area>.ts` plus `.de .es .fr .ja .ko
  .pl`, with **real translations**. English pasted into a sibling to silence the compiler is not
  acceptable. See `CLAUDE.md`'s i18n section for the `Pre`/`Post` fragment trap.
- Deleting a string is also a seven-file edit, and `apps/web/test/firstrun.mjs`'s orphan check must
  stay green with an **empty** allow-list.
- Check the existing `additional.*`, `filePrompt.*` and `shared.*` keys before adding one. Reusing
  the string another surface already uses for the identical fact is how two surfaces are kept from
  describing one thing two ways.

## What a guard can and cannot catch

Guards catch the interpunct, the em-dash, the wrong vocabulary word, an orphaned key, and a
pluralised label that was deleted by name. **They cannot catch narration, filler, an invented
heading, or a caption that explains rather than labels.** Those are on the reader. Do not add a
guard that appears to enforce taste; it will pass while the defect ships, which is the failure mode
this repo has paid for repeatedly (see the memory `mutation-verification-failure-modes`).
