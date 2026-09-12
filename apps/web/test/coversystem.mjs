#!/usr/bin/env node
/**
 * Which platform's cover art a game row belongs to.
 *
 *   docker compose exec dev sh -c 'cd /app/apps/web && node test/coversystem.mjs'
 *
 * Scraping a cover for Doom reported `[?] Unknown system for doom.wad (folder 'doom')`. `doom/`
 * is the Doom CORE's ingest folder; ScreenScraper has no `doom` platform and DOOM the game lives
 * under PC Dos (135), so the folder name could never answer. The owner's ruling on adding
 * `doom: 135` to the ScreenScraper map: "don't hard code it. we need to derive it."
 *
 * What it derives from is the manifest's TOP-LEVEL `originalSystem`, resolved through
 * ScreenScraper's own published shortcodes. THE POINT OF THE DESIGN, and the first check below:
 * a manifest saying `"dos"` reaches systemeid 135 with no entry in any local table.
 *
 * The real resolver is used, and so is the real ScreenScraper snapshot. Only the manifest is a
 * fixture, because the published Doom manifest does NOT carry the field yet -- which is itself
 * a case under test.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const here = dirname(fileURLToPath(import.meta.url));
let passed = 0;
const failures = [];
// AWAITS. A synchronous version counted an async check as passed the moment its promise was
// created, so every failure inside one was swallowed: three mutations of the ladder reported
// green against code with the rung deleted. This is the SECOND file in which that bug appeared;
// if you add a check here, it is async-safe either way.
const check = async (name, fn) => {
  try { await fn(); passed++; } catch (e) { failures.push(`${name}: ${e.message}`); }
};
const ok = (c, m) => { if (!c) throw new Error(m); };
const eq = (a, b, m) => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${m}: got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`); };

const bundleOf = async (rel) => {
  const out = await build({
    entryPoints: [join(here, rel)], bundle: true, write: false, format: "esm",
    platform: "neutral", loader: { ".json": "json" },
  });
  return import("data:text/javascript;base64," + Buffer.from(out.outputFiles[0].text).toString("base64"));
};

const { coverSystemFor } = await bundleOf("../src/lib/sources/coverSystem.ts");
// The REAL folder predicate and the REAL id lookup, over the committed snapshot. Stubbing these
// would leave the composition -- manifest word to ScreenScraper id -- untested, and that
// composition is the entire design.
const { isKnownSystemFolder, systemIdsFor } = await bundleOf("../src/lib/screenscraper/systemMap.js");

// A core that owns `doom/`, shaped like `coreRegistry.current.systems` and `homebrew.titles`.
const DOOM_SYSTEMS = [{ folder: "doom", targetKey: "sylverb/doom-retro-go-sd#gnw-retro-go" }];
const withOriginal = (v) => [
  { key: "sylverb/doom-retro-go-sd#gnw-retro-go", ...(v ? { originalSystem: v } : {}) },
];

await check("a manifest naming a platform ScreenScraper publishes needs NO local table", () => {
  // The whole point. `dos` is one of system 135's own shortcodes, so the manifest word reaches
  // the id with nothing hand-written anywhere in this repo.
  const got = coverSystemFor("doom/doom.wad", DOOM_SYSTEMS, withOriginal("dos"), isKnownSystemFolder);
  eq(got.kind, "manifest", "a core-owned folder with a stated originalSystem");
  eq(got.system, "dos", "the manifest's own word, not a translation of it");
  eq(systemIdsFor(got.system), [135], "which resolves to PC Dos through the snapshot");

  // ARMED: prove the id did not come from a local alias, which would make this check a tautology.
  const map = readFileSync(join(here, "../src/lib/screenscraper/systemMap.js"), "utf8");
  const table = map.slice(map.indexOf("RETRO_GO_SYSTEMS"), map.indexOf("};", map.indexOf("RETRO_GO_SYSTEMS")));
  ok(!/\bdos\b/.test(table), "`dos` is in the alias table, so this proves nothing about deriving");
  ok(!/\bdoom\b/.test(table), "`doom` is in the alias table, which is the hardcode that was rejected");
  const snap = JSON.parse(readFileSync(join(here, "../src/lib/screenscraper/systems.json"), "utf8"));
  const pcdos = snap.find((s) => s.id === 135);
  ok(pcdos && pcdos.shortcodes.includes("dos"),
    "the snapshot no longer publishes `dos` for 135, so this proves nothing");
});

await check("absent originalSystem is reported, never guessed", () => {
  // Today's real Doom manifest. A name-based search on a converter's output is a guess we are
  // not willing to make, so this must be a stated outcome and not a silent fallback.
  const got = coverSystemFor("doom/doom.wad", DOOM_SYSTEMS, withOriginal(null), isKnownSystemFolder);
  eq(got.kind, "unstated", "a core-owned folder with no originalSystem");
  eq(got.titleKey, "sylverb/doom-retro-go-sd#gnw-retro-go", "and it names who should publish it");
});

await check("a real console folder still answers for itself", () => {
  // Checked BEFORE the manifest, so a core publishing a converter for an existing console cannot
  // redirect that console's ROMs at its own provenance.
  for (const [key, folder] of [["gb/Tetris.gb", "gb"], ["gba/Pokemon.gba", "gba"], ["snes/Mario.sfc", "snes"]]) {
    const got = coverSystemFor(key, [], [], isKnownSystemFolder);
    eq(got.kind, "folder", `${folder} names a console`);
    eq(got.system, folder, "and is used as-is");
  }
});

await check("a console folder a core also owns is NOT redirected", () => {
  // The regression this ordering prevents: a core with a converter for `snes` declaring its own
  // provenance must not make every SNES ROM scrape against that provenance.
  const systems = [{ folder: "snes", targetKey: "someone/core#t" }];
  const titles = [{ key: "someone/core#t", originalSystem: "dos" }];
  const got = coverSystemFor("snes/Mario.sfc", systems, titles, isKnownSystemFolder);
  eq(got.kind, "folder", "the console wins over the owning core's provenance");
  eq(got.system, "snes", "and keeps its own folder");
});

await check("a folder nothing owns and no console claims stays unknown", () => {
  // The scraper's own line, naming the folder, is the honest answer. No invented platform.
  eq(coverSystemFor("doom/doom.wad", [], [], isKnownSystemFolder).kind, "unknown",
    "no owning core means nothing to derive from");
  eq(coverSystemFor("mystery/x.bin", DOOM_SYSTEMS, withOriginal("dos"), isKnownSystemFolder).kind, "unknown",
    "a folder no registered system claims");
});

await check("the owner is found by FOLDER, never by name", () => {
  // Two projects may share a title, and the scan key carries the folder, not the title.
  // The doom entry is deliberately NOT first: a positional lookup would pick `other` and the
  // check would pass on the wrong title. A mutation replacing the find with `systems[0]` is what
  // showed the first ordering here proved nothing.
  const systems = [
    { folder: "other", targetKey: "b/two#t" },
    { folder: "doom", targetKey: "a/one#t" },
  ];
  const titles = [
    { key: "b/two#t", originalSystem: "snes" },
    { key: "a/one#t", originalSystem: "dos" },
  ];
  const got = coverSystemFor("doom/doom.wad", systems, titles, isKnownSystemFolder);
  eq(got.system, "dos", "the title matched must be the one owning the doom folder");
});

await check("a row with no folder at all is unknown, not a crash", () => {
  eq(coverSystemFor("bare.wad", DOOM_SYSTEMS, withOriginal("dos"), isKnownSystemFolder).kind, "unknown", "no folder");
  eq(coverSystemFor("", DOOM_SYSTEMS, withOriginal("dos"), isKnownSystemFolder).kind, "unknown", "empty key");
  eq(coverSystemFor("/x.wad", DOOM_SYSTEMS, withOriginal("dos"), isKnownSystemFolder).kind, "unknown", "leading slash");
});

await check("a blank originalSystem counts as absent", () => {
  // `client.ts` pattern-checks the field, but whitespace-only would slip through as truthy and
  // then scrape against an empty folder name.
  eq(coverSystemFor("doom/doom.wad", DOOM_SYSTEMS, withOriginal("   "), isKnownSystemFolder).kind, "unstated",
    "whitespace is not a platform");
});

await check("the panel actually consults it", () => {
  // Wiring: the resolver existing and the game-row branch calling it are different facts, and
  // the bug was entirely that the branch never asked.
  const panel = readFileSync(join(here, "../src/lib/views/GameDetailsPanel.svelte"), "utf8");
  ok(/coverSystemFor\(/.test(panel), "GameDetailsPanel does not call coverSystemFor");
  ok(/errNoOriginalSystem/.test(panel), "the absent case must reuse the existing string");
  ok(/isKnownSystemFolder/.test(panel), "the real folder predicate must be passed in");
});

// --- originalName: the work's own title, used AS GIVEN ---------------------------------------
//
// `originalSystem` says which art library; `originalName` says which entry in it. Measured
// against the live API while this was designed: `ccleste` @234 is not found and `Celeste Classic`
// @234 is; `zelda3` @4 is not found and "The Legend of Zelda - A Link to the Past" @4 is. The
// owner's rule for the pair: "they're optional so if they're added, it's intentional."

const runSrc = readFileSync(join(here, "../src/lib/screenscraper/run.js"), "utf8");

/** The real `romnom` decision, lifted from run.js rather than restated. */
function lookupNameRule() {
  // Rung 1 of the ladder: the DECLARED call. Lifted from its argument list rather than from a
  // `romnom:` property -- the ladder passes it positionally to `infos(systemeid, romnom)`.
  const m = runSrc.match(/await infos\(sid, (forceName[^)]*\))\)/);
  ok(m, "the declared rung's lookup-name expression is gone from run.js");
  const expr = m[1];
  ok(/forceName/.test(expr), `the lifted expression does not consult forceName: ${expr}`);
  ok(/romnomFor/.test(expr), `the lifted expression no longer falls back to romnomFor: ${expr}`);
  return new Function("forceName", "rom", "sid", "romnomFor", `return ${expr};`);
}

