#!/usr/bin/env node
/**
 * "Check for new versions" actually refetches, and is rate limited.
 *
 *   docker compose exec dev sh -c 'cd /app/apps/web && node test/versionrefresh.mjs'
 *
 * `versions.json` is memoised for the session (`firmwareDist/memo.ts`), which is right for a
 * document that changes on the order of days: without it every consumer refetches the same
 * index. The cost is that a release published WHILE the app is open cannot appear, and the
 * picker gives no way to tell whether the list is current.
 *
 * So the control has one job: drop the memo and ask again. The two things that can silently
 * break it are (a) calling `listVersions` instead, which returns the memoised answer and looks
 * identical in the UI, and (b) forgetting the manifests too, which throws away downloads the
 * session already paid for. Both are asserted by counting fetches.
 */
import { mkdtempSync, symlinkSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
let passed = 0, failed = 0;
const check = async (name, fn) => {
  try { await fn(); passed++; } catch (e) { failed++; console.log(`  FAIL ${name}: ${e.message}`); }
};
const assert = (c, m) => { if (!c) throw new Error(m); };

const out = mkdtempSync(join(tmpdir(), "gnw-versionrefresh-"));
symlinkSync(join(here, "../../../node_modules"), join(out, "node_modules"));
const esbuild = await import("esbuild");
import { gnwResolveFor } from "./gnwResolve.mjs";
await esbuild.build({
  entryPoints: [join(here, "../src/lib/firmwareDist/memo.ts")],
  outfile: join(out, "memo.js"),
  bundle: true,
  format: "esm",
  platform: "neutral",
  target: "es2022",
  external: ["@gnw/*"],
  logLevel: "warning",
  plugins: [gnwResolveFor(import.meta.url)],
});
const { versionsOnce, manifestOnce, forgetVersions } = await import(pathToFileURL(join(out, "memo.js")).href);

const VERSIONS_URL = "https://example.invalid/dist/versions.json";
let versionFetches = 0;
let manifestFetches = 0;
// Shaped like the real published index (see test/fixtures/firmwaredist/versions.json): the
// parser refuses a document missing `project`, and a fixture that skipped it would be testing a
// shape the server never sends.
const body = (tags) => JSON.stringify({
  schemaVersion: 1,
  project: "retro-go-sd",
  title: "Retro-Go SD",
  repo: "slash-proc/game-and-watch-retro-go-sd",
  releasesUrl: "https://github.com/slash-proc/game-and-watch-retro-go-sd/releases",
  retained: 5,
  versions: tags.map((t) => ({
    tag: t,
    manifest: `${t}/manifest.json`,
    publishedAt: "2026-01-01T00:00:00Z",
    prerelease: false,
    gitTag: `Retro-Go SD ${t}`,
    providesAbi: { version: 2, size: 844 },
    coreMetaVersion: 3,
  })),
});
let live = ["v1"];
// GLOBAL fetch, not an injected one: `versionsOnce(url, fetchImpl)` deliberately bypasses the
// memo when given an implementation, so injecting here would test the one path the memo does not
// take. Stubbing the global keeps the code under test on its real path.
const fetchImpl = async (url) => {
  if (String(url).endsWith("versions.json")) {
    versionFetches++;
    return { ok: true, status: 200, async text() { return body(live); }, async json() { return JSON.parse(body(live)); } };
  }
  manifestFetches++;
  throw new Error("manifest fetch not exercised here");
};

globalThis.fetch = fetchImpl;

await check("the memo answers a second call without a fetch", async () => {
  versionFetches = 0;
  await versionsOnce(VERSIONS_URL);
  await versionsOnce(VERSIONS_URL);
  // PRECONDITION for everything below: if the memo did not hold, "refresh refetches" would be
  // true of any call at all and would prove nothing.
  assert(versionFetches === 1, `expected one fetch for two calls, got ${versionFetches}`);
});

await check("forgetVersions makes the next call refetch, and it sees the NEW list", async () => {
  // Start from a known state: the previous check left this URL memoised.
  forgetVersions(VERSIONS_URL);
  versionFetches = 0;
  await versionsOnce(VERSIONS_URL);
  live = ["v2", "v1"];                 // a release published while the app is open
  const stale = await versionsOnce(VERSIONS_URL);
  assert(stale.versions.length === 1, "the memo should still be serving the old list here");
  forgetVersions(VERSIONS_URL);
  const fresh = await versionsOnce(VERSIONS_URL);
  assert(fresh.versions.length === 2, `after forgetting, expected the new list, got ${fresh.versions.length}`);
  assert(versionFetches === 2, `expected exactly one refetch, got ${versionFetches - 1}`);
});

await check("forgetVersions leaves the manifest memo alone", async () => {
  // Manifests are keyed by URL and a new release brings a new URL, so nothing stale is reachable
  // through them. Clearing them would only re-download what the session already has.
  const src = readFileSync(join(here, "../src/lib/firmwareDist/memo.ts"), "utf8");
  const fn = src.slice(src.indexOf("export function forgetVersions"));
  const body2 = fn.slice(0, fn.indexOf("\n}"));
  assert(!/manifestMemo/.test(body2), "forgetVersions touches manifestMemo");
});

// --- the control ------------------------------------------------------------------------------
const rs = readFileSync(join(here, "../src/lib/advanced/RomSection.svelte"), "utf8");

function audit(src) {
  const problems = [];
  if (!/refreshVersions\(\)/.test(src)) {
    problems.push("the refresh calls something other than refreshVersions(), so it returns the memoised list");
  }
  if (!/refreshCooldown \|\| refreshingVersions/.test(src)) {
    problems.push("the button is not disabled while cooling down or in flight");
  }
  if (!/setTimeout\(\(\) => \(refreshCooldown = false\), 10000\)/.test(src)) {
    problems.push("the cooldown is not the 10 s the owner asked for");
  }
  if (!/aria-label=\{locale\.t\.romSection\.refreshVersions\}/.test(src)) {
    problems.push("the icon-only button has no accessible name");
  }
  if (!/if \(!selectedVersionUserSet/.test(src.slice(src.indexOf("doRefreshVersions")))) {
    problems.push("a refresh does not respect an explicit user choice");
  }
  return problems;
}

await check("the picker's refresh control is wired, rate limited and named", () => {
  const problems = audit(rs);
  assert(problems.length === 0, problems.join("; "));
});

await check("ANTI-VACUITY: the same assertions fail on a control that only looks right", () => {
  const before = rs
    .replace(/await refreshVersions\(\)/, "await listVersions()")
    .replace(/setTimeout\(\(\) => \(refreshCooldown = false\), 10000\)/, "setTimeout(() => (refreshCooldown = false), 0)")
    .replace(/aria-label=\{locale\.t\.romSection\.refreshVersions\}/, "");
  const problems = audit(before);
  assert(problems.length === 3,
    `expected three failures, got ${problems.length}: ${problems.join("; ") || "(none)"}`);
});

// The guided page carries the same control, and its own copy of the rule. Two copies is the
// deliberate shape (a snippet each, not a shared component), so both are asserted: a fix applied
// to one and not the other is exactly what this catches.
const wiz = readFileSync(join(here, "../src/lib/views/Wizard.svelte"), "utf8");

await check("the guided Install step carries the same refresh control", () => {
  const problems = [];
  if (!/await refreshVersions\(\)/.test(wiz)) problems.push("the guided refresh does not refetch");
  if (!/setTimeout\(\(\) => \(refreshCooldown = false\), 10000\)/.test(wiz)) {
    problems.push("the guided cooldown is not 10 s");
  }
  if (!/aria-label=\{locale\.t\.romSection\.refreshVersions\}/.test(wiz)) {
    problems.push("the guided button has no accessible name");
  }
  assert(problems.length === 0, problems.join("; "));
});

/**
 * WHERE it sits, which changed and is the owner's instruction.
 *
 * It used to render twice, once inside each shape of the install step (Install when the step is
 * not done, Reinstall/Upgrade when it is), because the shapes swap and the control belongs to
 * both. The owner moved it beside the step's title instead: the title does not swap, so one
 * render there serves both shapes and says the thing once.
 *
 * The count is asserted as EXACTLY one rather than at least one. Two renders is the old shape,
 * and it would put a second refresh on the page the moment anyone re-added it to a control row.
 */
await check("the guided refresh sits in the step's title row, exactly once", () => {
  const problems = [];
  const renders = wiz.match(/@render refreshVersionsButton\(\)/g) ?? [];
  if (renders.length !== 1) {
    problems.push(`the refresh renders ${renders.length} times; it belongs once, on the title row`);
  }
  // The title row is the one element that does NOT swap between the step's two shapes, which is
  // the whole reason it is the right home. Slice it out and require the render inside it.
  const i = wiz.indexOf('<div class="title-row">');
  assert(i >= 0, "the step's title row is gone or renamed");
  const titleRow = wiz.slice(i, wiz.indexOf("</div>", i));
  if (!/@render refreshVersionsButton\(\)/.test(titleRow)) {
    problems.push("the refresh is not in the title row, so it belongs to one shape of the step rather than both");
  }
  if (!/id === "install"/.test(titleRow)) {
    problems.push("the title row renders the refresh on every step, not just the install step");
  }
  assert(problems.length === 0, problems.join("; "));
});

await check("the guided page shows no Done chip, and the string is gone", () => {
  // The rail already replaces the step number with a green check; a word repeating it is filler.
  assert(!/chipDone/.test(wiz), "the Done chip is still rendered");
  const en = readFileSync(join(here, "../src/lib/i18n/strings/wizard.ts"), "utf8");
  assert(!/chipDone/.test(en), "wizard.chipDone still exists in the string table");
});

await check("the dual-boot backup step is done on bank-1 patch evidence", () => {
  // A patched Zelda/Mario image in bank 1 is device truth. The local backup flag is still
  // required for Retro-Go-only, which never patches, but must not keep an already-patched
  // dual-boot device looking unfinished after a reload or another session.
  const m = wiz.match(/let step1Done = \$derived\(([\s\S]*?)\);/);
  assert(m, "step1Done is gone or reshaped");
  assert(!/isPatched/.test(m[1]), `step1Done still depends on isPatched (and so on hasAssets): ${m[1].trim()}`);
  assert(/path === "rgo" \? backupTaken : !!device\.deviceClass\?\.ofw\?\.patched/.test(m[1]),
    `step1Done must use bank-1 patch evidence for dual boot and the backup flag only for Retro-Go: ${m[1].trim()}`);
});

console.log(`\nversionrefresh: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
