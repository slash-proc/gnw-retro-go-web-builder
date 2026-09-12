#!/usr/bin/env node
/**
 * A FLASH firmware install installs NO cores, and builds the partition WITH its structure.
 *
 *   docker compose exec dev sh -c 'cd /app/apps/web && node test/coreinstallwiring.mjs'
 *
 * THE RULE, from the owner, and it is about the medium rather than the policy:
 *
 *   SD   - install every core, without asking. A user may drop a ROM onto the card by hand at
 *          any moment, so every core has to be there already.
 *   Flash - install no cores by default, but still create the filesystem including its
 *          directory structure (`cores` and `data`). Content can only reach a flash device
 *          through this tool, so a core follows a ROM selection, and a firmware install has no
 *          ROM selection to follow.
 *
 * Two attempts got this wrong in opposite directions on the same evening, which is why the
 * guard exists at all: installing every active source put the Doom core on a device whose owner
 * asked for Retro-Go alone, and then filtering by ROM presence installed nothing whatsoever.
 *
 * WHAT THIS SUITE IS AND IS NOT. It reads source, because the install lives in a Svelte handler
 * behind a device connection. It therefore guards against the auto-install RETURNING; it does
 * not prove what lands on a device. `simflash.mjs` check 8 does that part properly: it flashes a
 * bare firmware install into a simulated chip and mounts the LittleFS back off it, asserting
 * `cores` and `data` are present with `type === 2` (a real `lfs_mkdir`, not a zero-byte file --
 * `opendir` fails on a file, so the firmware treats them differently).
 *
 * The anti-vacuity case at the end is the only reason the assertions above it prove anything: it
 * runs them against a synthetic re-introduction of the auto-install and requires them to fail.
 * Without it every assertion here could be a substring that is always absent.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
let failed = 0, passed = 0;
const check = (name, fn) => {
  try { fn(); passed++; }
  catch (e) { failed++; console.log(`  FAIL ${name}: ${e.message}`); }
};
const assert = (c, m) => { if (!c) throw new Error(m); };

/** The body of the function that performs the firmware install, by brace matching. */
function installBody(src) {
  const at = src.indexOf("buildFlashInstall({");
  assert(at > 0, "RomSection.svelte no longer calls buildFlashInstall({...})");
  // The ENCLOSING declaration, not the nearest one above the call: a nested helper declared
  // between the two (`extractLfs`) would otherwise become the body and hide what we read.
  const start = src.lastIndexOf("async function buildInstall", at);
  assert(start > 0, "the firmware install is no longer `async function buildInstall`");
  let depth = 0, i = src.indexOf("{", start);
  const open = i;
  for (; i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}" && --depth === 0) break;
  }
  return src.slice(open, i);
}

/** The object literal passed to buildFlashInstall, by brace matching. */
function buildFlashInstallArg(body) {
  const at = body.indexOf("buildFlashInstall({");
  const open = body.indexOf("{", at);
  let depth = 0, i = open;
  for (; i < body.length; i++) {
    if (body[i] === "{") depth++;
    else if (body[i] === "}" && --depth === 0) break;
  }
  return body.slice(open, i + 1);
}