/**
 * The REAL ladder, lifted out of run.js and given a stub client.
 *
 * Regex-matching the source proved the shape and not the behaviour, and the ladder is ORDER --
 * which rung runs, in what sequence, and when it stops. That is only testable by running it.
 * It closes over `romnomFor` alone, which is injected.
 */
function liftLadder() {
  const at = runSrc.indexOf("async function lookupGame(");
  ok(at >= 0, "lookupGame is gone from run.js");
  const sig = "async function lookupGame(client, rom, { h, forceSys, forceName, shouldCancel }) ";
  ok(runSrc.slice(at).startsWith(sig), "lookupGame's signature changed; this lift is stale");
  // From the END of the signature: `indexOf("{")` finds the DESTRUCTURING brace in the
  // parameter list, not the body, and lifts a body that starts mid-parameter.
  const bodyStart = at + sig.length;
  const endMarker = runSrc.indexOf("\nasync function buildCoverFromJeu", at);
  ok(endMarker > bodyStart, "cannot find the end of lookupGame");
  const body = runSrc.slice(bodyStart, runSrc.lastIndexOf("}", endMarker) + 1);
  ok(/rung: "unscoped"/.test(body), `the lifted body is not the ladder: ${body.slice(0, 120)}`);
  return new Function("romnomFor", `return ${sig}${body}`)(
    (fileName) => fileName.replace(/\.[^/.]+$/, "") + "|romnomFor",
  );
}
const lookupGame = liftLadder();

