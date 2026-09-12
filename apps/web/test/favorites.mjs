// FAVORITES: we write a file the FIRMWARE owns.
//
// Retro-Go v2.0.0-rc2's `Core/Src/retro-go/rg_favorites.c` reads and rewrites
// `/data/favorites.txt` at runtime. Every assertion below is a property of THAT implementation,
// cited where it comes from, not a shape we chose. If the firmware changes, these fail, which is
// the point: a format we drift away from is a favorites list the launcher silently stops showing.
//
// Run: node test/favorites.mjs
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { pathToFileURL } from "node:url";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";

const here = dirname(fileURLToPath(import.meta.url));
const src = join(here, "../src/lib");

let failures = [];
let passed = 0;
const check = (name, fn) => {
  try {
    fn();
    passed++;
  } catch (e) {
    failures.push(`${name}: ${e.message}`);
  }
};
const eq = (a, b, what) => {
  if (a !== b) throw new Error(`${what}: got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`);
};
const ok = (v, what) => {
  if (!v) throw new Error(what);
};

// The module is `.svelte.ts` (runes), so it cannot be imported directly by node. Bundle it the
// way the other suites do, with the runes stubbed as identity - see CLAUDE.md: no node test here
// can prove reactivity, and none of these assertions try to.
const out = mkdtempSync(join(tmpdir(), "favs-"));
const esbuild = await import("esbuild");
await esbuild.build({
  entryPoints: [join(src, "favorites.svelte.ts")],
  outfile: join(out, "favorites.js"),
  bundle: true,
  format: "esm",
  platform: "neutral",
  target: "es2022",
  banner: { js: "const $state = (v) => v; const $derived = (v) => v;" },
  logLevel: "warning",
});
const {
  parseFavorites,
  serializeFavorites,
  mergeFavorites,
  isFavoritable,
  toDevicePath,
  FAVORITES_DEVICE_PATH,
} = await import(pathToFileURL(join(out, "favorites.js")).href);

// ---------------------------------------------------------------------------------------------
// 1. The file's shape, against `rg_favorites.c`.
// ---------------------------------------------------------------------------------------------

// `#define FAVORITES_FILE ODROID_BASE_PATH_CONFIG "/favorites.txt"`, and ODROID_BASE_PATH_CONFIG
// is `ODROID_BASE_PATH "/data"` with RG_STORAGE_ROOT empty (config.h:54-60).
check("the path is the firmware's, relative for our writers", () => {
  eq(FAVORITES_DEVICE_PATH, "data/favorites.txt", "the device path");
});

// `rg_favorites_add`: `fprintf(f, "%s\n", path)` - every line terminated, including the last.
check("every line is newline terminated, including the last", () => {
  eq(serializeFavorites(["/roms/nes/a.nes"]), "/roms/nes/a.nes\n", "one entry");
  eq(serializeFavorites(["/roms/nes/a.nes", "/homebrews/b.bin"]),
    "/roms/nes/a.nes\n/homebrews/b.bin\n", "two entries");
});

// An empty list is an empty file, not a stray newline: `rg_favorites_remove` writes nothing when
// every line is dropped.
check("an empty list is an empty file", () => {
  eq(serializeFavorites([]), "", "no entries");
});

// `read_favorite_line`: `buf[strcspn(buf, "\r\n")] = '\0'` - CR and LF both stripped, so a file
// written by a CRLF editor still parses. We write LF because the firmware does.
check("a CRLF file parses, and round-trips to LF", () => {
  const parsed = parseFavorites("/roms/nes/a.nes\r\n/homebrews/b.bin\r\n");
  eq(parsed.join("|"), "/roms/nes/a.nes|/homebrews/b.bin", "CRLF parsed");
  eq(serializeFavorites(parsed), "/roms/nes/a.nes\n/homebrews/b.bin\n", "written back as LF");
});

