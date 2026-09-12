# SD card as a local source

Ten boards for: an SD card source holding exactly one selection, **one** card page summarising
the card in relation to Retro-Go, the two-folder first-run prompt, and what each surface shows
when the card is partial, unreadable, unselected or gone.

**`CardSizeBar` is the chosen board.** The owner picked it ("CardSizeBar looks great"), so it is
the primary arrangement and the others are variants around it rather than the reverse.

Proposals, not approved boards. This directory sits outside `apps/web/test/artboard-index.mjs`,
which polices `docs/design/mockups/` only.

```
python3 build.py          # regenerate every board
python3 check_markup.py   # self-tests the parser, then checks all ten
```

---

## What changed in this pass

**The card page collapsed from two idioms into one.** An earlier pass drew an "overview" and a
"card page" separately; the owner had not asked for that and has cut it. There is one page with
several states, every state carries the file picker, the rail entry drops the card's name, and
`CardUnselected` joins `PaneUnreadable` as the two no-contents states. `PanePaths` and
`PaneLibrary` are deleted. See "The card page: there is ONE".

Before that, two owner rulings, one of which reopened a question the first pass had closed.

**1. The SD card is an entry UNDER Local sources.** Not a category above Directories. The first
pass drew both readings; the group reading was a misunderstanding. `RailAsGroup` is **deleted**
rather than marked superseded, because a board that draws a rejected arrangement is an invitation
to build it. Five boards used that rail and now draw the entry rail instead; nothing else about
them moved.

That also disposes of the only real cost the group reading carried. A group of one forced the
heading and its single item to compete for the same word, so the item had to carry the card's
name instead of a label. As an entry beside Directories and Cache, the label is the label and the
card's name is the value under it.

**2. The user states the card's size, so there is a denominator.** Verbatim:

> "For browser then what we need to do is add a size selector. We can format some fake SD card in
> the form of img files and look at how much space they really supply. If the user selects 16GB,
> we look up roughly how much that should be and we just lob off ~100MB to make sure we don't go
> over. That's not my favorite way to handle this but in a browser we don't have much of an
> option. FAT32 and exFAT should be considered."

The first pass was built around capacity being unobtainable, and said so at length. That fact has
not changed: a `FileSystemDirectoryHandle` still does not expose its volume, and
`navigator.storage.estimate()` still answers about the browser profile. What changed is that the
app can now be *told*. `docs/ELECTRON.md` step 6 records this as a browser workaround that a
desktop build retires.

**The figures are now measured, not placeholders.** `apps/web/src/lib/data/sdCapacity.json` is
read at build time by `_capacity_table()`, so every capacity, every free figure and every bar
segment on every board derives from the table the app will ship. Change a bucket or the card size
and the boards follow. The fixture is a 32 GB card, which yields **29.69 GB** after the partition
gap, the FATs and the 100 MB margin.

**The conservative figure is FAT32, and that is asserted rather than assumed.** The build refuses
if exFAT ever comes out lower at any size, because "take FAT32" silently ceasing to mean "take
the smaller" is exactly the drift a board cannot show.

**The filesystem is no longer asked, and the measurement is why.** These boards drew a second,
unlabelled control beside the size. The owner cut it:

> "We should remove the filesystem field - Fat32 and exFAT aren't so different that it matters.
> We lob off 100MB to make sure we never over-estimate card capacity."

The table agrees with him. exFAT's usable space exceeds FAT32's by 1.7 MB at 2 GB, 12.4 MB at
16 GB and 52.7 MB at 256 GB, and the margin already withholds 100 MB at every size, so the
answer could never have moved the figure the page shows. A question whose answer changes nothing
is not a question, and `test/sdcapacity.mjs` now fails if a regenerated table ever makes it one
again. The per-filesystem rows stay in the JSON: they are the evidence for this, not a setting.