/** A client that answers only where told to, and records every call in order. */
function stubClient({ infosHit = null, searchHit = null, infosStatus = 404 } = {}) {
  const calls = [];
  return {
    calls,
    async jeuInfos(params) {
      if (params.gameid !== undefined) {
        calls.push({ kind: "byId", gameid: params.gameid });
        return { ok: true, json: async () => ({ response: { jeu: { id: params.gameid, from: "search" } } }) };
      }
      calls.push({ kind: "infos", systemeid: params.systemeid, romnom: params.romnom, md5: params.md5 });
      const hit = infosHit && infosHit(params);
      if (hit) return { ok: true, json: async () => ({ response: { jeu: hit } }) };
      return { ok: false, status: infosStatus };
    },
    async jeuRecherche(params) {
      calls.push({ kind: "search", recherche: params.recherche, systemeid: params.systemeid });
      const hit = searchHit && searchHit(params);
      return hit ? [{ id: hit }] : [];
    },
  };
}

const ROM = (name = "ccleste.bin") => ({ file: { name }, systemeids: [234], derivedIds: [234] });
const NO_HASH = { size: 0 };
const HASHED = { size: 1024, crc: "c", md5: "m", sha1: "s" };
const run = (client, rom, opts) =>
  lookupGame(client, rom, { h: HASHED, forceSys: null, forceName: null, shouldCancel: () => false, ...opts });

await check("rung 1: a declared system and name are tried FIRST, with hashes", async () => {
  const client = stubClient({ infosHit: (p) => (p.systemeid === 135 && p.romnom === "Tomb Raider" ? { id: 1 } : null) });
  const got = await run(client, ROM(), { forceSys: 135, forceName: "Tomb Raider" });
  eq(got.rung, "declared", "the manifest's own answer");
  eq(client.calls[0].kind, "infos", "the first call is a lookup, not a search");
  eq(client.calls[0].systemeid, 135, "against the declared system");
  eq(client.calls[0].romnom, "Tomb Raider", "with the declared name, as given");
  eq(client.calls[0].md5, "m", "and the hashes ride along");
});

