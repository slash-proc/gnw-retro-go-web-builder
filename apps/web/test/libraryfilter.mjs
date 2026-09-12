#!/usr/bin/env node
/**
 * The Library's three scopes: console, favourites, search. And the wiring that reaches them.
 *
 *   docker compose exec dev sh -c 'cd /app/apps/web && node test/libraryfilter.mjs'
 *
 * The rules are small, and every one of them is a decision that reads as arbitrary six months
 * from now: that `Favorites` does not narrow to a console, that its count describes the library
 * rather than the list, that an empty search restores everything, that the search is not
 * trimmed. None of it can be seen without rendering the tab, and there is no headless browser in
 * the dev container, which is exactly why the rules were lifted into `lib/libraryFilter.ts`.
 *
 * The structural half at the end guards the parts that stay in the component: that the options
 * modal has exactly ONE trigger, and that the body region can scroll under the pinned dock. That
 * second one is `test/panescroll.mjs`'s lesson (commit `e66b3db`) applied to this tab, because
 * this tab now has the same shape: a region that can shrink below its content, sitting above an
 * opaque bar that is painted later.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const esbuild = await import("esbuild");

const built = (
  await esbuild.build({
    entryPoints: [join(here, "../src/lib/libraryFilter.ts")],
    bundle: true,
    format: "esm",
    write: false,
    platform: "neutral",
  })
).outputFiles[0].text;
const { writeFileSync, mkdtempSync } = await import("node:fs");
const { tmpdir } = await import("node:os");
const out = join(mkdtempSync(join(tmpdir(), "gnw-libfilter-")), "f.mjs");
writeFileSync(out, built);
const { filterLibraryRows, countFavorites, passesConsole, isStarred, matchesSearch } =
  await import(`file://${out}`);

// The ORDER rules, bundled the same way for the same reason.
const builtSort = (
  await esbuild.build({
    entryPoints: [join(here, "../src/lib/librarySort.ts")],
    bundle: true,
    format: "esm",
    write: false,
    platform: "neutral",
  })
).outputFiles[0].text;
const outSort = join(mkdtempSync(join(tmpdir(), "gnw-libsort-")), "s.mjs");
writeFileSync(outSort, builtSort);
const { sortLibraryRows, LIBRARY_SORT_KEYS, ACTION_ORDER, actionRank, hasSize } =
  await import(`file://${outSort}`);

let passed = 0;
const failures = [];
const check = (name, fn) => {
  try {
    fn();
    passed++;
  } catch (e) {
    failures.push(`${name}: ${e.message}`);
  }
};
const ok = (c, m) => {
  if (!c) throw new Error(m);
};
const eq = (a, b, m) => {
  if (JSON.stringify(a) !== JSON.stringify(b))
    throw new Error(`${m}: got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`);
};

// A library shaped like the real one: two consoles, a homebrew, one row the firmware cannot
// address (a converter input still needing prepare), and three stars spread across them.
// `key` is the ROW ID, which is what a star is recorded against. `path` is the device path the
// row will occupy once installed, and is here only so a test can prove the filter does NOT use
// it: asking the star store by path is the bug this suite exists to keep out.
const ROWS = [
  { key: "md/aerobiz.md", name: "Aerobiz Supersonic", system: "md", path: "/roms/md/aerobiz.md" },
  { key: "md/aladdin.md", name: "Aladdin", system: "md", path: "/roms/md/aladdin.md" },
  { key: "sms/alexkidd.sms", name: "Alex Kidd in Miracle World", system: "sms", path: "/roms/sms/alexkidd.sms" },
  { key: "nes/battlekid.nes", name: "Battle Kid", system: "nes", path: "/roms/nes/battlekid.nes" },
  { key: "celeste", name: "Celeste", system: "homebrew", path: "/homebrews/celeste.bin" },
  // Not prepared, so it has no device path at all -- and is starrable anyway. The owner:
  // "anything should be able to be a favorite [...] including things that haven't been prepared".
  { key: "doom/doom.wad", name: "Doom", system: "doom", path: null },
];
const STARRED = new Set([
  "md/aerobiz.md",
  "sms/alexkidd.sms",
  "nes/battlekid.nes",
  "doom/doom.wad",
]);
const ACCESS = {
  systemOf: (r) => r.system,
  nameOf: (r) => r.name,
  rowIdOf: (r) => r.key,
  // THROWS on anything that is not a row id. The bug this replaced handed a DEVICE path to the
  // store that holds row ids, and a fixture answering a plain false could not tell the two
  // apart: `new Set(ids).has("/roms/md/aerobiz.md")` is false, so the filter looked merely
  // empty rather than wrong. Throwing makes the wrong question a failure instead of a silence.
  isFavorite: (id) => {
    if (typeof id !== "string") throw new Error(`isFavorite called with ${JSON.stringify(id)}`);
    if (id.startsWith("/")) throw new Error(`isFavorite called with a DEVICE PATH: ${id}`);
    return STARRED.has(id);
  },
};
const names = (rows) => rows.map((r) => r.name);
const run = (consoleFilter, searchQuery = "") =>
  names(filterLibraryRows(ROWS, ACCESS, { consoleFilter, searchQuery }));

check("all shows everything", () => {
  eq(run("all").length, ROWS.length, "no scope narrows anything");
});

check("a console narrows to that console", () => {
  eq(run("md"), ["Aerobiz Supersonic", "Aladdin"], "only the Mega Drive rows");
});

check("FAVORITES DOES NOT NARROW TO A CONSOLE", () => {
  // The whole reason the chip sits beside `All` rather than among the consoles. If this fails,
  // Favorites shows only the stars of whichever console was selected before it.
  eq(run("favorites"), ["Aerobiz Supersonic", "Alex Kidd in Miracle World", "Battle Kid", "Doom"],
    "starred rows from every console, prepared or not");
});

check("THE FILTER ASKS BY ROW ID, NOT BY DEVICE PATH", () => {
  // The regression this suite exists for. The star writes `favorites.toggle(row.key)`, so a
  // filter that looks up `favoritePathFor(row)` in that same store never matches and the game
  // never appears under `Favorites`. The fixture throws on a path, so a filter that asks the
  // old way fails loudly here rather than returning an empty list that looks like "no stars".
  eq(run("favorites").includes("Aerobiz Supersonic"), true, "a starred row is under Favorites");
});

check("a row with NO device path is still starrable", () => {
  // "anything should be able to be a favorite [...] including things that haven't been
  // prepared". Doom has no device path until it is prepared; the star is recorded against its
  // row id regardless, and the write-time half decides what reaches /data/favorites.txt.
  ok(isStarred(ROWS[5], ACCESS), "an unprepared row counts as starred");
  ok(run("favorites").includes("Doom"), "and appears under Favorites");
});

check("search matches the list name, case-insensitively", () => {
  eq(run("all", "ALA"), ["Aladdin"], "case folds both ways");
  eq(run("all", "kid"), ["Alex Kidd in Miracle World", "Battle Kid"], "substring, not prefix");
});

check("an empty search restores the list", () => {
  // A cleared box must not empty the library. The guard is `=== ""`, so a falsy-check bug here
  // would behave identically and this would still pass -- hence the explicit length compare.
  eq(run("all", "").length, ROWS.length, "empty query matches everything");
});

check("the search is NOT trimmed", () => {
  // A space the user typed is a narrowing they meant. Trimming would make "aladdin " and
  // "aladdin" behave identically, which is not how they read.
  //
  // The example matters: "Battle " still matches "Battle Kid", because the space is genuinely
  // in the name. The demonstration has to be a trailing space with nothing after it in the row,
  // which is why this uses the last word of a name rather than the first.
  eq(run("all", "Aladdin"), ["Aladdin"], "the row is there without the space");
  eq(run("all", "Aladdin "), [], "and gone with it, because the name ends there");
});

check("the scopes compose", () => {
  eq(run("favorites", "kid"), ["Alex Kidd in Miracle World", "Battle Kid"],
    "favourites AND search, not either");
  eq(run("md", "ala"), ["Aladdin"], "console AND search");
});

check("THE COUNT DESCRIBES THE LIBRARY, NOT THE LIST", () => {
  // The chip sits beside `All`, which counts the library, so the two must be comparable. A count
  // taken from the visible rows would fall as you typed.
  eq(countFavorites(ROWS, ACCESS), 4, "every starred row in the library");
  const visible = filterLibraryRows(ROWS, ACCESS, { consoleFilter: "md", searchQuery: "" });
  eq(countFavorites(ROWS, ACCESS), 4, "unchanged while a console is selected");
  ok(visible.length < ROWS.length, "and the list really was narrower, or this proves nothing");
});

check("passesConsole treats all and favorites alike", () => {
  for (const f of ["all", "favorites"]) {
    ok(passesConsole(ROWS[0], ACCESS, f), `${f} must not filter by console`);
    ok(passesConsole(ROWS[4], ACCESS, f), `${f} must admit homebrew too`);
  }
});

check("matchesSearch is the only thing the query touches", () => {
  ok(matchesSearch({ name: "Zelda" }, ACCESS, "eld"), "substring hit");
  ok(!matchesSearch({ name: "Zelda" }, ACCESS, "elf"), "and a miss is a miss");
});

// --- the wiring that stays in the component -------------------------------------------------
const TAB = readFileSync(join(here, "../src/lib/views/RomManagementTab.svelte"), "utf8");
/** One CSS rule's body, comments stripped first: a `}` inside a comment truncates the match. */
function ruleBody(selector) {
  const clean = TAB.replace(/\/\*[\s\S]*?\*\//g, "");
  const at = clean.indexOf(`${selector} {`);
  ok(at >= 0, `no \`${selector}\` rule in RomManagementTab.svelte`);
  const end = clean.indexOf("}", at);
  return clean.slice(at + selector.length + 2, end);
}

check("the tab asks the filter by ROW ID, and the star records the same thing", () => {
  // The pure rules above cannot see the component's wiring, and the wiring is where the bug
  // lived: `libraryFilter` was correct in isolation while the tab handed it a device path.
  // Found by mutating -- swapping the accessor back to `favoritePathFor(g)` left every other
  // check in this file green.
  ok(/rowIdOf: \(g: any\) => g\.key as string/.test(TAB),
    "rowAccess.rowIdOf must be the row key, not a device path");
  ok(/isFavorite: \(rowId: string\) => favorites\.has\(rowId\)/.test(TAB),
    "and isFavorite must ask the store the same way");
  // The star's own calls, so the two halves cannot drift apart again.
  ok(/favorites\.has\(g\.key\)/.test(TAB), "the star reads by row key");
  ok(/favorites\.toggle\(g\.key\)/.test(TAB), "and writes by row key");
});

check("BIOS has left the games list", () => {
  // "We should only have installable ROMs/Homebrew in the list." The rows are gone, and with
  // them the reason a row could be starless: every row in this list now has a real star.
  ok(!/\{#each biosRows as b/.test(TAB), "no BIOS rows are rendered in the list");
  // The CLASS and the RULE, not the word: a comment explaining why the gap went would otherwise
  // fail this, and the comment is worth keeping.
  ok(!/class="star-gap"/.test(TAB), "no row reserves the star column instead of having a star");
  ok(!/\.star-gap\s*[,{]/.test(TAB), "and the rule that styled it is gone with it");
});

check("the options modal has exactly ONE trigger", () => {
  // The dock's disclosure was removed because two controls opening one thing is the duplication
  // this redesign exists to remove. A second `optionsOpen = true` anywhere is that coming back.
  const opens = TAB.match(/optionsOpen = true/g) ?? [];
  eq(opens.length, 1, "exactly one place opens the options modal");
  ok(!/class="opts-toggle"/.test(TAB), "the dock's Additional options disclosure is gone");
  ok(/class="opts-btn"/.test(TAB), "and the info pane's button is the one that remains");
});

check("the body region can scroll under the pinned dock", () => {
  // test/panescroll.mjs's lesson, applied here. `.two-pane` sits above `.dock`, which is a later
  // in-flow sibling with an opaque background; if `.two-pane` can shrink below its content and
  // does not clip, that content spills UNDER the dock where nothing can reach it, and no gate in
  // this repo would see it. The 500px floor it used to carry is what pushed the column past the
  // pane and made the "pinned" bar scroll away with the page.
  const body = ruleBody(".two-pane");
  ok(/overflow-y:\s*auto/.test(body),
    "`.two-pane` must scroll itself, or its content hides behind the dock");
  ok(/min-height:\s*0/.test(body),
    "`.two-pane` must be able to give its slack back, or the dock cannot grow into it");
  ok(!/min-height:\s*\d*[1-9]\d*px/.test(body),
    "a pixel floor on `.two-pane` pushes the column past the pane and unpins the dock");
});

check("the body column runs to the bottom bar", () => {
  // The owner: the page-body/pagecol container stretches all the way down to the bottom bar.
  // What held it off was not a floor and not content failing to fill: `.seltable`'s only two
  // children are `.pagecol` and `.dock`, so its flex gap fell in exactly one place, and the dock
  // added a top margin on top of it. 1.6rem of space the body could never reach into.
  const seltable = ruleBody(".seltable");
  ok(/gap:\s*0\s*;/.test(seltable),
    "`.seltable`'s gap falls between the body column and the dock; any value holds the column off the bar");
  const dock = ruleBody(".dock");
  ok(!/margin-top:\s*[^0\s][^;]*;/.test(dock),
    "`.dock`'s top margin is the other half of that space");
  ok(/flex:\s*1 1 auto/.test(ruleBody(".pagecol")),
    "`.pagecol` must still grow into the height the gap gave back");
});

check("THE SUMMARY IS RAISED OVER THE BODY, NOT WEDGED INTO IT", () => {
  // The owner: opening the summary squeezed the carousel to nothing. The drawer is out of flow
  // now, so it contributes no height and the body keeps its size whether it is open or shut.
  const drawer = ruleBody(".drawer");
  ok(/position:\s*absolute/.test(drawer),
    "the drawer must leave the flow, or opening it shrinks the body again");
  // It anchored to `.dock`, whose top edge is the HANDLE's top -- so the panel stopped a
  // handle's height short of the bar and a band of page showed through. `.docktop` wraps the
  // handle and the drawer alone, so ITS bottom edge is the bar's top edge. See summarydrawer.mjs.
  ok(/bottom:\s*0\s*;/.test(drawer),
    "and sit on `.docktop`'s bottom edge, which is the bar's top edge, so no page shows between");
  ok(/position:\s*relative/.test(ruleBody(".docktop")),
    "`.docktop` must be the positioned ancestor, or the drawer anchors to `.dock` again");
});

check("the page behind it is darkened, on the dock's layer", () => {
  const dim = ruleBody(".dim");
  ok(/position:\s*absolute/.test(dim) && /inset:\s*0/.test(dim), "the scrim covers the body");
  ok(/z-index:\s*var\(--z-dock\)/.test(dim),
    "the scrim must take a layer from the scale in tokens.css, and the dock's is the right one");
  // "a little", not a modal scrim. ModalShell's own backdrop is 0.5; this must be lighter.
  const alpha = Number(dim.match(/rgba\(0,\s*0,\s*0,\s*([0-9.]+)\)/)?.[1]);
  ok(Number.isFinite(alpha), `no scrim colour found in .dim: ${dim}`);
  ok(alpha > 0 && alpha < 0.5, `the darkening is slight, not a modal scrim: got ${alpha}`);
});

check("the displacement machinery is GONE, not left inert", () => {
  // It was centring the carousel so it would ride up as the column shrank. Nothing shrinks now,
  // so the rule has no job; a layout rule that no longer fires is how the next reader is misled.
  ok(!/justify-content:\s*center/.test(ruleBody(".carousel-pane")),
    "the carousel centring existed only to produce the squeeze motion and should have gone with it");
  ok(!/\.star-gap/.test(TAB.slice(TAB.indexOf("{#each visibleGames"), TAB.indexOf("{#each unknownHomebrew"))),
    "no game row draws a gap any more: every row is starrable");
});

check("the pane is still the page's general scroller", () => {
  // ARMED: the fix above must not have been bought by clipping a tab. CLAUDE.md is explicit that
  // `overflow: hidden` on a pane/shell/page turns every tab from scrollable into clipped, and
  // that no gate detects it.
  const adv = readFileSync(join(here, "../src/lib/views/Advanced.svelte"), "utf8");
  const clean = adv.replace(/\/\*[\s\S]*?\*\//g, "");
  const at = clean.indexOf(".tabpane {");
  ok(at >= 0, "no `.tabpane` base rule; this check is looking in the wrong place");
  const base = clean.slice(at, clean.indexOf("}", at));
  ok(/overflow-y:\s*auto/.test(base), "`.tabpane` must keep its scroller");
  ok(!/overflow:\s*hidden/.test(base), "`.tabpane` must never clip");
});


// --- THE ORDER ------------------------------------------------------------------------------
// Four keys, a direction, a tiebreak, and where a row with no size goes. Each is a decision, and
// the list is the only place they show, which is why they live in a module a node suite can run.

/** A row shaped like the ones the tab assembles, and how this suite reads one. */
const ACC = {
  systemOf: (r) => r.system,
  nameOf: (r) => r.name,
  rowIdOf: (r) => r.key,
  sizeOf: (r) => r.size,
  actionOf: (r) => r.action,
};
const row = (key, system, name, size, action = "not installed") => ({ key, system, name, size, action });

check("each key orders the list, ascending", () => {
  const rows = [
    row("k1", "snes", "Zelda", 300),
    row("k2", "gb", "Mario", 100),
    row("k3", "nes", "Alpha", 200),
  ];
  eq(names(sortLibraryRows(rows, ACC, { key: "name", direction: "asc" })),
    ["Alpha", "Mario", "Zelda"], "by name");
  eq(sortLibraryRows(rows, ACC, { key: "system", direction: "asc" }).map((r) => r.system),
    ["gb", "nes", "snes"], "by system");
  eq(names(sortLibraryRows(rows, ACC, { key: "size", direction: "asc" })),
    ["Mario", "Alpha", "Zelda"], "by size");
});

check("and reverses on descending", () => {
  const rows = [
    row("k1", "snes", "Zelda", 300),
    row("k2", "gb", "Mario", 100),
    row("k3", "nes", "Alpha", 200),
  ];
  eq(names(sortLibraryRows(rows, ACC, { key: "name", direction: "desc" })),
    ["Zelda", "Mario", "Alpha"], "name, reversed");
  eq(sortLibraryRows(rows, ACC, { key: "system", direction: "desc" }).map((r) => r.system),
    ["snes", "nes", "gb"], "system, reversed");
  eq(names(sortLibraryRows(rows, ACC, { key: "size", direction: "desc" })),
    ["Zelda", "Alpha", "Mario"], "size, reversed");
});

check("A ROW WITH NO SIZE IS PINNED LAST, in BOTH directions", () => {
  // Not zero bytes: the list already draws it as an em dash, and a converter's output size is not
  // knowable before it runs. Ranking it as 0 would bury it ascending and crown it descending, and
  // both read as a measurement nobody made.
  const rows = [row("a", "gb", "Sized", 100), row("b", "gb", "Unsized", 0), row("c", "gb", "Big", 900)];
  eq(names(sortLibraryRows(rows, ACC, { key: "size", direction: "asc" })),
    ["Sized", "Big", "Unsized"], "ascending puts it last, not first");
  eq(names(sortLibraryRows(rows, ACC, { key: "size", direction: "desc" })),
    ["Big", "Sized", "Unsized"], "descending puts it last TOO, which a negated compare would not");
  ok(hasSize(1) && !hasSize(0), "hasSize is the test the list's own em dash uses");
});

check("the tiebreak is the name, then the row id", () => {
  // Sorting by system puts a whole console in one bucket; without a second key that bucket keeps
  // whatever order the scan produced, which is stable but meaningless to read.
  const rows = [row("k1", "gb", "Zelda", 1), row("k2", "gb", "Alpha", 2), row("k3", "gb", "Mario", 3)];
  eq(names(sortLibraryRows(rows, ACC, { key: "system", direction: "asc" })),
    ["Alpha", "Mario", "Zelda"], "one system, ordered by name inside it");
  // Two rows can share EVERYTHING the user sees: the same filename under two sources.
  const dup = [row("zzz", "gb", "Same", 5), row("aaa", "gb", "Same", 5)];
  eq(sortLibraryRows(dup, ACC, { key: "system", direction: "asc" }).map((r) => r.key),
    ["aaa", "zzz"], "identical rows still have a total order, so a re-render cannot swap them");
});

check("the tiebreak does NOT reverse with the direction", () => {
  // Reversing the direction reverses the key the user picked. Shuffling each bucket's contents as
  // well is motion they did not ask for.
  const rows = [row("k1", "gb", "Alpha", 1), row("k2", "gb", "Beta", 2), row("k3", "nes", "Gamma", 3)];
  eq(names(sortLibraryRows(rows, ACC, { key: "system", direction: "desc" })),
    ["Gamma", "Alpha", "Beta"], "nes first, and gb's own two still read A then B");
});

check("TEXT SORTS IN THE ACTIVE LOCALE, not in code-unit order", () => {
  // German puts an umlaut with its base letter; UTF-16 puts every accented character after every
  // ASCII one. `<` and a bare localeCompare() both get this wrong for fourteen of fifteen locales.
  const rows = [row("k1", "gb", "Zebra", 1), row("k2", "gb", "Ärger", 2)];
  eq(names(sortLibraryRows(rows, ACC, { key: "name", direction: "asc", locale: "de" })),
    ["Ärger", "Zebra"], "de");
  const byCodeUnit = [...rows].sort((a, b) => (a.name < b.name ? -1 : 1)).map((r) => r.name);
  ok(byCodeUnit[0] === "Zebra", "control: code-unit order really does differ here");
  // And numerically, so a run of sequels reads the way it is numbered.
  const nums = [row("a", "gb", "Sonic 10", 1), row("b", "gb", "Sonic 2", 2)];
  eq(names(sortLibraryRows(nums, ACC, { key: "name", direction: "asc" })),
    ["Sonic 2", "Sonic 10"], "numeric, so 10 follows 2");
});

check("THE ACTION KEY ORDERS BY THE ROW'S PROGRESS, not the alphabet", () => {
  const rows = ACTION_ORDER.map((a, i) => row(`k${i}`, "gb", `n${i}`, 1, a));
  const shuffled = [rows[6], rows[0], rows[3], rows[5], rows[1], rows[4], rows[2]];
  eq(sortLibraryRows(shuffled, ACC, { key: "action", direction: "asc" }).map((r) => r.action),
    [...ACTION_ORDER], "ascending runs from the most work left to already installed");
  const alpha = [...ACTION_ORDER].sort();
  ok(alpha.join() !== ACTION_ORDER.join(),
    "control: the lifecycle order is NOT the alphabetical one, so this check means something");
  ok(actionRank("something new") === ACTION_ORDER.length,
    "an unknown state sorts last rather than throwing, so a label added and forgotten degrades");
});

check("the action accessor is untouched unless the action key is chosen", () => {
  // LOAD-BEARING, not an optimisation: getActionState() reads the selection, `extracting`,
  // prepareState and the device homebrew list. Naming it on every sort would subscribe the list's
  // $derived to all of it, so every chip press would re-sort the whole library.
  let calls = 0;
  const counting = { ...ACC, actionOf: (r) => { calls++; return r.action; } };
  const rows = [row("k1", "gb", "A", 1), row("k2", "gb", "B", 2)];
  for (const key of ["name", "system", "size"]) sortLibraryRows(rows, counting, { key, direction: "asc" });
  eq(calls, 0, "the other three keys must never ask a row for its action");
  sortLibraryRows(rows, counting, { key: "action", direction: "asc" });
  ok(calls > 0, "control: the action key really does ask");
});

check("ordering does not mutate, and composes with the scopes rather than replacing them", () => {
  const rows = [row("k1", "gb", "Zelda", 3), row("k2", "nes", "Alpha", 1)];
  const before = rows.map((r) => r.key);
  sortLibraryRows(rows, ACC, { key: "name", direction: "asc" });
  eq(rows.map((r) => r.key), before, "the caller's array is left alone");
  // The tab filters, THEN orders. Ordering a filtered list must keep the filtering.
  const acc = { ...ACC, isFavorite: () => false };
  const filtered = filterLibraryRows(rows, acc, { consoleFilter: "gb", searchQuery: "" });
  const ordered = sortLibraryRows(filtered, ACC, { key: "name", direction: "asc" });
  eq(names(ordered), ["Zelda"], "the console scope survives being ordered");
});

check("the four keys are the ones the owner asked for", () => {
  eq([...LIBRARY_SORT_KEYS], ["system", "name", "size", "action"],
    "System, Filename, Size, and the action chip");
});

// --- the wiring -------------------------------------------------------------------------------

check("the list orders through the module, not with a bare compare of its own", () => {
  const body = TAB.slice(TAB.indexOf("const visibleGames"), TAB.indexOf("/** How the filter module"));
  ok(/sortLibraryRows\(/.test(body),
    "visibleGames does not call sortLibraryRows, so the rules above are not what the list uses");
  ok(!/list\.sort\(/.test(body),
    "visibleGames still sorts inline; that is the bare localeCompare this replaced");
  ok(/locale:\s*locale\.current/.test(body),
    "the active locale is not passed, so fourteen locales order by code unit");
});

check("every sort key reaches a label, and the direction is never a word", () => {
  const labels = TAB.slice(TAB.indexOf("function sortKeyLabel"), TAB.indexOf("function sortKeyLabel") + 600);
  for (const k of LIBRARY_SORT_KEYS) {
    ok(new RegExp(`case "${k}":`).test(labels), `sortKeyLabel has no case for ${k}`);
  }
  const markup = TAB.slice(TAB.indexOf('class="sortpick"'), TAB.indexOf("{#each visibleGames"));
  ok(/sortcaret/.test(markup), "the direction has no glyph");
  ok(!/sortAscending|sortDescending/.test(markup.replace(/aria-label=\{[\s\S]*?\}\n/, "")),
    "ascending/descending appear as visible text; the caret is the statement and those two strings are the accessible name only");
});

for (const f of failures) console.log(`  x ${f}`);
console.log(
  `library filter: ${failures.length ? `${failures.length} FAILED, ` : ""}${passed} checks passed`,
);
process.exit(failures.length ? 1 : 0);
