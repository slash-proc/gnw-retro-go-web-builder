#!/usr/bin/env node
/**
 * "Re-read retained on-device games" must not re-read what we already hold.
 *
 *   docker compose exec dev sh -c 'cd /app/apps/web && node test/retainreuse.mjs'
 *
 * That phase rebuilds the FrogFS image, so every game being KEPT has to be in the new image.
 * It was getting those bytes by reading them back off the device over SWD -- including files
 * sitting in the user's own library folder and homebrew assets this session had just prepared.
 * Deselecting one game therefore cost a multi-megabyte read of everything else, which is what
 * made an uninstall slow.
 *
 * The rule: prefer a local copy when one exists at the same key and its length matches what the
 * device reports. Length is the only cheap discriminator available -- FrogFS entries are not
 * 256 KiB aligned, so `readHashes` cannot speak about a single file -- and the local library is
 * where these were installed from in the first place.
 *
 * A WIRING check over the source, because the phase lives in a Svelte handler behind a device
 * connection. Kept honest by the anti-vacuity case below.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
let passed = 0, failed = 0;
const check = (name, fn) => {
  try { fn(); passed++; } catch (e) { failed++; console.log(`  FAIL ${name}: ${e.message}`); }
};
const assert = (c, m) => { if (!c) throw new Error(m); };

function audit(src) {
  const problems = [];
  const at = src.indexOf("report.subStart(\"build\", \"retain\")");
  assert(at > 0, "the retain phase is gone");
  const phase = src.slice(at, src.indexOf("report.subFinish(\"build\", \"retain\")", at));

  // `async` since zipped ROMs entered the library: the size comparison is still metadata, but
  // the winning candidate's bytes may need inflating, so the lookup awaits.
  if (!/const localFor = (async )?\(/.test(phase)) {
    problems.push("the retain phase has no local lookup, so every kept file is read from the device");
  }
  // The local copy must be checked against the device's size, not taken on name alone: a
  // different build of the same name would otherwise be packed silently.
  if (!/c\.length === size/.test(phase)) {
    problems.push("a local copy is used without checking its length against the device entry");
  }
  // And it must actually remove the entry from the read list, not merely note it.
  if (!/toRead\.splice\(/.test(phase)) {
    problems.push("a reused file is not removed from the read list, so it is read anyway");
  }
  // The sources worth consulting. `library.scan` is the user's folder; `prepareState.assets`
  // holds this session's prepared homebrew, which is the bulk of what a repack retains.
  for (const src2 of ["library.scan?.userRoms", "prepareState.assets"]) {
    if (!phase.includes(src2)) problems.push(`the local lookup ignores ${src2}`);
  }
  return problems;
}

const src = readFileSync(join(here, "../src/lib/views/RomManagementTab.svelte"), "utf8");

check("the retain phase reuses local bytes instead of reading the device", () => {
  const problems = audit(src);
  assert(problems.length === 0, problems.join("; "));
});

check("ANTI-VACUITY: the same assertions fail with the reuse removed", () => {
  const before = src
    .replace(/const localFor = (async )?\([\s\S]*?\n    \};/, "")
    .replace(/toRead\.splice\(i, 1\);/, "");
  const problems = audit(before);
  assert(problems.length >= 3,
    `stripping the reuse should fail several assertions, ${problems.length} did: ${problems.join("; ") || "(none)"}`);
});

console.log(`\nretainreuse: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
