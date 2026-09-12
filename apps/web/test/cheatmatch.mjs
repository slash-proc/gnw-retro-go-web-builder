#!/usr/bin/env node
/**
 * A ROM filename finds its cheat database entry.
 *
 *   docker compose exec dev sh -c 'cd /app/apps/web && node test/cheatmatch.mjs'
 *
 * Reported as "the game fuzzy auto-detection isn't working anymore (Link's Awakening DX isn't
 * being detected despite it working in the past)". It is a real regression, and the two halves
 * of it are pinned separately below.
 *
 * WHAT CHANGED. Before the UX overhaul the panel matched a filename against cheatdb.json by
 * bidirectional substring, returning the FIRST title it touched:
 *
 *     if (key.toLowerCase().includes(normalizedName) || normalizedName.includes(key.toLowerCase()))
 *
 * The overhaul replaced that with an exact normalized-key lookup inlined in the panel, and left
 * `findGameCheats` (whose comment promised "a fuzzier match ... can layer on top later") with no
 * callers at all. So the fuzz was not replaced, it was dropped.
 *
 * MEASURED against the shipped gb.json (757 games) and nes.json (721 games):
 *
 *     shape                     exact-norm (after)   substring (before)
 *     title                            100%                100%
 *     title (Region)                   100%                100%
 *     title (Region) (Rev 2)           100%                100%
 *     "Name, The" inverted article       0%              15% / 6%
 *     subtitle only                   3% / 5%              100%
 *
 * So a short or subtitle-only filename regressed from always working to almost never working,
 * which is the reported symptom. The inverted article, the single most common shape in a real
 * ROM set, never worked well in either.
 *
 * WHY THE OLD MATCHER IS NOT RESTORED. On the two shapes that matter most it picked the WRONG
 * game for 253 of 1514 GB names and 230 of 1442 NES names, because first-touch wins and a short
 * database title is a substring of many filenames. The ladder's third rung requires the match to
 * be UNIQUE and refuses otherwise, which is the difference between fuzzy and wrong.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const here = dirname(fileURLToPath(import.meta.url));
let passed = 0;
const failures = [];
const check = async (name, fn) => {
  try { await fn(); passed++; } catch (e) { failures.push(`${name}: ${e.message}`); }
};
const ok = (c, m) => { if (!c) throw new Error(m); };
const eq = (a, b, m) => {
  if (JSON.stringify(a) !== JSON.stringify(b)) {
    throw new Error(`${m}: got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`);
  }
};

// The real module. The per-system JSON is reached through `import("./x.json?url")`, which only
// a bundler understands, so those are marked external here and the data is read off disk below.
const out = await build({
  entryPoints: [join(here, "../src/lib/cheats/index.ts")],
  bundle: true, write: false, format: "esm", platform: "neutral",
  loader: { ".json": "json" }, external: ["*?url"],
});
const mod = await import(
  "data:text/javascript;base64," + Buffer.from(out.outputFiles[0].text).toString("base64")
);
const { resolveCheatGame, normalizeTitle } = mod;
ok(typeof resolveCheatGame === "function", "resolveCheatGame is gone from cheats/index.ts");

const DB = join(here, "../src/lib/cheats");
const load = (sys) => {
  const games = JSON.parse(readFileSync(join(DB, `${sys}.json`), "utf8"));
  return new Map(games.map((g) => [g.key, g]));
};
const gb = load("gb");
const nes = load("nes");
ok(gb.size > 700 && nes.size > 700, `the database shrank: gb=${gb.size} nes=${nes.size}`);

const titleOf = (map, filename) => resolveCheatGame(map, filename)?.game.title ?? null;
const viaOf = (map, filename) => resolveCheatGame(map, filename)?.via ?? null;

const DX = "The Legend of Zelda - Link's Awakening DX";
const PLAIN = "The Legend of Zelda Link's Awakening";

// --- the reported case ------------------------------------------------------------------
await check("THE REPORTED CASE: the No-Intro filename finds Link's Awakening DX", () => {
  const f = "Legend of Zelda, The - Link's Awakening DX (USA, Europe) (Rev 2).gbc";
  eq(titleOf(gb, f), DX, "the owner's filename did not resolve");
  eq(viaOf(gb, f), "article", "resolved by the wrong rung");
});

await check("a short filename finds it too, which is what regressed", () => {
  eq(titleOf(gb, "Link's Awakening DX.gbc"), DX, "a subtitle-only filename did not resolve");
  eq(viaOf(gb, "Link's Awakening DX.gbc"), "contains", "resolved by the wrong rung");
});

await check("DX and the plain cartridge stay apart", () => {
  eq(titleOf(gb, "Legend of Zelda, The - Link's Awakening (USA).gb"), PLAIN, "plain went to DX");
  ok(titleOf(gb, "Link's Awakening DX.gbc") !== PLAIN, "DX went to the plain cartridge");
});

// --- the rungs, each reachable ----------------------------------------------------------
await check("rung 1 still answers an exact title, tags and all", () => {
  eq(viaOf(nes, "Mega Man 2.nes"), "exact", "a bare exact title did not take rung 1");
  eq(viaOf(nes, "Mega Man 2 (USA).nes"), "exact", "a region tag broke the exact rung");
  eq(viaOf(nes, "Mega Man 2 (USA) (Rev 1) [!].nes"), "exact", "a GoodTools tag broke it");
  eq(titleOf(nes, "Mega Man 2 (USA) (Rev 1) [!].nes"), "MegaMan 2", "wrong game");
});

await check("rung 2 is the inverted article and nothing else", () => {
  eq(viaOf(gb, "Flash, The (USA, Europe).gb"), "article", "inverted article did not take rung 2");
  eq(titleOf(gb, "Flash, The (USA, Europe).gb"), "The Flash", "wrong game");
});

// --- the safety property ----------------------------------------------------------------
await check("AN AMBIGUOUS FILENAME IS REFUSED, not guessed at", () => {
  // "zelda" sits inside both Link's Awakening keys. The old matcher returned whichever it met
  // first; this must return nothing and leave the user the manual picker.
  eq(titleOf(gb, "Zelda.gb"), null, "an ambiguous name resolved to a single game");
});

await check("a name too short to mean anything is refused", () => {
  eq(titleOf(gb, "aa.gb"), null, "a two-character name resolved");
});

await check("a game that is not in the database stays unmatched", () => {
  eq(titleOf(gb, "Some Game That Does Not Exist (USA).gb"), null, "invented a match");
});

// --- database-wide, so the rules are not tuned to one title -----------------------------
const stripExt = (t) => t;
const invert = (t) => {
  const m = /^(The|A)\s+(.*)$/.exec(t);
  if (!m) return null;
  const rest = m[2];
  const at = rest.indexOf(" - ");
  return at < 0 ? `${rest}, ${m[1]}` : `${rest.slice(0, at)}, ${m[1]}${rest.slice(at)}`;
};
const rate = (map, make) => {
  let n = 0, hit = 0;
  for (const g of map.values()) {
    const f = make(g.title);
    if (!f) continue;
    n++;
    if (resolveCheatGame(map, `${f}.rom`)?.game.key === g.key) hit++;
  }
  return { n, hit };
};

for (const [name, map] of [["gb", gb], ["nes", nes]]) {
  await check(`${name}: every exact title still resolves to itself`, () => {
    const { n, hit } = rate(map, stripExt);
    eq(hit, n, `exact titles stopped resolving`);
  });
  await check(`${name}: a region tag never costs a match`, () => {
    const { n, hit } = rate(map, (t) => `${t} (USA, Europe)`);
    eq(hit, n, `region-tagged titles stopped resolving`);
  });
  await check(`${name}: EVERY inverted-article title resolves, not just Zelda`, () => {
    const { n, hit } = rate(map, invert);
    ok(n > 40, `too few article titles to be a real sample: ${n}`);
    eq(hit, n, `inverted-article titles did not all resolve (${hit} of ${n})`);
  });
}

// --- the panel uses this matcher and no other -------------------------------------------
await check("the panel resolves through the ladder, not its own inline lookup", () => {
  const src = readFileSync(join(here, "../src/lib/views/GameDetailsPanel.svelte"), "utf8");
  ok(/resolveCheatGame\(/.test(src), "GameDetailsPanel no longer calls resolveCheatGame");
  ok(
    !/systemGames\.get\(normalizeTitle\(/.test(src),
    "GameDetailsPanel has an inline exact-key lookup again, which is the shape that regressed",
  );
});

await check("normalizeTitle still mirrors ingest.py, so the database keys still match", () => {
  eq(normalizeTitle("The Legend of Zelda - Link's Awakening DX"), "legendofzeldalinksawakeningdx",
    "normalizeTitle drifted from the key generator");
});

// --- end to end: a system id reaches a database, and the database reaches the game ---------
// The checks above hand gb.json to the matcher directly, which is exactly how the reported case
// passed here while still failing in the app: the hop from the row's system id to the database
// was assumed, not exercised. These start where the app starts.

const panelSrc = readFileSync(join(here, "../src/lib/views/GameDetailsPanel.svelte"), "utf8");
const lineBlock = /const lineCheatSystems: Record<string, string> = \{([\s\S]*?)\};/.exec(panelSrc);
ok(lineBlock, "lineCheatSystems is gone from GameDetailsPanel, so the id-to-database hop moved");
const lineCheatSystems = Object.fromEntries(
  [...lineBlock[1].matchAll(/(\w+):\s*"(\w+)"/g)].map((m) => [m[1], m[2]]),
);
// Only enough to prove the LIFT worked. Which ids are present is what the checks below judge,
// so a dropped system fails by name instead of crashing this guard.
ok(Object.keys(lineCheatSystems).length >= 2, `the lift failed: ${JSON.stringify(lineCheatSystems)}`);

const idxSrc = readFileSync(join(DB, "index.ts"), "utf8");
const urlBlock = /const SYSTEM_URLS[\s\S]*?=\s*\{\n([\s\S]*?)\n\};/.exec(idxSrc);
ok(urlBlock, "SYSTEM_URLS is gone from cheats/index.ts");
const DATABASES = new Set([...urlBlock[1].matchAll(/^\s*(\w+):\s*\(\)/gm)].map((m) => m[1]));
ok(DATABASES.has("gb") && DATABASES.has("nes"), `lifted no databases: ${[...DATABASES]}`);

/** The app's path: a row's system id picks a database, the database answers the filename. */
const detect = (systemId, filename) => {
  const db = lineCheatSystems[systemId];
  if (!db) return { db: null, game: null };        // no cheat support for this system
  if (!DATABASES.has(db)) return { db, game: null }; // declared, but no data ships
  const map = db === "gb" ? gb : db === "nes" ? nes : null;
  ok(map, `the suite has no fixture for database ${db}`);
  return { db, game: resolveCheatGame(map, filename)?.game.title ?? null };
};

