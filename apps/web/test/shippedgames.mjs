#!/usr/bin/env node
/**
 * A game the PROJECT ships is an ordinary ROM row.
 *
 *   docker compose exec dev sh -c 'cd /app/apps/web && node test/shippedgames.mjs'
 *
 * Doom's shareware episode has been redistributable since 1993, so a Doom core that ships it is
 * one a user can install and play owning nothing. `spec/07-cores.md` ("A project may ship a game
 * itself") calls `games[]` the ROM-folder counterpart of `bios[]`, and `spec/05-host.md` says
 * where it goes: `roms/<system id>/`, the folder the launcher browses, never `biosDir`.
 *
 * THE LINE THIS MUST NOT BLUR. A converter's INPUT is never copied to the device -- `Game.role`'s
 * `ingestable` exists for that, after `doom/doom.wad` once shipped beside the `.whd` it becomes.
 * A shipped game is the opposite: already the installable form, needing no input, no converter
 * and no prepare step. Both have to work at once, and neither may shadow the other.
 *
 * WHAT IS AND IS NOT COVERED. The row itself is assembled in a `$derived.by` on `romSelection`,
 * and these suites stub the runes (`$derived.by` returns `[]`), so node cannot evaluate it. The
 * pure rules below are driven for real; the reactive half is held by a source-level wiring
 * check, the same shape the favourites filter needed after a seam moved underneath it.
 */