**Two shapes on this page were reinvented and are now the shared ones.** The bar was hand-rolled
with nine local colour rules and is now `GeometryBar size="slim"`, the same call `DetailsPane`
makes for External flash, which is the card these boards copy. `Contents` was a definition list
and is now `CachePane`'s row table, which is the shape the owner asked for by name at the start
of this feature. Neither changes what the page says; both stop it saying it a second way.

---

## Where the selector goes, and why

**On the card page, in the `Card` section, as two rows of the existing definition grid.** Not in
the source row where the folder is picked.

Three reasons, in order of weight:

1. **`Card` is already the section for facts about the card itself.** It holds `Folder` and
   `Files`. Capacity and filesystem are the same class of fact. Nothing new is invented; two
   rows are added to a grid that exists.
2. **There is no card to describe until a folder is picked.** A selector in the pick row would be
   a control for a thing that does not exist yet, and would have to appear in the first-run modal
   too, which loads the one screen a user cannot skip with a question they can answer later.
3. **The page is where you go to look at the card.** Picking the folder is a one-time act; the
   size is a fact you check and correct.

**Two pickers, not one.** The usable figure depends on both the size and the filesystem, and a
single combined picker would be eight sizes times two filesystems, sixteen entries, to state two
independent facts.

**The picker is drawn as the version picker in `guided-v2/chooseandsee` draws its own**, which in
turn follows `advanced/RomSection.svelte`. A second idiom for choosing a value would be the third
rail CLAUDE.md warns about.

---

## Measured and stated, told apart by structure

This is the constraint the whole pass turns on. Used bytes are walked. Capacity is asserted by a
user who may be wrong, and is then reduced by a margin. Presenting both with equal confidence
would be the `navigator.storage.estimate()` mistake by another route.

No board says so in a sentence. It is carried three ways:

| Signal | How it reads |
| --- | --- |
| **Stated values are controls** | `Capacity` has a chevron. `Folder` and `Files` do not. Only a value someone supplied can be changed, so the control *is* the provenance. |
| **The two kinds are in different sections** | `Contents` is the walk, and keeps its own `Total` undivided by anything. `Card` is what the user said plus what follows from it. |
| **Derived figures sit beside their source** | `Free` and the bar live in `Card`, next to the capacity they came from, never in the measured table. |

**The unset state does not go away, and is where every user starts.** `CardUnset` is that state:
`Capacity` reads `None`, which is UI_VOICE section 5's established pattern for an absent value.
No bar and no headline either, for the same reason: both need a denominator.

### `Free` will not equal `Capacity` minus `Total`, and should not

The gap is the safety margin plus **cluster slack**. Every file rounds up to a whole cluster, so
527 files consume more of the card than their bytes add up to, and a 128 KiB cluster against 212
small covers loses real space. This is why the computed table carries a cluster size per row.

**`Free` is never a row.** The bar's headline already reads "26.37 GB free of 29.69 GB", so a
`Free` row one line below states the same figure twice, which is the double statement UI_VOICE
rules out. It survived only on `CardSize`, the bar-less board, and went with it. Every board that
states a capacity draws the bar, so the figure is on all of them; the two that do not
(`CardUnset`, `CardUnselected`) have no denominator to compute it from.

With `Free` gone and `Files` hidden unless the walk was truncated, the `Card` grid is down to
`Folder` and `Capacity` -- but the section also holds the headline and the bar, so the heading is
still labelling a substantial block rather than a lone row.

`Free` is the figure a sync can actually spend. `Total` is the figure the walk measured. Drawing
both as one subtraction would be wrong; drawing the difference as a third number would be the
double-figure narration UI_VOICE rules out. The implementation note is simply that `Free` is
computed from cluster-rounded consumption, not from raw bytes.

---

## The boards

### Where it lives

| Board | The one idea | What it gives up |
| --- | --- | --- |
| `RailAsEntry` | An entry inside Local sources, above Directories, drawn selected. **The label alone, with no card name beneath it.** | Nothing. The name moved to the page, which is where the control to change it now is too. |