await check("END TO END: a .gbc row reaches gb.json and finds Link's Awakening DX", () => {
  const r = detect("gbc", "Legend of Zelda, The - Link's Awakening DX (USA, Europe) (Rev 2).gbc");
  eq(r.db, "gb", "a gbc row did not select the gb database");
  eq(r.game, DX, "a gbc row did not resolve the game");
});

await check("END TO END: the same title on a gb row resolves too", () => {
  eq(detect("gb", "Link's Awakening DX.gbc").game, DX, "a gb row did not resolve the game");
});

await check("END TO END: a nes row reaches nes.json", () => {
  const r = detect("nes", "Mega Man 2 (USA).nes");
  eq(r.db, "nes", "a nes row did not select the nes database");
  eq(r.game, "MegaMan 2", "a nes row did not resolve the game");
});

// --- every system id, so a silent gap cannot hide behind the three that coincide -----------
const romSel = readFileSync(join(here, "../src/lib/romSelection.svelte.ts"), "utf8");
const wl = romSel.slice(romSel.indexOf("CONSOLE_WHITELISTS"));
const SYSTEM_IDS = [...wl.slice(0, 2500).matchAll(/^\s*(\w+):\s*new Set/gm)].map((m) => m[1]);
ok(SYSTEM_IDS.length > 15, `lifted too few system ids: ${SYSTEM_IDS.length}`);