import { mkdtempSync, readFileSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
let passed = 0;
const failures = [];
const check = async (name, fn) => {
  try { await fn(); passed++; } catch (e) { failures.push(`${name}: ${e.message}`); }
};
const ok = (c, m) => { if (!c) throw new Error(m); };
const eq = (a, b, m) => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${m}: got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`); };

const out = mkdtempSync(join(tmpdir(), "gnw-shipped-"));
symlinkSync(join(here, "../node_modules"), join(out, "node_modules"));
const esbuild = await import("esbuild");

const bundle = async (entry, name) => {
  await esbuild.build({
    entryPoints: [join(here, "../src/lib/sources/", entry)],
    outfile: join(out, name),
    bundle: true, format: "esm", platform: "neutral", target: "es2022", logLevel: "warning",
    define: { $state: "__rune", $derived: "__rune" },
    banner: { js: "const __rune = Object.assign((v) => v, { by: () => [] });" },
  });
  return import(pathToFileURL(join(out, name)).href);
};

const { buildCoreRegistry } = await bundle("coreRegistry.ts", "coreRegistry.js");
const { selectedPreparedAssets } = await bundle("selectedAssets.ts", "selectedAssets.js");

const MANIFEST_URL = "https://slash-proc.github.io/doom-retro-go-sd/dist/v0.2.0/manifest.json";

/** The shareware entry as the spec shapes it, and as Doom's own gwrg.json declares it. */
const SHAREWARE = {
  id: "shareware",
  filename: "Doom - Shareware.whd",
  url: "Doom - Shareware.whd",
  bytes: 4196020,
  sha256: "b".repeat(64),
  label: { en: "Doom (shareware episode)" },
};

function doomManifest(games = [SHAREWARE]) {
  return {
    schemaVersion: 1,
    project: "doom",
    title: "Doom",
    source: { repo: "slash-proc/doom-retro-go-sd", commit: "a".repeat(40), ref: "v0.2.0" },
    tools: [{
      id: "doom-whd",
      binary: { file: "doom_whd.wasm", url: "doom_whd.wasm", bytes: 678369, sha256: "c".repeat(64) },
      inputs: [{ id: "base", required: true, allowMultiple: true, runPerFile: true, maxCount: 32, extensions: [".wad"], strict: false }],
      outputs: [{ id: "whd", extension: ".whd", maxBytes: 25165824 }],
    }],
    targets: [{
      id: "gnw-retro-go", platform: "game-and-watch", kind: "core", label: "Game & Watch (Retro-Go SD)",
      requiresAbi: { version: 2, minSize: 832 },
      artifacts: [{ filename: "doom.bin", bytes: 319068, sha256: "d".repeat(64), url: "doom.bin" }],
      uses: [{ tool: "doom-whd", outputs: ["whd"], required: true }],
      systems: [{
        id: "doom", longName: "Doom", shortName: "Doom",
        extensions: [".whd"], browse: "file", compression: false,
        ...(games ? { games } : {}),
      }],
    }],
  };
}

const row = (manifest) => ({ repo: "slash-proc/doom-retro-go-sd", active: true, manifest });

// --- 1. The manifest half ----------------------------------------------------------------------

await check("a shipped game reaches the registry, keyed to the folder the launcher browses", async () => {
  const reg = buildCoreRegistry([row(doomManifest())]);
  const sys = reg.systems.find((s) => s.id === "doom");
  ok(sys, "the doom system did not register at all");
  eq(sys.shippedGames.map((g) => g.filename), ["Doom - Shareware.whd"], "the shipped game is carried");
  eq(`${sys.folder}/${sys.shippedGames[0].filename}`, "doom/Doom - Shareware.whd",
    "a shipped game installs to roms/<system id>/, so its key is <folder>/<filename>");
});

await check("a core that ships nothing carries an empty list, not undefined", async () => {
  const reg = buildCoreRegistry([row(doomManifest(null))]);
  const sys = reg.systems.find((s) => s.id === "doom");
  eq(sys.shippedGames, [], "absent games must read as none rather than crashing a consumer");
});

await check("two entries claiming one filename cannot both keep it", async () => {
  // One file per name on the card. The first declaration wins, as it does for a folder two
  // cores both declare; nothing here quietly renames the loser.
  const dup = { ...SHAREWARE, id: "shareware-copy" };
  const reg = buildCoreRegistry([row(doomManifest([SHAREWARE, dup]))]);
  const sys = reg.systems.find((s) => s.id === "doom");
  eq(sys.shippedGames.map((g) => g.id), ["shareware"], "the second claim on the name is dropped");
});

// --- 2. The parser's refusals ------------------------------------------------------------------

const { parseManifest } = await bundle("client.ts", "client.js");

await check("an entry with nothing to fetch is dropped, and the core still resolves", async () => {
  // spec/07: url, bytes and sha256 are REQUIRED, because an entry without them describes a game
  // the user already has -- and a game the user already has needs no manifest entry.
  const { url, ...noUrl } = SHAREWARE;
  const m = parseManifest(doomManifest([noUrl]), MANIFEST_URL);
  eq(m.targets[0].systems[0].games, undefined, "an unfetchable entry is not kept");
  eq(m.targets[0].artifacts.length, 1, "and the rest of the core is untouched");
});

await check("a filename that is a path is refused", async () => {
  // It BECOMES A PATH SEGMENT. A game called ../doom.bin must never reach a core directory.
  const escape = { ...SHAREWARE, filename: "../doom.bin" };
  const m = parseManifest(doomManifest([escape]), MANIFEST_URL);
  eq(m.targets[0].systems[0].games, undefined, "a traversing filename is dropped");
});

await check("the url is resolved against the manifest", async () => {
  const m = parseManifest(doomManifest(), MANIFEST_URL);
  // Percent-encoded, because that is what a fetch needs: the space in "Doom - Shareware.whd" is
  // legal in a FAT filename and not in a URL path. The filename the file TAKES on the card is
  // unaffected -- that comes from `filename`, which is never URL-encoded.
  eq(m.targets[0].systems[0].games[0].url,
    "https://slash-proc.github.io/doom-retro-go-sd/dist/v0.2.0/Doom%20-%20Shareware.whd",
    "a published filename must become an absolute URL, as an artifact's does");
  eq(m.targets[0].systems[0].games[0].filename, "Doom - Shareware.whd",
    "and the on-card name keeps its spaces");
});

// --- 3. Selection: a shipped game is a ROM, not a core binary ----------------------------------

const SHIPPED_KEY = "doom/Doom - Shareware.whd";
const CORE_KEY = "cores/doom.bin";

function assetSel({ selectedRowKeys = new Set(), shippedGameKeys = new Set([SHIPPED_KEY]) } = {}) {
  return {
    assets: new Map([[SHIPPED_KEY, new Uint8Array([1])], [CORE_KEY, new Uint8Array([2])]]),
    sourceOf: () => "artifact",
    producedBy: () => [],
    rows: [],
    selectedRowKeys,
    selectedTitleKeys: new Set(),
    shippedGameKeys,
  };
}

await check("a shipped game whose row is cleared does NOT install", async () => {
  const got = selectedPreparedAssets(assetSel({ selectedRowKeys: new Set() }));
  ok(!got.has(SHIPPED_KEY), "a ROM the user deselected must not be written anyway");
});

await check("a shipped game whose row is selected DOES install", async () => {
  const got = selectedPreparedAssets(assetSel({ selectedRowKeys: new Set([SHIPPED_KEY]) }));
  ok(got.has(SHIPPED_KEY), "a selected row must reach the install map");
});

await check("the core's own binary is NOT gated on a row", async () => {
  // ARMED: this is what separates the new rule from a blanket change to artifact handling. The
  // packer governs core files (`installAllCores`, `selectedHomebrew`); rows do not.
  const got = selectedPreparedAssets(assetSel({ selectedRowKeys: new Set() }));
  ok(got.has(CORE_KEY), "gating every artifact on a row would strand the core binary");
});

// --- 4. The WAD path is undisturbed ------------------------------------------------------------

const { buildGameRows } = await bundle("gameRows.ts", "gameRows.js");

await check("a user's WAD still pairs with its output and is still never copied", async () => {
  const entries = [
    { key: "doom/DOOM.WAD", system: "doom", name: "DOOM.WAD", size: 12996515, role: "ingestable" },
    { key: "doom/The Ultimate Doom.whd", system: "doom", name: "The Ultimate Doom.whd", size: 12702921, role: "installable" },
  ];
  const rows = buildGameRows(entries, () => ".whd", () => ({ variantFilename: "The Ultimate Doom.whd" }));
  eq(rows.length, 1, "the wad and the whd are ONE row, before and after conversion");
  eq(rows[0].key, "doom/DOOM.WAD", "and the row is keyed by the INPUT, which is never copied");
});

await check("a shipped game standing alone is its own installable row", async () => {
  // No input exists, so gameRows keys it by the installable file -- the ordinary-ROM case.
  const entries = [
    { key: SHIPPED_KEY, system: "doom", name: "Doom - Shareware.whd", size: 4196020, role: "installable" },
  ];
  const rows = buildGameRows(entries, () => ".whd", () => undefined);
  eq(rows.length, 1, "one row");
  eq(rows[0].key, SHIPPED_KEY, "keyed by the installable file, needing no prepare");
});

await check("converting the same WAD absorbs the shipped copy instead of doubling it", async () => {
  // Doom's shareware entry deliberately takes the SAME filename its variants table gives that
  // dump, so a user converting the shareware WAD overwrites the shipped copy. Two rows here
  // would be the user seeing their own game twice.
  const entries = [
    { key: "doom/DOOM1.WAD", system: "doom", name: "DOOM1.WAD", size: 4196020, role: "ingestable" },
    { key: SHIPPED_KEY, system: "doom", name: "Doom - Shareware.whd", size: 4196020, role: "installable" },
  ];
  const rows = buildGameRows(entries, () => ".whd", () => ({ variantFilename: "Doom - Shareware.whd" }));
  eq(rows.length, 1, "one game, not two");
  eq(rows[0].key, "doom/DOOM1.WAD", "the user's own input owns the row");
});

// --- 5. The wiring node cannot execute ---------------------------------------------------------

await check("romSelection contributes shipped games, and the user's own copy wins", async () => {
  // `games` is a `$derived.by`, stubbed in this bundle, so the rule is pinned at the source.
  // Comments are stripped first: a note must not vouch for the code.
  const src = readFileSync(join(here, "../src/lib/romSelection.svelte.ts"), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  ok(/for \(const sys of coreRegistry\.current\.systems\)/.test(src),
    "romSelection no longer reads shipped games off the registry, so no row can appear for one");
  ok(/sys\.shippedGames/.test(src), "the shipped list is not consulted");
  ok(/if \(byKey\.has\(key\)\) continue;/.test(src),
    "a shipped game must not overwrite the user's own file of the same name");
});

await check("the install pass fetches them, gated on the row", async () => {
  const tab = readFileSync(join(here, "../src/lib/views/RomManagementTab.svelte"), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "");
  ok(/prepareState\.prepareShippedGames\(/.test(tab),
    "nothing fetches a shipped game, so a selected row would install nothing");
  ok(/shippedGameKeys: shippedGameKeys\(\)/.test(tab),
    "the selector is not told which keys are shipped games, so they install unconditionally");
});

// --- 6. The PROJECTION sees them too -----------------------------------------------------------
//
// The bug: `prepareShippedGames` had one caller, inside `ensureCoresPrepared`, which runs only in
// `runInstall`/`doSdSync`. `buildPreview` never fetched, and `selectedPreparedAssets` iterates
// `prepareState.assets` -- a key absent from that map contributes nothing at all. So selecting the
// shareware episode moved the net change by zero, its 4,196,020 bytes landing in NONE of the three
// provenance buckets rather than in a wrong one.

await check("a selected shipped game contributes its bytes once they are held", async () => {
  // The state the preview must reach. Absent bytes are not a zero-sized entry, they are no entry,
  // which is why the projection could not see the game at all.
  const before = selectedPreparedAssets(assetSel({ selectedRowKeys: new Set([SHIPPED_KEY]) }));
  const total = (m) => [...m.values()].reduce((a, d) => a + d.length, 0);
  ok(before.has(SHIPPED_KEY), "a selected shipped game must reach the map once prepared");

  const unprepared = selectedPreparedAssets({
    ...assetSel({ selectedRowKeys: new Set([SHIPPED_KEY]) }),
    assets: new Map([[CORE_KEY, new Uint8Array([2])]]), // nothing fetched the game yet
  });
  ok(!unprepared.has(SHIPPED_KEY), "unfetched bytes cannot be counted, so the preview must fetch");
  eq(total(before) - total(unprepared), 1, "the whole of the game's bytes are what the preview missed");
});

await check("THE REPORTED CASE: the preview fetches a selected shipped game before it builds", async () => {
  // Comments stripped first: a note must not vouch for the code. The call has to sit inside
  // `buildPreview`, before the image is built -- its presence anywhere in the file is what the
  // install-path check above already tests, and that passed throughout the bug.
  const tab = readFileSync(join(here, "../src/lib/views/RomManagementTab.svelte"), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  const start = tab.indexOf("async function buildPreview");
  ok(start > 0, "buildPreview is gone or renamed; this check no longer guards anything");
  const body = tab.slice(start, tab.indexOf("\n  async function", start + 10));
  ok(/prepareShippedGames\(/.test(body),
    "buildPreview does not fetch shipped games, so a selected one moves the net change by nothing");
  ok(body.indexOf("prepareShippedGames(") < body.indexOf("buildFrogfsImage("),
    "the fetch must precede the build, or the image is packed from bytes that arrived too late");
});

await check("the preview fetches only games whose row is selected", async () => {
  const tab = readFileSync(join(here, "../src/lib/views/RomManagementTab.svelte"), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  const start = tab.indexOf("function selectedShippedGameFetches");
  ok(start > 0, "the fetch list is gone; the preview would fetch every shipped game on sight");
  const body = tab.slice(start, start + 600);
  ok(/romSelection\.selectedKeys\.has\(key\)/.test(body),
    "the list is not gated on the selection, so an unwanted game is downloaded anyway");
  ok(/preparedBytesFor\(key\) !== undefined/.test(body),
    "a game already held would be refetched on every preview rebuild");
});

for (const f of failures) console.log(`  x ${f}`);
console.log(`shipped games: ${failures.length ? `${failures.length} FAILED, ` : ""}${passed} checks passed`);
process.exit(failures.length ? 1 : 0);