**The rail says which SOURCE is selected; the page says what the CARD is.** The entry used to
carry the card's name on a second line, because it holds one thing rather than a list. The owner
has ruled it out, and it is the same thought as putting the picker on the page: a name in both
places made the rail answer a question the page owns. `rail_item`'s `sub` parameter went with it
rather than being left unused.

**One-of is carried by structure, not by wording.** There is no second verb for replacing: the
control stays `Choose…` and there is only ever one row, so picking again changes the row's value.
A `Change…` would be a second word for one action, the `chooseFile`/`chooseFiles` mistake.

### The card page: there is ONE, and these are its states

An earlier pass drew an "overview" and a "card page" as two idioms. **That split was a drafting
artefact, not a request, and it is collapsed.** Every `Card*` board below is the same page in a
different state: same rail, same sections in the same order, same picker on the `Folder` row.

**Every one of them carries the file picker**, because the page is where you look at a card and
decide it is the wrong one. `folders.choose` is the existing artboard-verbatim string; it sits on
the `Folder` row, beside the name it changes.

| Board | The one idea | What it gives up |
| --- | --- | --- |
| **`CardSizeBar`** | **THE CHOSEN BOARD.** Capacity stated, the budget drawn: `Main.dc.html`'s External flash card, which is the approved drawing of this exact statement and the card `sdStorage` said could not be built. | Seven of nine bar segments are at their floor, so the bar cannot compare the small buckets. See below. |
| `CardSizePick` | The capacity picker open, with sizes the card has already outgrown struck through. | A dropdown drawn open is a moment, not a resting state. |
| `CardUnnamed` | A volume whose name came back unusable, so `Folder` reads `SD`. | Identical to `CardSizeBar` but for one row, which is the point and also makes it easy to skip. |
| `CardUnset` | **No capacity stated**, which is where every user starts and where some stay. No bar and no headline, because both need a denominator. | Nothing. This is the honest page when the one fact it cannot measure has not been supplied. |
| `CardPartial` | A truncated walk: the `Files` row appears and every figure is a floor, the bar included. | Nothing. The row exists exactly when there is something to say. |
| `CardUnselected` | **No card selected at all**, and the Library never opened, so nothing ever prompted for one. | Nothing to show but the picker, which is the whole of what is true here. |
| `PaneUnreadable` | A folder we hold and cannot read. | Promises no cause, because the catch cannot tell a removed volume from a revoked permission. |

**Deleted rather than superseded: `CardSize`, `PanePaths` and `PaneLibrary`.** All three were
alternative TREATMENTS the owner has passed over, so they are gone the way `RailAsGroup` went.
`CardSize` was the chosen page without the bar; once the bar was picked and the `Free` row cut as
superfluous against it, that board existed only to show the option that lost. A board drawing an
arrangement nobody chose is an invitation to build it, and "it might be useful later" is how a
proposal set stops being a set of proposals.

**The states were kept**, because they are not competing designs: `PaneContents` and `PanePartial`
folded into the one page as `CardUnset` and `CardPartial`, and `CardSizePick`, `CardUnselected`
and `PaneUnreadable` stand as the page in situations it will really be in.

**Deleting `CardSize` exposed two boards that had drifted onto its layout.** `CardPartial` and
`CardSizePick` were building the `Card` panel themselves and had inherited the bar-less shape, so
after the cut they would have been the only boards still drawing a rejected design. Both now call
one shared `card_panel()`, which is also what stops it happening again. Same fault as
`PaneLibrary`'s hardcoded bucket list, found the same way.

**`Free` is not lost with it, and that is confirmed rather than assumed.** No board carries a
`Free` ROW now, because every board that states a capacity draws the bar, and the bar's caption
reads `26.37 GB free of 29.69 GB`. The figure is on all four of them; only the duplicate row is
gone. `CardUnset` and `CardUnselected` show no free figure at all, which is correct: neither has a
denominator to compute one from.

