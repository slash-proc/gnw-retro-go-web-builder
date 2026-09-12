#!/usr/bin/env node
/**
 * Offline coverage for the CURATED-LIST import in `src/lib/sources/store.svelte.ts`.
 *
 *   docker compose exec dev sh -c 'cd /app/apps/web && node test/curatedsources.mjs'
 *
 * Plain node, no framework (repo convention). `$state` is defined away for node exactly as
 * `test/localfolders.mjs` does it, and both network seams (`load` the list, `resolve` one
 * project) are INJECTED through `CuratedDeps`, so nothing here touches a network.
 *
 * The contract under test — these are the design decisions, pinned:
 *   - a release WITH `projects` produces one row per entry, all INACTIVE (the app listed them;
 *     the user did not ask to install them)
 *   - a release WITHOUT one (`load` -> null) adds nothing and is NOT an error
 *   - the whole walk failing is likewise not an error: the rail degrades to what it had
 *   - an entry the user already added by hand produces ONE row, and the user's row is the one
 *     that survives untouched (title, active flag, pinned tag)
 *   - one entry failing to resolve leaves every other entry intact
 *   - a `versionsUrl` that is not the canonical mirror path for the repo it names is refused
 *   - a repo the user REMOVED does not come back on the next import
 *   - a failed entry is NEVER a row: it becomes one section-scoped note (title + rail from
 *     projects.json), excluded from the rail counts, retryable per-section without re-walking
 *     the curated discovery list, and a dedup skip is not a failure
 */
import { mkdtempSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

let passed = 0;
const failures = [];
async function check(name, fn) {
  try { await fn(); passed++; } catch (e) { failures.push(`${name}: ${e && e.message ? e.message : e}`); }
}
function eq(a, b, msg) {
  if (a !== b) throw new Error(`${msg}: expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);
}
function ok(v, msg) { if (!v) throw new Error(msg); }

const here = dirname(fileURLToPath(import.meta.url));
const out = mkdtempSync(join(tmpdir(), "gnw-curated-"));
symlinkSync(join(here, "../../../node_modules"), join(out, "node_modules"));
const esbuild = await import("esbuild");
await esbuild.build({
  entryPoints: [join(here, "../src/lib/sources/store.svelte.ts")],
  outfile: join(out, "store.js"),
  bundle: true,
  format: "esm",
  platform: "neutral",
  target: "es2022",
  define: { $state: "__rune" },
  // Same reason as `src/lib/sources/test/validate.mjs`: `bundle.ts` (pulled in by the store's
  // import graph, never exercised here) pulls jszip, a CJS package that reaches for node's
  // own buffer/stream through readable-stream and cannot go into a `platform: neutral` build.
  // The node_modules symlink above is what lets node resolve it at import time.
  external: ["jszip"],
  banner: { js: "const __rune = (v) => v;" },
  logLevel: "warning",
});

const mem = new Map();
globalThis.localStorage = {
  getItem: (k) => (mem.has(k) ? mem.get(k) : null),
  setItem: (k, v) => void mem.set(k, String(v)),
  removeItem: (k) => void mem.delete(k),
};

const { SourcesStore, curatedRepoFor, UPDATE_ALL_CONCURRENCY } = await import(pathToFileURL(join(out, "store.js")).href);

const url = (repo) => `https://${repo.split("/")[0]}.github.io/${repo.split("/")[1]}/dist/versions.json`;
const entry = (repo, kind, title) => ({ project: repo.split("/")[1], title, kind, versionsUrl: url(repo) });

/** A `ResolvedSource` in the only shape `toCard()` reads. */
const resolved = (repo, kind, title) => ({
  repo,
  entry: { kind, tag: "v1.0.0", publishedAt: "2026-01-01T00:00:00Z", prerelease: false, needsUserFiles: false },
  index: { releasesUrl: `https://github.com/${repo}/releases`, versions: [{ tag: "v1.0.0", manifest: "m", publishedAt: "2026-01-01T00:00:00Z", prerelease: false }] },
  manifest: {
    title,
    targets: [{ platform: "game-and-watch", requiresAbi: { version: 1, minSize: 4 }, systems: [] }],
  },
});

const CORE = "slash-proc/fceumm-retro-go-sd";
const HB = "slash-proc/snake-retro-go-sd";
const LIST = [entry(CORE, "core", "FCEUmm"), entry(HB, "homebrew", "Snake")];

/** A store with a clean localStorage, loaded with the auto-import seam off. */
function freshStore() {
  mem.clear();
  const s = new SourcesStore();
  s.load(false);
  return s;
}

const okResolver = (kinds) => async (repo) => {
  const k = kinds[repo];
  if (!k) throw new Error(`no fixture for ${repo}`);
  return resolved(repo, k.kind, k.title);
};
const KINDS = { [CORE]: { kind: "emulator", title: "FCEUmm" }, [HB]: { kind: "homebrew", title: "Snake" } };

await check("a manifest WITH projects yields one inactive row per entry, in the right rail", async () => {
  const s = freshStore();
  await s.importCurated({ load: async () => LIST, resolve: okResolver(KINDS) });
  eq(s.rows.length, 2, "two rows");
  eq(s.byKind.core.length, 1, "the core lands under Emulators");
  eq(s.byKind.homebrew.length, 1, "the homebrew lands under Homebrew");
  eq(s.byKind.core[0].repo, CORE, "emulator row is the core");
  ok(s.rows.every((r) => r.active === false), "curated rows start INACTIVE");
  ok(s.rows.every((r) => r.status === "ok" && r.card), "rows carry a resolved card");
  eq(s.selected, null, "importing selects nothing");
});

await check("a manifest WITHOUT projects adds nothing and is not an error", async () => {
  const s = freshStore();
  await s.importCurated({ load: async () => null, resolve: () => { throw new Error("must not resolve"); } });
  eq(s.rows.length, 0, "nothing added");
});

await check("the whole walk failing degrades to today's rail, not an error", async () => {
  const s = freshStore();
  await s.importCurated({
    load: async () => { throw new Error("offline"); },
    resolve: () => { throw new Error("must not resolve"); },
  });
  eq(s.rows.length, 0, "nothing added, nothing thrown");
});

await check("a curated entry the user already added is ONE row, and theirs wins", async () => {
  const s = freshStore();
  ok(s.addResolved(resolved(CORE, "emulator", "My own copy")), "manual add");
  s.setActive(CORE, true);
  const before = s.rows.length;
  const asked = [];
  // The curated resolve would produce a DIFFERENT row for the same repo, so a missing dedupe
  // shows up as a second row rather than as a swallowed error.
  await s.importCurated({
    load: async () => LIST,
    resolve: async (repo) => {
      asked.push(repo);
      return resolved(repo, repo === CORE ? "emulator" : "homebrew", "Curated copy");
    },
  });
  eq(s.rows.filter((r) => r.repo === CORE).length, 1, "exactly one row for the repo");
  eq(s.rows.length, before + 1, "only the other entry was added");
  eq(asked.join(","), HB, "a repo the user already has is not even fetched");
  const mine = s.get(CORE);
  eq(mine.card.title, "My own copy", "the user's resolve is untouched");
  eq(mine.active, true, "the user's active flag is untouched");
});

await check("one entry failing to resolve leaves the others intact", async () => {
  const s = freshStore();
  await s.importCurated({
    load: async () => LIST,
    resolve: async (repo) => {
      if (repo === CORE) throw new Error("404");
      return resolved(repo, "homebrew", "Snake");
    },
  });
  eq(s.rows.length, 1, "the healthy entry landed");
  eq(s.rows[0].repo, HB, "and it is the one that resolved");
  eq(s.get(CORE), undefined, "the failed entry contributes no row this session");
});

// --- SourcesCuratedUnreadable.dc.html: the failure NOTE ----------------------------------
// A failed entry is never a row (a card-less row parks in the wrong rail, and an offline first
// visit would draw ~22 of them). It is one section-scoped note, retryable in place.

await check("a failed entry becomes one note under ITS OWN rail, naming it", async () => {
  const s = freshStore();
  await s.importCurated({
    load: async () => LIST,
    resolve: async (repo) => {
      if (repo === CORE) throw new Error("404");
      return resolved(repo, "homebrew", "Snake");
    },
  });
  eq(s.curatedFailures.length, 1, "one failure recorded");
  eq(s.curatedFailures[0].repo, CORE, "and it is the entry that failed");
  eq(s.curatedFailures[0].title, "FCEUmm", "the note carries projects.json's title");
  eq(s.curatedFailuresByKind.core.length, 1, "a failed core files under Emulators");
  eq(s.curatedFailuresByKind.homebrew.length, 0, "and not under Homebrew");
  // Rail counts are the rows you HAVE; a failure is not one of them.
  eq(s.byKind.core.length, 0, "the Emulators count excludes the failure");
  eq(s.byKind.homebrew.length, 1, "the healthy homebrew row still counts");
});

await check("a dedup skip is not a failure", async () => {
  const s = freshStore();
  ok(s.addResolved(resolved(CORE, "emulator", "My own copy")), "manual add");
  await s.importCurated({
    load: async () => LIST,
    resolve: async (repo) => {
      if (repo === CORE) throw new Error("must not resolve a repo the user already has");
      return resolved(repo, "homebrew", "Snake");
    },
  });
  eq(s.curatedFailures.length, 0, "a skipped entry raises no note");
});

await check("every entry failing is one note per section, and no rows", async () => {
  const s = freshStore();
  await s.importCurated({ load: async () => LIST, resolve: async () => { throw new Error("offline"); } });
  eq(s.rows.length, 0, "no rows at all");
  eq(s.curatedFailuresByKind.core.length, 1, "one Emulators note entry");
  eq(s.curatedFailuresByKind.homebrew.length, 1, "one Homebrew note entry");
  eq(s.curatedFailures.map((f) => f.title).join(", "), "FCEUmm, Snake", "titles in list order");
});

await check("a successful retry adds the row and clears the note", async () => {
  const s = freshStore();
  await s.importCurated({ load: async () => LIST, resolve: async () => { throw new Error("offline"); } });
  eq(s.curatedFailures.length, 2, "both failed");
  let listed = 0;
  // Retry is scoped to the section AND to the failed entries — it must not re-walk discovery.
  await s.retryCurated("core", {
    load: async () => { listed++; return LIST; },
    resolve: okResolver(KINDS),
  });
  eq(listed, 0, "retry does not re-walk the curated discovery list");
  eq(s.rows.length, 1, "the retried entry became a row");
  eq(s.rows[0].repo, CORE, "and it is the core");
  eq(s.rows[0].active, false, "still inactive, as any curated row is");
  eq(s.curatedFailuresByKind.core.length, 0, "its note is cleared");
  eq(s.curatedFailuresByKind.homebrew.length, 1, "the other section's note is untouched");
});

await check("a failure is not cached, so a retry really retries", async () => {
  const s = freshStore();
  const asked = [];
  const flaky = async (repo) => {
    asked.push(repo);
    if (asked.filter((r) => r === repo).length === 1) throw new Error("first attempt fails");
    return resolved(repo, repo === CORE ? "emulator" : "homebrew", "Recovered");
  };
  await s.importCurated({ load: async () => LIST, resolve: flaky });
  eq(s.rows.length, 0, "both failed the first time");
  await s.retryCurated("core", { load: async () => LIST, resolve: flaky });
  eq(asked.filter((r) => r === CORE).length, 2, "the failed entry was fetched again");
  eq(s.get(CORE)?.card.title, "Recovered", "the second attempt is what landed");
  await s.retryCurated("homebrew", { load: async () => LIST, resolve: flaky });
  eq(s.curatedFailures.length, 0, "both notes cleared");
  eq(s.rows.length, 2, "and both rows exist");
});

await check("a versionsUrl that is not the repo's canonical mirror is refused", async () => {
  eq(curatedRepoFor(entry(CORE, "core", "x")), CORE, "the canonical mirror maps to owner/repo");
  for (const bad of [
    "https://slash-proc.github.io/fceumm-retro-go-sd/other/dist/versions.json",
    "https://example.test/dist/versions.json",
    "https://slash-proc.github.io/dist/versions.json",
  ]) {
    eq(curatedRepoFor({ project: "p", title: "t", kind: "core", versionsUrl: bad }), null, `refused: ${bad}`);
  }
  const s = freshStore();
  await s.importCurated({
    load: async () => [{ project: "p", title: "t", kind: "core", versionsUrl: "https://example.test/dist/versions.json" }],
    resolve: () => { throw new Error("must not resolve a URL we could not map"); },
  });
  eq(s.rows.length, 0, "an unmappable entry adds nothing");
});

await check("a repo the user removed does not come back on the next import", async () => {
  const s = freshStore();
  await s.importCurated({ load: async () => LIST, resolve: okResolver(KINDS) });
  eq(s.rows.length, 2, "both added");
  s.remove(CORE);
  eq(s.rows.length, 1, "removed");
  // Same tab.
  await s.importCurated({ load: async () => LIST, resolve: okResolver(KINDS) });
  eq(s.rows.length, 1, "the import does not undo the removal");
  // A later visit: a brand-new store over the SAME localStorage.
  const s2 = new SourcesStore();
  s2.load(false);
  await s2.importCurated({ load: async () => LIST, resolve: okResolver(KINDS) });
  eq(s2.rows.filter((r) => r.repo === CORE).length, 0, "still gone after a reload");
  eq(s2.rows.length, 1, "the other curated row survived the reload");
  // Adding it back by hand clears the tombstone.
  ok(s2.addResolved(resolved(CORE, "emulator", "FCEUmm")), "manual re-add");
  const s3 = new SourcesStore();
  s3.load(false);
  await s3.importCurated({ load: async () => LIST, resolve: okResolver(KINDS) });
  eq(s3.rows.filter((r) => r.repo === CORE).length, 1, "one row, not resurrected twice");
});

// --- Update all: the remote pane's bulk refresh -------------------------------------------
// `updateAll` drives `refresh()` per row, so what is pinned here is the BATCH behaviour:
// which rows are in it, how wide it runs, and that it cannot be re-entered. The per-row
// semantics (pin honoured, bundle refused) belong to `refresh` and are asserted through it.

const CORE2 = "slash-proc/tgb-retro-go-sd";
const BUNDLED = "slash-proc/gwenesis-retro-go-sd";
const KINDS3 = {
  ...KINDS,
  [CORE2]: { kind: "emulator", title: "Game Boy" },
  [BUNDLED]: { kind: "emulator", title: "Genesis" },
};

/** Two cores, one bundle-origin core, one homebrew. */
async function paneStore() {
  const s = freshStore();
  await s.importCurated({
    load: async () => [
      entry(CORE, "core", "FCEUmm"),
      entry(CORE2, "core", "Game Boy"),
      entry(BUNDLED, "core", "Genesis"),
      entry(HB, "homebrew", "Snake"),
    ],
    resolve: okResolver(KINDS3),
  });
  s.get(BUNDLED).origin = "bundle";
  return s;
}

await check("Update all refreshes every non-bundle row of THAT pane and nothing else", async () => {
  const s = await paneStore();
  const seen = [];
  await s.updateAll("core", async (repo) => void seen.push(repo));
  eq(seen.length, 2, "both network-resolved cores were refreshed");
  ok(seen.includes(CORE) && seen.includes(CORE2), "and they are the two cores");
  ok(!seen.includes(HB), "the homebrew pane is untouched — the panes update respectively");
});

await check("a bundle row is stepped over, not failed", async () => {
  const s = await paneStore();
  const seen = [];
  await s.updateAll("core", async (repo) => void seen.push(repo));
  ok(!seen.includes(BUNDLED), "a bundle has no mirror, so it is never refreshed");
  eq(s.get(BUNDLED).status, "ok", "and it is left alone — not loading, not errored");
  eq(s.get(BUNDLED).errorCode, undefined, "no error code either");
});

await check("one row failing leaves the rest updated", async () => {
  const s = await paneStore();
  const done = [];
  await s.updateAll("core", async (repo) => {
    if (repo === CORE) throw new Error("boom");
    done.push(repo);
  });
  eq(done.length, 1, "the other core still ran");
  eq(done[0], CORE2, "and it is the one that did not throw");
  eq(s.updating, null, "the pane is not left stuck busy by a thrown job");
});

await check("concurrency is bounded, and the bound is actually reached", async () => {
  const s = freshStore();
  const many = Array.from({ length: 9 }, (_, i) => `slash-proc/core${i}-retro-go-sd`);
  const kinds = Object.fromEntries(many.map((r) => [r, { kind: "emulator", title: r }]));
  await s.importCurated({
    load: async () => many.map((r) => entry(r, "core", r)),
    resolve: okResolver(kinds),
  });
  let live = 0;
  let peak = 0;
  await s.updateAll("core", async () => {
    live++;
    peak = Math.max(peak, live);
    await new Promise((r) => setTimeout(r, 1));
    live--;
  });
  eq(peak, UPDATE_ALL_CONCURRENCY, "nine rows run three at a time, never nine at once");
});

await check("the action cannot be re-entered while it runs", async () => {
  const s = await paneStore();
  let calls = 0;
  let release;
  const gate = new Promise((r) => (release = r));
  const first = s.updateAll("core", async () => {
    calls++;
    await gate;
  });
  eq(s.updating, "core", "the pane reports itself busy while it runs");
  await s.updateAll("core", async () => void calls++);
  eq(calls, 2, "a second click during the run adds no work (2 = the first batch's own width)");
  release();
  await first;
  eq(s.updating, null, "and the pane is free again afterwards");
});

await check("the OTHER pane is still updatable while one runs", async () => {
  const s = await paneStore();
  let release;
  const gate = new Promise((r) => (release = r));
  const first = s.updateAll("core", async () => void (await gate));
  const seen = [];
  await s.updateAll("homebrew", async (repo) => void seen.push(repo));
  eq(seen.length, 1, "Emulators being busy does not block Homebrew");
  eq(seen[0], HB, "and it refreshed the homebrew row");
  release();
  await first;
});

await check("a PINNED row is refreshed, never silently un-pinned", async () => {
  const s = await paneStore();
  s.get(CORE).pinnedTag = "v0.9.0";
  const seen = [];
  await s.updateAll("core", async (repo) => void seen.push(repo));
  ok(seen.includes(CORE), "the pinned row is still re-fetched — that is how a new release appears in its picker");
  eq(s.get(CORE).pinnedTag, "v0.9.0", "but the pin the user chose survives the update");
});

if (failures.length) {
  console.error(`curatedsources: ${failures.length} failure(s)`);
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
if (passed === 0) {
  console.error("curatedsources: no assertions ran");
  process.exit(1);
}
console.log(`curatedsources: ${passed} checks passed`);
