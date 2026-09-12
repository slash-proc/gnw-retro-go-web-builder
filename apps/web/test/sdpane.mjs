/**
 * WHAT THE SD CARD'S PAGE ACTUALLY RENDERS IN EACH STATE.
 *
 *   docker compose exec dev sh -c 'cd /app/apps/web && node test/sdpane.mjs'
 *
 * WHY A RENDERING SUITE. Three static gates and twenty-odd targeted checks have passed in this
 * repo on components that did not work, because `svelte-check` type-checks and `vite build`
 * bundles and neither one ever draws the page. This compiles the REAL component with the REAL
 * Svelte compiler and reads what comes out.
 *
 * `SdCardPane` takes pure props and returns callbacks, so unlike `landingshift.mjs` this needs no
 * source rewriting to reach a state: the state IS an argument. That was the reason to build it
 * that way.
 *
 * WHAT IS PINNED, and why each one is a thing that can actually break:
 *
 *   - the unselected page draws NO red dot and NO Rescan, and the unreadable page draws both.
 *     Those two states share a shape and differ in what they claim: one says there is no card,
 *     the other says a card failed. A dot on the unselected page accuses a user who has picked
 *     nothing of a failure they did not commit.
 *   - a size the card has outgrown is DISABLED rather than absent, so the list's length does not
 *     depend on the card's contents.
 *   - the truncation sentence follows the cause the store reports. All three used to read as
 *     "too many files"; a deep tree and one unreadable file are not that.
 *   - the bar's sub-pixel floor takes its pixels from the FREE REMAINDER, never from a sibling
 *     bucket. Seven of nine buckets are under a third of a percent against a card-sized
 *     denominator, so without a floor they render as nothing, and floored against siblings the
 *     big buckets would understate. The whole error is put on the grey.
 *   - an EMPTY bucket gets no segment: the floor lifts what is small, never what is absent.
 *   - the buckets sort alphabetically by LABEL in the active locale with `Other` pinned last,
 *     checked in German, where `Sonstiges` would sort mid-list and `Bildschirmfotos` sorts
 *     before `BIOS`. A hardcoded English order looks arbitrary in fourteen languages.
 */
import { mkdtempSync, mkdirSync, rmSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import * as esbuild from "esbuild";
import { compile, compileModule } from "svelte/compiler";
import { render } from "svelte/server";

const here = new URL(".", import.meta.url).pathname;
const web = join(here, "..");
// CI installs from the repo root, so `apps/web/node_modules` may not exist; node still
// resolves the bundle's imports by walking up to the root install.
mkdirSync(join(web, "node_modules"), { recursive: true });
const out = mkdtempSync(join(web, "node_modules/.sdpane-"));

let passed = 0;
const failures = [];
const ok = (c, msg) => { passed++; if (!c) failures.push(msg); };
const eq = (a, b, msg) => {
  passed++;
  const x = JSON.stringify(a), y = JSON.stringify(b);
  if (x !== y) failures.push(`${msg}: got ${x}, want ${y}`);
};

const SRC = join(web, "src/lib/ui/SdCardPane.svelte");

/** The locale store reaches the whole i18n registry; the pane only needs a table and a code.
 *
 *  The table is emitted as SOURCE rather than JSON, because `JSON.stringify` silently drops every
 *  function and the interpolating strings (`freeOf`, `fileCount`, `truncEntries`) are functions.
 *  Dropping them does not fail quietly: the page throws on render. */
function localeStub(code, table) {
  const body = JSON.stringify(table, (_k, v) => (typeof v === "function" ? `__FN__${v}` : v))
    .replace(/"__FN__(.*?)"(?=[,}])/g, (_m, src) => JSON.parse(`"${src}"`));
  return `export const locale = { current: ${JSON.stringify(code)}, t: ${body} };`;
}