`PaneLibrary`'s third column is worth one line of epitaph: it needed a join of the walk against
the Library's rows through `classifySdScanKey()`, which nothing does, and at nine buckets only
ROMs and Covers could ever have been joined. Seven of nine rows could only be a dash.

### Unselected is not unreadable

`PaneUnreadable`'s shape is the basis for `CardUnselected`, as the owner asked: no `Contents`
table at all, one panel, and the picker. **But the two states are different facts and the page
must not claim the wrong one.** Unreadable means we hold a folder and cannot read it. Unselected
means there is no folder. The store separates them too: `unavailable` versus `unreadable`.

Three things differ, all structural rather than worded:

| | `CardUnselected` | `PaneUnreadable` |
| --- | --- | --- |
| Status dot | **None.** Nothing has gone wrong. | **Red.** A read failed. |
| Card name | **None**, because there is no card. The value is `No folder chosen`. | `GNW-SD`, because we hold it. |
| Footer | **No `Rescan`.** Nothing to rescan. | `Rescan`, because retrying is the obvious thing. |

The absent dot is the load-bearing one. A fresh user who has not opened the Library has simply
not picked a card yet, and a red dot would accuse them of a failure they did not commit.

**Section order: every board now leads with `Card`.** `CardSizeBar` has to, because a budget
headline is the first thing on the page or it is not a headline. When it was an experiment that
flip was a cost, since it alone could not be compared row for row with the rest. Now that it is
the chosen arrangement the others follow it instead, which makes the comparison work again and
stops the primary board being the odd one out.

**The bar at nine buckets, and what it honestly says.** Segment widths are derived from the same
fixture the table prints, never written beside it. At the fixture:

| | True | Drawn |
| --- | --- | --- |
| ROMs | 67.74px | 67.74px |
| Other | 7.03px | 7.03px |
| Homebrew | 1.09px | 2.00px |
| Covers | 0.43px | 2.00px |
| Saves | 0.09px | 2.00px |
| BIOS | 0.05px | 2.00px |
| Screenshots | 0.04px | 2.00px |
| Fonts | 0.02px | 2.00px |
| Language | 0.009px | 2.00px |

**Seven of the nine are below one pixel.** Three ways to handle that and none is free: draw true
proportions and seven buckets vanish; floor them and take the pixels from their siblings, which
understates the big buckets; or floor them and take the pixels from the free remainder.

**The third is taken.** Every bucket big enough to be drawn to scale is drawn to scale, no bucket
is ever invisible, and the whole error lands on the grey remainder, the largest quantity on the
bar and the least sensitive. Measured cost: used is drawn **12.27px of 684 wider than it truly
is, 1.79 percentage points**. The caption is text rather than pixels, so the figures stay exact.

**So the bar says how full the card is and which buckets exist. It does not say how the small
buckets compare** -- seven are at the same floor, and among those seven the widths carry no
information. The `Contents` table directly below carries every exact figure and is where a reader
compares. That is also the second reason there is **no legend**: a legend would invite exactly
the comparison the widths cannot support.

**These buckets are permanently sub-pixel, not sub-pixel because this card is empty.** They are
tiny against a card-sized denominator and stay tiny however full the card gets. No fill level
makes this go away, and no realistic fixture would hide it.

**`PaneLibrary`'s third column is still blocked.** The selector supplies a capacity; that column
needs a join of the walk against the Library's rows keyed through `classifySdScanKey()`. Those are
unrelated, so the selector does not unblock it. At nine buckets it reads worse than before: only
ROMs and Covers can be joined at all, so **seven of the nine rows can only be a dash**, which is
the honest picture of a column that is mostly empty by construction.

Its bucket rows were a second hardcoded copy of the old four and kept drawing them after the table
grew to nine. They now derive from the same list as every other board, which is what stops that
recurring.

