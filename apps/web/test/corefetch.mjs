#!/usr/bin/env node
/**
 * An install FETCHES the cores its selection needs; the gate cannot do it.
 *
 *   docker compose exec dev sh -c 'cd /app/apps/web && node test/corefetch.mjs'
 *
 * `sources/coreGate.ts` decides which PREPARED cores survive a selection. It reads
 * `prepareState.producedKeys` and `assetSourceOf`, so a core nobody prepared has no keys, is
 * kept by nothing, and is written by nothing. Selecting a GBC ROM without having opened Sources
 * and prepared tgb-dual therefore installed the ROM and no core at all, silently, which is
 * exactly what the owner hit.
 *
 * Both install paths must fetch first, and they are separate functions on purpose
 * (`runInstall` is Flash, `doSdSync` is SD; conflating them is a documented trap in CLAUDE.md),
 * so both are asserted. SD needs it as much as Flash does: the gate is a no-op there, but bytes
 * that were never fetched are still absent.
 *
 * A WIRING check, and it says so: the install lives in a Svelte handler behind a device
 * connection. Kept honest by an anti-vacuity case that runs the same assertions against the
 * pre-fix shape and requires them to fail.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
let failed = 0, passed = 0;
const check = (name, fn) => {
  try { fn(); passed++; } catch (e) { failed++; console.log(`  FAIL ${name}: ${e.message}`); }
};
const assert = (c, m) => { if (!c) throw new Error(m); };

/** One function's body, by brace matching from its declaration. */
function bodyOf(src, decl) {
  const at = src.indexOf(decl);
  assert(at > 0, `${decl} is gone from RomManagementTab.svelte`);
  let depth = 0, i = src.indexOf("{", at);
  const open = i;
  for (; i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}" && --depth === 0) break;
  }
  // Comments stripped: this reasons about ORDER of real statements, and a comment naming
  // `selectedAssets` above the fetch read as a use before it. That was a false positive on the
  // first run, which is the sort of thing that gets "fixed" by loosening the assertion.
  return src.slice(open, i).replace(/^\s*\/\/.*$/gm, "");
}

function audit(src) {
  const problems = [];

  // The helper must actually fetch, not merely exist.
  const helper = bodyOf(src, "async function ensureCoresPrepared(");
  if (!/await prepareState\.prepareCoreArtifacts\(/.test(helper)) {
    problems.push("ensureCoresPrepared never fetches a core's artifacts");
  }
  // The target must come from the source MANIFEST. `homebrew.titles` drops a core with no
  // converter (`if (isCore && tool === undefined) continue;`), which is most cores -- tgb-dual
  // among them, which is how a GBC ROM installed with no core while Doom, the one core with a
  // converter, was the only entry in that list.
  if (/homebrew\.titles/.test(helper)) {
    problems.push("the core lookup goes through homebrew.titles, which excludes every core without a converter");
  }
  if (!/sources\.rows/.test(helper) || !/manifest\?\.targets/.test(helper)) {
    problems.push("the core target is not resolved from the source manifest");
  }
  // Driven by the SELECTION through the registry, not by source activation: activating a source
  // is not a request to install its core (that is how the Doom core reached the device).
  if (!/selectedSystems/.test(helper) || !/coreRegistry\.current\.systems/.test(helper)) {
    problems.push("the fetch is not driven by the selected systems through the core registry");
  }

  // A fetch during the install must INVALIDATE the preview. `builtFrogfs`/`builtPendingLfs`
  // are produced by the preview effect before the fetch, and `selSig` does not change when a
  // fetch adds bytes, so reusing the preview ships the ROM with no core -- the same symptom
  // twice in a row.
  const run = bodyOf(src, "async function runInstall(");
  const gotFetch = run.match(/const (\w+) = await ensureCoresPrepared\([^)]*\);/);
  if (!gotFetch) {
    problems.push("runInstall ignores whether ensureCoresPrepared actually fetched anything");
  } else {
    const flag = gotFetch[1];
    const reuse = run.match(/let frogfs = [^;]+;/);
    if (!reuse || !reuse[0].includes(flag)) {
      problems.push("the preview image is reused without asking whether cores were just fetched");
    }
    if (!new RegExp(`if \\(${flag}\\)[\\s\\S]{0,200}builtPendingLfs = \\[\\]`).test(run)) {
      problems.push("a fetch does not clear builtPendingLfs, so the LittleFS half stays stale");
    }
  }

  // The LittleFS write is its OWN visible step. It runs after the FrogFS flash inside the same
  // phase, so without a substep the bar sat at 100% while work continued and a hang there was
  // indistinguishable from a finished install. Declared unconditionally: an install with no
  // cores still shows the step rather than the checklist changing shape per run.
  if (!/substeps: \[[\s\S]{0,400}?id: "cores"/.test(src)) {
    problems.push("the flash phase declares no cores substep, so the LittleFS write is invisible");
  }
  if (!/report\.subStart\("flash", "cores"\)/.test(src)) {
    problems.push("nothing starts the cores substep, so it never lights up");
  }
  if (!/report\.progress\("flash", done, total, "cores"\)/.test(src)) {
    problems.push("the LittleFS write reports no progress into its own substep");
  }

  // Both paths call it, and before the bytes are read.
  for (const [decl, label] of [
    ["async function runInstall(", "the Flash ROM install"],
    ["async function doSdSync(", "the SD sync"],
  ]) {
    const body = bodyOf(src, decl);
    const call = body.search(/await ensureCoresPrepared\(/);
    if (call < 0) { problems.push(`${label} never fetches the cores its selection needs`); continue; }
    const use = body.indexOf("selectedAssets");
    if (use >= 0 && call > use) {
      problems.push(`${label} fetches cores AFTER reading selectedAssets, so the build sees no bytes`);
    }
  }
  return problems;
}

const src = readFileSync(join(here, "../src/lib/views/RomManagementTab.svelte"), "utf8");

check("both installs fetch the cores their selection needs, before building", () => {
  const problems = audit(src);
  assert(problems.length === 0, problems.join("; "));
});

check("ANTI-VACUITY: the same assertions fail with the fetch removed", () => {
  const before = src.replace(/await ensureCoresPrepared\([^)]*\)/g, "false");
  const problems = audit(before);
  // Three, not two: removing the call also removes the value runInstall branches on, so the
  // preview-invalidation assertion loses its subject as well. Pinned exactly, so a change that
  // quietly stops one of them from firing is a failure rather than a smaller number.
  // Exactly the assertions that lose their subject when the fetch is gone. Pinned, so an
  // assertion quietly ceasing to fire is a failure rather than a smaller number.
  assert(problems.length === 3,
    `the pre-fix shape should fail exactly three, ${problems.length} did: ${problems.join("; ") || "(none)"}`);
});

console.log(`\ncorefetch: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
