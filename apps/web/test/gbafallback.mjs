#!/usr/bin/env node
/**
 * GBA is a console the fallback tables know about.
 *
 *   docker compose exec dev sh -c 'cd /app/apps/web && node test/gbafallback.mjs'
 *
 * Three hardcoded tables survive as a FALLBACK for the case where no core source has registered
 * anything yet (see coreRegistry.ts's header: the registry is the authority, these answer only
 * when nothing is registered, and they also name a console already on the device whose core was
 * later disabled). `engine/consoles.ts` knew `gba: "Game Boy Advance"`, but neither
 * `CONSOLE_WHITELISTS` (romSelection.svelte.ts) nor `LEGACY_CONSOLE_DIRS` (coreRegistry.ts) had
 * an entry -- so with no active GBA core, a `.gba` file under `gba/` was not a game at all. No
 * row, and therefore nothing in the cover carousel, which is how the owner found it.
 *
 * This does NOT demand that every label have a fallback entry. Several (fds, lynx, ws, ngp,
 * sg1000) are deliberately absent: the legacy tables describe what the legacy build shipped, not
 * everything the firmware could name. GBA is different -- this repo builds a GBA core, patches
 * `gba.xip`, and has an end-to-end suite for it.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
let passed = 0;
const failures = [];
const check = (name, fn) => { try { fn(); passed++; } catch (e) { failures.push(`${name}: ${e.message}`); } };
const ok = (c, m) => { if (!c) throw new Error(m); };

const read = (p) => readFileSync(join(here, "../src/lib", p), "utf8");
const sel = read("romSelection.svelte.ts");
const reg = read("sources/coreRegistry.ts");
const lab = read("engine/consoles.ts");

/** The entries of one `Record<string, Set<string>>`-shaped table. */
function tableKeys(src, name) {
  const at = src.indexOf(name);
  ok(at >= 0, `no ${name} table found`);
  return [...src.slice(at).matchAll(/^\s*([a-z0-9]+):\s*new Set/gm)].map((m) => m[1]);
}

check("gba is a console directory, so a folder holding only gba/ is accepted", () => {
  const at = reg.indexOf("LEGACY_CONSOLE_DIRS");
  ok(at >= 0, "no LEGACY_CONSOLE_DIRS");
  const body = reg.slice(at, reg.indexOf("]", at));
  ok(/"gba"/.test(body),
    "gba is not a legacy console dir, so a ROM folder holding only gba/ is refused at pick time");
});

check("a .gba file under gba/ classifies as a game", () => {
  const keys = tableKeys(sel, "CONSOLE_WHITELISTS");
  ok(keys.includes("gba"), "CONSOLE_WHITELISTS has no gba entry, so a .gba file is not a game");
  const at = sel.indexOf("gba: new Set");
  const entry = sel.slice(at, sel.indexOf("]", at));
  ok(/\.gba/.test(entry), `the gba whitelist does not accept .gba: ${entry}`);
});

check("the label already existed, which is what made this invisible", () => {
  // ARMED: the bug was a table disagreeing with a table. If the label goes, this test is
  // guarding the wrong thing and should be re-read rather than deleted.
  ok(/gba:\s*"Game Boy Advance"/.test(lab),
    "engine/consoles.ts no longer labels gba; re-read whether the fallback entries still belong");
});

check("the ScreenScraper mapping is no longer a table here", () => {
  // Those two checks moved to ssystems.mjs when SS_SYSTEM_MAP was replaced by a resolver over
  // ScreenScraper's own list. Left as a pointer rather than deleted silently: the guarantee they
  // carried (every console folder can be scraped) is the one that would have caught the original
  // bug, and a future reader needs to know where it went.
  const cfg = readFileSync(join(here, "../src/lib/screenscraper/config.js"), "utf8");
  ok(!/SS_SYSTEM_MAP\s*=/.test(cfg),
    "SS_SYSTEM_MAP is back as a hand-written table; ssystems.mjs is the suite that should own this");
  ok(/from "\.\/systems\.js"/.test(cfg), "config.js no longer delegates to the resolver");
});

check("the registry still outranks the fallback", () => {
  // The fallback must stay a fallback: an active core that declares gba decides, and a user
  // with core sources but no GBA core must still not get a gba button.
  ok(/if \(registryIsAuthoritative\(reg\)\) return null;/.test(sel),
    "the legacy table is no longer gated behind an unresolved registry");
});

for (const f of failures) console.log(`  x ${f}`);
console.log(`gba fallback: ${failures.length ? `${failures.length} FAILED, ` : ""}${passed} checks passed`);
process.exit(failures.length ? 1 : 0);