### The Library, untouched

| Board | The one idea | What it gives up |
| --- | --- | --- |
| `LibraryMissing` | The Library when the card is gone: the source row says `Missing`, game rows dim rather than vanish. | Does not answer what `Sync Library` does while the card is missing. |

**Unchanged this pass and byte-identical**, because the Library is not to be touched. It is the
only board here that draws the Library tab, and it is the reason to check `git diff` on it rather
than assume.

One thing left open on `PaneUnreadable`, unchanged from the last pass: it carries no `Capacity`
row, because it draws a status panel rather than the definition grid. A stated capacity survives
a read failure, so arguably it should still show. Left alone as out of scope.

### The prompt

| Board | The one idea | What it gives up |
| --- | --- | --- |
| `GatePrompt` | The two-folder first-run prompt. | Nothing, because it already exists. |

Still a finding rather than a proposal: `ModalFolder.dc.html` already draws both rows and every
string is live in `shared.folderGateModal`. What the proposal changes is underneath, that picking
the SD row would register a source. **The selector is deliberately not here** for the reason
above: it is answerable later, and the gate is the one screen a user cannot skip.

---

## Validation: a size the card has already outgrown

`CardSizePick` draws the picker open. The walk measured **3.32 GB** on the card; a 2 GB card
yields 1.76 GB after formatting and the margin, so `2 GB` is not a preference the app disagrees
with, it is a statement the card has already disproved. Refusing it is honest in a way that
refusing a guess would not be.

**Struck in place, not removed.** Dropping the impossible sizes would make the list's LENGTH
depend on the card's contents, so a reader could not tell a size that is impossible from one the
app does not offer. Struck says which, and why, without a sentence.

**A truncated walk still refuses.** `truncated` makes the total a floor, and a floor is enough:
having SEEN 3.32 GB proves the card holds at least that, whatever the walk missed. The refusal
needs the total to be real, not complete.

**Sizes are powers of two**, which is what the capacity table already covers: 2, 4, 8, 16, 32,
64, 128, 256.

---

## The folder name is not dependable

> "I'm not sure about Mac but Windows returns practically nothing for the SD card's name so that
> should default to SD when no alphanumeric characters are provided."

`sdStorage` reports `root.name`. On Windows a removable volume commonly comes back with nothing
usable, so the `Folder` row would render blank or as bare punctuation. `CardUnnamed` draws the
fallback; the rail's SD entry takes it from the same helper rather than a second copy of the test.

**Three things the implementer must get right.**

1. **The test is "no alphanumeric character", not "empty".** `-` and `___` fail a reader exactly
   the way `""` does. An empty string is one case of the rule, not the rule.
2. **It must be Unicode-aware.** In JS, `/[\p{L}\p{N}]/u` -- a letter or digit in ANY script. A
   naive `/[a-z0-9]/i` would silently rename every Japanese, Russian or Arabic card to `SD`, and
   it would pass review because the English case looks right. This is the failure worth stating
   loudest.
3. **`SD` is a fallback, not a label.** A card that has a name keeps it.

**What the rule deliberately does NOT catch.** `(E:)` keeps its name, because `E` is a letter.
The rule as stated is "no alphanumerics at all", so a drive letter counts as a name even though a
reader gains little from it. Widening it to "fewer than two" or "none outside punctuation" would
be a different rule and would start discarding real one-character names, including single-glyph
CJK ones. Left as stated; flagged because the example and the rule diverge here.

---

## Where the buckets come from

Nine buckets, **alphabetical with `Other` pinned last**: BIOS, Covers, Fonts, Homebrew, Language,
ROMs, Saves, Screenshots, Other. `Other` is the catch-all rather than a peer, so it keeps the end
of the list whatever letter it starts with.

**Two rules the implementer must carry, because the boards can only show the English answer.**

