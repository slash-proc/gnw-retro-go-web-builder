#!/usr/bin/env node
/**
 * The committed ScreenScraper system snapshot is usable without the network.
 *
 *   docker compose exec dev sh -c 'cd /app/apps/web && node test/ssSystems.mjs'
 *
 * `SS_SYSTEM_MAP` answers "which systemeid for this folder". The snapshot answers "what CAN be
 * scraped at all", which nothing could answer before: the map was inherited from CoverStudio,
 * so a console the firmware gained later (gba, tama) had no cover source and the app had no way
 * to say so. More cores are coming; adding one should be a lookup.
 *
 * What this pins is that the snapshot is real, complete enough to answer for every console we
 * already support, and reachable with no credentials and no network.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
let passed = 0;
const failures = [];
const check = (name, fn) => { try { fn(); passed++; } catch (e) { failures.push(`${name}: ${e.message}`); } };
const ok = (c, m) => { if (!c) throw new Error(m); };

const SS = join(here, "../src/lib/screenscraper");
const systems = JSON.parse(readFileSync(join(SS, "systems.json"), "utf8"));

check("the snapshot is a real list, not a stub", () => {
  ok(Array.isArray(systems), "systems.json is not an array");
  // ARMED: an empty or near-empty file would let every lookup below pass by finding nothing.
  ok(systems.length >= 200, `only ${systems.length} systems; the snapshot looks truncated`);
});

check("every row carries what a lookup needs", () => {
  for (const s of systems) {
    ok(Number.isInteger(s.id) && s.id > 0, `bad id: ${JSON.stringify(s)}`);
    ok(typeof s.name === "string" && s.name.length > 0, `nameless system ${s.id}`);
    ok(Array.isArray(s.shortcodes), `system ${s.id} has no shortcodes array`);
    ok(Array.isArray(s.extensions), `system ${s.id} has no extensions array`);
  }
});

check("ids are unique", () => {
  const seen = new Set();
  for (const s of systems) {
    ok(!seen.has(s.id), `duplicate id ${s.id}`);
    seen.add(s.id);
  }
});

// The resolver, bundled so this suite can ask what it would actually scrape. Kept to one import
// so the snapshot checks above stay independent of the policy layer.
const { build } = await import("esbuild");
const _b = await build({
  entryPoints: [join(SS, "systemMap.js")],
  bundle: true, write: false, format: "esm", platform: "neutral", loader: { ".json": "json" },
});
const _map = await import("data:text/javascript;base64," + Buffer.from(_b.outputFiles[0].text).toString("base64"));
const resolveIds = _map.systemIdsFor;

check("the platforms this firmware actually runs are in it", () => {
  // The two that were missing from SS_SYSTEM_MAP, plus the umbrellas worth naming.
  const want = { 12: "Game Boy Advance", 293: "Tamagotchi", 75: "Mame", 135: "PC Dos", 142: "Neo-Geo" };
  for (const [id, name] of Object.entries(want)) {
    const hit = systems.find((s) => s.id === Number(id));
    ok(hit, `system ${id} (${name}) is not in the snapshot`);
    ok(hit.name === name, `system ${id} is "${hit.name}", expected "${name}"`);
  }
});

check("every id the resolver can return exists in the snapshot", () => {
  // Was "every id SS_SYSTEM_MAP scrapes". That table is gone -- `systemMap.js` resolves folders
  // against this snapshot instead -- so the guarantee moves to the resolver's OUTPUT, which is
  // strictly stronger: it covers folders that resolve with no alias entry at all, which the old
  // check could not see. An id ScreenScraper does not have would fail only at scrape time,
  // against the user's quota, with a shrug.
  const map = readFileSync(join(SS, "systemMap.js"), "utf8");
  const folders = [...map.matchAll(/^\s*"?([a-z0-9+]+)"?:\s*\[/gm)].map((m) => m[1]);
  ok(folders.length > 10, `only ${folders.length} folders parsed out of RETRO_GO_SYSTEMS; the parse is wrong`);
  const known = new Set(systems.map((s) => s.id));
  const ghosts = [];
  for (const f of [...folders, "gba", "gw", "pico8", "arcade", "videopac"]) {
    for (const id of resolveIds(f)) if (!known.has(id)) ghosts.push(`${f} -> ${id}`);
  }
  ok(ghosts.length === 0, `the resolver returns ids ScreenScraper does not have: ${ghosts.join(", ")}`);
});

check("the lookup module reads it with no network and no credentials", () => {
  const mod = readFileSync(join(SS, "systems.js"), "utf8");
  ok(/import systems from "\.\/systems\.json"/.test(mod), "systems.js does not import the snapshot");
  ok(!/fetch\(|devCreds|devpassword/.test(mod),
    "systems.js reaches for the network or credentials; the snapshot exists so it does not have to");
});

check("only the refresh script talks to the API", () => {
  const script = readFileSync(join(here, "../scripts/fetch-ss-systems.mjs"), "utf8");
  ok(/systemesListe\.php/.test(script), "the refresh script no longer fetches the system list");
  ok(/refusing to overwrite the snapshot/.test(script),
    "the refresh script must not overwrite a good snapshot with an empty response");
});

for (const f of failures) console.log(`  x ${f}`);
console.log(`ss systems: ${failures.length ? `${failures.length} FAILED, ` : ""}${passed} checks passed`);
process.exit(failures.length ? 1 : 0);