await check("rung 1: each field works without the other", async () => {
  // A declared NAME with no system is looked up against the folder's systems.
  const nameOnly = stubClient({ infosHit: (p) => (p.romnom === "Celeste Classic" ? { id: 1 } : null) });
  let got = await run(nameOnly, ROM(), { forceName: "Celeste Classic" });
  eq(got.rung, "declared", "name alone still counts as declared");
  eq(nameOnly.calls[0].systemeid, 234, "against the folder-derived system");

  // A declared SYSTEM with no name is looked up with the filename.
  const sysOnly = stubClient({ infosHit: (p) => (p.systemeid === 135 ? { id: 1 } : null) });
  got = await run(sysOnly, ROM(), { forceSys: 135 });
  eq(got.rung, "declared", "system alone still counts as declared");
  eq(sysOnly.calls[0].romnom, "ccleste|romnomFor", "with the filename, through romnomFor");
});

await check("rung 2: with nothing declared, the folder answers as it always has", async () => {
  const client = stubClient({ infosHit: (p) => (p.systemeid === 234 ? { id: 2 } : null) });
  const got = await run(client, ROM());
  eq(got.rung, "derived", "the unchanged path");
  eq(client.calls.length, 1, "and it is the FIRST call: rung 1 is skipped entirely");
  eq(client.calls[0].romnom, "ccleste|romnomFor", "the filename goes through romnomFor");
});

await check("rung 3: a scoped search, inside the declared system", async () => {
  const client = stubClient({ searchHit: (p) => (p.systemeid === 135 ? 99 : null) });
  const got = await run(client, ROM(), { forceSys: 135, forceName: "Tomb Raider" });
  eq(got.rung, "scoped", "found by search within one system");
  const search = client.calls.find((c) => c.kind === "search");
  eq(search.systemeid, 135, "scoped to the declared system");
  eq(search.recherche, "Tomb Raider", "searching the declared name");
});

await check("rung 4: an unscoped search is the last resort", async () => {
  const client = stubClient({ searchHit: (p) => (p.systemeid === undefined ? 77 : null) });
  const got = await run(client, ROM("mine sweeper.gw"));
  eq(got.rung, "unscoped", "the last rung");
  const searches = client.calls.filter((c) => c.kind === "search");
  eq(searches[searches.length - 1].systemeid, undefined, "with no system at all");
  eq(searches[0].recherche, "mine sweeper", "a search term is the stem, NOT romnomFor output");
});

await check("THE ORDER: a title matchable at two rungs takes the higher one", async () => {
  // Answerable at rung 1 AND by search. Rung 1 must win, and no search may happen at all.
  const client = stubClient({
    infosHit: (p) => (p.systemeid === 135 ? { id: "declared" } : null),
    searchHit: () => "search",
  });
  const got = await run(client, ROM(), { forceSys: 135, forceName: "Tomb Raider" });
  eq(got.rung, "declared", "the declared rung outranks any search");
  eq(client.calls.some((c) => c.kind === "search"), false, "and the ladder stopped before searching");
});

await check("THE ORDER: derived outranks both searches", async () => {
  const client = stubClient({ infosHit: () => ({ id: "derived" }), searchHit: () => "search" });
  const got = await run(client, ROM());
  eq(got.rung, "derived", "a file match beats a name search");
  eq(client.calls.some((c) => c.kind === "search"), false, "no search was needed");
});

await check("THE ORDER: scoped outranks unscoped", async () => {
  const client = stubClient({ searchHit: (p) => (p.systemeid ? 5 : 6) });
  const got = await run(client, ROM());
  eq(got.rung, "scoped", "a search inside the system beats one across all of them");
});

await check("a miss at every rung is an honest miss", async () => {
  const client = stubClient();
  const got = await run(client, ROM());
  eq(got.jeu, null, "nothing found");
  eq(got.rung, null, "and no rung claimed it");
  eq(got.httpError, null, "a 404 is not an error");
  ok(client.calls.length >= 3, `every rung should have been tried, got ${client.calls.length} calls`);
});

await check("a real HTTP failure stops the ladder rather than guessing", async () => {
  // A 500 means we do not know; walking on to a name search would turn an outage into a guess.
  const client = stubClient({ infosStatus: 500 });
  const got = await run(client, ROM());
  eq(got.httpError, 500, "the failure is reported");
  eq(client.calls.some((c) => c.kind === "search"), false, "and no search was attempted");
});

await check("a stated originalName is the lookup name, AS GIVEN", () => {
  const rule = lookupNameRule();
  const romnomFor = () => { throw new Error("romnomFor must not run when a name is stated"); };
  eq(rule("Celeste Classic", { file: { name: "ccleste.bin" } }, 234, romnomFor), "Celeste Classic",
    "the manifest's title wins over the filename");
});