// `rg_favorites_remove` skips `line[0] == '\0'` while rewriting, so a blank line is not data.
check("blank lines are dropped, as the firmware's own rewrite drops them", () => {
  eq(parseFavorites("/roms/nes/a.nes\n\n\n/homebrews/b.bin\n").length, 2, "blank lines gone");
  eq(parseFavorites("").length, 0, "an empty file is no entries");
  eq(parseFavorites("\n\n").length, 0, "a file of blank lines is no entries");
});

// `strcmp(line, path) == 0` - exact, case sensitive. Two spellings are two favorites TO THE
// FIRMWARE, so normalising here would silently unstar one of them.
check("matching is exact and case sensitive, like strcmp", () => {
  const merged = mergeFavorites(["/roms/nes/A.nes"], ["/roms/nes/a.nes"], []);
  eq(merged.length, 2, "different case is a different entry");
});

// ---------------------------------------------------------------------------------------------
// 2. Merge, not replace. The device writes this file too.
// ---------------------------------------------------------------------------------------------

// This is the assertion that matters most: `favorites_fill_files` deliberately KEEPS a line it
// cannot resolve, "so an SD hiccup can't silently destroy the list". A replace would destroy
// exactly what that comment protects.
check("a line we do not understand survives untouched", () => {
  const existing = ["/roms/nes/keep.nes", "/roms/madeup/x.rom", "not-even-a-path"];
  const merged = mergeFavorites(existing, ["/homebrews/new.bin"], []);
  ok(merged.includes("/roms/madeup/x.rom"), "an unknown system survives");
  ok(merged.includes("not-even-a-path"), "an unparseable line survives");
  ok(merged.includes("/roms/nes/keep.nes"), "a known entry survives");
  ok(merged.includes("/homebrews/new.bin"), "the new star is added");
});

// `rg_favorites_add` is `if (rg_favorites_contains(path)) return true;` then append: the file is
// a set, and starring twice adds one line.
check("starring adds exactly one line, and starring twice adds none", () => {
  const once = mergeFavorites([], ["/roms/nes/a.nes"], []);
  eq(once.length, 1, "one star, one line");
  const again = mergeFavorites(once, ["/roms/nes/a.nes"], []);
  eq(again.length, 1, "starring an entry already present is a no-op");
});

check("unstarring removes exactly that line and leaves the rest", () => {
  const existing = ["/roms/nes/a.nes", "/roms/nes/b.nes", "/homebrews/c.bin"];
  const merged = mergeFavorites(existing, [], ["/roms/nes/b.nes"]);
  eq(merged.join("|"), "/roms/nes/a.nes|/homebrews/c.bin", "only the named entry left");
});

// Order is insertion order (append), and carries no meaning: `favorites_name_cmp` sorts the tab
// alphabetically before drawing. Asserted so a future "tidy the file" change is a deliberate one.
check("existing order is preserved and new entries append", () => {
  const merged = mergeFavorites(["/roms/nes/z.nes", "/roms/nes/a.nes"], ["/homebrews/m.bin"], []);
  eq(merged.join("|"), "/roms/nes/z.nes|/roms/nes/a.nes|/homebrews/m.bin", "append, no reorder");
});

check("unstarring wins over starring the same path in one merge", () => {
  eq(mergeFavorites(["/roms/nes/a.nes"], ["/roms/nes/a.nes"], ["/roms/nes/a.nes"]).length, 0,
    "the removal is applied");
});

// ---------------------------------------------------------------------------------------------
// 3. What the firmware can resolve. Mirrors `system_for_path`.
// ---------------------------------------------------------------------------------------------

check("a rom under a system resolves", () => {
  ok(isFavoritable("/roms/nes/mario.nes"), "/roms/<system>/<file>");
  ok(isFavoritable("/roms/gb/deep/nested.gb"), "a nested rom still names a system");
});

// `if (strncmp(path, hb_prefix, hb_prefix_len) == 0) return rg_emulators_system_for_dir("homebrew"...)`
// Homebrew IS representable - the directive that commissioned this assumed it might not be.
check("homebrew resolves, at /homebrews/", () => {
  ok(isFavoritable("/homebrews/OpenLara.bin"), "/homebrews/<file>");
});