1. **Sort the LABEL, not the directory key.** `lang/` displays as `Language` and belongs under L.
   Any bucket whose label and directory differ has the same trap.
2. **Sort per locale.** Fifteen locales are wired. `BIOS`, `Covers` and `Fonts` translate to words
   that sort differently in German or Russian, and Arabic sorts right to left. The implementation
   is `localeCompare` against the **active** locale, never a fixed array. A hardcoded English
   order ships a list that looks arbitrary in fourteen languages. The generator derives the order
   from the labels (`_sorted_buckets`) rather than listing it, so the boards demonstrate the rule
   even though they can only draw one locale's answer to it.

**Five of the nine do not exist today.** `sdStorage.svelte.ts`'s `SdCategory` is four wide:
`games | covers | saves | other`.

| Bucket | Directory | Status today |
| --- | --- | --- |
| BIOS | `bios/` | **Role exists, never tested.** `paths.bios` is declared, but `bucketFor()` has no branch for it, so BIOS lands in `Other`. One line. |
| Covers | `covers/` | Live. |
| Fonts | `fonts/` | **No role.** Firmware furniture, seeded unconditionally from `defaultContent` and in `gen_frogfs_image.py`'s `DEFAULT_DIRS`. Note the firmware routes **`fonts` AND `font`**, so a bucket matching only the plural misses the singular. |
| Homebrew | `roms/homebrew/` | **Merged with ROMs** as `games`. Splitting is free: `bucketFor` is already longest-prefix, so the nesting resolves correctly once they are separate branches. |
| Language | `lang/` | **No role, but already a literal.** `flashImage.ts` hardcodes `lang/` with a documented reason (the firmware's `paths` object declares no such role, and `rg_i18n.c` opens it with a plain `fopen`). Precedent for the literal exists; reuse it rather than adding a second spelling. |
| ROMs | `roms/` | **Merged with Homebrew** as `games`. |
| Saves | `data/` | Live. `ODROID_BASE_PATH_SAVES` is `/data`. |
| Screenshots | `screenshots/` | **No producer at any layer.** The firmware writes it (`ODROID_BASE_PATH_SCREENSHOTS`), but nothing in this codebase names it: no `InstallPaths` role, no literal. It lands in `Other` today and is the one bucket that needs a decision rather than a line of code. |
| Other | catch-all | Live. |

**`cores/` and `cheats/` are declared roles that are not in the nine**, so they fall into `Other`
along with anything else. On a real card `cores/` is not small, which is most of why `Other` is
312.6 MB in the fixture. Whether either deserves its own row is a question the owner has not been
asked and this set does not presume to answer.

**`ROMs` is safe as a label.** `core-vocabulary.mjs` blocks the word only for keys that NAME the
Library tab, and its own comment says a folder of files may keep it. But note the guard reads
`apps/web/src/lib/i18n/strings/` only, so **a new `ROMs` bucket-label key will fail it** unless
that key is added to the guard's `ABOUT_FILES` map with a reason, the way `railRoms` already is.

---

## New copy, every instance

The selector needed **no new labels**, which was not the expected outcome. Every word it wanted
already exists, and so did both words the one-page collapse wanted: the picker and the
unselected value are existing artboard-verbatim strings. **This pass added no copy at all.**

| Drawn | Status |
| --- | --- |
| `Capacity`, `Free` | **Exist**, in `roms.installGeometry`. See the caveat below. |
| `None` | **Established pattern** for an absent value (UI_VOICE section 5), already used elsewhere in this set. |
| `32 GB` | **Data, not copy**, like `v1.4.1` in the version picker. A size list is a constant, not a string table. |
| `Choose…` | **Exists**, `folders.choose`, artboard-verbatim. The picker that is now on every card page. |
| `No folder chosen` | **Exists**, `folders.noFolderChosen`, artboard-verbatim: the add-a-directory page's value for a folder row with nothing chosen, which is exactly what `CardUnselected` needs. |
| `SD` | **Constant, not copy.** The fallback when a volume name carries no letter or digit. It stands in for the volume's NAME, and a name that changed per locale would be a different card to every reader. Same reasoning that keeps version strings and model names out of the tables. |
| `BIOS`, `Fonts`, `Homebrew`, `Language`, `ROMs`, `Screenshots` | **New bucket labels.** See the `ROMs` caveat under "Where the buckets come from". |
| `Contents`, `Total`, `Other`, `Choose…`, `Missing`, `No folders yet.`, `Rescan`, `Sync Library`, `Folder`, `Saves` | **Exist.** Reused verbatim from `sources.cache`, `sources.folders`, `shared.rescan`, `roms.syncLibraryButton`. |
| `Folders needed`, `Select the folders below to continue.`, `ROM Folder`, `SD Card Folder`, `The root of your SD card volume`, `Your local collection of ROM files`, `That folder could not be read.` | **Exist**, in `shared.folderGateModal`. |
| `Games`, `Covers` | **Board-derived**, from the Details board's breakdown. |
| `Card` | **New caption**, the one new heading in this set. |
| `Files` | **Renamed**, from `Counted`. The row label. |
| `Too many files on SD card. Unable to calculate more than 40,000 files` | **New, and the only new sentence in the set.** Renamed from `First 40,000 files. Sizes are a minimum.` See below. |
| `On card` / `In library` | **New**, on `PaneLibrary` only, which is already flagged as needing data that does not exist. |
| `free of 29.69 GB` | **Composition exists** on `Main.dc.html` (`46.58 MB free of 50 MB`). Whether the key is reusable depends on where it lives today. |

**The `Files` row, and the one new sentence.**

The row does not appear at all when the walk was complete: a complete count needs no row to say
so, which is UI_VOICE section 3, presence carrying the fact. So the row exists exactly when the
walk stopped early, and its presence is already the warning. It is drawn in `--caution`
(`tokens.css:52`) with the same `status_dot` every other state row uses, not a new shape.

**Where the count itself is.** With the label renamed from `Counted` to `Files`, a reader might
expect a number in that row. The number is one section below, in the `Contents` table's `Total`
row (`527 files`). Stating it twice is the double statement UI_VOICE rules out, so the `Files`
row carries only what the total cannot say: that it is capped.

**`40,000` is `MAX_ENTRIES`**, exported from `lib/sdStorage.svelte.ts:100`. It stays runtime data
interpolated into the sentence, so the i18n entry is `(limit: string) => ...` and fifteen
translations do not bake in a number that can change. **Interpolate that constant rather than a
second spelling of 40000.**

**The sentence names one cause and `truncated` has three.** The store sets it when the walk hits
`MAX_ENTRIES` (too many files), when it hits `MAX_DEPTH` (a tree deeper than 8), and when a single
file's `getFile()` throws. Only the first is "too many files", so this wording is right for the
common case and misleading for the other two. The copy is the owner's and is drawn as given;
raising it here rather than rewording it. If it matters, the cheapest fix is for the store to
report WHICH limit it hit, since it already knows.

**Both renames are a 15-file i18n edit each**, the label and the sentence.

**The caveat on `Capacity` and `Free`.** The words are not new, but they sit in
`roms.installGeometry`, and these boards are a Sources pane. Reusing a string across areas is how
two surfaces are kept from describing one fact two ways, which UI_VOICE encourages, but the key
may want to move to `shared.*` rather than have Sources reach into `roms`. That is a placement
decision for the implementer, not new copy.

Any string that does get added is a **15-file edit** (`SUPPORTED_LOCALES` lists 16; `nl` has no
string files yet and falls back to English).

---

## Removal detection, unchanged and still honest

**The File System Access API has no removal event.** Nothing fires when a volume is unmounted,
and nothing in the app polls or revalidates. What exists is a permission check at load
(`localFolders.readAll()`) and an `unreadable` state when a walk throws (`sdStorage.refresh()`).

The truthful triggers, in increasing cost: on next read (free, can be minutes late); on tab focus
or `visibilitychange` (cheap, and catches the real case, because pulling a card out means leaving
the tab); polling (a timer touching the filesystem forever).

`PaneUnreadable` and `LibraryMissing` draw the outcome, which is the same picture whichever
trigger produces it. **No board here claims live detection.**

---

## Long strings and RTL

Every board is a 1440px page with a 244px rail and a 720px pane, so none is tight. The pickers
are the new risk: the capacity picker is 112px and the filesystem picker 96px, both holding short
tokens that do not translate (`16 GB`, `exFAT`), so neither grows in German. The labels beside
them sit in a 148px column and wrap rather than clip.

**Implementing these means logical properties** (`text-align: end`, `padding-inline-start`),
because `apps/web/test/direction.mjs` now fails the build on a physical inline property anywhere
in `src/`. The boards keep the physical spellings of the approved board they were lifted from;
the guard does not read `docs/`.

---

## What is guarded, and how it was verified

`check_markup.py` parses every board and **self-tests first**: it is pointed at an approved board
known to be good, and at both shapes of the bug, and refuses to report a pass if the self-test
does not fail as expected. All ten boards are well formed.

The bar's segment widths are **derived from the fixture the table prints**, never written beside
it, so the two pictures of the same data cannot drift apart. `segments()` also refuses to build
if the buckets stop adding up to the printed `Total`, or if the walked total does not fit in the
stated capacity. Both refusals were mutation-verified:

```
AssertionError: the buckets miss the Total by 2045.68 MB, more than the 10.25 MB the printed
                rounding allows
AssertionError: 3.27 GB used does not fit in 2 GB
```

The tolerance is derived from the display's own rounding rather than picked. The first version
used a flat 1 MB and failed against the untouched fixture, because `formatSize` trims to 2dp and
`2.94 GB` alone carries 5.37 MB of slack, so a tolerance tighter than the printed precision could
never be met.

Hardcoding the segments instead was also tried: with the fixture changed to `7.94 GB`, the bar
went on drawing `19.86%` where the derived value is `53.65%`, silently. That is the failure the
derivation removes.

**Untouched boards regenerate byte-identically.** `RailAsEntry`, `LibraryMissing` and
`GatePrompt` are unchanged by this pass, confirmed against git rather than by eye, so the
generator changes cannot have quietly altered a board already reviewed. The five that did change
are accounted for above: the rail on all five, and a `Capacity` row on the four that draw the
definition grid.

---

## Things that would bite an implementation

- **SD mode and Flash mode share UI, not budget logic.** Anything reading `device.partitions` or
  `device.info` is Flash-only and must early-out on `targetMedia === "sd"`. The budget on these
  boards is the **card's**, and has nothing to do with the device's flash gap; wiring one to the
  other would be exactly the confusion `docs/AUDIT_NOTES.md` item 14 records.
- **`runInstall()` and `doSdSync()` are two functions**, not one branching on media.
- **The stated size must persist with the source**, and every persisted name goes through
  `scoped()` (`lib/storageScope.ts`); `apps/web/test/storagescope.mjs` fails on a bypass. A size
  remembered for the wrong card is worse than no size, so it belongs to the source record rather
  than to a global setting.
- **`sdStorage.refresh()` never prompts.** It reads a handle the app already holds, so a card page
  opening cannot raise a permission dialog. A `Rescan` control has to keep that property.
- **The filesystem is guessable but not detectable.** Factory cards follow the SD specification:
  32 GB and below ship FAT32, above 32 GB ships exFAT. That makes a sensible default rather than
  a known value, because a user who reformatted has no reason to expect us to notice. Drawn as a
  picker with a value, not as a detected fact.
