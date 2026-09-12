#!/usr/bin/env node
/**
 * The filename sent to ScreenScraper carries an extension that system accepts.
 *
 *   docker compose exec dev sh -c 'cd /app/apps/web && node test/romnom.mjs'
 *
 * ScreenScraper validates `romnom`'s extension against the extensions the system declares, and
 * 404s the lookup when it does not recognise one -- the SAME 404 it returns for a game it has
 * never heard of. So an unknown extension is indistinguishable from an unknown game, and the app
 * reported "No result".
 *
 * Measured against the live API while diagnosing:
 *
 *     Ball.gw  name only            http=404  Erreur : Rom/Iso/Dossier non trouvee !
 *     Ball     name only            http=200  Ball
 *
 * Game & Watch (52) declares only `mgw`; Retro-Go's files are `.gw`. Game Boy Advance (12)
 * declares `gba,bin`, which is why GBA looked fine and Game & Watch did not.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
let passed = 0;
const failures = [];
const check = (name, fn) => { try { fn(); passed++; } catch (e) { failures.push(`${name}: ${e.message}`); } };
const ok = (c, m) => { if (!c) throw new Error(m); };
const eq = (a, b, m) => { if (a !== b) throw new Error(`${m}: got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`); };

const SS = join(here, "../src/lib/screenscraper");
const systems = JSON.parse(readFileSync(join(SS, "systems.json"), "utf8"));

/** The real helper, lifted out of run.js so this tests the shipped rule, not a restatement. */
const src = readFileSync(join(SS, "run.js"), "utf8");
const at = src.indexOf("function romnomFor(");
ok(at >= 0, "romnomFor is gone from run.js");
const body = src.slice(src.indexOf("{", at) + 1, src.indexOf("\n}", at));
ok(/extensions/.test(body), `the lifted body is not the helper: ${body}`);
const romnomFor = new Function(
  "systemById",
  `return function romnomFor(fileName, systemeid) {${body}}`,
)((id) => systems.find((s) => s.id === id));

check("a Game & Watch .gw file is sent without its extension", () => {
  // 52 declares only `mgw`. This is the case the owner hit.
  eq(romnomFor("Ball.gw", 52), "Ball", "a .gw name must lose the extension ScreenScraper refuses");
});

check("a GBA .gba file keeps its extension", () => {
  // 12 declares `gba,bin`, and the full name resolved against the live API.
  eq(romnomFor("Pokemon - Sapphire Version (USA).gba", 12),
    "Pokemon - Sapphire Version (USA).gba", "a declared extension must be kept");
});

check("a Game Boy Color .gbc file keeps its extension", () => {
  eq(romnomFor("Zelda - Link's Awakening DX.gbc", 10), "Zelda - Link's Awakening DX.gbc",
    "10 declares gb,gbc,bin, so the full name is right");
});

check("a system declaring no extensions gets the stem", () => {
  // 46 of the 250 declare none. We cannot know what they accept; the stem works more often.
  const none = systems.find((s) => s.extensions.length === 0);
  ok(none, "no extensionless system in the snapshot; this check is looking in the wrong place");
  eq(romnomFor("Some Game.rom", none.id), "Some Game",
    `system ${none.id} (${none.name}) declares nothing, so the stem must be sent`);
});

check("a name with dots in it only loses the last segment", () => {
  eq(romnomFor("Mr. Do.gw", 52), "Mr. Do", "only the final extension is removed");
});

check("a name with no extension is sent as-is", () => {
  eq(romnomFor("Ball", 52), "Ball", "nothing to strip");
});

check("a dotfile is not mistaken for an extension", () => {
  eq(romnomFor(".hidden", 52), ".hidden", "a leading dot is not an extension boundary");
});

check("an unknown systemeid falls back to the stem rather than throwing", () => {
  eq(romnomFor("Ball.gw", 999999), "Ball", "an id absent from the snapshot must not crash the run");
});

check("the lookup actually calls it", () => {
  // Lifting the helper tests the RULE; it cannot see the call site reverting to the raw
  // filename, which is where the bug lived. Found by mutating: reverting the call site left
  // every check above green.
  //
  // The call now reads `forceName || romnomFor(rom.file.name, sid)`: a manifest's `originalName`
  // is a TITLE and is sent as given (see test/coversystem.mjs), but the FILENAME path -- which is
  // what this suite is about -- must still go through the helper. Matched loosely enough to
  // allow that prefix and tightly enough to still catch the filename being sent raw.
  // The lookup is an ordered ladder now (see test/coversystem.mjs). The DERIVED rung is the one
  // this suite is about -- the filename against the folder's systems -- and it must still go
  // through the helper. The declared rung sends a manifest TITLE as given, which is a different
  // thing and deliberately does not.
  ok(/await infos\(sid, romnomFor\(rom\.file\.name, sid\)\)/.test(src),
    "the jeuInfos lookup no longer routes the filename through romnomFor, so an extension "
    + "ScreenScraper refuses goes back on the wire");
});

for (const f of failures) console.log(`  x ${f}`);
console.log(`romnom: ${failures.length ? `${failures.length} FAILED, ` : ""}${passed} checks passed`);
process.exit(failures.length ? 1 : 0);
