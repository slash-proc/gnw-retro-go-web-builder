#!/usr/bin/env node
/**
 * A ScreenScraper account is optional, and a bad one does not stop the scrape.
 *
 *   docker compose exec dev sh -c 'cd /app/apps/web && node test/coverlogin.mjs'
 *
 * ScreenScraper authenticates on the DEVELOPER credentials the app carries. A user account only
 * raises the quota and thread count. Two places forgot that, and together they made every cover
 * for every console fail with one opaque message:
 *
 *   1. `runCovers` returned `{ error: "badAccount" }` before touching a single ROM when a saved
 *      login was rejected, so one stale password stopped everything.
 *   2. The cover panel refused to scrape at all without a username, so the obvious workaround
 *      (clear the login) did not work either.
 *
 * The owner hit both: a username saved long ago, a password he no longer had, and a panel that
 * said only "Cover not found." for GBA and for GBC alike -- which is what finally showed it was
 * not about the GBA system id at all.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
let passed = 0;
const failures = [];
const check = (name, fn) => { try { fn(); passed++; } catch (e) { failures.push(`${name}: ${e.message}`); } };
const ok = (c, m) => { if (!c) throw new Error(m); };

const run = readFileSync(join(here, "../src/lib/screenscraper/run.js"), "utf8");
const panel = readFileSync(join(here, "../src/lib/views/GameDetailsPanel.svelte"), "utf8");
const i18n = readFileSync(join(here, "../src/lib/screenscraper/i18n.js"), "utf8");

check("a rejected login degrades to anonymous rather than aborting the run", () => {
  ok(!/return \{ error: "badAccount" \}/.test(run),
    "a rejected login still aborts the whole run; one stale password stops every cover");
  const at = run.indexOf('q.status === "bad"');
  ok(at >= 0, "the bad-login branch is gone entirely; this check is looking in the wrong place");
  const body = run.slice(at, at + 900);
  ok(/delete creds\.ssid/.test(body), "the rejected login is not dropped, so the retry sends it again");
  ok(/client\.creds = creds/.test(body), "the client keeps the old credentials after they are dropped");
});

check("the user is told, in the scraper's own log", () => {
  const at = run.indexOf('q.status === "bad"');
  const body = run.slice(at, at + 900);
  ok(/t\("badAccount"\)/.test(body) && /t\("anonFallback"\)/.test(body),
    "the fallback is silent; the user sees covers appear with no idea their login was ignored");
  for (const lang of ["en", "fr"]) {
    const block = i18n.slice(i18n.indexOf(`  ${lang}: {`));
    ok(/anonFallback:/.test(block.slice(0, block.indexOf("\n  },"))),
      `the ${lang} catalogue has no anonFallback line`);
  }
});

check("the panel scrapes without an account", () => {
  ok(!/coverSource !== ['"]scraper['"] \|\| !ssUsername/.test(panel),
    "the panel still requires a username, so someone without an account cannot scrape at all");
  ok(/coverSource !== "scraper"/.test(panel), "the scraper guard is gone entirely");
});

check("an empty login is omitted rather than sent blank", () => {
  // The anonymous path only works because readCreds leaves ssid out. Sending ssid= would be a
  // login attempt with an empty user, which ScreenScraper rejects.
  const at = run.indexOf("function readCreds");
  ok(at >= 0, "readCreds is gone");
  const body = run.slice(at, run.indexOf("}", run.indexOf("return c;", at)));
  ok(/if \(ssid\?\.trim\(\)\)/.test(body),
    "readCreds no longer guards on a non-empty ssid, so an anonymous run sends a blank login");
});

for (const f of failures) console.log(`  x ${f}`);
console.log(`cover login: ${failures.length ? `${failures.length} FAILED, ` : ""}${passed} checks passed`);
process.exit(failures.length ? 1 : 0);