function sveltePlugin(stub) {
  return {
    name: "svelte-ssr",
    setup(b) {
      b.onResolve({ filter: /i18n\/locale\.svelte\.js$/ }, () => ({ path: "locale", namespace: "stub" }));
      b.onLoad({ filter: /.*/, namespace: "stub" }, () => ({ contents: stub, loader: "js" }));
      b.onLoad({ filter: /\.svelte$/ }, async (a) => {
        const fs = await import("node:fs/promises");
        const src = await fs.readFile(a.path, "utf8");
        return { contents: compile(src, { generate: "server", filename: a.path, runes: true }).js.code, loader: "js" };
      });
      b.onLoad({ filter: /\.svelte\.ts$/ }, async (a) => {
        const fs = await import("node:fs/promises");
        const js = (await esbuild.transform(await fs.readFile(a.path, "utf8"), { loader: "ts", target: "es2022" })).code;
        return { contents: compileModule(js, { generate: "server", filename: a.path }).js.code, loader: "js" };
      });
    },
  };
}

const { gnwResolve } = await import("./gnwResolve.mjs");

/** The real English table, lifted from the real file rather than restated here. */
function realTable(code) {
  const file = code === "en" ? "sources.ts" : `sources.${code}.ts`;
  const src = readFileSync(join(web, "src/lib/i18n/strings", file), "utf8");
  const m = src.match(/\n {2}sd: \{[\s\S]*?\n {2}\},/);
  if (!m) {
    console.error(`sd pane: could not lift the sd block from ${file}; this suite would be testing an invented table`);
    process.exit(1);
  }
  // Functions are not needed for the sort or the state checks; the strings are.
  const obj = {};
  for (const [, k, v] of m[0].matchAll(/^ {4}(\w+): "((?:[^"\\]|\\.)*)",$/gm)) {
    obj[k] = JSON.parse(`"${v}"`);
  }
  obj.freeOf = (f, c) => `${f} free of ${c}`;
  obj.fileCount = (n) => `${n} files`;
  obj.truncEntries = (l) => `TRUNC_ENTRIES_${l}`;
  return obj;
}

let seq = 0;
async function renderPane(code, props) {
  const table = {
    sources: {
      sd: realTable(code),
      folders: { fieldFolder: "Folder", noFolderChosen: "No folder chosen", choose: "Choose…" },
    },
    // `formatSize` (util.ts) routes its unit words through the locale, so the stub has to carry
    // them or every byte figure on the page throws. `geometry.freeSpace` is the word the
    // device's own geometry bars use for free space, which the pane reuses for the bar's free
    // segment rather than adding a second key for one fact.
    shared: {
      units: { space: " ", b: "B", kb: "KB", mb: "MB", gb: "GB" },
      geometry: { freeSpace: "Free Space" },
    },
  };
  // A fresh outdir per render: the stub differs per locale and esbuild would otherwise reuse it.
  const dir = join(out, `r${seq++}`);
  await esbuild.build({
    entryPoints: [SRC],
    outdir: dir, bundle: true, format: "esm", platform: "node", target: "es2022",
    external: ["svelte", "svelte/*"],
    plugins: [gnwResolve(join(here, ".")), sveltePlugin(localeStub(code, table))],
    logLevel: "error",
  });
  const C = (await import(pathToFileURL(join(dir, "SdCardPane.js")).href)).default;
  return render(C, {
    props: { onChoose: () => {}, onRescan: () => {}, onState: () => {}, stated: null, ...props },
  }).body;
}

const CATS = ["bios","covers","fonts","homebrew","language","roms","saves","screenshots","other"];
const zero = () => Object.fromEntries(CATS.map((c) => [c, 0]));
const readyState = (over = {}) => {
  const bytes = { ...zero(), ...(over.bytes ?? {}) };
  const files = { ...zero(), ...(over.files ?? {}) };
  return {
    kind: "ready",
    folderName: over.folderName ?? "GNW-SD",
    bytes, files,
    total: Object.values(bytes).reduce((a, b) => a + b, 0),
    truncated: over.truncatedBy != null,
    truncatedBy: over.truncatedBy ?? null,
  };
};

/** 32 GB after the partition gap, the FATs and the margin -- the board's own fixture. */
const STATED_32 = { folderName: "GNW-SD", nominalGB: 32 };