await check("a title with a dot survives, which routing through romnomFor would not", () => {
  // THE REASON IT IS NOT ROUTED THROUGH `romnomFor`. That helper reads everything after the last
  // dot as an extension, which is right for a filename and wrong for a title. Measured on the
  // real helper: "Dr. Mario" -> "Dr", "Mario Bros." -> "Mario Bros".
  const rule = lookupNameRule();
  const romnomFor = () => { throw new Error("must not run"); };
  eq(rule("Dr. Mario", { file: { name: "x.bin" } }, 3, romnomFor), "Dr. Mario", "the whole title");
  eq(rule("Mario Bros.", { file: { name: "x.bin" } }, 3, romnomFor), "Mario Bros.", "trailing dot kept");

  // ARMED: prove the helper really would have mangled it, so this is not a straw man.
  const at = runSrc.indexOf("function romnomFor(");
  ok(at >= 0, "romnomFor is gone from run.js");
  const body = runSrc.slice(runSrc.indexOf("{", at) + 1, runSrc.indexOf("\n}", at));
  const real = new Function("systemById", `return function (fileName, systemeid) {${body}}`)(
    (id) => JSON.parse(readFileSync(join(here, "../src/lib/screenscraper/systems.json"), "utf8"))
      .find((s) => s.id === Number(id)),
  );
  eq(real("Dr. Mario", 3), "Dr", "romnomFor truncates a dotted title, which is why titles skip it");
});

await check("with NO originalName, the filename rule is untouched", () => {
  const rule = lookupNameRule();
  let sawFilename = null;
  const romnomFor = (name) => { sawFilename = name; return "STEM"; };
  eq(rule(null, { file: { name: "Ball.gw" } }, 52, romnomFor), "STEM", "falls through to romnomFor");
  eq(sawFilename, "Ball.gw", "and it is handed the filename, unchanged");
  eq(rule(undefined, { file: { name: "Ball.gw" } }, 52, romnomFor), "STEM", "undefined behaves as absent");
});

await check("the resolver carries the name for a core-owned game row", () => {
  const withBoth = [{ key: "a/one#t", originalSystem: "dos", originalName: "Tomb Raider" }];
  const got = coverSystemFor("openlara/level.pkd", [{ folder: "openlara", targetKey: "a/one#t" }], withBoth, isKnownSystemFolder);
  eq(got.kind, "manifest", "a core-owned folder");
  eq(got.system, "dos", "the platform");
  eq(got.name, "Tomb Raider", "and the work's title");
});

await check("the two fields are independent", () => {
  // A manifest may name the platform without naming the work. That is still usable: the
  // filename is then the lookup, exactly as it is for an ordinary ROM.
  const systems = [{ folder: "openlara", targetKey: "a/one#t" }];
  const sysOnly = coverSystemFor("openlara/x.pkd", systems, [{ key: "a/one#t", originalSystem: "dos" }], isKnownSystemFolder);
  eq(sysOnly.kind, "manifest", "still resolves");
  eq("name" in sysOnly, false, "with no name to carry");

  // A name with no platform is NOT usable: there is no library to look it up in.
  const nameOnly = coverSystemFor("openlara/x.pkd", systems, [{ key: "a/one#t", originalName: "Tomb Raider" }], isKnownSystemFolder);
  eq(nameOnly.kind, "unstated", "a title with no platform cannot be looked up");
});

await check("a blank originalName is not carried", () => {
  const blank = [{ key: "a/one#t", originalSystem: "dos", originalName: "   " }];
  const got = coverSystemFor("openlara/x.pkd", [{ folder: "openlara", targetKey: "a/one#t" }], blank, isKnownSystemFolder);
  eq("name" in got, false, "whitespace is not a title");
});

await check("the panel passes the stated name to the scraper", () => {
  const panel = readFileSync(join(here, "../src/lib/views/GameDetailsPanel.svelte"), "utf8");
  ok(/forceName:\s*lookupName/.test(panel), "GameDetailsPanel does not pass forceName");
  ok(/lookupName = hb\.originalName/.test(panel), "the homebrew branch does not use originalName");
  ok(/lookupName = resolved\.name/.test(panel), "the game-row branch does not use the resolved name");
});

for (const f of failures) console.log(`  x ${f}`);
console.log(`cover system: ${failures.length ? `${failures.length} FAILED, ` : ""}${passed} checks passed`);
process.exit(failures.length ? 1 : 0);