await check("EVERY system claiming cheat support resolves to a database that ships", () => {
  const silent = [];
  for (const id of SYSTEM_IDS) {
    const db = lineCheatSystems[id];
    if (!db) continue;                                  // no cheat support, nothing claimed
    if (DATABASES.has(db)) continue;                    // has data
    if (mod.CHEAT_SYSTEMS_WITHOUT_DATABASE.has(db)) continue; // a declared, known gap
    silent.push(`${id} -> ${db}`);
  }
  eq(silent, [], "a system claims cheat support but silently resolves to no database");
});

await check("a system with no cheat support asks for no database and does not throw", () => {
  for (const id of ["md", "gg", "sms", "gba", "a2600"]) {
    eq(detect(id, "Anything (USA).bin"), { db: null, game: null }, `${id} reached a database`);
  }
});

await check("the known-empty gap is declared rather than left to look like a typo", () => {
  ok(mod.CHEAT_SYSTEMS_WITHOUT_DATABASE.has("pce"),
    "pce is no longer declared as a system whose empty cheat list is correct");
  ok(!DATABASES.has("pce"), "pce grew a database, so the declaration is now wrong");
});

console.log(`cheat match: ${passed} passed, ${failures.length} failed`);
for (const f of failures) console.log(`  FAIL ${f}`);
process.exit(failures.length ? 1 : 0);