// "Legacy /roms/homebrew/ - homebrews live at /homebrews/ only" returns NULL there, so an entry
// written under it is invisible on the device forever.
check("the legacy /roms/homebrew/ path is refused, as the firmware refuses it", () => {
  ok(!isFavoritable("/roms/homebrew/OpenLara.bin"), "/roms/homebrew is not resolvable");
});

check("a shape the firmware can never resolve is refused", () => {
  ok(!isFavoritable("roms/nes/a.nes"), "a relative path is not what the file holds");
  ok(!isFavoritable("/roms/a.nes"), "a rom with no system directory");
  ok(!isFavoritable("/roms/nes/"), "a directory, not a file");
  ok(!isFavoritable("/cores/gba.bin"), "a core is not launchable content");
  ok(!isFavoritable("/data/favorites.txt"), "the file itself");
  ok(!isFavoritable(""), "empty");
});

check("toDevicePath makes an installer key absolute, and leaves one that already is", () => {
  eq(toDevicePath("roms/nes/a.nes"), "/roms/nes/a.nes", "relative key");
  eq(toDevicePath("/roms/nes/a.nes"), "/roms/nes/a.nes", "already absolute");
});

// ---------------------------------------------------------------------------------------------
// 4. The wiring. The rules above are worthless if the app does not use them.
// ---------------------------------------------------------------------------------------------

const stripComments = (t) =>
  t.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "").replace(/<!--[\s\S]*?-->/g, "");
const tab = stripComments(readFileSync(join(src, "views/RomManagementTab.svelte"), "utf8"));

// EVERY row carries a star. This inverts a rule this file used to pin (`{#if favPath}`): the
// owner's model is that favouriting is a local act on a row and the FILE is the favourited-and-
// installed intersection, so a row with no device path is starrable and simply absent from the
// file. Anti-vacuity: the control itself must be found, or a deleted star would pass both arms.
check("EVERY row can be starred, not only one whose path resolves", () => {
  ok(/class="star \{starred \? 'on' : ''\}"/.test(tab), "the star control is drawn");
  ok(!/\{#if favPath\}/.test(tab), "and is not gated on a resolvable device path");
});

// The handler must star THAT row. Reading the body, not the call site: the same trap
// caught `removeOneFile` twice on this file (see mutation-verification-failure-modes).
// The argument is the ROW ID now, which is what the store keys on.
check("the control toggles that row", () => {
  ok(/favorites\.toggle\(g\.key\)/.test(tab), "toggle is called with the row's own id");
});

// The sync must MERGE. A check for "writes the file" would pass on a replace, which is the whole
// defect this guards. The resolver is the second argument: it turns a starred row id into the
// path the device will hold, and answering null is how a not-installed favourite stays out.
check("the sync folds into the card's existing file rather than replacing it", () => {
  // Anchored on the sync phase's own marker: `favorites.dirty` also appears in the substep
  // declaration hundreds of lines earlier, and a window from THAT one contains none of this.
  const i = tab.indexOf('subStart("write", "favorites")');
  ok(i > 0, "the favorites sync phase exists");
  ok(/if \(favorites\.dirty\) \{/.test(tab), "the phase is gated on there being something to write");
  const phase = tab.slice(i, i + 900);
  ok(/readTextFromDir\(sdHandle, FAVORITES_DEVICE_PATH\)/.test(phase),
    "the existing file is read before writing");
  ok(/favorites\.fileFor\(existing, favoriteWritePath\)/.test(phase),
    "the new contents are derived FROM the existing file, through the row-id resolver");
});

check("the file is left alone entirely when nothing was starred", () => {
  const i = tab.indexOf('subStart("write", "favorites")');
  const phase = tab.slice(i, i + 900);
  ok(/if \(next !== existing\)/.test(phase), "an unchanged file is not rewritten");
});

rmSync(out, { recursive: true, force: true });

if (failures.length > 0) {
  console.log(`favorites: ${passed} passed, ${failures.length} FAILED`);
  for (const f of failures) console.log(`  - ${f}`);
  process.exit(1);
}
console.log(`favorites: ${passed} checks passed`);
