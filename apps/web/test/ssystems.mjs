#!/usr/bin/env node
/**
 * Which ScreenScraper systems a Retro-Go ROM folder means.
 *
 *   docker compose exec dev sh -c 'cd /app/apps/web && node test/ssystems.mjs'
 *
 * `systemMap.js` replaced `SS_SYSTEM_MAP`, a hand-written table inherited verbatim from
 * CoverStudio. `systemIdsFor` returns `[]` for anything absent, and an empty list means no cover
 * can ever be scraped for that console, silently: `gba` and `tama` were missing, so the Library
 * listed the games and the scraper had nowhere to ask. Nothing failed.
 *
 * NO NETWORK AND NO FIXTURE. The resolver is pure over the committed snapshot (`systems.json`,
 * refreshed only by `scripts/fetch-ss-systems.mjs`), so this suite reads the same file the app
 * does. `ssSystems.mjs` covers the snapshot and its reader; this covers the policy on top.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const here = dirname(fileURLToPath(import.meta.url));
let passed = 0;
const failures = [];
const check = (name, fn) => { try { fn(); passed++; } catch (e) { failures.push(`${name}: ${e.message}`); } };
const ok = (c, m) => { if (!c) throw new Error(m); };
const eq = (a, b, m) => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${m}: got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`); };

// Bundled rather than imported: it pulls in the JSON snapshot through systems.js.
const bundled = await build({
  entryPoints: [join(here, "../src/lib/screenscraper/systemMap.js")],
  bundle: true, write: false, format: "esm", platform: "neutral", loader: { ".json": "json" },
});
const mod = await import("data:text/javascript;base64," + Buffer.from(bundled.outputFiles[0].text).toString("base64"));
const { systemIdsFor, systemSourceFor, isKnownSystemFolder, allSystems, RETRO_GO_SYSTEMS } = mod;

const snapshot = JSON.parse(readFileSync(join(here, "../src/lib/screenscraper/systems.json"), "utf8"));

check("the snapshot is the real list, not a stub", () => {
  // ARMED. Every check below would pass vacuously against three hand-picked systems.
  ok(snapshot.length >= 200, `the snapshot holds ${snapshot.length} systems; a real capture is ~250`);
  ok(snapshot.filter((s) => s.shortcodes.length).length >= 150,
    "almost nothing carries a shortcode, so the shortcode rule cannot be under test");
});

check("the bug that started this: gba and tama resolve", () => {
  eq(systemIdsFor("gba"), [12], "Game Boy Advance");
  eq(systemIdsFor("tama"), [293], "Tamagotchi");
});

check("every console folder the Library classifies can be scraped", () => {
  // The guarantee that would have caught the original bug. A folder the Library accepts but the
  // scraper cannot map is a game that can never get a cover, and nothing else says so.
  const sel = readFileSync(join(here, "../src/lib/romSelection.svelte.ts"), "utf8");
  const at = sel.indexOf("CONSOLE_WHITELISTS");
  ok(at >= 0, "no CONSOLE_WHITELISTS table found");
  const folders = [...sel.slice(at).matchAll(/^\s*([a-z0-9]+):\s*new Set/gm)].map((m) => m[1]);
  ok(folders.length > 10, `only ${folders.length} folders parsed; that table changed shape`);
  const unresolved = folders.filter((f) => systemIdsFor(f).length === 0);
  eq(unresolved, [], "console folders with no ScreenScraper system; their games can never get a cover");
});

check("a folder ScreenScraper already names needs no alias", () => {
  // The dynamic half, and the actual win: a new core whose folder matches Recalbox naming works
  // with no edit to the alias table at all.
  for (const f of ["gba", "gw", "pico8", "videopac"]) {
    eq(systemSourceFor(f), "shortcode", `${f} should resolve from the snapshot's own shortcodes`);
    ok(!(f in RETRO_GO_SYSTEMS), `${f} must not need an alias entry`);
  }
});

check("ordered candidate lists survive, because the snapshot cannot express them", () => {
  // `systemIdsFor` returns candidates TRIED IN ORDER. A gb folder routinely holds GBC games and
  // an msx folder is more often MSX2 than MSX1; ScreenScraper has no opinion about either.
  eq(systemIdsFor("gb"), [9, 10], "Game Boy first, Game Boy Color as the fallback");
  eq(systemIdsFor("gbc"), [10, 9], "and the reverse for a gbc folder");
  eq(systemIdsFor("msx"), [116, 113, 117, 118], "MSX2, MSX, MSX2+, MSX Turbo R, in that order");
});

check("an accessory is not a console a ROM folder means", () => {
  // Every extra candidate costs a ScreenScraper request per ROM that misses, against a quota.
  //
  // Tested on a SHORTCODE-resolved folder, the only path the filter is on. `gb` looks like the
  // obvious case (Super Game Boy 127 and 128 both claim it) but `gb` is an alias, and the alias
  // path resolves by NAME and so never sees an accessory anyway: asserting there passed whether
  // or not the filter existed. A mutation caught that, not this file's first draft.
  const amiga = systemIdsFor("amiga");
  ok(amiga.length > 0, "amiga should resolve by shortcode");
  eq(systemSourceFor("amiga"), "shortcode", "this check is only meaningful on the shortcode path");
  const cd = snapshot.find((s) => s.id === 134);
  ok(cd && cd.type === "Accessory" && cd.shortcodes.includes("amiga"),
    "the snapshot no longer has an accessory claiming the amiga shortcode, so this proves nothing");
  ok(!amiga.includes(134), `Amiga CD (an Accessory) leaked into amiga: ${JSON.stringify(amiga)}`);
});

check("arcade resolves to the umbrella, not to a manufacturer", () => {
  // ~55 systems publish the identical arcade/mame/fba shortcodes because ScreenScraper splits
  // arcade by MANUFACTURER. No shortcode can disambiguate them, so the umbrella must lead or an
  // arcade folder scrapes against whichever manufacturer happened to sort first.
  const ids = systemIdsFor("arcade");
  ok(ids.length > 10, `arcade should resolve to many systems, got ${ids.length}`);
  const mame = snapshot.find((s) => s.name === "Mame");
  ok(mame, "the snapshot has no Mame entry, so this proves nothing");
  eq(ids[0], mame.id, "Mame must be the first candidate for an arcade folder");
});

check("the hand-written part is ALIASES ONLY, never ids", () => {
  // The whole claim of this change. An id here would mean the table had quietly grown back.
  for (const [folder, terms] of Object.entries(RETRO_GO_SYSTEMS)) {
    ok(Array.isArray(terms), `${folder} must map to a list of lookup terms`);
    for (const t of terms) {
      ok(typeof t === "string", `${folder}: ${JSON.stringify(t)} is not a name`);
      ok(!/^\d+$/.test(t.trim()), `${folder}: "${t}" is a raw systemeid; aliases must name a system`);
    }
  }
});

check("an alias names something the snapshot actually has", () => {
  // A typo in the alias table is otherwise invisible: the folder silently stops resolving.
  const dead = Object.entries(RETRO_GO_SYSTEMS)
    .filter(([folder]) => systemIdsFor(folder).length === 0)
    .map(([folder, terms]) => `${folder} -> ${terms.join(", ")}`);
  eq(dead, [], "these aliases resolve to nothing");
});

check("a core's pseudo-console is NOT hardcoded to a platform", () => {
  // `doom/` is the Doom core's ingest folder, not a console's. ScreenScraper has no `doom`
  // platform; DOOM the game lives under PC Dos (135). Adding `doom: 135` here was proposed and
  // the owner rejected it: "don't hard code it. we need to derive it."
  //
  // There is nothing to derive it FROM yet. `originalSystem` is the manifest's provenance field
  // and looks like the answer, but `spec/03-manifest.md` makes it homebrew-only by design -- "a
  // core has no such gap: a ROM lives under roms/<system>/ and its core declares systems[]" --
  // and declaring it on a manifest with no homebrew target is an upstream warning. The core
  // declares `{"id":"doom","extensions":[".whd"]}`, which carries no link to PC Dos.
  //
  // So this is blocked on a spec decision, not on code, and until then the scraper's own
  // "Unknown system for doom.wad (folder 'doom')" is the correct answer. If the spec gains a
  // per-system art hint, this check is what to update -- deliberately, naming the new field.
  eq(systemIdsFor("doom"), [], "doom must not resolve until a manifest field can say why it does");
  ok(!("doom" in RETRO_GO_SYSTEMS), "doom is a pseudo-console; an alias here is the hardcode that was rejected");
});

check("an unknown folder still answers with an empty list", () => {
  eq(systemIdsFor("not-a-console"), [], "unchanged contract for an unmapped folder");
  eq(systemSourceFor("not-a-console"), "none", "and it says so");
  eq(systemIdsFor(""), [], "an empty shortcode is not a lookup");
  eq(isKnownSystemFolder("not-a-console"), false, "and the scanner's predicate agrees");
  eq(isKnownSystemFolder("gba"), true, "while a real one is known");
});

check("the picker list is the whole snapshot, sorted", () => {
  const list = allSystems();
  ok(list.length >= 200, `the picker shows ${list.length} systems; it should be the whole list`);
  ok(list.some((s) => s.id === 12 && s.name === "Game Boy Advance"), "GBA is in the picker");
  const names = list.map((s) => s.name);
  eq(names, names.slice().sort((a, b) => a.localeCompare(b)), "sorted by name");
});

check("no id table survives in config.js", () => {
  const cfg = readFileSync(join(here, "../src/lib/screenscraper/config.js"), "utf8");
  ok(!/SS_SYSTEM_MAP\s*=/.test(cfg), "SS_SYSTEM_MAP is back as a hand-written table");
  ok(/from "\.\/systemMap\.js"/.test(cfg), "config.js no longer delegates to the resolver");
});

check("the resolver stays pure: no network, no credentials, no storage", () => {
  // `systems.js` has its own guard against this. The policy layer needs the same one, or the
  // fetch-and-cache design this replaced could reappear one import at a time -- which is exactly
  // what the first draft of this change did before the snapshot existed.
  const src = readFileSync(join(here, "../src/lib/screenscraper/systemMap.js"), "utf8");
  ok(!/\bfetch\s*\(/.test(src), "systemMap.js must not talk to the network");
  ok(!/devCreds/.test(src), "systemMap.js must not touch credentials");
  ok(!/localStorage/.test(src), "systemMap.js must not cache; the snapshot is the source");
});

for (const f of failures) console.log(`  x ${f}`);
console.log(`ss system map: ${failures.length ? `${failures.length} FAILED, ` : ""}${passed} checks passed`);
process.exit(failures.length ? 1 : 0);