/** The assertions, over one source string. Returns the failures found. */
function auditInstall(src) {
  const problems = [];
  const body = installBody(src);
  const arg = buildFlashInstallArg(body);

  // 1. EVERY active core is fetched. The owner reversed the earlier "no cores by default" rule
  //    after living with the alternative: a ROM install cannot rebuild the partition (saves),
  //    so it had to write into the live filesystem over SWD, which is slow for a structural
  //    reason (our block device faults whole 4096 B blocks while littlefs asks for 16 to 64).
  //    A firmware install extracts saves and packs the partition locally, so cores ride in the
  //    image and it is flashed in one sequential write.
  if (!/prepareState\.prepareCoreArtifacts\(/.test(body)) {
    problems.push("the firmware install does not fetch core artifacts, so the image ships without cores");
  }
  // 2. The cores tree reaches the install's content. Scoped to `cores/`: `prepareState.assets`
  //    also holds converted game output and homebrew, and merging all of it once grew a fresh
  //    install to 25 MB.
  if (!/of prepareState\.assets\b/.test(body) || !/startsWith\(CORES_PREFIX\)/.test(body)) {
    problems.push("the firmware install does not merge the cores tree into userRoms, so the image ships without cores");
  }
  // 3. The relocation facts still travel. Unrelated to cores-by-default, and easy to delete by
  //    accident while removing the code above: without it a mapped blob is never rebased, and on
  //    a flash-only build nothing else rebases it (odroid_overlay.c runs its relocation callback
  //    only under SD_CARD == 1), so the core faults on its first indirect call.
  if (!/\bmappedArtifacts\s*:/.test(arg)) {
    problems.push("buildFlashInstall is called without mappedArtifacts, so a mapped core is never relocated");
  }
  return problems;
}

/** The builder must create the structural directories, from the manifest's own path names. */
function auditBuilder(src) {
  const problems = [];
  if (!/lfsDirs/.test(src)) {
    problems.push("the plan carries no lfsDirs, so an install with no cores builds a partition with no directories");
  }
  if (!/lfsDirs:\s*\[paths\.cores,\s*paths\.data\]/.test(src)) {
    problems.push("lfsDirs is not [paths.cores, paths.data] from the resolved manifest paths");
  }
  return problems;
}

const romSection = readFileSync(join(here, "../src/lib/advanced/RomSection.svelte"), "utf8");
const flashImage = readFileSync(join(here, "../../../packages/fs-builders/src/flashImage.ts"), "utf8");

check("a flash firmware install packs every active core and passes the relocation facts", () => {
  const problems = auditInstall(romSection);
  assert(problems.length === 0, problems.join("; "));
});

check("the plan names the directories the partition must carry, from the manifest paths", () => {
  const problems = auditBuilder(flashImage);
  assert(problems.length === 0, problems.join("; "));
});

check("buildCoresLittlefs creates them as directories, before any file", () => {
  const at = flashImage.indexOf("export async function buildCoresLittlefs");
  assert(at > 0, "buildCoresLittlefs is gone");
  const body = flashImage.slice(at, flashImage.indexOf("\n}", at));
  const mk = body.search(/fs\.mkdir\(path\)/);
  const files = body.search(/for \(const f of \[\.\.\.coreFiles\]/);
  assert(mk > 0, "buildCoresLittlefs never mkdirs the structural directories");
  assert(files > 0, "buildCoresLittlefs no longer writes coreFiles");
  assert(mk < files, "the structural directories are created after the files, so an empty install makes none");
  // A directory, not a zero-byte file: `rg_storage`'s stat reports is_dir and the firmware's
  // opendir fails on a file. Verified as distinguishable: mkdir yields type 2 and a zero-byte
  // writeFile yields type 1 through listDirFromImage.
  assert(!/writeFile\(path,/.test(body), "the structural directories are written as files, which opendir cannot open");
});

// ANTI-VACUITY. Strip the core packing and the relocation facts, and every assertion above must
// fail. Without this they could all be substrings that are simply never present.
check("ANTI-VACUITY: the same assertions fail on the no-cores shape", () => {
  const before = romSection
    .replace(/await prepareState\.prepareCoreArtifacts\([^)]*\);/g, "")
    .replace(/if \(!k\.startsWith\(CORES_PREFIX\)\) continue;/g, "")
    .replace(/for \(const \[k, v\] of prepareState\.assets\)/g, "for (const [k, v] of new Map())")
    .replace(/\n\s*mappedArtifacts: mappedArtifactsIn\(userRoms\),/, "");
  const problems = auditInstall(before);
  assert(problems.length === 3,
    `the no-cores shape should fail all three install assertions, it failed ${problems.length}: ${problems.join("; ") || "(none)"}`);

  const bare = flashImage.replace(/lfsDirs/g, "removedDirs");
  const builderProblems = auditBuilder(bare);
  assert(builderProblems.length === 2,
    `a plan without lfsDirs should fail both builder assertions, it failed ${builderProblems.length}`);
});

console.log(`\ncoreinstallwiring: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