/* ARMED. Svelte appends a scope class inside the class attribute, so every selector here has to
   tolerate it. If this stops holding, the regexes above match nothing and every check built on
   them passes whatever the pane draws -- which is how a suite in this repo went vacuous before. */
{
  const probe = await renderPane("en", { state: readyState({ bytes: { roms: 1e9 } }), stated: STATED_32 });
  if (!/class="gseg sd-roms[^"]*"/.test(probe) || !/style="width:/.test(probe)) {
    console.error("sd pane: the scope-class shape changed; these selectors would match nothing and this suite cannot test what it claims to");
    process.exit(1);
  }
}


// --- 1. Unselected vs unreadable: same shape, different claim -----------------------------------
{
  const unsel = await renderPane("en", { state: { kind: "unavailable" } });
  const unread = await renderPane("en", { state: { kind: "unreadable", folderName: "GNW-SD" } });

  ok(!/class="dot/.test(unsel), "the unselected page draws NO status dot: a user who has picked nothing has not failed at anything");
  ok(/class="dot/.test(unread), "the unreadable page DOES draw the status dot");
  ok(unsel.includes("No folder chosen"), "the unselected page says no folder is chosen");
  ok(unsel.includes("Choose"), "the unselected page still offers the picker, so it is not a dead end");
  ok(!unsel.includes("Rescan"), "the unselected page offers NO Rescan: there is nothing to rescan");
  ok(unread.includes("Rescan"), "the unreadable page DOES offer Rescan");
  ok(unread.includes("GNW-SD"), "the unreadable page still names the card it cannot read");
  ok(!/class="gbar[^"]*"/.test(unsel) && !/class="gbar[^"]*"/.test(unread),
     "neither no-contents state draws the bar");
}

// --- 2. Every state carries the picker ---------------------------------------------------------
for (const [label, state] of [
  ["unselected", { kind: "unavailable" }],
  ["unknown", { kind: "unknown" }],
  ["unreadable", { kind: "unreadable", folderName: "GNW-SD" }],
  ["ready", readyState({ bytes: { roms: 1e9 } })],
]) {
  const html = await renderPane("en", { state, stated: STATED_32 });
  ok(html.includes("Choose"), `the ${label} state carries the picker that changes which card is selected`);
}

// --- 3. The capacity picker, and what it refuses -----------------------------------------------
{
  // 3.32 GB used: every size at or below 2 GB has been outgrown.
  const html = await renderPane("en", { state: readyState({ bytes: { roms: 3.32e9 } }) });
  const opts = [...html.matchAll(/<option value="(\d+)"([^>]*)>/g)].map(([, gb, rest]) => ({
    gb: Number(gb), disabled: /disabled/.test(rest),
  }));
  ok(opts.length >= 8, "every nominal size is offered");
  eq(opts.filter((o) => o.disabled).map((o) => o.gb), [2],
     "a size the card has ALREADY OUTGROWN is offered but disabled, so the list's length does not depend on the card's contents");
  ok(opts.some((o) => o.gb === 4 && !o.disabled), "a size that fits is selectable");
}

// --- 4. Truncation says which limit was hit ----------------------------------------------------
{
  const table = realTable("en");
  const byCause = {};
  for (const cause of ["entries", "depth", "file"]) {
    byCause[cause] = await renderPane("en", {
      state: readyState({ bytes: { roms: 1e9 }, truncatedBy: cause }),
    });
  }
  ok(byCause.entries.includes("TRUNC_ENTRIES_40000"),
     "the entries limit names itself and interpolates MAX_ENTRIES rather than hardcoding a second 40000");
  ok(byCause.depth.includes(table.truncDepth),
     "the DEPTH limit gets its own sentence, not the too-many-files one");
  ok(byCause.file.includes(table.truncFile),
     "one unreadable FILE gets its own sentence, not the too-many-files one");
  ok(!byCause.depth.includes("TRUNC_ENTRIES_"),
     "a deep tree is NOT reported as too many files");

  const clean = await renderPane("en", { state: readyState({ bytes: { roms: 1e9 } }) });
  ok(!clean.includes(table.files + "</dt>") || !/class="warn"/.test(clean),
     "a COMPLETE walk draws no warning row: a complete count needs no row at all");
}

// --- 5. The bar's floor, and where its cost is put ---------------------------------------------
{
  // ROMs huge, Language a single 4 KB file: Language is far under one pixel of 684.
  const html = await renderPane("en", {
    state: readyState({ bytes: { roms: 6e9, language: 4096 }, files: { roms: 400, language: 1 } }),
    stated: STATED_32,
  });
  const segs = [...html.matchAll(/class="gseg sd-(\w+)[^"]*"[^>]*width:\s*([\d.]+)%/g)]
    .map(([, cat, pct]) => ({ cat, pct: Number(pct) }));
  const free = html.match(/class="gseg free[^"]*"[^>]*width:\s*([\d.]+)%/);

  const byCat = Object.fromEntries(segs.map((s) => [s.cat, s.pct]));
  const floorPct = (2 / 684) * 100;
  ok(byCat.language !== undefined, "a sub-pixel bucket still gets a segment: it is never invisible");
  ok(Math.abs(byCat.language - floorPct) < 1e-9,
     `the sub-pixel bucket is drawn at the floor: got ${byCat.language}, want ${floorPct}`);

  // The load-bearing half: ROMs is drawn at its TRUE share, so the floor did not take from it.
  const usable = 31875268608; // 32 GB FAT32, from data/sdCapacity.json
  const romsTrue = (6e9 / usable) * 100;
  ok(Math.abs(byCat.roms - romsTrue) < 1e-6,
     `a bucket big enough to be drawn to scale IS drawn to scale, so the floor took its pixels from the FREE REMAINDER and not from a sibling: got ${byCat.roms}, want ${romsTrue}`);

  ok(free !== null, "the free remainder is drawn");
  const used = segs.reduce((n, s) => n + s.pct, 0);
  ok(Math.abs(used + Number(free[1]) - 100) < 1e-6,
     "the segments and the remainder account for the whole bar");

  // Empty buckets are absent, not floored.
  eq(segs.map((s) => s.cat).sort(), ["language", "roms"],
     "an EMPTY bucket gets no segment at all: the floor lifts the small, never the absent");
}

// --- 6. Alphabetical by LABEL in the active locale, Other pinned last ---------------------------
{
  const de = realTable("de");
  const html = await renderPane("de", {
    state: readyState({ bytes: Object.fromEntries(CATS.map((c) => [c, 1e6])) }),
    stated: STATED_32,
  });
  const drawn = [...html.matchAll(/class="swatch swatch-(\w+)[^"]*"/g)].map(([, c]) => c);
  const labels = Object.fromEntries(CATS.map((c) => [c, de["cat" + c[0].toUpperCase() + c.slice(1)]]));
  const want = CATS.filter((c) => c !== "other")
    .sort((a, b) => labels[a].localeCompare(labels[b], "de"))
    .concat("other");
  eq(drawn, want, "the buckets sort by their GERMAN labels with Other pinned last");
  ok(drawn.at(-1) === "other",
     `Sonstiges is pinned last rather than sorted into S: it is the catch-all, not a peer`);
  // The trap that makes this check worth having: German does NOT match the English order.
  const english = CATS.filter((c) => c !== "other").concat("other");
  ok(JSON.stringify(drawn) !== JSON.stringify(english),
     "the German order DIFFERS from the English one, so a hardcoded English array would be caught here");
}

// --- 7. Contents is a TABLE, in CachePane's idiom ----------------------------------------------
// The owner asked for the Cache view's shape by name and got a definition list. `CachePane` draws
// `.panel` > `.row` of name/count/size, closed by `.row.total`; this asserts the SD pane draws the
// same thing, and that it does NOT carry Cache's `.act` column, which exists there for a Clear
// action these rows have nothing to offer.
{
  const html = await renderPane("en", {
    state: readyState({ bytes: { roms: 2e9, covers: 3e6 }, files: { roms: 400, covers: 120 } }),
    stated: STATED_32,
  });
  ok(/class="panel[^"]*"/.test(html), "Contents is drawn in a panel, as CachePane draws it");
  const rows = [...html.matchAll(/class="row(?: total)?[^"]*"/g)].length;
  eq(rows, CATS.length + 1, "one row per bucket plus a total row");
  ok(/class="row total[^"]*"/.test(html), "the table closes with a total row, as CachePane does");
  ok(/class="name[^"]*"/.test(html) && /class="count[^"]*"/.test(html) && /class="size[^"]*"/.test(html),
     "each row carries a name, a file count and a size");
  ok(!/class="act[^"]*"/.test(html),
     "there is NO act column: Cache rows carry a Clear action and these have nothing to act on, " +
     "and a column existing only to match another page's grid is what UI_VOICE rules out");
  // The total row states both figures, so the table foots.
  ok(/class="row total[^"]*"[\s\S]{0,400}520 files/.test(html),
     "the total row counts every file, not just the bytes");
  // It is a TABLE, not the definition list it used to be. `dl` survives for the Card facts only.
  const contents = html.slice(html.indexOf("Contents"));
  ok(!/<dl/.test(contents), "the Contents section is no longer a definition list");
  ok(/<dl/.test(html), "the Card block keeps its definition list: Folder and Capacity are label/value pairs");
}

// --- 8. The bar is the shared primitive, not a second one --------------------------------------
// `GeometryBar size="slim"` is the same call DetailsPane makes for External flash, which is the
// card the board copies. The nine fills arrive on `GeoSegment.color` so this page's palette stays
// in tokens.css rather than adding nine rules to a primitive every Advanced pane shares.
{
  const html = await renderPane("en", { state: readyState({ bytes: { roms: 1e9 } }), stated: STATED_32 });
  ok(/class="gbar slim[^"]*"/.test(html), "the bar is GeometryBar's slim variant, the one DetailsPane draws");
  ok(/background:\s*var\(--sd-seg-roms\)/.test(html),
     "the bucket fill rides in on the segment, so the palette stays in tokens.css");
  const src = readFileSync(SRC, "utf8");
  ok(!/\.seg-\w+\s*\{/.test(src),
     "the pane declares no per-bucket segment rules of its own: that was the hand-rolled bar");
  ok(/GeometryBar/.test(src), "the pane imports the shared bar rather than rebuilding one");
}

// --- 9. Nothing states a filesystem any more ---------------------------------------------------
// exFAT beats FAT32 by less than the safety margin at every measured size, so the question could
// not change the figure. It is gone from the record, the pane and the string table.
{
  const html = await renderPane("en", { state: readyState({ bytes: { roms: 1e9 } }), stated: STATED_32 });
  ok(!/FAT32|exFAT/i.test(html), "the pane offers no filesystem control");
  const src = readFileSync(SRC, "utf8");
  ok(!/pickFilesystem|SD_FILESYSTEMS/.test(src), "the pane has no filesystem picker left in it");
  const en = readFileSync(join(web, "src/lib/i18n/strings/sources.ts"), "utf8");
  ok(!/^ {4}filesystem: /m.test(en), "the string table carries no filesystem label");
}

// --- 10. The folder gate asks for the card's SIZE ----------------------------------------------
// GatePrompt.dc.html draws it on the SD row: the moment the card is picked is the moment the user
// is holding it, and a stated size is the only denominator the card page will ever have. Source
// level, because the modal reaches the library and device stores rather than taking props.
{
  const modal = readFileSync(join(web, "src/lib/ui/FolderGateModal.svelte"), "utf8");
  ok(/SD_NOMINAL_SIZES_GB/.test(modal), "the modal offers the nominal sizes");
  ok(/saveStatedCard/.test(modal), "picking a size in the modal records it for this card");
  ok(/locale\.t\.sources\.sd\.capacity/.test(modal),
     "the modal reuses the card page's own word for this fact rather than adding a second key");
  // CODE, not comments. Both files explain in prose why the question is gone, so a bare match
  // found its own documentation and failed. Strip comments first and look at what is left.
  const code = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  ok(!/SD_FILESYSTEMS|FAT32|exFAT/.test(code(modal)),
     "the modal offers no filesystem control, and never did");
  // The size control belongs to the SD row, and only once a card is chosen: there is nothing to
  // state a size FOR before that.
  const sdRow = modal.slice(modal.indexOf("sdCardFolderTitle"));
  ok(/item-size/.test(sdRow), "the size sits on the SD row, not on the ROM folder row");
  // THE PLURAL PAIR IS GONE. `subtitleSingular`/`subtitlePlural` swapped on the ROW COUNT, which
  // is the antipattern UI_VOICE section 3 names by name. Both are deleted rather than merged.
  ok(!/subtitleSingular|subtitlePlural/.test(modal), "the modal draws no count-swapped subtitle");
  // The KEY, not the word: shared.ts documents by name why the pair was deleted, so this looks
  // for a definition (`subtitlePlural:`) rather than a mention.
  for (const f of ["shared.ts", "shared.de.ts", "shared.ja.ts", "shared.ar.ts"]) {
    const t = readFileSync(join(web, "src/lib/i18n/strings", f), "utf8");
    ok(!/^\s*subtitle(Singular|Plural)\s*:/m.test(t), `${f} defines no count-swapped subtitle key`);
  }
}

// --- 11. The SD pane is not a remote catalogue -------------------------------------------------
// `Sources.svelte` guarded its remote chrome with `!isLocal && !isCache`, two EXACT-ID tests, so
// `local-sd` matched neither and took the remote branch: `Update all`, `Add`, a `remoteKind` of
// `core` those buttons would have acted on, and a page titled `Homebrew` off the end of a title
// chain whose final else was that string. The fix is a positive fact about the pane, so this
// pins the fact and the places that must read it.
{
  const dir = join(out, "route");
  await esbuild.build({
    entryPoints: [join(web, "src/lib/sourcesRoute.ts")],
    outdir: dir, bundle: true, format: "esm", platform: "node", target: "es2022", logLevel: "error",
  });
  const route = await import(pathToFileURL(join(dir, "sourcesRoute.js")).href);

  eq(route.isRemotePane("local-sd"), false, "the SD card pane is not remote");
  eq(route.isRemotePane("local-directories"), false, "Directories is not remote");
  eq(route.isRemotePane("local-cache"), false, "Cache is not remote");
  eq(route.isRemotePane("remote-cores"), true, "Cores is remote");
  eq(route.isRemotePane("remote-homebrew"), true, "Homebrew is remote");
  // EVERY id, so a pane added later is covered by construction rather than by someone
  // remembering to extend a list at the call site. That is the whole point of the change.
  for (const id of route.SOURCE_PANE_IDS) {
    eq(route.isRemotePane(id), id.startsWith("remote-"),
       `${id}: remoteness follows the id's own group, not a list kept somewhere else`);
  }

  const src = readFileSync(join(web, "src/lib/views/Sources.svelte"), "utf8");
  // The two controls the owner saw.
  ok(!/\{#if !isLocal && !isCache\}/.test(src),
     "the remote chrome is no longer guarded by a list of exact local ids");
  ok(/\{#if isRemote && remoteKind\}/.test(src),
     "Update all and Add are drawn only where there IS a catalogue to update and add to");
  // The identity, which is the bigger half: a non-remote pane resolves NO kind at all, so
  // nothing downstream can read `core` for a card.
  ok(/!isRemotePane\(pane\) \? null/.test(src),
     "remoteKind is null off a remote pane rather than defaulting to core");
  ok(/\{:else if remoteKind\}/.test(src),
     "the remote list branch tests the kind, so a pane with no catalogue cannot land in it");
  // The title came off the end of a ternary chain; it now comes from the rail's own label.
  ok(/railGroups\.flatMap\(\(g\) => g\.items\)\.find\(\(i\) => i\.id === pane\)\?\.label/.test(src),
     "the page title is the rail's label for the mounted pane, not the last arm of a chain");
  ok(!/: t\.colHomebrew,\n?\s*\);/.test(src),
     "no title chain ends in Homebrew, which is what the SD page used to call itself");
  // The footer bar named a remote selection and offered remote actions on the SD page too.
  ok(/\{#if isCache \|\| isSd\}\{""\}/.test(src), "the bar names nothing on the SD page");
  ok(/class:strong=\{isRemote &&/.test(src), "the bar's selected-name styling is remote-only");
  ok(/\{#if isSd\}/.test(src), "the bar's actions have an SD branch rather than falling to the remote one");
}

rmSync(out, { recursive: true, force: true });
if (failures.length) {
  console.error(`sd pane: ${failures.length} FAILED of ${passed}`);
  for (const f of failures) console.error(`  ${f}`);
  process.exit(1);
}
console.log(`sd pane: ${passed} checks passed`);
